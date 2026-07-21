import { randomUUID } from 'node:crypto';
import {
  ChannelAccountStatus,
  DispatchItemStatus,
  DispatchStatus,
  type PrismaClient,
} from '@prisma/client';
import {
  assertDispatchSendJobPayload,
  buildReassignmentUpdate,
  canReassignDispatchItem,
  isDispatchEngineEnabled,
  isDispatchQueueEnabled,
  isDispatchSendEnabled,
  isWithinOperationalWindow,
  resolveNextOperationalWindowStart,
  selectNextEligibleDispatchChannel,
  type OperationalWindowConfig,
  type SelectableDispatchChannel,
} from '@campanha360/shared';

/**
 * Worker tecnico da subetapa 09.3. Consome jobs da fila `dispatch-send`,
 * revalida tenancy/estado/canal e realiza a "validacao tecnica" do item
 * (technicalValidatedAt). NUNCA chama a Evolution, nunca seta
 * providerMessageId/sentAt/SENT — isso pertence exclusivamente a 09.4.
 */

const LOCK_DURATION_MS = 30_000;
const DEFER_MINUTES_NO_CHANNEL = 5;

const NON_ACTIVE_DISPATCH_STATUSES = new Set<string>([
  DispatchStatus.PAUSING,
  DispatchStatus.PAUSED,
  DispatchStatus.CANCELED,
  DispatchStatus.EMERGENCY_STOPPED,
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

const DEFAULT_WINDOW: OperationalWindowConfig = {
  timezone: 'America/Sao_Paulo',
  allowedStartTime: '09:00',
  allowedEndTime: '18:00',
  allowedDays: [1, 2, 3, 4, 5, 6],
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
  | 'SKIPPED_FLAG_DISABLED'
  | 'SKIPPED_CLAIM_LOST';

export type DispatchSendProcessResult = {
  action: DispatchSendProcessAction;
  send: false;
  dispatchItemId?: string;
  reason?: string;
};

export type DispatchSendProcessorDeps = {
  prisma: PrismaClient;
  now?: () => Date;
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

  if (isDispatchSendEnabled()) {
    // 09.4 usara esta flag para ativar o envio real; aqui apenas avisamos.
    // eslint-disable-next-line no-console
    console.warn(
      `[dispatch-send] DISPATCH_SEND_ENABLED=true detectado, mas a 09.3 nao envia mensagens (item=${payload.dispatchItemId})`,
    );
  }

  const dispatch = await prisma.dispatch.findFirst({
    where: {
      id: payload.dispatchId,
      organizationId: payload.organizationId,
      campaignId: payload.campaignId,
    },
    select: {
      id: true,
      status: true,
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

  if (NON_ACTIVE_DISPATCH_STATUSES.has(String(dispatch.status))) {
    return {
      action: 'NOOP_DISPATCH_NOT_ACTIVE',
      send: false,
      dispatchItemId: item.id,
      reason: `DISPATCH_STATUS_${dispatch.status}`,
    };
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
        status: { in: CLAIMABLE_ITEM_STATUSES },
      },
      data: {
        status: DispatchItemStatus.SCHEDULED,
        scheduledAt: now(),
        lastQueueError: 'DISPATCH_REQUIRES_REDISTRIBUTION',
      },
    });
    return { action: 'DEFERRED_REDISTRIBUTION', send: false, dispatchItemId: item.id };
  }

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
    const currentApta = currentChannel
      ? isChannelApta(currentChannel, now())
      : false;

    let effectiveChannel: SelectableDispatchChannel | null = currentChannel;
    let reassigned = false;

    if (!currentApta) {
      const next = selectNextEligibleDispatchChannel(selectable, {
        now: now(),
        excludeChannelIds: item.dispatchChannelId ? [item.dispatchChannelId] : [],
      });

      if (next && canReassignDispatchItem(item.status)) {
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
        effectiveChannel = next;
        reassigned = true;
      } else {
        effectiveChannel = null;
      }
    }

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

      if (job.moveToDelayed) {
        try {
          await job.moveToDelayed(nextStart.getTime(), job.token);
        } catch {
          // Se o BullMQ nao permitir mover (ex.: fora de contexto de teste),
          // o item ja ficou SCHEDULED e o reconcile/producer cuidam depois.
        }
      }

      return { action: 'DEFERRED_OUTSIDE_WINDOW', send: false, dispatchItemId: item.id };
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
