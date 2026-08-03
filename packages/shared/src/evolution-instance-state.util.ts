/**
 * Modelo central de estado remoto Evolution (API 2.3.7).
 * Separado do ChannelAccountStatus operacional (CONNECTED/DISCONNECTED/...).
 */

import { platformRestrictionReadinessReason } from './platform-restriction.util';

export type EvolutionRemoteConnectionState =
  | 'NOT_FOUND'
  | 'CREATED'
  | 'QR_REQUIRED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'DISCONNECTED_WITH_SESSION'
  | 'DISCONNECTED_UNKNOWN_SESSION'
  | 'RESTART_REQUIRED'
  | 'LOGGED_OUT'
  | 'DEVICE_REMOVED'
  | 'SESSION_INVALID'
  | 'REMOVED'
  | 'ERROR'
  | 'UNKNOWN';

export type EvolutionSessionState =
  | 'ABSENT'
  | 'POSSIBLY_PRESENT'
  | 'INVALID'
  | 'REMOVED'
  | 'UNKNOWN';

export type EvolutionStateSource = 'WEBHOOK' | 'POLLING' | 'MANUAL' | 'PREPARE';

export type EvolutionInstanceStateSnapshot = {
  normalizedConnectionState: EvolutionRemoteConnectionState;
  normalizedSessionState: EvolutionSessionState;
  rawStateSafe: string | null;
  statusReason: string | null;
  reasonCode: string | null;
  reasonType: string | null;
  instanceExists: boolean;
  ownerHash: string | null;
  ownerLast4: string | null;
  checkedAt: string;
  source: EvolutionStateSource;
  recommendedAction:
    | 'NONE'
    | 'SYNC'
    | 'SHOW_QR'
    | 'RECONNECT'
    | 'RESTART'
    | 'RESET_SESSION'
    | 'RECREATE'
    | 'UNLINK';
};

