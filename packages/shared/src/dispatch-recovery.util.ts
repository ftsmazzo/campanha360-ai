/**
 * Classificador puro de recuperacao (09.6).
 * Prioridade: nunca reenviar com risco de duplicidade.
 */

export type DispatchItemRecoveryClassification =
  | 'SAFE_REQUEUE'
  | 'SAFE_RETRY'
  | 'WAIT_LOCK'
  | 'MARK_UNKNOWN'
  | 'MANUAL_REVIEW'
  | 'TERMINAL_NO_ACTION'
  | 'INVALID_STATE';

export type ClassifyDispatchItemRecoveryInput = {
  status: string;
  lockExpiresAt?: Date | string | null;
  providerRequestStartedAt?: Date | string | null;
  providerRequestCompletedAt?: Date | string | null;
  providerMessageId?: string | null;
  sentAt?: Date | string | null;
  attemptCount?: number | null;
  maxAttempts?: number | null;
  nextRetryAt?: Date | string | null;
  errorCategory?: string | null;
  errorCode?: string | null;
  queueJobId?: string | null;
  dispatchStatus?: string | null;
  hasMissingJob?: boolean;
};

export type ClassifyDispatchItemRecoveryResult = {
  classification: DispatchItemRecoveryClassification;
  reason: string;
};

const TERMINAL_ITEM_STATUSES = new Set([
  'SENT',
  'DELIVERED',
  'READ',
  'CANCELED',
  'SKIPPED',
]);

const TRANSIENT_CATEGORIES = new Set([
  'TRANSIENT_NETWORK',
  'PROVIDER_RATE_LIMIT',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
  'CHANNEL_DISCONNECTED',
]);

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Classifica um DispatchItem para recuperacao tecnica / retry / revisao.
 * `hasMissingJob` e opcional (quando o caller ja consultou o BullMQ).
 */
export function classifyDispatchItemRecovery(
  item: ClassifyDispatchItemRecoveryInput,
  now: Date = new Date(),
): ClassifyDispatchItemRecoveryResult {
  const status = String(item.status ?? '');

  if (TERMINAL_ITEM_STATUSES.has(status)) {
    return { classification: 'TERMINAL_NO_ACTION', reason: `ITEM_${status}` };
  }

  if (hasText(item.providerMessageId) || item.sentAt) {
    if (status === 'UNKNOWN_PROVIDER_STATE') {
      return {
        classification: 'MANUAL_REVIEW',
        reason: 'UNKNOWN_WITH_PROVIDER_MESSAGE_ID',
      };
    }
    if (!TERMINAL_ITEM_STATUSES.has(status)) {
      return {
        classification: 'MANUAL_REVIEW',
        reason: 'PROVIDER_MESSAGE_OR_SENT_ON_NON_TERMINAL',
      };
    }
  }

  if (status === 'UNKNOWN_PROVIDER_STATE') {
    return { classification: 'MANUAL_REVIEW', reason: 'UNKNOWN_PROVIDER_STATE' };
  }

  const lockExpiresAt = toDate(item.lockExpiresAt);
  const requestStarted = toDate(item.providerRequestStartedAt);
  const requestCompleted = toDate(item.providerRequestCompletedAt);
  const lockExpired =
    lockExpiresAt != null && lockExpiresAt.getTime() < now.getTime();
  const lockActive =
    lockExpiresAt != null && lockExpiresAt.getTime() >= now.getTime();

  if (status === 'PROCESSING') {
    if (lockActive) {
      return { classification: 'WAIT_LOCK', reason: 'LOCK_STILL_VALID' };
    }

    if (requestStarted && !requestCompleted) {
      return {
        classification: 'MARK_UNKNOWN',
        reason: 'STALE_LOCK_REQUEST_STARTED_NO_COMPLETION',
      };
    }

    if (requestStarted && requestCompleted) {
      return {
        classification: 'MANUAL_REVIEW',
        reason: 'PROCESSING_WITH_COMPLETED_REQUEST_INCONSISTENT',
      };
    }

    if (lockExpired || lockExpiresAt == null) {
      return {
        classification: 'SAFE_REQUEUE',
        reason: 'STALE_LOCK_NO_EXTERNAL_REQUEST',
      };
    }

    return { classification: 'WAIT_LOCK', reason: 'PROCESSING_LOCK_UNKNOWN' };
  }

  if (status === 'QUEUED' || status === 'SCHEDULED') {
    if (item.hasMissingJob === true || !hasText(item.queueJobId)) {
      return {
        classification: 'SAFE_REQUEUE',
        reason:
          status === 'QUEUED' ? 'QUEUED_MISSING_JOB' : 'SCHEDULED_MISSING_JOB',
      };
    }
    return {
      classification: 'SAFE_REQUEUE',
      reason: 'QUEUED_OR_SCHEDULED_ENSURE_JOB',
    };
  }

  if (status === 'RETRY_SCHEDULED') {
    const nextRetryAt = toDate(item.nextRetryAt);
    const due =
      nextRetryAt == null || nextRetryAt.getTime() <= now.getTime();
    if (item.hasMissingJob === true || !hasText(item.queueJobId) || due) {
      return {
        classification: 'SAFE_RETRY',
        reason: due ? 'RETRY_DUE' : 'RETRY_MISSING_JOB',
      };
    }
    return {
      classification: 'SAFE_RETRY',
      reason: 'RETRY_SCHEDULED_ENSURE_JOB',
    };
  }

  if (status === 'FAILED') {
    const category = String(item.errorCategory ?? '');
    if (TRANSIENT_CATEGORIES.has(category)) {
      const attempts = item.attemptCount ?? 0;
      const max = item.maxAttempts ?? 3;
      if (attempts < max) {
        return {
          classification: 'SAFE_RETRY',
          reason: 'FAILED_TRANSIENT_ELIGIBLE',
        };
      }
      return {
        classification: 'MANUAL_REVIEW',
        reason: 'FAILED_TRANSIENT_EXHAUSTED',
      };
    }
    return {
      classification: 'MANUAL_REVIEW',
      reason: 'FAILED_PERMANENT_OR_UNKNOWN_CATEGORY',
    };
  }

  if (status === 'PENDING') {
    return { classification: 'INVALID_STATE', reason: 'PENDING_UNEXPECTED' };
  }

  return { classification: 'INVALID_STATE', reason: `STATUS_${status}` };
}

