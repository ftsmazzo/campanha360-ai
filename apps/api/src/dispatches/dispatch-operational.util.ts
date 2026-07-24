import {
  ChannelAccountStatus,
  DispatchChannelOperationalStatus,
  DispatchItemStatus,
  DispatchStatus,
  MembershipRole,
} from '@prisma/client';
import {
  isDispatchEngineEnabled,
  isDispatchQueueEnabled,
  isDispatchSendEnabled,
} from '@campanha360/shared';
import {
  DISPATCH_OPERATIONAL_REASON_MAX_LENGTH,
  DISPATCH_OPERATIONAL_REASON_MIN_LENGTH,
} from './dispatch-operational.constants';
import { isDispatchStartWithinPilotLimit } from './dispatch-prepare.util';

export const DISPATCH_CANCELABLE_STATUSES: DispatchStatus[] = [
  DispatchStatus.DRAFT,
  DispatchStatus.PREPARING,
  DispatchStatus.READY,
  DispatchStatus.QUEUED,
  DispatchStatus.RUNNING,
  DispatchStatus.PAUSING,
  DispatchStatus.PAUSED,
];

export const DISPATCH_EMERGENCY_STOP_STATUSES: DispatchStatus[] = [
  DispatchStatus.QUEUED,
  DispatchStatus.RUNNING,
  DispatchStatus.PAUSING,
  DispatchStatus.PAUSED,
];

export const DISPATCH_CANCELABLE_ITEM_STATUSES: DispatchItemStatus[] = [
  DispatchItemStatus.PENDING,
  DispatchItemStatus.SCHEDULED,
  DispatchItemStatus.QUEUED,
  DispatchItemStatus.RETRY_SCHEDULED,
];

export const DISPATCH_PRESERVED_ITEM_STATUSES: DispatchItemStatus[] = [
  DispatchItemStatus.SENT,
  DispatchItemStatus.DELIVERED,
  DispatchItemStatus.READ,
  DispatchItemStatus.FAILED,
  DispatchItemStatus.SKIPPED,
  DispatchItemStatus.UNKNOWN_PROVIDER_STATE,
];

export const DISPATCH_RESUME_ELIGIBLE_ITEM_STATUSES: DispatchItemStatus[] = [
  DispatchItemStatus.QUEUED,
  DispatchItemStatus.SCHEDULED,
  DispatchItemStatus.RETRY_SCHEDULED,
];

/**
 * Sanitiza motivo operacional: trim, remove tags HTML simples, valida tamanho.
 * Pause: opcional. Cancel/emergency: obrigatório.
 */
export function normalizeOperationalReason(
  reason: string | undefined | null,
  options: { required: boolean },
): string | null {
  if (reason == null || String(reason).trim() === '') {
    if (options.required) {
      throw new Error('Motivo e obrigatorio');
    }
    return null;
  }

  const stripped = String(reason)
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim();

  if (!stripped) {
    if (options.required) {
      throw new Error('Motivo e obrigatorio');
    }
    return null;
  }

  if (stripped.length > DISPATCH_OPERATIONAL_REASON_MAX_LENGTH) {
    throw new Error(
      `Motivo deve ter no maximo ${DISPATCH_OPERATIONAL_REASON_MAX_LENGTH} caracteres`,
    );
  }

  if (
    options.required &&
    stripped.length < DISPATCH_OPERATIONAL_REASON_MIN_LENGTH
  ) {
    throw new Error(
      `Motivo deve ter no minimo ${DISPATCH_OPERATIONAL_REASON_MIN_LENGTH} caracteres`,
    );
  }

  return stripped;
}

export function assertCanPauseDispatch(status: DispatchStatus | string): void {
  if (status !== DispatchStatus.RUNNING && status !== 'RUNNING') {
    throw new Error('Somente Dispatch RUNNING pode ser pausado');
  }
}

export function assertCanResumeDispatch(input: {
  status: DispatchStatus | string;
  requiringRedistribution: boolean;
}): void {
  if (input.status !== DispatchStatus.PAUSED && input.status !== 'PAUSED') {
    throw new Error('Somente Dispatch PAUSED pode ser retomado');
  }
  if (input.requiringRedistribution) {
    throw new Error('Dispatch exige redistribuicao antes de retomar');
  }
  if (!isDispatchEngineEnabled() || !isDispatchQueueEnabled()) {
    throw new Error('Motor ou fila de disparo desabilitados');
  }
  if (!isDispatchSendEnabled()) {
    throw new Error(
      'Envio real desabilitado (DISPATCH_SEND_ENABLED=false); nao e possivel retomar',
    );
  }
}

export function assertCanCancelDispatch(status: DispatchStatus | string): void {
  const allowed = DISPATCH_CANCELABLE_STATUSES.map(String);
  if (!allowed.includes(String(status))) {
    throw new Error(`Dispatch em status ${status} nao pode ser cancelado`);
  }
}

export function assertCanEmergencyStopDispatch(
  status: DispatchStatus | string,
): void {
  const allowed = DISPATCH_EMERGENCY_STOP_STATUSES.map(String);
  if (!allowed.includes(String(status))) {
    throw new Error(
      `Dispatch em status ${status} nao permite parada emergencial`,
    );
  }
}

export function buildOperationalAllowedActions(input: {
  role: MembershipRole | string | null | undefined;
  status: DispatchStatus | string;
  requiringRedistribution?: boolean;
  totalItems?: number;
}): {
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
  canEmergencyStop: boolean;
} {
  const canApprove =
    input.role === MembershipRole.OWNER ||
    input.role === MembershipRole.ADMIN ||
    input.role === 'OWNER' ||
    input.role === 'ADMIN';

  const status = String(input.status);

  const canPause = canApprove && status === DispatchStatus.RUNNING;

  const canResume =
    canApprove &&
    status === DispatchStatus.PAUSED &&
    !input.requiringRedistribution &&
    isDispatchEngineEnabled() &&
    isDispatchQueueEnabled() &&
    isDispatchSendEnabled() &&
    isDispatchStartWithinPilotLimit(input.totalItems ?? 0);

  const canCancel =
    canApprove &&
    DISPATCH_CANCELABLE_STATUSES.map(String).includes(status);

  const canEmergencyStop =
    canApprove &&
    DISPATCH_EMERGENCY_STOP_STATUSES.map(String).includes(status);

  return { canPause, canResume, canCancel, canEmergencyStop };
}

export type DispatchCounterCounts = {
  pendingItems: number;
  queuedItems: number;
  processingItems: number;
  sentItems: number;
  deliveredItems: number;
  readItems: number;
  failedItems: number;
  skippedItems: number;
  canceledItems: number;
  unknownItems: number;
};

export function computeDispatchCountersFromStatusMap(
  counts: Record<string, number>,
): DispatchCounterCounts {
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

  return {
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
  };
}

export function isChannelPoolAptForResume(channels: Array<{
  enabled: boolean;
  operationalStatus: DispatchChannelOperationalStatus | string;
  channelAccountStatus: ChannelAccountStatus | string;
}>): boolean {
  return channels.some(
    (channel) =>
      channel.enabled &&
      channel.operationalStatus === DispatchChannelOperationalStatus.READY &&
      channel.channelAccountStatus === ChannelAccountStatus.CONNECTED,
  );
}
