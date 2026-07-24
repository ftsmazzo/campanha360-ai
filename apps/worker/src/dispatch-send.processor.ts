import { randomUUID } from 'node:crypto';
import {
  ChannelAccountStatus,
  ContactStatus,
  DispatchChannelOperationalStatus,
  DispatchItemErrorCategory,
  DispatchItemStatus,
  DispatchStatus,
  type PrismaClient,
} from '@prisma/client';
import {
  assertDispatchSendJobPayload,
  buildReassignmentUpdate,
  canReassignDispatchItem,
  computeDispatchNextRetryAt,
  isDispatchDestinationAllowed,
  isDispatchEngineEnabled,
  isDispatchQueueEnabled,
  isDispatchRetryExhausted,
  isDispatchSendEnabled,
  isWithinOperationalWindow,
  resolveNextOperationalWindowStart,
  selectNextEligibleDispatchChannel,
  sendEvolutionText,
  type EvolutionSendCategory,
  type EvolutionSendInput,
  type EvolutionSendResult,
  type OperationalWindowConfig,
  type SelectableDispatchChannel,
} from '@campanha360/shared';

/**
 * Worker de disparo. Consome jobs da fila `dispatch-send`.
 *
 * - Enquanto o Dispatch nao esta RUNNING, ou RUNNING mas
 *   DISPATCH_SEND_ENABLED=false, mantem o path tecnico da subetapa 09.3
 *   (apenas valida/technicalValidatedAt, NUNCA chama a Evolution).
 * - Quando o Dispatch esta RUNNING e DISPATCH_SEND_ENABLED=true, executa o
 *   envio real (subetapa 09.4): last-mile (opt-out/bloqueio/destino),
 *   selecao/rotacao de canal, respeito a delays/pausas, chamada a
 *   Evolution (injetavel via `deps.sendText` para testes) e resolucao de
 *   SENT / RETRY_SCHEDULED / FAILED / UNKNOWN_PROVIDER_STATE.
 */

const LOCK_DURATION_MS = 30_000;
const DEFER_MINUTES_NO_CHANNEL = 5;
const CHANNEL_COOLDOWN_STEP_MS = 5 * 60_000;
const CHANNEL_COOLDOWN_MAX_STEPS = 6;
const CHANNEL_FAILOVER_RETRY_DELAY_MS = 5_000;

const TERMINAL_DISPATCH_STATUSES = new Set<string>([
  DispatchStatus.FAILED,
  DispatchStatus.COMPLETED,
  DispatchStatus.COMPLETED_WITH_ERRORS,
]);

const ALREADY_SENT_ITEM_STATUSES = new Set<string>([
  DispatchItemStatus.SENT,
  DispatchItemStatus.DELIVERED,
  DispatchItemStatus.READ,
]);

const CLAIMABLE_ITEM_STATUSES: DispatchItemStatus[] = [
  DispatchItemStatus.QUEUED,
  DispatchItemStatus.SCHEDULED,
];

const CLAIMABLE_ITEM_STATUSES_REAL_SEND: DispatchItemStatus[] = [
  DispatchItemStatus.QUEUED,
  DispatchItemStatus.SCHEDULED,
  DispatchItemStatus.RETRY_SCHEDULED,
];

const DEFAULT_WINDOW: OperationalWindowConfig = {
  timezone: 'America/Sao_Paulo',
  allowedStartTime: '09:00',
  allowedEndTime: '18:00',
  allowedDays: [1, 2, 3, 4, 5, 6],
};

const DEFAULT_SEND_POLICY: DispatchSendProtectionPolicy = {
  minDelaySeconds: 20,
  maxDelaySeconds: 45,
  batchSize: 15,
  pauseBetweenBatchesSeconds: 600,
  longPauseEveryMessages: 50,
  longPauseMinutes: 15,
  rotateEveryMessages: 100,
  pauseOn403: true,
  pauseOn429: true,
};

export type DispatchSendJobLike = {
  id?: string;
  data: unknown;
  token?: string;
  moveToDelayed?: (timestamp: number, token?: string) => Promise<void>;
};

export type DispatchSendProcessAction =
  | 'TECHNICAL_VALIDATED'
  | 'NOOP_NOT_FOUND'
  | 'NOOP_DISPATCH_NOT_ACTIVE'
  | 'NOOP_ALREADY_SENT'
  | 'DEFERRED_REDISTRIBUTION'
  | 'DEFERRED_NO_CHANNEL'
  | 'DEFERRED_OUTSIDE_WINDOW'
  | 'DEFERRED_CHANNEL_DELAY'
  | 'DEFERRED_CHANNEL_COOLDOWN'
  | 'SKIPPED_FLAG_DISABLED'
  | 'SKIPPED_CLAIM_LOST'
  | 'SKIPPED_CONTACT_DELETED'
  | 'SKIPPED_CONTACT_BLOCKED'
  | 'SKIPPED_CONTACT_OPT_OUT'
  | 'SKIPPED_PILOT_DESTINATION_NOT_ALLOWED'
  | 'FAILED_INVALID_DESTINATION'
  | 'SENT'
  | 'RETRY_SCHEDULED'
  | 'FAILED'
  | 'UNKNOWN_PROVIDER_STATE'
  | 'BLOCKED_SEND_DISABLED'
  | 'BLOCKED_DISPATCH_PAUSING'
  | 'BLOCKED_DISPATCH_PAUSED'
  | 'BLOCKED_DISPATCH_CANCELED'
  | 'BLOCKED_DISPATCH_EMERGENCY_STOPPED';

export type DispatchSendProcessResult = {
  action: DispatchSendProcessAction;
  send: boolean;
  dispatchItemId?: string;
  reason?: string;
  /**
   * Quando definido, o Worker BullMQ deve chamar `job.moveToDelayed(delayUntil, token)`
   * e em seguida lançar `DelayedError` — sem isso o BullMQ tenta `moveToFinished`
   * com o lock já consumido ("Missing lock").
   */
  delayUntil?: Date;
};

export type DispatchSendProtectionPolicy = {
  minDelaySeconds: number;
  maxDelaySeconds: number;
  batchSize: number;
  pauseBetweenBatchesSeconds: number;
  longPauseEveryMessages: number;
  longPauseMinutes: number;
  rotateEveryMessages: number;
  pauseOn403: boolean;
  pauseOn429: boolean;
};

export type DispatchSendProcessorDeps = {
  prisma: PrismaClient;
  now?: () => Date;
  /** Injetavel para testes; default = cliente real (fetch nativo). */
  sendText?: (input: EvolutionSendInput) => Promise<EvolutionSendResult>;
  evolutionBaseUrl?: string;
  evolutionApiKey?: string;
  /** Injetavel para testes deterministicos do delay min/max por canal. */
  random?: () => number;
};