export const MANUAL_RETRY_ELIGIBLE_ERROR_CATEGORIES = [
  'TRANSIENT_NETWORK',
  'PROVIDER_RATE_LIMIT',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
  'CHANNEL_DISCONNECTED',
] as const;

export const MANUAL_RETRY_BLOCKED_ERROR_CATEGORIES = [
  'CONTACT_OPT_OUT',
  'CONTACT_BLOCKED',
  'CONTACT_DELETED',
  'INVALID_DESTINATION',
  'CONTENT_REJECTED',
  'UNKNOWN_ABANDONED',
  'ADMIN_CONFIRMED_NOT_SENT',
] as const;

export type ManualRetryEligibility = {
  allowed: boolean;
  reason: string;
};

export function evaluateManualRetryEligibility(item: {
  status: string;
  providerMessageId?: string | null;
  sentAt?: Date | string | null;
  errorCategory?: string | null;
  attemptCount?: number | null;
  maxAttempts?: number | null;
  allowExtraManualAttempt?: boolean;
}): ManualRetryEligibility {
  if (String(item.status) !== 'FAILED') {
    return { allowed: false, reason: 'STATUS_NOT_FAILED' };
  }
  if (hasText(item.providerMessageId) || item.sentAt) {
    return { allowed: false, reason: 'PROVIDER_EVIDENCE_PRESENT' };
  }
  const category = String(item.errorCategory ?? '');
  if (
    (MANUAL_RETRY_BLOCKED_ERROR_CATEGORIES as readonly string[]).includes(
      category,
    )
  ) {
    return { allowed: false, reason: `BLOCKED_CATEGORY_${category}` };
  }
  if (
    !(MANUAL_RETRY_ELIGIBLE_ERROR_CATEGORIES as readonly string[]).includes(
      category,
    )
  ) {
    return { allowed: false, reason: 'CATEGORY_NOT_ELIGIBLE' };
  }
  const attempts = item.attemptCount ?? 0;
  const max = item.maxAttempts ?? 3;
  if (attempts >= max && !item.allowExtraManualAttempt) {
    return { allowed: false, reason: 'ATTEMPTS_EXHAUSTED' };
  }
  return { allowed: true, reason: 'ELIGIBLE' };
}

export const DISPATCH_RECOVERY_BATCH_MAX_ITEMS = 20;
export const DISPATCH_FAILED_RETRY_BATCH_MAX_ITEMS = 20;
