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
  detectProtectionIntervalViolation,
  extractFullSendProtectionPolicy,
  hashDestinationForCache,
  isDispatchDestinationAllowed,
  isDispatchEngineEnabled,
  isDispatchQueueEnabled,
  isDispatchRetryExhausted,
  isDispatchSendEnabled,
  isWithinOperationalWindow,
  resolveNextOperationalWindowStart,
  selectNextEligibleDispatchChannel,
  sendEvolutionText,
  checkEvolutionConnectionState,
  validateWhatsAppNumber,
  cacheTtlMsForValidationStatus,
  WHATSAPP_VALIDATION_MAX_UNKNOWN_ATTEMPTS,
  WHATSAPP_VALIDATION_SOURCE,
  assertFrozenItemContentReady,
  type EvolutionSendCategory,
  type EvolutionSendInput,
  type EvolutionSendResult,
  type OperationalWindowConfig,
  type SelectableDispatchChannel,
  type ValidateWhatsAppNumberResult,
} from '@campanha360/shared';
import {
  confirmChannelAccountSendSuccessAtomic,
  registerChannelProtectionIntervalViolation,
  reserveChannelAccountSendSlotAtomic,
} from './channel-send-guard';

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
  | 'DEFERRED_HOURLY_LIMIT'
  | 'DEFERRED_DAILY_LIMIT'
  | 'DEFERRED_PROTECTION_COOLDOWN'
  | 'DEFERRED_WHATSAPP_VALIDATION'
  | 'SKIPPED_FLAG_DISABLED'
  | 'BLOCKED_LAST_MILE_UNAVAILABLE'
  | 'FAILED_WHATSAPP_NUMBER_INVALID'
  | 'SKIPPED_WHATSAPP_NUMBER_INVALID'
  | 'FAILED_VALIDATION_UNAVAILABLE'
  | 'SKIPPED_CLAIM_LOST'
  | 'SKIPPED_CONTACT_DELETED'
  | 'SKIPPED_CONTACT_BLOCKED'
  | 'SKIPPED_CONTACT_OPT_OUT'
  | 'SKIPPED_PILOT_DESTINATION_NOT_ALLOWED'
  | 'SKIPPED_CONTENT_INVALID'
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
  /** Injetavel para testes de validateWhatsAppNumber. */
  validateNumber?: (
    input: Parameters<typeof validateWhatsAppNumber>[0],
  ) => Promise<ValidateWhatsAppNumberResult>;
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
    // --- Last-mile: contato (fail closed) ---
    let contact: { status?: unknown; optOuts?: unknown[] } | null = null;
    try {
      contact = (await prisma.contact.findFirst({
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
      } as never)) as { status?: unknown; optOuts?: unknown[] } | null;
    } catch {
      const resumeAt = new Date(now().getTime() + 60_000);
      await prisma.dispatchItem.update({
        where: { id: item.id },
        data: {
          status: DispatchItemStatus.SCHEDULED,
          scheduledAt: resumeAt,
          lockedAt: null,
          lockToken: null,
          lockExpiresAt: null,
          lastQueueError: 'LAST_MILE_CONTACT_QUERY_FAILED',
        },
      });
      return {
        action: 'BLOCKED_LAST_MILE_UNAVAILABLE',
        send: false,
        dispatchItemId: item.id,
        reason: 'CONTACT_QUERY_FAILED',
        delayUntil: resumeAt,
      };
    }

    if (!contact) {
      await finalizeSkip(
        prisma,
        item,
        now(),
        'CONTACT_DELETED',
        DispatchItemErrorCategory.CONTACT_DELETED,
      );
      await recomputeDispatchProgress(prisma, dispatch, now());
      return { action: 'SKIPPED_CONTACT_DELETED', send: false, dispatchItemId: item.id };
    }

    {
      const contactStatus = String(contact.status ?? '');
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
      if (Array.isArray(contact.optOuts) && contact.optOuts.length > 0) {
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
    const policy = extractFullSendProtectionPolicy(dispatch.approvalSnapshot);
    let selectedChannel = effectiveChannel;
    let rotated = false;

    if (
      policy.rotationEnabled &&
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
          lastQueueError: 'OUTSIDE_OPERATIONAL_WINDOW',
        },
      });
      return {
        action: 'DEFERRED_OUTSIDE_WINDOW',
        send: false,
        dispatchItemId: item.id,
        delayUntil: nextStart,
      };
    }

    // --- Validacao WhatsApp (antes da reserva; 09.6.2) ---
    const usageDateKey = computeUsageDateKey(now());
    const channelAccountMeta = await prisma.channelAccount.findUnique({
      where: { id: selectedChannel.channelAccountId },
      select: {
        externalAccountId: true,
        createdAt: true,
        accountOperationalSince: true,
        verifiedAccountAgeSource: true,
        status: true,
      },
    });

    if (
      !channelAccountMeta ||
      String(channelAccountMeta.status) !== ChannelAccountStatus.CONNECTED
    ) {
      const resumeAt = new Date(now().getTime() + DEFER_MINUTES_NO_CHANNEL * 60_000);
      await prisma.dispatchItem.update({
        where: { id: item.id },
        data: {
          status: DispatchItemStatus.SCHEDULED,
          scheduledAt: resumeAt,
          lockedAt: null,
          lockToken: null,
          lockExpiresAt: null,
          lastQueueError: 'CHANNEL_NOT_CONNECTED_AT_SEND',
        },
      });
      return {
        action: 'DEFERRED_NO_CHANNEL',
        send: false,
        dispatchItemId: item.id,
        delayUntil: resumeAt,
        reason: 'CHANNEL_NOT_CONNECTED',
      };
    }

    let destinationValidationStatus:
      | 'SKIPPED_BY_POLICY'
      | 'VALID'
      | 'INVALID'
      | 'UNKNOWN'
      | 'PROVIDER_UNAVAILABLE'
      | 'CACHE_HIT' = 'SKIPPED_BY_POLICY';
    let validationCacheHit = false;
    let validationSource: string | null = null;

    if (policy.validateWhatsAppNumber) {
      const orgId = String((item as { organizationId?: string }).organizationId ?? '');
      const campaignId = String((item as { campaignId?: string }).campaignId ?? '');
      const destHash = hashDestinationForCache(normalizedDestination);
      const destHashPartial = destHash.slice(0, 12);
      const priorAttempts = Number(
        (item as { destinationValidationAttempts?: number | null })
          .destinationValidationAttempts ?? 0,
      );

      await safeAudit(prisma, {
        organizationId: orgId,
        campaignId,
        action: 'DISPATCH_DESTINATION_VALIDATION_REQUIRED',
        entityType: 'DispatchItem',
        entityId: item.id,
        metadata: {
          dispatchId: dispatch.id,
          destinationHashPartial: destHashPartial,
          source: WHATSAPP_VALIDATION_SOURCE,
        },
      });

      let cached: {
        status: string;
        expiresAt: Date;
        source: string | null;
      } | null = null;
      try {
        const rows = await prisma.$queryRaw<
          Array<{ status: string; expiresAt: Date; source: string | null }>
        >`
          SELECT "status", "expiresAt", "source"
          FROM "DestinationWhatsAppValidationCache"
          WHERE "organizationId" = ${orgId}
            AND "destinationHash" = ${destHash}
            AND "expiresAt" > ${now()}
          LIMIT 1
        `;
        cached = rows[0] ?? null;
      } catch {
        const resumeAt = new Date(now().getTime() + 5 * 60_000);
        await prisma.dispatchItem.update({
          where: { id: item.id },
          data: {
            status: DispatchItemStatus.SCHEDULED,
            scheduledAt: resumeAt,
            lockedAt: null,
            lockToken: null,
            lockExpiresAt: null,
            lastQueueError: 'WHATSAPP_VALIDATION_CACHE_UNAVAILABLE',
            destinationValidationStatus: 'UNKNOWN',
            destinationValidationAttempts: { increment: 1 },
          } as never,
        });
        await safeAudit(prisma, {
          organizationId: orgId,
          campaignId,
          action: 'DISPATCH_DESTINATION_VALIDATION_UNAVAILABLE',
          entityType: 'DispatchItem',
          entityId: item.id,
          metadata: {
            dispatchId: dispatch.id,
            destinationHashPartial: destHashPartial,
            reason: 'VALIDATION_CACHE_UNAVAILABLE',
            cacheHit: false,
          },
        });
        return {
          action: 'DEFERRED_WHATSAPP_VALIDATION',
          send: false,
          dispatchItemId: item.id,
          delayUntil: resumeAt,
          reason: 'VALIDATION_CACHE_UNAVAILABLE',
        };
      }

      if (cached?.status === 'VALID') {
        destinationValidationStatus = 'VALID';
        validationCacheHit = true;
        validationSource = cached.source ?? WHATSAPP_VALIDATION_SOURCE;
        await prisma.dispatchItem.update({
          where: { id: item.id },
          data: {
            destinationValidationStatus: 'VALID',
            destinationValidatedAt: now(),
            validationSource,
            validationCacheHit: true,
          } as never,
        });
        await safeAudit(prisma, {
          organizationId: orgId,
          campaignId,
          action: 'DISPATCH_DESTINATION_VALIDATED',
          entityType: 'DispatchItem',
          entityId: item.id,
          metadata: {
            dispatchId: dispatch.id,
            destinationHashPartial: destHashPartial,
            status: 'VALID',
            cacheHit: true,
            source: validationSource,
          },
        });
      } else if (cached?.status === 'INVALID') {
        await finalizeSkip(
          prisma,
          item,
          now(),
          'WHATSAPP_NUMBER_NOT_REGISTERED',
          DispatchItemErrorCategory.INVALID_DESTINATION,
          {
            destinationValidationStatus: 'INVALID',
            destinationValidatedAt: now(),
            validationSource: cached.source ?? WHATSAPP_VALIDATION_SOURCE,
            validationCacheHit: true,
            lastQueueError: 'WHATSAPP_NUMBER_NOT_REGISTERED',
          },
        );
        await recomputeDispatchProgress(prisma, dispatch, now());
        await safeAudit(prisma, {
          organizationId: orgId,
          campaignId,
          action: 'DISPATCH_DESTINATION_INVALID',
          entityType: 'DispatchItem',
          entityId: item.id,
          metadata: {
            dispatchId: dispatch.id,
            destinationHashPartial: destHashPartial,
            status: 'INVALID',
            cacheHit: true,
            source: cached.source ?? WHATSAPP_VALIDATION_SOURCE,
            reason: 'WHATSAPP_NUMBER_NOT_REGISTERED',
          },
        });
        return {
          action: 'SKIPPED_WHATSAPP_NUMBER_INVALID',
          send: false,
          dispatchItemId: item.id,
        };
      } else {
        const validateFn = deps.validateNumber ?? validateWhatsAppNumber;
        const validation = await validateFn({
          baseUrl: deps.evolutionBaseUrl ?? process.env.EVOLUTION_API_URL ?? '',
          apiKey: deps.evolutionApiKey ?? process.env.EVOLUTION_API_KEY,
          instanceName: channelAccountMeta.externalAccountId ?? '',
          destinationDigits: normalizedDestination,
        });
        destinationValidationStatus = validation.status;
        validationSource = WHATSAPP_VALIDATION_SOURCE;
        validationCacheHit = false;

        if (validation.status === 'VALID' || validation.status === 'INVALID') {
          const ttl = cacheTtlMsForValidationStatus(validation.status);
          try {
            await prisma.$executeRaw`
              INSERT INTO "DestinationWhatsAppValidationCache" (
                "id", "organizationId", "destinationHash", "status", "source",
                "provider", "lastErrorCode", "checkedAt", "expiresAt", "createdAt", "updatedAt"
              ) VALUES (
                ${`dvc_${destHash.slice(0, 20)}`},
                ${orgId},
                ${destHash},
                ${validation.status},
                ${WHATSAPP_VALIDATION_SOURCE},
                ${'EVOLUTION'},
                ${validation.errorCode},
                ${now()},
                ${new Date(now().getTime() + ttl)},
                ${now()},
                ${now()}
              )
              ON CONFLICT ("organizationId", "destinationHash") DO UPDATE SET
                "status" = EXCLUDED."status",
                "source" = EXCLUDED."source",
                "provider" = EXCLUDED."provider",
                "lastErrorCode" = EXCLUDED."lastErrorCode",
                "checkedAt" = EXCLUDED."checkedAt",
                "expiresAt" = EXCLUDED."expiresAt",
                "updatedAt" = EXCLUDED."updatedAt"
            `;
          } catch {
            // cache best-effort
          }
        } else {
          const ttl = cacheTtlMsForValidationStatus('UNKNOWN');
          try {
            await prisma.$executeRaw`
              INSERT INTO "DestinationWhatsAppValidationCache" (
                "id", "organizationId", "destinationHash", "status", "source",
                "provider", "lastErrorCode", "checkedAt", "expiresAt", "createdAt", "updatedAt"
              ) VALUES (
                ${`dvc_${destHash.slice(0, 20)}`},
                ${orgId},
                ${destHash},
                ${'UNKNOWN'},
                ${WHATSAPP_VALIDATION_SOURCE},
                ${'EVOLUTION'},
                ${validation.errorCode},
                ${now()},
                ${new Date(now().getTime() + ttl)},
                ${now()},
                ${now()}
              )
              ON CONFLICT ("organizationId", "destinationHash") DO UPDATE SET
                "status" = EXCLUDED."status",
                "lastErrorCode" = EXCLUDED."lastErrorCode",
                "checkedAt" = EXCLUDED."checkedAt",
                "expiresAt" = EXCLUDED."expiresAt",
                "updatedAt" = EXCLUDED."updatedAt"
            `;
          } catch {
            // cache best-effort
          }
        }

        if (validation.status === 'VALID') {
          await prisma.dispatchItem.update({
            where: { id: item.id },
            data: {
              destinationValidationStatus: 'VALID',
              destinationValidatedAt: now(),
              validationSource,
              validationCacheHit: false,
            } as never,
          });
          await safeAudit(prisma, {
            organizationId: orgId,
            campaignId,
            action: 'DISPATCH_DESTINATION_VALIDATED',
            entityType: 'DispatchItem',
            entityId: item.id,
            metadata: {
              dispatchId: dispatch.id,
              destinationHashPartial: destHashPartial,
              status: 'VALID',
              cacheHit: false,
              source: validationSource,
            },
          });
        } else if (validation.status === 'INVALID') {
          await finalizeSkip(
            prisma,
            item,
            now(),
            'WHATSAPP_NUMBER_NOT_REGISTERED',
            DispatchItemErrorCategory.INVALID_DESTINATION,
            {
              destinationValidationStatus: 'INVALID',
              destinationValidatedAt: now(),
              validationSource,
              validationCacheHit: false,
              lastQueueError: 'WHATSAPP_NUMBER_NOT_REGISTERED',
            },
          );
          await recomputeDispatchProgress(prisma, dispatch, now());
          await safeAudit(prisma, {
            organizationId: orgId,
            campaignId,
            action: 'DISPATCH_DESTINATION_INVALID',
            entityType: 'DispatchItem',
            entityId: item.id,
            metadata: {
              dispatchId: dispatch.id,
              destinationHashPartial: destHashPartial,
              status: 'INVALID',
              cacheHit: false,
              source: validationSource,
              reason: 'WHATSAPP_NUMBER_NOT_REGISTERED',
            },
          });
          return {
            action: 'SKIPPED_WHATSAPP_NUMBER_INVALID',
            send: false,
            dispatchItemId: item.id,
          };
        } else {
          const nextAttempts = priorAttempts + 1;
          if (nextAttempts >= WHATSAPP_VALIDATION_MAX_UNKNOWN_ATTEMPTS) {
            await finalizeFailed(
              prisma,
              item,
              now(),
              'FAILED_VALIDATION_UNAVAILABLE',
              DispatchItemErrorCategory.PROVIDER_UNAVAILABLE,
              'Validacao WhatsApp indisponivel apos tentativas',
            );
            await prisma.dispatchItem.update({
              where: { id: item.id },
              data: {
                destinationValidationStatus: validation.status,
                destinationValidatedAt: now(),
                validationSource,
                validationCacheHit: false,
                destinationValidationAttempts: nextAttempts,
                lastQueueError: 'FAILED_VALIDATION_UNAVAILABLE',
              } as never,
            });
            await recomputeDispatchProgress(prisma, dispatch, now());
            await safeAudit(prisma, {
              organizationId: orgId,
              campaignId,
              action: 'DISPATCH_DESTINATION_VALIDATION_UNAVAILABLE',
              entityType: 'DispatchItem',
              entityId: item.id,
              metadata: {
                dispatchId: dispatch.id,
                destinationHashPartial: destHashPartial,
                status: validation.status,
                cacheHit: false,
                reason: 'FAILED_VALIDATION_UNAVAILABLE',
                source: validationSource,
              },
            });
            return {
              action: 'FAILED_VALIDATION_UNAVAILABLE',
              send: false,
              dispatchItemId: item.id,
              reason: validation.errorCode ?? validation.status,
            };
          }

          const backoffMinutes = Math.min(30, 5 * nextAttempts);
          const resumeAt = new Date(now().getTime() + backoffMinutes * 60_000);
          await prisma.dispatchItem.update({
            where: { id: item.id },
            data: {
              status: DispatchItemStatus.SCHEDULED,
              scheduledAt: resumeAt,
              lockedAt: null,
              lockToken: null,
              lockExpiresAt: null,
              lastQueueError: `WHATSAPP_VALIDATION_${validation.status}`,
              destinationValidationStatus: validation.status,
              validationSource,
              validationCacheHit: false,
              destinationValidationAttempts: nextAttempts,
            } as never,
          });
          await safeAudit(prisma, {
            organizationId: orgId,
            campaignId,
            action: 'DISPATCH_DESTINATION_VALIDATION_UNAVAILABLE',
            entityType: 'DispatchItem',
            entityId: item.id,
            metadata: {
              dispatchId: dispatch.id,
              destinationHashPartial: destHashPartial,
              status: validation.status,
              cacheHit: false,
              reason: validation.errorCode ?? validation.status,
              source: validationSource,
            },
          });
          return {
            action: 'DEFERRED_WHATSAPP_VALIDATION',
            send: false,
            dispatchItemId: item.id,
            delayUntil: resumeAt,
            reason: validation.errorCode ?? validation.status,
          };
        }
      }
    } else {
      destinationValidationStatus = 'SKIPPED_BY_POLICY';
    }

    // --- Reserva atomica de slot por ChannelAccount (09.6.1) ---

    type ProtectionEvidence = {
      protectionProfile: string;
      minDelaySeconds: number;
      maxDelaySeconds: number;
      selectedDelaySeconds: number;
      previousChannelSendAt: Date | null;
      reservedSendAt: Date;
      sequenceNumber: number;
      hourlyUsageBefore: number;
      dailyUsageBefore: number;
      effectiveDailyLimit: number;
      batchPosition: number;
      batchNumber: number;
      pauseApplied: boolean;
      pauseReason: string | null;
      protectionDecision: string;
      protectionReason: string;
    };

    let protectionEvidence: ProtectionEvidence;
    const preScheduledAt = (item as { protectionScheduledAt?: Date | null })
      .protectionScheduledAt;
    const preDelaySeconds = (item as { protectionDelaySeconds?: number | null })
      .protectionDelaySeconds;
    const preSequence = (item as { protectionSequenceNumber?: number | null })
      .protectionSequenceNumber;
    const preRule = (item as { protectionRuleApplied?: string | null })
      .protectionRuleApplied;

    if (preScheduledAt && preDelaySeconds != null && preSequence != null) {
      const scheduledMs = new Date(preScheduledAt).getTime();
      if (scheduledMs > now().getTime() + 50) {
        await prisma.dispatchItem.update({
          where: { id: item.id },
          data: {
            status: DispatchItemStatus.SCHEDULED,
            scheduledAt: new Date(preScheduledAt),
            dispatchChannelId: selectedChannel.id,
            channelAccountId: selectedChannel.channelAccountId,
            lockedAt: null,
            lockToken: null,
            lockExpiresAt: null,
            lastQueueError: 'WAITING_PRE_RESERVED_SLOT',
          },
        });
        return {
          action: 'DEFERRED_CHANNEL_DELAY',
          send: false,
          dispatchItemId: item.id,
          delayUntil: new Date(preScheduledAt),
          reason: 'PRE_RESERVED_SLOT_NOT_DUE',
        };
      }

      protectionEvidence = {
        protectionProfile: policy.profile,
        minDelaySeconds: policy.minDelaySeconds,
        maxDelaySeconds: policy.maxDelaySeconds,
        selectedDelaySeconds: preDelaySeconds,
        previousChannelSendAt: null,
        reservedSendAt: new Date(preScheduledAt),
        sequenceNumber: preSequence,
        hourlyUsageBefore: 0,
        dailyUsageBefore: 0,
        effectiveDailyLimit: selectedChannel.effectiveDailyLimit,
        batchPosition: ((preSequence - 1) % Math.max(1, policy.batchSize)) + 1,
        batchNumber:
          Math.floor((preSequence - 1) / Math.max(1, policy.batchSize)) + 1,
        pauseApplied: Boolean(preRule && String(preRule).includes('PAUSE')),
        pauseReason: preRule ?? null,
        protectionDecision: 'ALLOW_NOW',
        protectionReason: 'PRE_RESERVED_SLOT_DUE',
      };
    } else {
      const reservation = await reserveChannelAccountSendSlotAtomic(prisma, {
        organizationId: String(
          (item as { organizationId?: string }).organizationId ?? '',
        ),
        campaignId: String((item as { campaignId?: string }).campaignId ?? ''),
        channelAccountId: selectedChannel.channelAccountId,
        channelAccountCreatedAt:
          (channelAccountMeta as { accountOperationalSince?: Date | null } | null)
            ?.accountOperationalSince ??
          channelAccountMeta?.createdAt ??
          null,
        approvalSnapshot: dispatch.approvalSnapshot,
        dispatchChannelEffectiveDailyLimit: selectedChannel.effectiveDailyLimit,
        now: now(),
        random: deps.random,
      });

      protectionEvidence = {
        protectionProfile: reservation.policy.profile,
        minDelaySeconds: reservation.policy.minDelaySeconds,
        maxDelaySeconds: reservation.policy.maxDelaySeconds,
        selectedDelaySeconds: reservation.selectedDelaySeconds,
        previousChannelSendAt: reservation.previousChannelSendAt,
        reservedSendAt: reservation.reservedSendAt,
        sequenceNumber: reservation.sequenceNumber,
        hourlyUsageBefore: reservation.hourlyUsageBefore,
        dailyUsageBefore: reservation.dailyUsageBefore,
        effectiveDailyLimit: reservation.effectiveDailyLimit,
        batchPosition: reservation.batchPosition,
        batchNumber: reservation.batchNumber,
        pauseApplied: reservation.pauseApplied,
        pauseReason: reservation.pauseReason,
        protectionDecision: reservation.decision,
        protectionReason: reservation.protectionReason,
      };

      if (reservation.decision !== 'ALLOW_NOW') {
        const resumeAt = reservation.reservedSendAt;
        let action:
          | 'DEFERRED_CHANNEL_DELAY'
          | 'DEFERRED_HOURLY_LIMIT'
          | 'DEFERRED_DAILY_LIMIT'
          | 'DEFERRED_PROTECTION_COOLDOWN' = 'DEFERRED_CHANNEL_DELAY';
        if (reservation.protectionReason === 'HOURLY_LIMIT_REACHED') {
          action = 'DEFERRED_HOURLY_LIMIT';
        } else if (reservation.protectionReason === 'DAILY_LIMIT_REACHED') {
          action = 'DEFERRED_DAILY_LIMIT';
        } else if (reservation.decision === 'BLOCKED_COOLDOWN') {
          action = 'DEFERRED_PROTECTION_COOLDOWN';
        }

        await prisma.dispatchItem.update({
          where: { id: item.id },
          data: {
            status: DispatchItemStatus.SCHEDULED,
            scheduledAt: resumeAt,
            dispatchChannelId: selectedChannel.id,
            channelAccountId: selectedChannel.channelAccountId,
            protectionDelaySeconds: reservation.selectedDelaySeconds,
            protectionScheduledAt: resumeAt,
            protectionRuleApplied: reservation.protectionReason,
            protectionSequenceNumber: reservation.sequenceNumber,
            lockedAt: null,
            lockToken: null,
            lockExpiresAt: null,
            lastQueueError: reservation.protectionReason,
          },
        });

        return {
          action,
          send: false,
          dispatchItemId: item.id,
          delayUntil: resumeAt,
          reason: reservation.protectionReason,
        };
      }

      await prisma.dispatchItem.update({
        where: { id: item.id },
        data: {
          dispatchChannelId: selectedChannel.id,
          channelAccountId: selectedChannel.channelAccountId,
          protectionDelaySeconds: reservation.selectedDelaySeconds,
          protectionScheduledAt: reservation.reservedSendAt,
          protectionRuleApplied: reservation.protectionReason,
          protectionSequenceNumber: reservation.sequenceNumber,
        },
      });
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

    const contentCheck = assertFrozenItemContentReady(item.contentSnapshot);
    if (!contentCheck.ok) {
      await finalizeSkip(
        prisma,
        item,
        now(),
        contentCheck.errorCode,
        DispatchItemErrorCategory.CONTENT_REJECTED,
      );
      return {
        action: 'SKIPPED_CONTENT_INVALID',
        send: false,
        dispatchItemId: item.id,
        reason: contentCheck.errorCode,
      };
    }
    const text = contentCheck.text;

    const requestStartedAt = now();

    const violation = detectProtectionIntervalViolation({
      previousStartedAt: protectionEvidence.previousChannelSendAt,
      actualStartedAt: requestStartedAt,
      minDelaySeconds: protectionEvidence.minDelaySeconds,
    });
    if (violation.violated) {
      await registerChannelProtectionIntervalViolation(prisma, {
        channelAccountId: selectedChannel.channelAccountId,
        now: requestStartedAt,
        cooldownMinutes: Math.max(1, policy.errorPauseMinutes),
      });
      await prisma.dispatchChannel.updateMany({
        where: { id: selectedChannel.id },
        data: {
          consecutiveErrors: { increment: 1 },
          cooldownUntil: new Date(
            requestStartedAt.getTime() +
              Math.max(1, policy.errorPauseMinutes) * 60_000,
          ),
          operationalStatus: DispatchChannelOperationalStatus.COOLDOWN,
        },
      });
      await prisma.dispatchItem.update({
        where: { id: item.id },
        data: {
          status: DispatchItemStatus.SCHEDULED,
          scheduledAt: new Date(
            requestStartedAt.getTime() +
              Math.max(1, policy.errorPauseMinutes) * 60_000,
          ),
          lockedAt: null,
          lockToken: null,
          lockExpiresAt: null,
          lastQueueError: 'PROTECTION_INTERVAL_VIOLATION',
        },
      });
      try {
        await prisma.auditLog.create({
          data: {
            organizationId: String(
              (item as { organizationId?: string }).organizationId ?? '',
            ),
            campaignId: String(
              (item as { campaignId?: string }).campaignId ?? '',
            ),
            action: 'PROTECTION_INTERVAL_VIOLATION',
            entityType: 'ChannelAccount',
            entityId: selectedChannel.channelAccountId,
            metadata: {
              dispatchId: dispatch.id,
              dispatchItemId: item.id,
              intervalObservedSeconds: violation.intervalObservedSeconds,
              minDelaySeconds: protectionEvidence.minDelaySeconds,
            },
          },
        });
      } catch {
        // auditoria nao bloqueia
      }
      return {
        action: 'DEFERRED_PROTECTION_COOLDOWN',
        send: false,
        dispatchItemId: item.id,
        reason: 'PROTECTION_INTERVAL_VIOLATION',
        delayUntil: new Date(
          requestStartedAt.getTime() +
            Math.max(1, policy.errorPauseMinutes) * 60_000,
        ),
      };
    }

    await prisma.dispatchItem.updateMany({
      where: { id: item.id, status: DispatchItemStatus.PROCESSING },
      data: {
        providerRequestStartedAt: requestStartedAt,
        channelStatusAtSend: String(channelAccountMeta.status ?? 'UNKNOWN'),
      } as never,
    });

    console.log(
      `[provider-send-start] item=${item.id} channelAccount=${selectedChannel.channelAccountId} connectionStatus=${String(channelAccountMeta.status ?? 'UNKNOWN')} providerRequestStartedAt=${requestStartedAt.toISOString()}`,
    );

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
      protection: {
        ...protectionEvidence,
        actualProviderRequestStartedAt: requestStartedAt,
        intervalObservedSeconds: violation.intervalObservedSeconds,
      },
    });

    const sendFn = deps.sendText ?? sendEvolutionText;
    const result = await sendFn({
      baseUrl: deps.evolutionBaseUrl ?? process.env.EVOLUTION_API_URL ?? '',
      apiKey: deps.evolutionApiKey ?? process.env.EVOLUTION_API_KEY,
      instanceName:
        (channelAccountMeta as { externalAccountId?: string | null } | null)
          ?.externalAccountId ?? '',
      destination: normalizedDestination,
      text,
      idempotencyKey: item.id,
    });

    const responseReceivedAt = now();
    await prisma.dispatchItem.updateMany({
      where: { id: item.id },
      data: {
        providerRequestCompletedAt: responseReceivedAt,
        providerResponseReceivedAt: responseReceivedAt,
      } as never,
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
        protectionDecision: 'SENT',
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
      await confirmChannelAccountSendSuccessAtomic(prisma, {
        channelAccountId: selectedChannel.channelAccountId,
        now: now(),
      });
      await upsertChannelUsageDaily(prisma, {
        organizationId: (item as { organizationId?: string }).organizationId ?? '',
        campaignId: (item as { campaignId?: string }).campaignId ?? '',
        dispatchChannelId: selectedChannel.id,
        channelAccountId: selectedChannel.channelAccountId,
        usageDate: usageDateKey,
        now: now(),
      });
      await reconcileDispatchChannelCounters(prisma, dispatch.id);
      await recomputeDispatchProgress(prisma, dispatch, now());
      return { action: 'SENT', send: true, dispatchItemId: item.id };
    }

    const failure = result;
    const evidence =
      'evidence' in failure && failure.evidence
        ? failure.evidence
        : {
            httpStatus: failure.httpStatus,
            providerErrorCode: failure.errorCode,
            providerErrorType: null,
            providerErrorMessageSafe: failure.errorMessage,
            providerRequestId: null,
            endpoint: 'message/sendText',
            instanceName: channelAccountMeta.externalAccountId ?? null,
          };
    const acceptanceState =
      ('acceptanceState' in failure && failure.acceptanceState) ||
      (failure.ambiguous ? 'AMBIGUOUS' : 'NOT_ACCEPTED');

    let channelStatusAfterFailure = String(channelAccountMeta.status ?? 'UNKNOWN');
    const disconnectLike =
      failure.category === 'CHANNEL_DISCONNECTED' ||
      failure.category === 'PROVIDER_CONNECTION_CLOSED' ||
      failure.category === 'CHANNEL_UNAVAILABLE' ||
      failure.category === 'CHANNEL_NOT_FOUND';

    if (disconnectLike) {
      const check = await checkEvolutionConnectionState({
        baseUrl: deps.evolutionBaseUrl ?? process.env.EVOLUTION_API_URL ?? '',
        apiKey: deps.evolutionApiKey ?? process.env.EVOLUTION_API_KEY,
        instanceName: channelAccountMeta.externalAccountId ?? '',
      });
      channelStatusAfterFailure = check.status;
      if (
        check.status === 'DISCONNECTED' ||
        check.status === 'UNAVAILABLE' ||
        check.status === 'UNKNOWN'
      ) {
        await prisma.channelAccount.updateMany({
          where: { id: selectedChannel.channelAccountId },
          data: {
            status: ChannelAccountStatus.DISCONNECTED,
            disconnectedAt: now(),
            lastConnectionError: failure.errorCode,
          } as never,
        });
        await prisma.dispatchChannel.updateMany({
          where: { id: selectedChannel.id },
          data: {
            operationalStatus: DispatchChannelOperationalStatus.COOLDOWN,
            cooldownUntil: new Date(now().getTime() + CHANNEL_COOLDOWN_STEP_MS),
          },
        });
      }
    }

    // Nao substituir evidencia do provider pela mensagem classificada do motor:
    // a UI separa "mensagem segura" (corpo) de "mensagem operacional" (categoria).
    const providerMessageSafe = evidence.providerErrorMessageSafe ?? null;

    console.log(
      `[provider-send-error] item=${item.id} channelAccount=${selectedChannel.channelAccountId} httpStatus=${failure.httpStatus ?? 'n/a'} providerErrorCode=${evidence.providerErrorCode ?? failure.errorCode} classifiedAs=${failure.category} acceptanceState=${acceptanceState} channelStatusAfterCheck=${channelStatusAfterFailure} providerMessageSafe=${providerMessageSafe ? JSON.stringify(providerMessageSafe) : 'n/a'}`,
    );

    const diagnosticFields = {
      providerHttpStatus: failure.httpStatus,
      providerErrorCode: evidence.providerErrorCode ?? failure.errorCode,
      providerErrorType: evidence.providerErrorType,
      providerErrorMessageSafe: providerMessageSafe,
      providerRequestId: evidence.providerRequestId,
      providerResponseReceivedAt: responseReceivedAt,
      acceptanceState,
      channelStatusAfterFailure,
      classificationConfidence: 'CONFIRMED',
    };

    if (failure.ambiguous || acceptanceState === 'AMBIGUOUS') {
      await finalizeUnknown(prisma, item, now(), attemptCount, failure, diagnosticFields);
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
        protectionDecision: 'UNKNOWN_PROVIDER_STATE',
      });
      await reconcileDispatchChannelCounters(prisma, dispatch.id);
      await recomputeDispatchProgress(prisma, dispatch, now());
      return { action: 'UNKNOWN_PROVIDER_STATE', send: true, dispatchItemId: item.id };
    }

    if (
      (failure.category === 'PROVIDER_RATE_LIMIT' && policy.pauseOn429) ||
      ((failure.category === 'AUTHENTICATION_ERROR' ||
        failure.category === 'PROVIDER_AUTH_ERROR') &&
        policy.pauseOn403)
    ) {
      const nextConsecutiveErrors = (selectedChannel.consecutiveErrors ?? 0) + 1;
      const shouldPause =
        nextConsecutiveErrors >= Math.max(1, policy.consecutiveErrorsBeforePause);
      if (shouldPause) {
        await prisma.dispatchChannel.updateMany({
          where: { id: selectedChannel.id },
          data: {
            consecutiveErrors: nextConsecutiveErrors,
            cooldownUntil: new Date(
              now().getTime() + Math.max(1, policy.errorPauseMinutes) * 60_000,
            ),
            operationalStatus: DispatchChannelOperationalStatus.COOLDOWN,
          },
        });
      } else {
        await prisma.dispatchChannel.updateMany({
          where: { id: selectedChannel.id },
          data: { consecutiveErrors: nextConsecutiveErrors },
        });
      }

      const canFailover =
        !item.providerMessageId &&
        acceptanceState === 'NOT_ACCEPTED';

      const failoverCandidate = canFailover
        ? await resolveEffectiveChannel({
            prisma,
            dispatch,
            item: { ...item, dispatchChannelId: selectedChannel.id },
            now,
            excludeCurrent: true,
          })
        : { effectiveChannel: null };

      const resumeAt = new Date(now().getTime() + CHANNEL_FAILOVER_RETRY_DELAY_MS);

      if (failoverCandidate.effectiveChannel) {
        await prisma.dispatchItem.update({
          where: { id: item.id },
          data: {
            status: DispatchItemStatus.SCHEDULED,
            scheduledAt: resumeAt,
            dispatchChannelId: failoverCandidate.effectiveChannel.id,
            channelAccountId: failoverCandidate.effectiveChannel.channelAccountId,
            protectionDelaySeconds: null,
            protectionScheduledAt: null,
            protectionRuleApplied: null,
            protectionSequenceNumber: null,
            lockedAt: null,
            lockToken: null,
            lockExpiresAt: null,
            lastQueueError: `CHANNEL_COOLDOWN_${failure.errorCode}`,
            ...diagnosticFields,
          } as never,
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
            ...diagnosticFields,
          } as never,
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
        protectionDecision: 'RETRY_SCHEDULED',
      });
      return {
        action: 'DEFERRED_CHANNEL_COOLDOWN',
        send: true,
        dispatchItemId: item.id,
        delayUntil: resumeAt,
      };
    }

    // Queda de instancia confirmada (NOT_ACCEPTED): failover seguro se houver outra conta
    if (
      disconnectLike &&
      acceptanceState === 'NOT_ACCEPTED' &&
      !item.providerMessageId
    ) {
      const failoverCandidate = await resolveEffectiveChannel({
        prisma,
        dispatch,
        item: { ...item, dispatchChannelId: selectedChannel.id },
        now,
        excludeCurrent: true,
      });
      if (failoverCandidate.effectiveChannel) {
        const resumeAt = new Date(now().getTime() + CHANNEL_FAILOVER_RETRY_DELAY_MS);
        await prisma.dispatchItem.update({
          where: { id: item.id },
          data: {
            status: DispatchItemStatus.SCHEDULED,
            scheduledAt: resumeAt,
            dispatchChannelId: failoverCandidate.effectiveChannel.id,
            channelAccountId: failoverCandidate.effectiveChannel.channelAccountId,
            protectionDelaySeconds: null,
            protectionScheduledAt: null,
            protectionRuleApplied: null,
            protectionSequenceNumber: null,
            lockedAt: null,
            lockToken: null,
            lockExpiresAt: null,
            lastQueueError: `CHANNEL_DISCONNECT_FAILOVER_${failure.errorCode}`,
            ...diagnosticFields,
          } as never,
        });
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
          protectionDecision: 'FAILOVER_AFTER_DISCONNECT',
        });
        await recomputeDispatchProgress(prisma, dispatch, now());
        return {
          action: 'DEFERRED_CHANNEL_COOLDOWN',
          send: true,
          dispatchItemId: item.id,
          delayUntil: resumeAt,
        };
      }
    }

    const isTransient =
      failure.category === 'TRANSIENT_NETWORK' ||
      failure.category === 'PROVIDER_UNAVAILABLE' ||
      failure.category === 'PROVIDER_TIMEOUT';

    if (isTransient && !isDispatchRetryExhausted(attemptCount, maxAttempts)) {
      const nextRetryAt = computeDispatchNextRetryAt(now(), attemptCount);
      await finalizeRetryScheduled(
        prisma,
        item,
        now(),
        attemptCount,
        nextRetryAt,
        failure,
        diagnosticFields,
      );
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
      diagnosticFields,
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
    await prisma.dispatchChannel.updateMany({
      where: { id: selectedChannel.id },
      data: {
        failedItems: { increment: 1 },
      },
    });
    await reconcileDispatchChannelCounters(prisma, dispatch.id);
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
    protection?: {
      protectionProfile: string;
      minDelaySeconds: number;
      maxDelaySeconds: number;
      selectedDelaySeconds: number;
      previousChannelSendAt: Date | null;
      reservedSendAt: Date;
      actualProviderRequestStartedAt: Date;
      intervalObservedSeconds: number | null;
      sequenceNumber: number;
      hourlyUsageBefore: number;
      dailyUsageBefore: number;
      effectiveDailyLimit: number;
      batchPosition: number;
      batchNumber: number;
      pauseApplied: boolean;
      pauseReason: string | null;
      protectionDecision: string;
      protectionReason: string;
    };
  },
): Promise<string | null> {
  if (!input.organizationId || !input.campaignId) return null;
  const protection = input.protection;
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
        ...(protection
          ? {
              protectionProfile: protection.protectionProfile,
              minDelaySeconds: protection.minDelaySeconds,
              maxDelaySeconds: protection.maxDelaySeconds,
              selectedDelaySeconds: protection.selectedDelaySeconds,
              previousChannelSendAt: protection.previousChannelSendAt,
              reservedSendAt: protection.reservedSendAt,
              actualProviderRequestStartedAt:
                protection.actualProviderRequestStartedAt,
              intervalObservedSeconds: protection.intervalObservedSeconds,
              sequenceNumber: protection.sequenceNumber,
              hourlyUsageBefore: protection.hourlyUsageBefore,
              dailyUsageBefore: protection.dailyUsageBefore,
              effectiveDailyLimit: protection.effectiveDailyLimit,
              batchPosition: protection.batchPosition,
              batchNumber: protection.batchNumber,
              pauseApplied: protection.pauseApplied,
              pauseReason: protection.pauseReason,
              protectionDecision: protection.protectionDecision,
              protectionReason: protection.protectionReason,
            }
          : {}),
      },
      update: {
        startedAt: input.startedAt,
        channelAccountId: input.channelAccountId,
        dispatchChannelId: input.dispatchChannelId,
        manual: input.manual,
        retryMode: input.retryMode,
        completedAt: null,
        outcome: null,
        ...(protection
          ? {
              protectionProfile: protection.protectionProfile,
              minDelaySeconds: protection.minDelaySeconds,
              maxDelaySeconds: protection.maxDelaySeconds,
              selectedDelaySeconds: protection.selectedDelaySeconds,
              previousChannelSendAt: protection.previousChannelSendAt,
              reservedSendAt: protection.reservedSendAt,
              actualProviderRequestStartedAt:
                protection.actualProviderRequestStartedAt,
              intervalObservedSeconds: protection.intervalObservedSeconds,
              sequenceNumber: protection.sequenceNumber,
              hourlyUsageBefore: protection.hourlyUsageBefore,
              dailyUsageBefore: protection.dailyUsageBefore,
              effectiveDailyLimit: protection.effectiveDailyLimit,
              batchPosition: protection.batchPosition,
              batchNumber: protection.batchNumber,
              pauseApplied: protection.pauseApplied,
              pauseReason: protection.pauseReason,
              protectionDecision: protection.protectionDecision,
              protectionReason: protection.protectionReason,
            }
          : {}),
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
    protectionDecision?: string | null;
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
        ...(data.protectionDecision
          ? { protectionDecision: data.protectionDecision }
          : {}),
      },
    });
  } catch {
    // historico e diagnostico; nao falha o envio
  }
}

