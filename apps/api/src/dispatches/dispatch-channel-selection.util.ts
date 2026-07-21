import {
  DispatchChannelOperationalStatus,
  DispatchItemStatus,
} from '@prisma/client';

export type SelectableDispatchChannel = {
  id: string;
  channelAccountId: string;
  enabled: boolean;
  priority: number;
  weight: number;
  effectiveDailyLimit: number;
  assignedItems: number;
  sentItems: number;
  consecutiveErrors?: number;
  cooldownUntil?: Date | string | null;
  operationalStatus: DispatchChannelOperationalStatus | string;
  connected: boolean;
  archived: boolean;
};

export type DispatchItemReassignmentSource = {
  dispatchChannelId: string | null;
  originalDispatchChannelId: string | null;
  channelAccountId: string;
  reassignmentCount: number;
  status: DispatchItemStatus | string;
};

const NON_REASSIGNABLE = new Set<string>([
  DispatchItemStatus.SENT,
  DispatchItemStatus.DELIVERED,
  DispatchItemStatus.READ,
  DispatchItemStatus.UNKNOWN_PROVIDER_STATE,
  DispatchItemStatus.CANCELED,
  'SENT',
  'DELIVERED',
  'READ',
  'UNKNOWN_PROVIDER_STATE',
  'CANCELED',
]);

function remainingCapacity(channel: SelectableDispatchChannel): number {
  return Math.max(
    0,
    channel.effectiveDailyLimit - channel.assignedItems - channel.sentItems,
  );
}

function isInCooldown(
  cooldownUntil: Date | string | null | undefined,
  now: Date,
): boolean {
  if (!cooldownUntil) return false;
  const until =
    cooldownUntil instanceof Date ? cooldownUntil : new Date(cooldownUntil);
  return until.getTime() > now.getTime();
}

export function selectNextEligibleDispatchChannel(
  channels: SelectableDispatchChannel[],
  options: { now?: Date; excludeChannelIds?: string[] } = {},
): SelectableDispatchChannel | null {
  const now = options.now ?? new Date();
  const excluded = new Set(options.excludeChannelIds ?? []);

  const eligible = channels
    .filter((channel) => {
      if (excluded.has(channel.id)) return false;
      if (!channel.enabled) return false;
      if (channel.archived) return false;
      if (!channel.connected) return false;
      if (
        channel.operationalStatus !== DispatchChannelOperationalStatus.READY &&
        channel.operationalStatus !== 'READY'
      ) {
        return false;
      }
      if (isInCooldown(channel.cooldownUntil, now)) return false;
      return remainingCapacity(channel) > 0;
    })
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.weight !== b.weight) return b.weight - a.weight;
      return a.id.localeCompare(b.id);
    });

  return eligible[0] ?? null;
}

export function canReassignDispatchItem(
  status: DispatchItemStatus | string,
): boolean {
  return !NON_REASSIGNABLE.has(String(status));
}

export function buildReassignmentUpdate(
  item: DispatchItemReassignmentSource,
  newChannel: { id: string; channelAccountId: string },
  now: Date = new Date(),
): {
  dispatchChannelId: string;
  channelAccountId: string;
  originalDispatchChannelId: string | null;
  reassignmentCount: number;
  lastReassignedAt: Date;
} {
  if (!canReassignDispatchItem(item.status)) {
    throw new Error('Item com status terminal nao pode ser realocado');
  }

  return {
    dispatchChannelId: newChannel.id,
    channelAccountId: newChannel.channelAccountId,
    originalDispatchChannelId:
      item.originalDispatchChannelId ?? item.dispatchChannelId,
    reassignmentCount: item.reassignmentCount + 1,
    lastReassignedAt: now,
  };
}
