import { DispatchStatus } from '@prisma/client';
import type { SelectableDispatchChannel } from './dispatch-channel-selection.util';
import type { OperationalWindowConfig } from '@campanha360/shared';

/**
 * Regras puras da subetapa 09.3 (enfileiramento tecnico). Mantidas fora do
 * service para permitir testes unitarios sem mocks de Prisma/BullMQ.
 */

export const DISPATCH_QUEUE_DEFER_MINUTES_NO_CHANNEL = 5;

const DEFAULT_ALLOWED_DAYS = [1, 2, 3, 4, 5, 6];
const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
const DEFAULT_START_TIME = '09:00';
const DEFAULT_END_TIME = '18:00';

export type DispatchForQueuePreconditions = {
  status: DispatchStatus | string;
  totalItems: number;
  pendingItems: number;
  requiringRedistribution: boolean;
  approvalSnapshot: unknown;
};

/**
 * Valida pre-condicoes de enfileiramento (09.3, secao "queue"). Lanca Error
 * (texto amigavel) para ser convertido em BadRequestException pelo service.
 */
export function assertDispatchQueuePreconditions(
  dispatch: DispatchForQueuePreconditions,
): void {
  if (dispatch.status !== DispatchStatus.READY && dispatch.status !== 'READY') {
    throw new Error('Somente Dispatch READY pode ser enfileirado');
  }
  if (dispatch.totalItems <= 0) {
    throw new Error('Dispatch sem items nao pode ser enfileirado');
  }
  if (dispatch.pendingItems <= 0) {
    throw new Error('Dispatch sem items PENDING para enfileirar');
  }
  if (dispatch.requiringRedistribution) {
    throw new Error(
      'Dispatch READY legado exige redistribuicao antes de enfileirar',
    );
  }
  if (!hasValidProtectionOrDistribution(dispatch.approvalSnapshot)) {
    throw new Error(
      'approvalSnapshot sem protectionPolicy/distributionStrategy/multiInstance; reaprove o Plano',
    );
  }
}

function hasValidProtectionOrDistribution(approvalSnapshot: unknown): boolean {
  if (!approvalSnapshot || typeof approvalSnapshot !== 'object') {
    return false;
  }
  const snapshot = approvalSnapshot as {
    protectionPolicy?: unknown;
    distributionStrategy?: unknown;
    multiInstance?: unknown;
  };
  return Boolean(
    snapshot.protectionPolicy || snapshot.distributionStrategy || snapshot.multiInstance,
  );
}

/**
 * Extrai a janela operacional a partir do approvalSnapshot.protectionPolicy
 * (fonte primaria) ou do configurationSnapshot do Dispatch (fallback),
 * aplicando defaults conservadores quando ausente.
 */
export function extractOperationalWindowForQueue(
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
    timezone:
      firstString(policy.timezone, config.timezone) ?? DEFAULT_TIMEZONE,
    allowedStartTime:
      firstString(policy.allowedStartTime, config.allowedStartTime) ??
      DEFAULT_START_TIME,
    allowedEndTime:
      firstString(policy.allowedEndTime, config.allowedEndTime) ??
      DEFAULT_END_TIME,
    allowedDays:
      firstNumberArray(policy.allowedDays, config.allowedDays) ??
      DEFAULT_ALLOWED_DAYS,
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

/** Remaining capacity considerando assignedItems + sentItems ja consumidos. */
export function remainingChannelCapacity(
  channel: SelectableDispatchChannel,
): number {
  return Math.max(
    0,
    channel.effectiveDailyLimit - channel.assignedItems - channel.sentItems,
  );
}

/** Verifica se um DispatchChannel esta apto a receber novo item agora. */
export function isDispatchChannelApta(
  channel: SelectableDispatchChannel,
  now: Date = new Date(),
): boolean {
  if (!channel.enabled || channel.archived || !channel.connected) return false;
  if (channel.operationalStatus !== 'READY') return false;
  if (channel.cooldownUntil) {
    const until =
      channel.cooldownUntil instanceof Date
        ? channel.cooldownUntil
        : new Date(channel.cooldownUntil);
    if (until.getTime() > now.getTime()) return false;
  }
  return remainingChannelCapacity(channel) > 0;
}

/** Data de reagendamento quando nenhum canal elegivel foi encontrado. */
export function buildNoChannelDeferredScheduleAt(now: Date): Date {
  return new Date(now.getTime() + DISPATCH_QUEUE_DEFER_MINUTES_NO_CHANNEL * 60_000);
}

export type QueueRunSummary = {
  jobsCreated: number;
  itemsReassigned: number;
  itemsDeferred: number;
  itemsBlocked: number;
};

/**
 * Decide o status final do Dispatch apos a rodada de enfileiramento.
 * Mantem QUEUED sempre que algo foi enfileirado ou existe algo SCHEDULED
 * para retomada futura (reconcile/cron); volta para READY apenas quando
 * absolutamente nada pode ser processado (edge case defensivo).
 */
export function resolveDispatchStatusAfterQueueRun(
  summary: QueueRunSummary,
): DispatchStatus {
  if (summary.jobsCreated > 0 || summary.itemsDeferred > 0) {
    return DispatchStatus.QUEUED;
  }
  return DispatchStatus.READY;
}