async function safeAudit(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    campaignId: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: input.organizationId,
        campaignId: input.campaignId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata as never,
      },
    });
  } catch {
    // auditoria nao bloqueia
  }
}

async function finalizeSkip(
  prisma: PrismaClient,
  item: ItemRow,
  now: Date,
  errorCode: string,
  errorCategory: DispatchItemErrorCategory | null,
  extras?: {
    destinationValidationStatus?: string;
    destinationValidatedAt?: Date;
    validationSource?: string | null;
    validationCacheHit?: boolean;
    lastQueueError?: string;
  },
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
      ...(extras?.lastQueueError
        ? { lastQueueError: extras.lastQueueError }
        : {}),
      ...(extras?.destinationValidationStatus
        ? {
            destinationValidationStatus: extras.destinationValidationStatus,
            destinationValidatedAt: extras.destinationValidatedAt ?? now,
            validationSource: extras.validationSource ?? null,
            validationCacheHit: extras.validationCacheHit ?? false,
          }
        : {}),
    } as never,
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
  diagnostics?: Record<string, unknown>,
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
      ...(diagnostics ?? {}),
    } as never,
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
      acceptanceState: 'ACCEPTED',
      lockedAt: null,
      lockToken: null,
      lockExpiresAt: null,
    } as never,
  });
}