export async function processDispatchSendJob(
  job: DispatchSendJobLike,
  deps: DispatchSendProcessorDeps,
): Promise<DispatchSendProcessResult> {
  const now = deps.now ?? (() => new Date());
  const prisma = deps.prisma;

  if (!isDispatchEngineEnabled() || !isDispatchQueueEnabled()) {
    return {
      action: 'SKIPPED_FLAG_DISABLED',
      send: false,
      reason: 'DISPATCH_ENGINE_OR_QUEUE_DISABLED',
    };
  }

  const payload = assertDispatchSendJobPayload(job.data);

  const dispatch = await prisma.dispatch.findFirst({
    where: {
      id: payload.dispatchId,
      organizationId: payload.organizationId,
      campaignId: payload.campaignId,
    },
    select: {
      id: true,
      status: true,
      totalItems: true,
      requiringRedistribution: true,
      approvalSnapshot: true,
      configurationSnapshot: true,
    },
  });

  const item = await prisma.dispatchItem.findFirst({
    where: {
      id: payload.dispatchItemId,
      dispatchId: payload.dispatchId,
      organizationId: payload.organizationId,
      campaignId: payload.campaignId,
    },
  });

  if (!dispatch || !item) {
    return {
      action: 'NOOP_NOT_FOUND',
      send: false,
      dispatchItemId: payload.dispatchItemId,
      reason: 'DISPATCH_OR_ITEM_NOT_FOUND',
    };
  }

  if (TERMINAL_DISPATCH_STATUSES.has(String(dispatch.status))) {
    return {
      action: 'NOOP_DISPATCH_NOT_ACTIVE',
      send: false,
      dispatchItemId: item.id,
      reason: `DISPATCH_STATUS_${dispatch.status}`,
    };
  }

  // 09.5 — bloqueios operacionais (antes de SEND / Evolution)
  const operationalBlock = await handleOperationalDispatchBlock({
    prisma,
    dispatch,
    item,
    now,
  });
  if (operationalBlock) {
    return operationalBlock;
  }

  if (
    item.providerMessageId ||
    item.sentAt ||
    ALREADY_SENT_ITEM_STATUSES.has(String(item.status))
  ) {
    return {
      action: 'NOOP_ALREADY_SENT',
      send: false,
      dispatchItemId: item.id,
      reason: 'ITEM_ALREADY_SENT',
    };
  }

  if (dispatch.requiringRedistribution) {
    await prisma.dispatchItem.updateMany({
      where: {
        id: item.id,
        status: { in: [...CLAIMABLE_ITEM_STATUSES_REAL_SEND] },
      },
      data: {
        status: DispatchItemStatus.SCHEDULED,
        scheduledAt: now(),
        lastQueueError: 'DISPATCH_REQUIRES_REDISTRIBUTION',
      },
    });
    return { action: 'DEFERRED_REDISTRIBUTION', send: false, dispatchItemId: item.id };
  }

  const sendEnabled = isDispatchSendEnabled();

  /**
   * Protecao critica: com DISPATCH_SEND_ENABLED=false, jamais chamar Evolution.
   * Se o Dispatch ja esta RUNNING, nao fingir validacao tecnica "ok" — marcar
   * lastQueueError e preservar QUEUED para o operador republicar apos ligar SEND.
   */
  if (!sendEnabled) {
    const blockedStatuses = new Set<string>([
      DispatchItemStatus.RETRY_SCHEDULED,
      DispatchItemStatus.FAILED,
      DispatchItemStatus.UNKNOWN_PROVIDER_STATE,
      DispatchItemStatus.SENT,
      DispatchItemStatus.DELIVERED,
      DispatchItemStatus.READ,
      DispatchItemStatus.SKIPPED,
      DispatchItemStatus.CANCELED,
    ]);

    if (blockedStatuses.has(String(item.status))) {
      const nextRetryAtRaw = (item as { nextRetryAt?: Date | string | null })
        .nextRetryAt;
      if (
        String(item.status) === DispatchItemStatus.RETRY_SCHEDULED &&
        nextRetryAtRaw
      ) {
        const nextRetryAt = new Date(nextRetryAtRaw);
        if (
          Number.isFinite(nextRetryAt.getTime()) &&
          nextRetryAt.getTime() > now().getTime()
        ) {
          return {
            action: 'BLOCKED_SEND_DISABLED',
            send: false,
            dispatchItemId: item.id,
            reason: 'DISPATCH_SEND_ENABLED_FALSE',
            delayUntil: nextRetryAt,
          };
        }
      }

      return {
        action: 'BLOCKED_SEND_DISABLED',
        send: false,
        dispatchItemId: item.id,
        reason: 'DISPATCH_SEND_ENABLED_FALSE',
      };
    }

    if (dispatch.status === DispatchStatus.RUNNING) {
      await prisma.dispatchItem.updateMany({
        where: {
          id: item.id,
          status: {
            in: [
              DispatchItemStatus.QUEUED,
              DispatchItemStatus.SCHEDULED,
              DispatchItemStatus.RETRY_SCHEDULED,
              DispatchItemStatus.PROCESSING,
            ],
          },
        },
        data: {
          status: DispatchItemStatus.QUEUED,
          lockedAt: null,
          lockToken: null,
          lockExpiresAt: null,
          lastQueueError: 'DISPATCH_SEND_ENABLED_FALSE',
        },
      });

      return {
        action: 'BLOCKED_SEND_DISABLED',
        send: false,
        dispatchItemId: item.id,
        reason: 'DISPATCH_SEND_ENABLED_FALSE_WHILE_RUNNING',
      };
    }
  }

  const realSendMode =
    dispatch.status === DispatchStatus.RUNNING && sendEnabled;

  if (!realSendMode) {
    return runTechnicalValidation({ job, dispatch, item, prisma, now });
  }

  return runRealSend({ job, dispatch, item, prisma, now, deps });
}

// ---------------------------------------------------------------------------
// Path tecnico (subetapa 09.3) — inalterado.
// ---------------------------------------------------------------------------

type DispatchRow = {
  id: string;
  status: string;
  totalItems?: number;
  requiringRedistribution: boolean;
  approvalSnapshot: unknown;
  configurationSnapshot: unknown;
};

type ItemRow = Record<string, unknown> & {
  id: string;
  status: string;
  dispatchChannelId: string | null;
  originalDispatchChannelId: string | null;
  channelAccountId: string;
  reassignmentCount: number;
  contactId?: string;
  normalizedDestination?: string;
  attemptCount?: number;
  maxAttempts?: number;
};