export type ClassifyEvolutionRemoteInput = {
  instanceExists: boolean;
  rawState?: string | null;
  statusReason?: string | null;
  reasonCode?: string | null;
  reasonType?: string | null;
  conflictType?: string | null;
  /** Evidencia de sessao/credenciais persistidas (quando a API expõe). */
  hasSessionEvidence?: boolean | null;
  streamErrorCode?: string | number | null;
  removed?: boolean;
  loggedOut?: boolean;
  source?: EvolutionStateSource;
  checkedAt?: Date;
  ownerHash?: string | null;
  ownerLast4?: string | null;
};

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function classifyEvolutionRemoteState(
  input: ClassifyEvolutionRemoteInput,
): EvolutionInstanceStateSnapshot {
  const checkedAt = (input.checkedAt ?? new Date()).toISOString();
  const source = input.source ?? 'MANUAL';
  const raw = norm(input.rawState);
  const statusReason = norm(input.statusReason);
  const reasonCode = norm(input.reasonCode) || norm(String(input.streamErrorCode ?? ''));
  const reasonType = norm(input.reasonType) || norm(input.conflictType);
  const combined = `${raw} ${statusReason} ${reasonCode} ${reasonType}`;

  const base = {
    rawStateSafe: input.rawState?.trim() || null,
    statusReason: input.statusReason?.trim() || null,
    reasonCode: input.reasonCode?.trim() || (input.streamErrorCode != null ? String(input.streamErrorCode) : null),
    reasonType: input.reasonType?.trim() || input.conflictType?.trim() || null,
    checkedAt,
    source,
    ownerHash: input.ownerHash ?? null,
    ownerLast4: input.ownerLast4 ?? null,
  };

  if (input.removed || /\bremoved\b/.test(combined)) {
    return {
      ...base,
      normalizedConnectionState: 'REMOVED',
      normalizedSessionState: 'REMOVED',
      instanceExists: false,
      recommendedAction: 'RECREATE',
    };
  }

  if (!input.instanceExists) {
    return {
      ...base,
      normalizedConnectionState: 'NOT_FOUND',
      normalizedSessionState: 'ABSENT',
      instanceExists: false,
      recommendedAction: 'RECREATE',
    };
  }

  const deviceRemoved =
    reasonType.includes('device_removed') ||
    combined.includes('device_removed') ||
    (statusReason === '401' && combined.includes('conflict')) ||
    (reasonCode === '401' && combined.includes('device'));

  if (deviceRemoved) {
    return {
      ...base,
      normalizedConnectionState: 'DEVICE_REMOVED',
      normalizedSessionState: 'INVALID',
      instanceExists: true,
      recommendedAction: 'RESET_SESSION',
    };
  }

  if (
    input.loggedOut ||
    /\blogout\b/.test(combined) ||
    (raw === 'close' && statusReason === '401' && !deviceRemoved)
  ) {
    // 401 close sem device_removed explícito: tratar como LOGGED_OUT (sessão desautorizada).
    if (statusReason === '401' || reasonCode === '401' || input.loggedOut || /\blogout\b/.test(combined)) {
      return {
        ...base,
        normalizedConnectionState: 'LOGGED_OUT',
        normalizedSessionState: 'INVALID',
        instanceExists: true,
        recommendedAction: 'RESET_SESSION',
      };
    }
  }

  // stream:error 515 — restart obrigatório transitório (não é logout).
  if (reasonCode === '515' || /\b515\b/.test(combined) || combined.includes('restart required')) {
    return {
      ...base,
      normalizedConnectionState: 'RESTART_REQUIRED',
      normalizedSessionState: 'POSSIBLY_PRESENT',
      instanceExists: true,
      recommendedAction: 'RESTART',
    };
  }

  if (['open', 'connected', 'authenticated'].includes(raw)) {
    return {
      ...base,
      normalizedConnectionState: 'CONNECTED',
      normalizedSessionState: 'POSSIBLY_PRESENT',
      instanceExists: true,
      recommendedAction: 'NONE',
    };
  }

  if (['connecting', 'pairing'].includes(raw)) {
    return {
      ...base,
      normalizedConnectionState: 'CONNECTING',
      normalizedSessionState: 'POSSIBLY_PRESENT',
      instanceExists: true,
      recommendedAction: 'SYNC',
    };
  }

  if (['qr', 'qrcode', 'refused'].includes(raw) || combined.includes('qrcode')) {
    return {
      ...base,
      normalizedConnectionState: 'QR_REQUIRED',
      normalizedSessionState: 'ABSENT',
      instanceExists: true,
      recommendedAction: 'SHOW_QR',
    };
  }

  if (['close', 'closed', 'disconnected'].includes(raw)) {
    const hasSession =
      input.hasSessionEvidence === true ||
      (input.hasSessionEvidence !== false && statusReason !== '401');
    if (hasSession) {
      return {
        ...base,
        normalizedConnectionState: 'DISCONNECTED_WITH_SESSION',
        normalizedSessionState: 'POSSIBLY_PRESENT',
        instanceExists: true,
        recommendedAction: 'RECONNECT',
      };
    }
    return {
      ...base,
      normalizedConnectionState: 'DISCONNECTED_UNKNOWN_SESSION',
      normalizedSessionState: 'UNKNOWN',
      instanceExists: true,
      recommendedAction: 'SYNC',
    };
  }

  if (['error', 'failed', 'conflict'].includes(raw)) {
    return {
      ...base,
      normalizedConnectionState: 'ERROR',
      normalizedSessionState: 'UNKNOWN',
      instanceExists: true,
      recommendedAction: 'SYNC',
    };
  }

  if (!raw) {
    return {
      ...base,
      normalizedConnectionState: 'CREATED',
      normalizedSessionState: 'UNKNOWN',
      instanceExists: true,
      recommendedAction: 'SYNC',
    };
  }

  return {
    ...base,
    normalizedConnectionState: 'UNKNOWN',
    normalizedSessionState: 'UNKNOWN',
    instanceExists: true,
    recommendedAction: 'SYNC',
  };
}