async function finalizeRetryScheduled(
  prisma: PrismaClient,
  item: ItemRow,
  now: Date,
  attemptCount: number,
  nextRetryAt: Date,
  failure: { errorCode: string; errorMessage: string; category: EvolutionSendCategory },
  diagnostics?: Record<string, unknown>,
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
      ...(diagnostics ?? {}),
    } as never,
  });
}

async function finalizeUnknown(
  prisma: PrismaClient,
  item: ItemRow,
  now: Date,
  attemptCount: number,
  failure: { errorCode: string; errorMessage: string },
  diagnostics?: Record<string, unknown>,
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
      ...(diagnostics ?? {}),
    } as never,
  });
}

/** Reconcilia sentItems/failedItems do DispatchChannel a partir dos DispatchItems. */
export async function reconcileDispatchChannelCounters(
  prisma: PrismaClient,
  dispatchId: string,
): Promise<void> {
  const channels = await prisma.dispatchChannel.findMany({
    where: { dispatchId },
    select: { id: true },
  });
  for (const channel of channels) {
    const grouped = await prisma.dispatchItem.groupBy({
      by: ['status'],
      where: { dispatchId, dispatchChannelId: channel.id },
      _count: { _all: true },
    } as never);
    let sent = 0;
    let failed = 0;
    for (const row of grouped as Array<{ status: string; _count: { _all: number } }>) {
      if (
        row.status === DispatchItemStatus.SENT ||
        row.status === DispatchItemStatus.DELIVERED ||
        row.status === DispatchItemStatus.READ
      ) {
        sent += row._count._all;
      }
      if (row.status === DispatchItemStatus.FAILED) {
        failed += row._count._all;
      }
    }
    await prisma.dispatchChannel.updateMany({
      where: { id: channel.id },
      data: { sentItems: sent, failedItems: failed },
    });
  }
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

  let validationPendingItems = 0;
  let validDestinationItems = 0;
  let invalidDestinationItems = 0;
  let validationErrorItems = 0;
  try {
    const validationGrouped = await prisma.dispatchItem.groupBy({
      by: ['destinationValidationStatus'],
      where: { dispatchId: dispatch.id },
      _count: { _all: true },
    } as never);
    for (const row of validationGrouped as Array<{
      destinationValidationStatus: string | null;
      _count: { _all: number };
    }>) {
      const status = row.destinationValidationStatus;
      const n = row._count._all;
      if (status === 'VALID') validDestinationItems += n;
      else if (status === 'INVALID') invalidDestinationItems += n;
      else if (
        status === 'UNKNOWN' ||
        status === 'PROVIDER_UNAVAILABLE' ||
        status === 'ERROR'
      ) {
        validationErrorItems += n;
      } else {
        validationPendingItems += n;
      }
    }
  } catch {
    // colunas ausentes: nao bloqueia progresso
  }

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
    validationPendingItems,
    validDestinationItems,
    invalidDestinationItems,
    validationErrorItems,
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
  const full = extractFullSendProtectionPolicy(approvalSnapshot);
  return {
    minDelaySeconds: full.minDelaySeconds,
    maxDelaySeconds: full.maxDelaySeconds,
    batchSize: full.batchSize,
    pauseBetweenBatchesSeconds: full.pauseBetweenBatchesSeconds,
    longPauseEveryMessages: full.longPauseEveryMessages,
    longPauseMinutes: full.longPauseMinutes,
    rotateEveryMessages: full.rotateEveryMessages,
    pauseOn403: full.pauseOn403,
    pauseOn429: full.pauseOn429,
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
    case 'PROVIDER_BAD_REQUEST':
      return DispatchItemErrorCategory.PROVIDER_BAD_REQUEST;
    case 'PROVIDER_CONNECTION_CLOSED':
      return DispatchItemErrorCategory.PROVIDER_CONNECTION_CLOSED;
    case 'PROVIDER_AUTH_ERROR':
    case 'AUTHENTICATION_ERROR':
      return DispatchItemErrorCategory.AUTHENTICATION_ERROR;
    case 'CHANNEL_DISCONNECTED':
      return DispatchItemErrorCategory.CHANNEL_DISCONNECTED;
    case 'CHANNEL_NOT_FOUND':
      return DispatchItemErrorCategory.CHANNEL_NOT_FOUND;
    case 'CHANNEL_UNAVAILABLE':
      return DispatchItemErrorCategory.CHANNEL_UNAVAILABLE;
    case 'INVALID_DESTINATION':
      return DispatchItemErrorCategory.INVALID_DESTINATION;
    case 'CONTENT_REJECTED':
      return DispatchItemErrorCategory.CONTENT_REJECTED;
    case 'UNKNOWN_PROVIDER_STATE':
      return DispatchItemErrorCategory.UNKNOWN;
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