async function runTechnicalValidation(input: {
  job: DispatchSendJobLike;
  dispatch: DispatchRow;
  item: ItemRow;
  prisma: PrismaClient;
  now: () => Date;
}): Promise<DispatchSendProcessResult> {
  const { job, dispatch, prisma, now } = input;
  let item = input.item;

  const lockToken = randomUUID();
  const lockExpiresAt = new Date(now().getTime() + LOCK_DURATION_MS);
  const nowValue = now();

  const claim = await prisma.dispatchItem.updateMany({
    where: {
      id: item.id,
      status: { in: CLAIMABLE_ITEM_STATUSES },
      OR: [{ lockExpiresAt: null }, { lockExpiresAt: { lt: nowValue } }],
    },
    data: {
      status: DispatchItemStatus.PROCESSING,
      lockedAt: nowValue,
      lockToken,
      lockExpiresAt,
    },
  });

  if (claim.count !== 1) {
    return {
      action: 'SKIPPED_CLAIM_LOST',
      send: false,
      dispatchItemId: item.id,
      reason: 'CLAIM_CONFLICT',
    };
  }

  try {
    const { effectiveChannel, reassigned } = await resolveEffectiveChannel({
      prisma,
      dispatch,
      item,
      now,
    });

    if (!effectiveChannel) {
      const deferAt = new Date(now().getTime() + DEFER_MINUTES_NO_CHANNEL * 60_000);
      await prisma.dispatchItem.update({
        where: { id: item.id },
        data: {
          status: DispatchItemStatus.SCHEDULED,
          scheduledAt: deferAt,
          lastQueueError: 'NO_ELIGIBLE_CHANNEL',
          lockedAt: null,
          lockToken: null,
          lockExpiresAt: null,
        },
      });
      return { action: 'DEFERRED_NO_CHANNEL', send: false, dispatchItemId: item.id };
    }

    const window = extractOperationalWindow(
      dispatch.approvalSnapshot,
      dispatch.configurationSnapshot,
    );
    const insideWindow = isWithinOperationalWindow({
      now: now(),
      timezone: window.timezone,
      allowedStartTime: window.allowedStartTime,
      allowedEndTime: window.allowedEndTime,
      allowedDays: window.allowedDays,
    });

    if (!insideWindow) {
      const nextStart = resolveNextOperationalWindowStart(now(), window);
      await prisma.dispatchItem.update({
        where: { id: item.id },
        data: {
          status: DispatchItemStatus.SCHEDULED,
          scheduledAt: nextStart,
          lockedAt: null,
          lockToken: null,
          lockExpiresAt: null,
        },
      });

      return {
        action: 'DEFERRED_OUTSIDE_WINDOW',
        send: false,
        dispatchItemId: item.id,
        delayUntil: nextStart,
      };
    }

    await prisma.dispatchItem.update({
      where: { id: item.id },
      data: {
        status: DispatchItemStatus.QUEUED,
        technicalValidatedAt: now(),
        lockedAt: null,
        lockToken: null,
        lockExpiresAt: null,
        lastQueueError: null,
      },
    });

    // eslint-disable-next-line no-console
    console.log(
      `[dispatch-send] validado tecnicamente item=${item.id} dispatch=${dispatch.id} canal=${effectiveChannel.id} reassigned=${reassigned}`,
    );

    return { action: 'TECHNICAL_VALIDATED', send: false, dispatchItemId: item.id };
  } catch (error) {
    await prisma.dispatchItem.updateMany({
      where: { id: item.id, status: DispatchItemStatus.PROCESSING },
      data: {
        status: DispatchItemStatus.QUEUED,
        lockedAt: null,
        lockToken: null,
        lockExpiresAt: null,
        lastQueueError: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
      },
    });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Envio real (subetapa 09.4)
// ---------------------------------------------------------------------------

async function runRealSend(input: {
  job: DispatchSendJobLike;
  dispatch: DispatchRow;
  item: ItemRow;
  prisma: PrismaClient;
  now: () => Date;
  deps: DispatchSendProcessorDeps;
}): Promise<DispatchSendProcessResult> {
  const { job, dispatch, prisma, now, deps } = input;
  const item = input.item;

  const lockToken = randomUUID();
  const lockExpiresAt = new Date(now().getTime() + LOCK_DURATION_MS);
  const nowValue = now();

  const claim = await prisma.dispatchItem.updateMany({
    where: {
      id: item.id,
      status: { in: CLAIMABLE_ITEM_STATUSES_REAL_SEND },
      OR: [{ lockExpiresAt: null }, { lockExpiresAt: { lt: nowValue } }],
    },
    data: {
      status: DispatchItemStatus.PROCESSING,
      lockedAt: nowValue,
      lockToken,
      lockExpiresAt,
    },
  });

  if (claim.count !== 1) {
    return {
      action: 'SKIPPED_CLAIM_LOST',
      send: false,
      dispatchItemId: item.id,
      reason: 'CLAIM_CONFLICT',
    };
  }

  try {
    // --- Last-mile: contato ---
    const contact = await prisma.contact.findFirst({
      where: {
        id: item.contactId,
        organizationId: (item as { organizationId?: string }).organizationId,
        campaignId: (item as { campaignId?: string }).campaignId,
      },
      select: {
        status: true,
        optOuts: {
          where: { OR: [{ channel: null }, { channel: 'WHATSAPP' }] },
          take: 1,
          select: { id: true },
        },
      },
    } as never);

    if (contact) {
      const contactStatus = String((contact as { status?: unknown }).status ?? '');
      if (contactStatus === ContactStatus.DELETED) {
        await finalizeSkip(prisma, item, now(), 'CONTACT_DELETED', DispatchItemErrorCategory.CONTACT_DELETED);
        await recomputeDispatchProgress(prisma, dispatch, now());
        return { action: 'SKIPPED_CONTACT_DELETED', send: false, dispatchItemId: item.id };
      }
      if (contactStatus === ContactStatus.BLOCKED) {
        await finalizeSkip(prisma, item, now(), 'CONTACT_BLOCKED', DispatchItemErrorCategory.CONTACT_BLOCKED);
        await recomputeDispatchProgress(prisma, dispatch, now());
        return { action: 'SKIPPED_CONTACT_BLOCKED', send: false, dispatchItemId: item.id };
      }
      const optOuts = (contact as { optOuts?: unknown[] }).optOuts;
      if (Array.isArray(optOuts) && optOuts.length > 0) {
        await finalizeSkip(prisma, item, now(), 'CONTACT_OPT_OUT', DispatchItemErrorCategory.CONTACT_OPT_OUT);
        await recomputeDispatchProgress(prisma, dispatch, now());
        return { action: 'SKIPPED_CONTACT_OPT_OUT', send: false, dispatchItemId: item.id };
      }
    }

    // --- Last-mile: destino ---
    const normalizedDestination = String(item.normalizedDestination ?? '');
    if (!isValidNormalizedDestination(normalizedDestination)) {
      await finalizeFailed(
        prisma,
        item,
        now(),
        'INVALID_DESTINATION',
        DispatchItemErrorCategory.INVALID_DESTINATION,
        'Destino invalido apos revalidacao last-mile',
      );
      await recomputeDispatchProgress(prisma, dispatch, now());
      return { action: 'FAILED_INVALID_DESTINATION', send: false, dispatchItemId: item.id };
    }

    if (!isDispatchDestinationAllowed(normalizedDestination)) {
      await finalizeSkip(
        prisma,
        item,
        now(),
        'PILOT_DESTINATION_NOT_ALLOWED',
        null,
      );
      await recomputeDispatchProgress(prisma, dispatch, now());
      return {
        action: 'SKIPPED_PILOT_DESTINATION_NOT_ALLOWED',
        send: false,
        dispatchItemId: item.id,
      };
    }

    // --- Selecao/failover de canal ---
    const { effectiveChannel, reassigned } = await resolveEffectiveChannel({
      prisma,
      dispatch,
      item,
      now,
    });

    if (!effectiveChannel) {
      const deferAt = new Date(now().getTime() + DEFER_MINUTES_NO_CHANNEL * 60_000);
      await prisma.dispatchItem.update({
        where: { id: item.id },
        data: {
          status: DispatchItemStatus.SCHEDULED,
          scheduledAt: deferAt,
          lastQueueError: 'NO_ELIGIBLE_CHANNEL',
          lockedAt: null,
          lockToken: null,
          lockExpiresAt: null,
        },
      });
      return { action: 'DEFERRED_NO_CHANNEL', send: false, dispatchItemId: item.id };
    }

    // --- Rotacao por volume (rotateEveryMessages) ---
    const policy = extractSendProtectionPolicy(dispatch.approvalSnapshot);
    let selectedChannel = effectiveChannel;
    let rotated = false;

    if (
      !reassigned &&
      shouldRotateChannel(selectedChannel.sentItems, policy.rotateEveryMessages)
    ) {
      const rotationCandidate = await resolveEffectiveChannel({
        prisma,
        dispatch,
        item: { ...item, dispatchChannelId: selectedChannel.id },
        now,
        excludeCurrent: true,
      });
      if (rotationCandidate.effectiveChannel) {
        selectedChannel = rotationCandidate.effectiveChannel;
        rotated = true;
      }
    }

    // --- Janela operacional ---
    const window = extractOperationalWindow(
      dispatch.approvalSnapshot,
      dispatch.configurationSnapshot,
    );
    const insideWindow = isWithinOperationalWindow({
      now: now(),
      timezone: window.timezone,
      allowedStartTime: window.allowedStartTime,
      allowedEndTime: window.allowedEndTime,
      allowedDays: window.allowedDays,
    });

    if (!insideWindow) {
      const nextStart = resolveNextOperationalWindowStart(now(), window);
      await prisma.dispatchItem.update({
        where: { id: item.id },
        data: {
          status: DispatchItemStatus.SCHEDULED,
          scheduledAt: nextStart,
          lockedAt: null,
          lockToken: null,
          lockExpiresAt: null,
        },
      });
      return {
        action: 'DEFERRED_OUTSIDE_WINDOW',
        send: false,
        dispatchItemId: item.id,
        delayUntil: nextStart,
      };
    }

    // --- Delay minimo/batch/pausa longa por canal ---
    const usageDateKey = computeUsageDateKey(now());
    const usage = await prisma.dispatchChannelUsageDaily.findUnique({
      where: {
        dispatchChannelId_usageDate: {
          dispatchChannelId: selectedChannel.id,
          usageDate: usageDateKey,
        },
      },
    });

    const requiredDelayMs = computeChannelSendDelayMs(
      policy,
      selectedChannel.sentItems,
      deps.random ?? Math.random,
    );
    const lastSentAt = (usage as { lastSentAt?: Date | null } | null)?.lastSentAt ?? null;

    if (lastSentAt && requiredDelayMs > 0) {
      const elapsed = now().getTime() - lastSentAt.getTime();
      if (elapsed < requiredDelayMs) {
        const resumeAt = new Date(lastSentAt.getTime() + requiredDelayMs);
        await prisma.dispatchItem.update({
          where: { id: item.id },
          data: {
            status: DispatchItemStatus.SCHEDULED,
            scheduledAt: resumeAt,
            dispatchChannelId: selectedChannel.id,
            channelAccountId: selectedChannel.channelAccountId,
            lockedAt: null,
            lockToken: null,
            lockExpiresAt: null,
          },
        });
        return {
          action: 'DEFERRED_CHANNEL_DELAY',
          send: false,
          dispatchItemId: item.id,
          delayUntil: resumeAt,
        };
      }
    }

    if (rotated) {
      await prisma.dispatchItem.update({
        where: { id: item.id },
        data: {
          dispatchChannelId: selectedChannel.id,
          channelAccountId: selectedChannel.channelAccountId,
        },
      });
    }

    // --- Chamada Evolution ---
    // Revalida status operacional imediatamente antes da chamada externa.
    const freshDispatch = await prisma.dispatch.findFirst({
      where: { id: dispatch.id },
      select: { status: true },
    });
    const freshStatus = String(freshDispatch?.status ?? '');
    if (
      freshStatus === DispatchStatus.PAUSING ||
      freshStatus === DispatchStatus.PAUSED
    ) {
      await prisma.dispatchItem.updateMany({
        where: {
          id: item.id,
          status: DispatchItemStatus.PROCESSING,
          providerRequestStartedAt: null,
        },
        data: {
          status: DispatchItemStatus.QUEUED,
          lockedAt: null,
          lockToken: null,
          lockExpiresAt: null,
          lastQueueError: `BLOCKED_${freshStatus}`,
        },
      });
      await tryFinalizePauseFromWorker(prisma, dispatch.id, now());
      return {
        action:
          freshStatus === DispatchStatus.PAUSED
            ? 'BLOCKED_DISPATCH_PAUSED'
            : 'BLOCKED_DISPATCH_PAUSING',
        send: false,
        dispatchItemId: item.id,
      };
    }
    if (freshStatus === DispatchStatus.CANCELED) {
      await prisma.dispatchItem.updateMany({
        where: {
          id: item.id,
          status: DispatchItemStatus.PROCESSING,
          providerRequestStartedAt: null,
        },
        data: {
          status: DispatchItemStatus.CANCELED,
          canceledAt: now(),
          lockedAt: null,
          lockToken: null,
          lockExpiresAt: null,
          errorCategory: DispatchItemErrorCategory.DISPATCH_CANCELED,
          errorCode: 'DISPATCH_CANCELED',
          errorMessage: 'Dispatch cancelado antes da chamada externa',
        },
      });
      return {
        action: 'BLOCKED_DISPATCH_CANCELED',
        send: false,
        dispatchItemId: item.id,
      };
    }
    if (freshStatus === DispatchStatus.EMERGENCY_STOPPED) {
      await prisma.dispatchItem.updateMany({
        where: {
          id: item.id,
          status: DispatchItemStatus.PROCESSING,
          providerRequestStartedAt: null,
        },
        data: {
          status: DispatchItemStatus.QUEUED,
          lockedAt: null,
          lockToken: null,
          lockExpiresAt: null,
          lastQueueError: 'DISPATCH_EMERGENCY_STOPPED',
        },
      });
      return {
        action: 'BLOCKED_DISPATCH_EMERGENCY_STOPPED',
        send: false,
        dispatchItemId: item.id,
      };
    }
    if (freshStatus !== DispatchStatus.RUNNING) {
      return {
        action: 'NOOP_DISPATCH_NOT_ACTIVE',
        send: false,
        dispatchItemId: item.id,
        reason: `DISPATCH_STATUS_${freshStatus}`,
      };
    }

    const channelAccount = await prisma.channelAccount.findUnique({
      where: { id: selectedChannel.channelAccountId },
      select: { externalAccountId: true },
    });

    const contentSnapshot = (item.contentSnapshot ?? {}) as { body?: unknown };
    const text = typeof contentSnapshot.body === 'string' ? contentSnapshot.body : '';

    const requestStartedAt = now();
    await prisma.dispatchItem.updateMany({
      where: { id: item.id, status: DispatchItemStatus.PROCESSING },
      data: { providerRequestStartedAt: requestStartedAt },
    });

    const attemptNumber = (item.attemptCount ?? 0) + 1;
    const attemptId = await beginDispatchItemAttempt(prisma, {
      organizationId: String(
        (item as { organizationId?: string }).organizationId ?? '',
      ),
      campaignId: String((item as { campaignId?: string }).campaignId ?? ''),
      dispatchId: dispatch.id,
      dispatchItemId: item.id,
      attemptNumber,
      channelAccountId: selectedChannel.channelAccountId,
      dispatchChannelId: selectedChannel.id,
      startedAt: requestStartedAt,
      manual: String((item as { retryMode?: string }).retryMode ?? '') === 'MANUAL',
      retryMode: (item as { retryMode?: string | null }).retryMode ?? null,
    });

    const sendFn = deps.sendText ?? sendEvolutionText;
    const result = await sendFn({
      baseUrl: deps.evolutionBaseUrl ?? process.env.EVOLUTION_API_URL ?? '',
      apiKey: deps.evolutionApiKey ?? process.env.EVOLUTION_API_KEY,
      instanceName:
        (channelAccount as { externalAccountId?: string | null } | null)
          ?.externalAccountId ?? '',
      destination: normalizedDestination,
      text,
      idempotencyKey: item.id,
    });

    await prisma.dispatchItem.updateMany({
      where: { id: item.id },
      data: { providerRequestCompletedAt: now() },
    });

    const attemptCount = attemptNumber;
    const maxAttempts = item.maxAttempts ?? 3;

    if (result.success) {
      await finalizeSent(prisma, item, now(), {
        providerMessageId: result.providerMessageId,
        providerStatus: result.providerStatus,
        attemptCount,
      });
      await completeDispatchItemAttempt(prisma, attemptId, {
        completedAt: now(),
        outcome: 'SENT',
        providerStatus: result.providerStatus,
        providerMessageId: result.providerMessageId,
        httpStatus: result.httpStatus ?? null,
        ambiguous: false,
      });
      await prisma.dispatchChannel.updateMany({
        where: { id: selectedChannel.id },
        data: {
          sentItems: selectedChannel.sentItems + 1,
          consecutiveErrors: 0,
          cooldownUntil: null,
          operationalStatus: DispatchChannelOperationalStatus.READY,
        },
      });
      await upsertChannelUsageDaily(prisma, {
        organizationId: (item as { organizationId?: string }).organizationId ?? '',
        campaignId: (item as { campaignId?: string }).campaignId ?? '',
        dispatchChannelId: selectedChannel.id,
        channelAccountId: selectedChannel.channelAccountId,
        usageDate: usageDateKey,
        now: now(),
      });
      await recomputeDispatchProgress(prisma, dispatch, now());
      return { action: 'SENT', send: true, dispatchItemId: item.id };
    }

    const failure = result;

    if (failure.ambiguous) {
      await finalizeUnknown(prisma, item, now(), attemptCount, failure);
      await completeDispatchItemAttempt(prisma, attemptId, {
        completedAt: now(),
        outcome: 'UNKNOWN_PROVIDER_STATE',
        providerStatus: null,
        providerMessageId: null,
        httpStatus: failure.httpStatus ?? null,
        errorCategory: null,
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
        ambiguous: true,
      });
      await recomputeDispatchProgress(prisma, dispatch, now());
      return { action: 'UNKNOWN_PROVIDER_STATE', send: true, dispatchItemId: item.id };
    }

    if (
      (failure.category === 'PROVIDER_RATE_LIMIT' && policy.pauseOn429) ||
      (failure.category === 'AUTHENTICATION_ERROR' && policy.pauseOn403)
    ) {
      const nextConsecutiveErrors = (selectedChannel.consecutiveErrors ?? 0) + 1;
      await prisma.dispatchChannel.updateMany({
        where: { id: selectedChannel.id },
        data: {
          consecutiveErrors: nextConsecutiveErrors,
          cooldownUntil: computeChannelCooldownUntil(now(), nextConsecutiveErrors),
          operationalStatus: DispatchChannelOperationalStatus.COOLDOWN,
        },
      });

      const failoverCandidate = await resolveEffectiveChannel({
        prisma,
        dispatch,
        item: { ...item, dispatchChannelId: selectedChannel.id },
        now,
        excludeCurrent: true,
      });

      const resumeAt = new Date(now().getTime() + CHANNEL_FAILOVER_RETRY_DELAY_MS);

      if (failoverCandidate.effectiveChannel) {
        await prisma.dispatchItem.update({
          where: { id: item.id },
          data: {
            status: DispatchItemStatus.SCHEDULED,
            scheduledAt: resumeAt,
            dispatchChannelId: failoverCandidate.effectiveChannel.id,
            channelAccountId: failoverCandidate.effectiveChannel.channelAccountId,
            lockedAt: null,
            lockToken: null,
            lockExpiresAt: null,
            lastQueueError: `CHANNEL_COOLDOWN_${failure.errorCode}`,
          },
        });
      } else {
        await prisma.dispatchItem.update({
          where: { id: item.id },
          data: {
            status: DispatchItemStatus.SCHEDULED,
            scheduledAt: resumeAt,
            lockedAt: null,
            lockToken: null,
            lockExpiresAt: null,
            lastQueueError: `CHANNEL_COOLDOWN_NO_FAILOVER_${failure.errorCode}`,
          },
        });
      }
      await recomputeDispatchProgress(prisma, dispatch, now());
      await completeDispatchItemAttempt(prisma, attemptId, {
        completedAt: now(),
        outcome: 'RETRY_SCHEDULED',
        providerStatus: null,
        providerMessageId: null,
        httpStatus: failure.httpStatus ?? null,
        errorCategory: mapEvolutionCategoryToErrorCategory(failure.category),
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
        ambiguous: false,
      });
      return {
        action: 'DEFERRED_CHANNEL_COOLDOWN',
        send: true,
        dispatchItemId: item.id,
        delayUntil: resumeAt,
      };
    }

    const isTransient =
      failure.category === 'TRANSIENT_NETWORK' ||
      failure.category === 'PROVIDER_UNAVAILABLE' ||
      failure.category === 'PROVIDER_TIMEOUT';

    if (isTransient && !isDispatchRetryExhausted(attemptCount, maxAttempts)) {
      const nextRetryAt = computeDispatchNextRetryAt(now(), attemptCount);
      await finalizeRetryScheduled(prisma, item, now(), attemptCount, nextRetryAt, failure);
      await completeDispatchItemAttempt(prisma, attemptId, {
        completedAt: now(),
        outcome: 'RETRY_SCHEDULED',
        providerStatus: null,
        providerMessageId: null,
        httpStatus: failure.httpStatus ?? null,
        errorCategory: mapEvolutionCategoryToErrorCategory(failure.category),
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
        ambiguous: false,
      });
      await recomputeDispatchProgress(prisma, dispatch, now());
      return {
        action: 'RETRY_SCHEDULED',
        send: true,
        dispatchItemId: item.id,
        delayUntil: nextRetryAt,
      };
    }

    await finalizeFailed(
      prisma,
      item,
      now(),
      failure.errorCode,
      mapEvolutionCategoryToErrorCategory(failure.category),
      failure.errorMessage,
      attemptCount,
    );
    await completeDispatchItemAttempt(prisma, attemptId, {
      completedAt: now(),
      outcome: 'FAILED',
      providerStatus: null,
      providerMessageId: null,
      httpStatus: failure.httpStatus ?? null,
      errorCategory: mapEvolutionCategoryToErrorCategory(failure.category),
      errorCode: failure.errorCode,
      errorMessage: failure.errorMessage,
      ambiguous: false,
    });
    await recomputeDispatchProgress(prisma, dispatch, now());
    return { action: 'FAILED', send: true, dispatchItemId: item.id };
  } catch (error) {
    await prisma.dispatchItem.updateMany({
      where: { id: item.id, status: DispatchItemStatus.PROCESSING },
      data: {
        status: DispatchItemStatus.RETRY_SCHEDULED,
        lockedAt: null,
        lockToken: null,
        lockExpiresAt: null,
        lastQueueError: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
      },
    });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Helpers de finalizacao de item
// ---------------------------------------------------------------------------

async function beginDispatchItemAttempt(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    campaignId: string;
    dispatchId: string;
    dispatchItemId: string;
    attemptNumber: number;
    channelAccountId: string | null;
    dispatchChannelId: string | null;
    startedAt: Date;
    manual: boolean;
    retryMode: string | null;
  },
): Promise<string | null> {
  if (!input.organizationId || !input.campaignId) return null;
  try {
    const created = await (prisma as unknown as {
      dispatchItemAttempt: {
        upsert: (args: unknown) => Promise<{ id: string }>;
      };
    }).dispatchItemAttempt.upsert({
      where: {
        dispatchItemId_attemptNumber: {
          dispatchItemId: input.dispatchItemId,
          attemptNumber: input.attemptNumber,
        },
      },
      create: {
        organizationId: input.organizationId,
        campaignId: input.campaignId,
        dispatchId: input.dispatchId,
        dispatchItemId: input.dispatchItemId,
        attemptNumber: input.attemptNumber,
        channelAccountId: input.channelAccountId,
        dispatchChannelId: input.dispatchChannelId,
        startedAt: input.startedAt,
        manual: input.manual,
        retryMode: input.retryMode,
        ambiguous: false,
      },
      update: {
        startedAt: input.startedAt,
        channelAccountId: input.channelAccountId,
        dispatchChannelId: input.dispatchChannelId,
        manual: input.manual,
        retryMode: input.retryMode,
        completedAt: null,
        outcome: null,
      },
    });
    return created.id;
  } catch {
    return null;
  }
}

async function completeDispatchItemAttempt(
  prisma: PrismaClient,
  attemptId: string | null,
  data: {
    completedAt: Date;
    outcome: string;
    providerStatus?: string | null;
    providerMessageId?: string | null;
    httpStatus?: number | null;
    errorCategory?: DispatchItemErrorCategory | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    ambiguous: boolean;
  },
): Promise<void> {
  if (!attemptId) return;
  try {
    await (prisma as unknown as {
      dispatchItemAttempt: {
        update: (args: unknown) => Promise<unknown>;
      };
    }).dispatchItemAttempt.update({
      where: { id: attemptId },
      data: {
        completedAt: data.completedAt,
        outcome: data.outcome,
        providerStatus: data.providerStatus ?? null,
        providerMessageId: data.providerMessageId ?? null,
        httpStatus: data.httpStatus ?? null,
        errorCategory: data.errorCategory ?? null,
        errorCode: data.errorCode ?? null,
        errorMessage: data.errorMessage ?? null,
        ambiguous: data.ambiguous,
      },
    });
  } catch {
    // historico e diagnostico; nao falha o envio
  }
}

async function finalizeSkip(
  prisma: PrismaClient,
  item: ItemRow,
  now: Date,
  errorCode: string,
  errorCategory: DispatchItemErrorCategory | null,
): Promise<void> {
  await prisma.dispatchItem.update({
    where: { id: item.id },
    data: {
      status: DispatchItemStatus.SKIPPED,
      skippedAt: now,
      errorCategory,
      errorCode,
      errorMessage: errorCode,
      lockedAt: null,
      lockToken: null,
      lockExpiresAt: null,
    },
  });
}

async function finalizeFailed(
  prisma: PrismaClient,
  item: ItemRow,
  now: Date,
  errorCode: string,
  errorCategory: DispatchItemErrorCategory,
  errorMessage: string,
  attemptCount?: number,
): Promise<void> {
  await prisma.dispatchItem.update({
    where: { id: item.id },
    data: {
      status: DispatchItemStatus.FAILED,
      failedAt: now,
      lastAttemptAt: now,
      ...(attemptCount != null ? { attemptCount } : {}),
      errorCategory,
      errorCode,
      errorMessage,
      lockedAt: null,
      lockToken: null,
      lockExpiresAt: null,
    },
  });
}

async function finalizeSent(
  prisma: PrismaClient,
  item: ItemRow,
  now: Date,
  data: {
    providerMessageId: string | null;
    providerStatus: string | null;
    attemptCount: number;
  },
): Promise<void> {
  await prisma.dispatchItem.update({
    where: { id: item.id },
    data: {
      status: DispatchItemStatus.SENT,
      sentAt: now,
      lastAttemptAt: now,
      attemptCount: data.attemptCount,
      providerMessageId: data.providerMessageId,
      providerStatus: data.providerStatus,
      errorCategory: null,
      errorCode: null,
      errorMessage: null,
      lockedAt: null,
      lockToken: null,
      lockExpiresAt: null,
    },
  });
}

async function finalizeRetryScheduled(
  prisma: PrismaClient,
  item: ItemRow,
  now: Date,
  attemptCount: number,
  nextRetryAt: Date,
  failure: { errorCode: string; errorMessage: string; category: EvolutionSendCategory },
): Promise<void> {
  await prisma.dispatchItem.update({
    where: { id: item.id },
    data: {
      status: DispatchItemStatus.RETRY_SCHEDULED,
      attemptCount,
      nextRetryAt,
      lastAttemptAt: now,
      errorCategory: mapEvolutionCategoryToErrorCategory(failure.category),
      errorCode: failure.errorCode,
      errorMessage: failure.errorMessage,
      lockedAt: null,
      lockToken: null,
      lockExpiresAt: null,
    },
  });
}

async function finalizeUnknown(
  prisma: PrismaClient,
  item: ItemRow,
  now: Date,
  attemptCount: number,
  failure: { errorCode: string; errorMessage: string },
): Promise<void> {
  await prisma.dispatchItem.update({
    where: { id: item.id },
    data: {
      status: DispatchItemStatus.UNKNOWN_PROVIDER_STATE,
      attemptCount,
      lastAttemptAt: now,
      nextRetryAt: null,
      errorCategory: null,
      errorCode: failure.errorCode,
      errorMessage: failure.errorMessage,
      lockedAt: null,
      lockToken: null,
      lockExpiresAt: null,
    },
  });
}

async function upsertChannelUsageDaily(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    campaignId: string;
    dispatchChannelId: string;
    channelAccountId: string;
    usageDate: Date;
    now: Date;
  },
): Promise<void> {
  await prisma.dispatchChannelUsageDaily.upsert({
    where: {
      dispatchChannelId_usageDate: {
        dispatchChannelId: input.dispatchChannelId,
        usageDate: input.usageDate,
      },
    },
    create: {
      organizationId: input.organizationId,
      campaignId: input.campaignId,
      dispatchChannelId: input.dispatchChannelId,
      channelAccountId: input.channelAccountId,
      usageDate: input.usageDate,
      sentCount: 1,
      lastSentAt: input.now,
    },
    update: {
      sentCount: { increment: 1 },
      lastSentAt: input.now,
    },
  });
}

async function recomputeDispatchProgress(
  prisma: PrismaClient,
  dispatch: DispatchRow,
  now: Date,
): Promise<void> {
  const grouped = await prisma.dispatchItem.groupBy({
    by: ['status'],
    where: {
      dispatchId: dispatch.id,
    },
    _count: { _all: true },
  } as never);

  const counts: Record<string, number> = {};
  for (const row of grouped as Array<{ status: string; _count: { _all: number } }>) {
    counts[row.status] = row._count._all;
  }

  const pendingItems = counts[DispatchItemStatus.PENDING] ?? 0;
  const queuedItems =
    (counts[DispatchItemStatus.QUEUED] ?? 0) +
    (counts[DispatchItemStatus.SCHEDULED] ?? 0) +
    (counts[DispatchItemStatus.RETRY_SCHEDULED] ?? 0);
  const processingItems = counts[DispatchItemStatus.PROCESSING] ?? 0;
  const sentItems = counts[DispatchItemStatus.SENT] ?? 0;
  const deliveredItems = counts[DispatchItemStatus.DELIVERED] ?? 0;
  const readItems = counts[DispatchItemStatus.READ] ?? 0;
  const failedItems = counts[DispatchItemStatus.FAILED] ?? 0;
  const unknownItems = counts[DispatchItemStatus.UNKNOWN_PROVIDER_STATE] ?? 0;
  const skippedItems = counts[DispatchItemStatus.SKIPPED] ?? 0;
  const canceledItems = counts[DispatchItemStatus.CANCELED] ?? 0;

  const unresolved = pendingItems + queuedItems + processingItems + unknownItems;
  const data: Record<string, unknown> = {
    pendingItems,
    queuedItems,
    processingItems,
    sentItems,
    deliveredItems,
    readItems,
    failedItems,
    skippedItems,
    canceledItems,
    unknownItems,
    lastProgressAt: now,
  };

  if (
    unresolved === 0 &&
    (dispatch.totalItems ?? 0) > 0 &&
    String(dispatch.status) === DispatchStatus.RUNNING
  ) {
    data.completedAt = now;
    data.status =
      failedItems + skippedItems + canceledItems > 0
        ? DispatchStatus.COMPLETED_WITH_ERRORS
        : DispatchStatus.COMPLETED;
  }

  await prisma.dispatch.updateMany({
    where: {
      id: dispatch.id,
      status: {
        in: [
          DispatchStatus.RUNNING,
          DispatchStatus.PAUSING,
          DispatchStatus.PAUSED,
        ],
      },
    },
    data,
  });

  if (String((dispatch as { status?: string }).status) === DispatchStatus.PAUSING) {
    await tryFinalizePauseFromWorker(prisma, dispatch.id, now);
  }
}

async function handleOperationalDispatchBlock(input: {
  prisma: PrismaClient;
  dispatch: DispatchRow;
  item: ItemRow;
  now: () => Date;
}): Promise<DispatchSendProcessResult | null> {
  const { prisma, dispatch, item, now } = input;
  const status = String(dispatch.status);

  if (status === DispatchStatus.CANCELED) {
    const cancelableNow = new Set<string>([
      DispatchItemStatus.PENDING,
      DispatchItemStatus.SCHEDULED,
      DispatchItemStatus.QUEUED,
      DispatchItemStatus.RETRY_SCHEDULED,
      DispatchItemStatus.PROCESSING,
    ]);
    if (
      cancelableNow.has(String(item.status)) &&
      !(item as { providerRequestStartedAt?: Date | null }).providerRequestStartedAt
    ) {
      await prisma.dispatchItem.updateMany({
        where: {
          id: item.id,
          status: {
            in: [
              DispatchItemStatus.PENDING,
              DispatchItemStatus.SCHEDULED,
              DispatchItemStatus.QUEUED,
              DispatchItemStatus.RETRY_SCHEDULED,
              DispatchItemStatus.PROCESSING,
            ],
          },
          providerRequestStartedAt: null,
        },
        data: {
          status: DispatchItemStatus.CANCELED,
          canceledAt: now(),
          lockedAt: null,
          lockToken: null,
          lockExpiresAt: null,
          errorCategory: DispatchItemErrorCategory.DISPATCH_CANCELED,
          errorCode: 'DISPATCH_CANCELED',
          errorMessage: 'Dispatch cancelado',
        },
      });
    }
    return {
      action: 'BLOCKED_DISPATCH_CANCELED',
      send: false,
      dispatchItemId: item.id,
      reason: 'DISPATCH_CANCELED',
    };
  }

  if (status === DispatchStatus.EMERGENCY_STOPPED) {
    if (
      item.status === DispatchItemStatus.PROCESSING &&
      !(item as { providerRequestStartedAt?: Date | null }).providerRequestStartedAt
    ) {
      await prisma.dispatchItem.updateMany({
        where: {
          id: item.id,
          status: DispatchItemStatus.PROCESSING,
          providerRequestStartedAt: null,
        },
        data: {
          status: DispatchItemStatus.QUEUED,
          lockedAt: null,
          lockToken: null,
          lockExpiresAt: null,
          lastQueueError: 'DISPATCH_EMERGENCY_STOPPED',
        },
      });
    }
    return {
      action: 'BLOCKED_DISPATCH_EMERGENCY_STOPPED',
      send: false,
      dispatchItemId: item.id,
      reason: 'DISPATCH_EMERGENCY_STOPPED',
    };
  }

  if (status === DispatchStatus.PAUSED) {
    if (
      item.status === DispatchItemStatus.PROCESSING &&
      !(item as { providerRequestStartedAt?: Date | null }).providerRequestStartedAt
    ) {
      await prisma.dispatchItem.updateMany({
        where: {
          id: item.id,
          status: DispatchItemStatus.PROCESSING,
          providerRequestStartedAt: null,
        },
        data: {
          status: DispatchItemStatus.QUEUED,
          lockedAt: null,
          lockToken: null,
          lockExpiresAt: null,
          lastQueueError: 'DISPATCH_PAUSED',
        },
      });
    }
    return {
      action: 'BLOCKED_DISPATCH_PAUSED',
      send: false,
      dispatchItemId: item.id,
      reason: 'DISPATCH_PAUSED',
    };
  }

  if (status === DispatchStatus.PAUSING) {
    if (
      item.status === DispatchItemStatus.PROCESSING &&
      !(item as { providerRequestStartedAt?: Date | null }).providerRequestStartedAt
    ) {
      await prisma.dispatchItem.updateMany({
        where: {
          id: item.id,
          status: DispatchItemStatus.PROCESSING,
          providerRequestStartedAt: null,
        },
        data: {
          status: DispatchItemStatus.QUEUED,
          lockedAt: null,
          lockToken: null,
          lockExpiresAt: null,
          lastQueueError: 'DISPATCH_PAUSING_RELEASED',
        },
      });
    }
    await tryFinalizePauseFromWorker(prisma, dispatch.id, now());
    return {
      action: 'BLOCKED_DISPATCH_PAUSING',
      send: false,
      dispatchItemId: item.id,
      reason: 'DISPATCH_PAUSING',
    };
  }

  return null;
}

async function tryFinalizePauseFromWorker(
  prisma: PrismaClient,
  dispatchId: string,
  now: Date,
): Promise<boolean> {
  const processingCount = await prisma.dispatchItem.count({
    where: { dispatchId, status: DispatchItemStatus.PROCESSING },
  });
  if (processingCount > 0) return false;

  const claim = await prisma.dispatch.updateMany({
    where: { id: dispatchId, status: DispatchStatus.PAUSING },
    data: {
      status: DispatchStatus.PAUSED,
      pausedAt: now,
      pausingAt: null,
      lastProgressAt: now,
    },
  });
  return claim.count === 1;
}

// ---------------------------------------------------------------------------
// Selecao de canal (compartilhada entre tecnico e real)
// ---------------------------------------------------------------------------

async function resolveEffectiveChannel(input: {
  prisma: PrismaClient;
  dispatch: DispatchRow;
  item: ItemRow;
  now: () => Date;
  excludeCurrent?: boolean;
}): Promise<{
  effectiveChannel: SelectableDispatchChannel | null;
  reassigned: boolean;
}> {
  const { prisma, dispatch, item, now } = input;

  const dispatchChannelRows = await prisma.dispatchChannel.findMany({
    where: { dispatchId: dispatch.id },
    include: { channelAccount: { select: { id: true, status: true } } },
  });

  const selectable: SelectableDispatchChannel[] = dispatchChannelRows.map((row) => ({
    id: row.id,
    channelAccountId: row.channelAccountId,
    enabled: row.enabled,
    priority: row.priority,
    weight: row.weight,
    effectiveDailyLimit: row.effectiveDailyLimit,
    assignedItems: row.assignedItems,
    sentItems: row.sentItems,
    consecutiveErrors: row.consecutiveErrors,
    cooldownUntil: row.cooldownUntil,
    operationalStatus: row.operationalStatus,
    connected: row.channelAccount.status === ChannelAccountStatus.CONNECTED,
    archived: row.channelAccount.status === ChannelAccountStatus.ARCHIVED,
  }));

  const currentChannel = item.dispatchChannelId
    ? selectable.find((c) => c.id === item.dispatchChannelId) ?? null
    : null;
  const currentApta =
    !input.excludeCurrent && currentChannel ? isChannelApta(currentChannel, now()) : false;

  if (currentApta && currentChannel) {
    return { effectiveChannel: currentChannel, reassigned: false };
  }

  const next = selectNextEligibleDispatchChannel(selectable, {
    now: now(),
    excludeChannelIds: item.dispatchChannelId ? [item.dispatchChannelId] : [],
  });

  if (!next) {
    return { effectiveChannel: null, reassigned: false };
  }

  if (!canReassignDispatchItem(item.status)) {
    return { effectiveChannel: input.excludeCurrent ? null : currentChannel, reassigned: false };
  }

  if (!input.excludeCurrent) {
    const update = buildReassignmentUpdate(
      {
        dispatchChannelId: item.dispatchChannelId,
        originalDispatchChannelId: item.originalDispatchChannelId,
        channelAccountId: item.channelAccountId,
        reassignmentCount: item.reassignmentCount,
        status: item.status,
      },
      { id: next.id, channelAccountId: next.channelAccountId },
      now(),
    );
    await prisma.dispatchItem.update({ where: { id: item.id }, data: update });
  }

  return { effectiveChannel: next, reassigned: true };
}

function isChannelApta(channel: SelectableDispatchChannel, now: Date): boolean {
  if (!channel.enabled || channel.archived || !channel.connected) return false;
  if (channel.operationalStatus !== 'READY') return false;
  if (channel.cooldownUntil) {
    const until =
      channel.cooldownUntil instanceof Date
        ? channel.cooldownUntil
        : new Date(channel.cooldownUntil);
    if (until.getTime() > now.getTime()) return false;
  }
  const remaining = channel.effectiveDailyLimit - channel.assignedItems - channel.sentItems;
  return remaining > 0;
}

// ---------------------------------------------------------------------------
// Politica de protecao / delays / rotacao (puro, testavel)
// ---------------------------------------------------------------------------

export function extractSendProtectionPolicy(
  approvalSnapshot: unknown,
): DispatchSendProtectionPolicy {
  const snapshot = (approvalSnapshot ?? {}) as {
    protectionPolicy?: Partial<DispatchSendProtectionPolicy>;
  };
  const policy = snapshot.protectionPolicy ?? {};

  return {
    minDelaySeconds: firstNumber(policy.minDelaySeconds) ?? DEFAULT_SEND_POLICY.minDelaySeconds,
    maxDelaySeconds: firstNumber(policy.maxDelaySeconds) ?? DEFAULT_SEND_POLICY.maxDelaySeconds,
    batchSize: firstNumber(policy.batchSize) ?? DEFAULT_SEND_POLICY.batchSize,
    pauseBetweenBatchesSeconds:
      firstNumber(policy.pauseBetweenBatchesSeconds) ??
      DEFAULT_SEND_POLICY.pauseBetweenBatchesSeconds,
    longPauseEveryMessages:
      firstNumber(policy.longPauseEveryMessages) ?? DEFAULT_SEND_POLICY.longPauseEveryMessages,
    longPauseMinutes:
      firstNumber(policy.longPauseMinutes) ?? DEFAULT_SEND_POLICY.longPauseMinutes,
    rotateEveryMessages:
      firstNumber(policy.rotateEveryMessages) ?? DEFAULT_SEND_POLICY.rotateEveryMessages,
    pauseOn403:
      typeof policy.pauseOn403 === 'boolean' ? policy.pauseOn403 : DEFAULT_SEND_POLICY.pauseOn403,
    pauseOn429:
      typeof policy.pauseOn429 === 'boolean' ? policy.pauseOn429 : DEFAULT_SEND_POLICY.pauseOn429,
  };
}

/**
 * Delay minimo exigido antes do proximo envio no mesmo canal: o maior
 * entre o delay aleatorio (min/max) e a pausa de lote/pausa longa quando
 * `sentItemsBeforeSend` cruza os limiares configurados.
 */
export function computeChannelSendDelayMs(
  policy: DispatchSendProtectionPolicy,
  sentItemsBeforeSend: number,
  random: () => number = Math.random,
): number {
  const min = Math.max(0, policy.minDelaySeconds) * 1000;
  const max = Math.max(min, policy.maxDelaySeconds * 1000);
  const randomDelayMs = max > min ? min + random() * (max - min) : min;

  let pauseMs = 0;
  if (sentItemsBeforeSend > 0 && policy.longPauseEveryMessages > 0) {
    if (sentItemsBeforeSend % policy.longPauseEveryMessages === 0) {
      pauseMs = Math.max(pauseMs, policy.longPauseMinutes * 60_000);
    }
  }
  if (sentItemsBeforeSend > 0 && policy.batchSize > 0) {
    if (sentItemsBeforeSend % policy.batchSize === 0) {
      pauseMs = Math.max(pauseMs, policy.pauseBetweenBatchesSeconds * 1000);
    }
  }

  return Math.max(randomDelayMs, pauseMs);
}

export function shouldRotateChannel(
  sentItemsBeforeSend: number,
  rotateEveryMessages: number,
): boolean {
  if (rotateEveryMessages <= 0) return false;
  return sentItemsBeforeSend > 0 && sentItemsBeforeSend % rotateEveryMessages === 0;
}

export function computeChannelCooldownUntil(now: Date, consecutiveErrors: number): Date {
  const steps = Math.min(Math.max(consecutiveErrors, 1), CHANNEL_COOLDOWN_MAX_STEPS);
  return new Date(now.getTime() + steps * CHANNEL_COOLDOWN_STEP_MS);
}

export function computeUsageDateKey(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function isValidNormalizedDestination(value: string): boolean {
  return /^\d{10,15}$/.test(value);
}

export function mapEvolutionCategoryToErrorCategory(
  category: EvolutionSendCategory,
): DispatchItemErrorCategory {
  switch (category) {
    case 'TRANSIENT_NETWORK':
      return DispatchItemErrorCategory.TRANSIENT_NETWORK;
    case 'PROVIDER_RATE_LIMIT':
      return DispatchItemErrorCategory.PROVIDER_RATE_LIMIT;
    case 'PROVIDER_UNAVAILABLE':
      return DispatchItemErrorCategory.PROVIDER_UNAVAILABLE;
    case 'PROVIDER_TIMEOUT':
      return DispatchItemErrorCategory.PROVIDER_TIMEOUT;
    case 'AUTHENTICATION_ERROR':
      return DispatchItemErrorCategory.AUTHENTICATION_ERROR;
    case 'INVALID_DESTINATION':
      return DispatchItemErrorCategory.INVALID_DESTINATION;
    case 'CONTENT_REJECTED':
      return DispatchItemErrorCategory.CONTENT_REJECTED;
    default:
      return DispatchItemErrorCategory.UNKNOWN;
  }
}

function extractOperationalWindow(
  approvalSnapshot: unknown,
  configurationSnapshot: unknown,
): OperationalWindowConfig {
  const snapshot = (approvalSnapshot ?? {}) as {
    protectionPolicy?: {
      timezone?: unknown;
      allowedStartTime?: unknown;
      allowedEndTime?: unknown;
      allowedDays?: unknown;
    };
  };
  const policy = snapshot.protectionPolicy ?? {};
  const config = (configurationSnapshot ?? {}) as {
    timezone?: unknown;
    allowedStartTime?: unknown;
    allowedEndTime?: unknown;
    allowedDays?: unknown;
  };

  return {
    timezone: firstString(policy.timezone, config.timezone) ?? DEFAULT_WINDOW.timezone,
    allowedStartTime:
      firstString(policy.allowedStartTime, config.allowedStartTime) ??
      DEFAULT_WINDOW.allowedStartTime,
    allowedEndTime:
      firstString(policy.allowedEndTime, config.allowedEndTime) ??
      DEFAULT_WINDOW.allowedEndTime,
    allowedDays:
      firstNumberArray(policy.allowedDays, config.allowedDays) ??
      DEFAULT_WINDOW.allowedDays,
  };
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function firstNumberArray(...values: unknown[]): number[] | null {
  for (const value of values) {
    if (Array.isArray(value) && value.every((v) => typeof v === 'number')) {
      return value as number[];
    }
  }
  return null;
}

function firstNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