/** Mapeia estado remoto rico → status operacional grosso do ChannelAccount (dispatch). */
export function mapRemoteStateToChannelAccountStatus(
  state: EvolutionRemoteConnectionState,
): 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'ERROR' {
  switch (state) {
    case 'CONNECTED':
      return 'CONNECTED';
    case 'CONNECTING':
    case 'QR_REQUIRED':
    case 'RESTART_REQUIRED':
      return 'CONNECTING';
    case 'ERROR':
    case 'UNKNOWN':
      return 'ERROR';
    default:
      return 'DISCONNECTED';
  }
}

export function isQrAllowedForRemoteState(
  state: EvolutionRemoteConnectionState,
  opts?: { destructiveResetConfirmed?: boolean },
): boolean {
  if (
    state === 'QR_REQUIRED' ||
    state === 'LOGGED_OUT' ||
    state === 'DEVICE_REMOVED' ||
    state === 'SESSION_INVALID' ||
    state === 'CREATED' ||
    state === 'NOT_FOUND' ||
    state === 'REMOVED'
  ) {
    return true;
  }
  if (opts?.destructiveResetConfirmed) return true;
  return false;
}

export function isChannelOperationallyReady(input: {
  localStatus: string;
  remoteConnectionState: EvolutionRemoteConnectionState | null | undefined;
  sessionState: EvolutionSessionState | null | undefined;
  lastRemoteVerificationAt: Date | string | null | undefined;
  operationInProgress?: string | null;
  ttlMs?: number;
  now?: Date;
  platformRestrictionStatus?: string | null;
  platformRestrictedUntil?: Date | string | null;
  requiresManualReview?: boolean | null;
}): { ready: boolean; reason: string | null } {
  const now = input.now ?? new Date();
  const restrictionReason = platformRestrictionReadinessReason(
    {
      platformRestrictionStatus: input.platformRestrictionStatus,
      platformRestrictedUntil: input.platformRestrictedUntil,
      requiresManualReview: input.requiresManualReview,
    },
    now,
  );
  if (restrictionReason) {
    return { ready: false, reason: restrictionReason };
  }
  if (input.operationInProgress) {
    return { ready: false, reason: 'OPERATION_IN_PROGRESS' };
  }
  if (input.localStatus !== 'CONNECTED') {
    return { ready: false, reason: 'LOCAL_NOT_CONNECTED' };
  }
  const remote = input.remoteConnectionState;
  if (!remote || remote !== 'CONNECTED') {
    return { ready: false, reason: 'REMOTE_NOT_CONNECTED' };
  }
  if (
    input.sessionState === 'INVALID' ||
    input.sessionState === 'REMOVED' ||
    input.sessionState === 'ABSENT'
  ) {
    return { ready: false, reason: 'SESSION_NOT_USABLE' };
  }
  if (!input.lastRemoteVerificationAt) {
    return { ready: false, reason: 'VERIFICATION_STALE' };
  }
  const checked =
    typeof input.lastRemoteVerificationAt === 'string'
      ? new Date(input.lastRemoteVerificationAt)
      : input.lastRemoteVerificationAt;
  const ttl = input.ttlMs ?? 15 * 60_000;
  if (Number.isNaN(checked.getTime()) || now.getTime() - checked.getTime() > ttl) {
    return { ready: false, reason: 'VERIFICATION_STALE' };
  }
  return { ready: true, reason: null };
}

/** Freshness: evento antigo nao sobrescreve estado mais recente. */
export function shouldApplyStateUpdate(input: {
  incomingAt: Date | null;
  currentEventAt: Date | null;
  incomingReceivedAt: Date;
  currentUpdatedAt: Date | null;
}): boolean {
  if (input.incomingAt && input.currentEventAt) {
    return input.incomingAt.getTime() >= input.currentEventAt.getTime();
  }
  if (input.incomingAt && !input.currentEventAt) return true;
  if (!input.incomingAt && input.currentEventAt) {
    // Sem timestamp no evento: so aplica se nao houver evento datado mais novo que receivedAt
    return input.incomingReceivedAt.getTime() >= input.currentEventAt.getTime();
  }
  if (input.currentUpdatedAt) {
    return input.incomingReceivedAt.getTime() >= input.currentUpdatedAt.getTime() - 1000;
  }
  return true;
}
