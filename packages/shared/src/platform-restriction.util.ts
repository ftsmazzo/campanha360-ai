/**
 * Restricao operacional administrativa da plataforma (spam / cooldown / vinculacao).
 * Separada de remoteConnectionState / sessionState.
 */

import { sanitizeLogText } from './log-sanitizer.util';

export type PlatformRestrictionStatus =
  | 'NONE'
  | 'DEVICE_LINKING_RESTRICTED'
  | 'PLATFORM_RESTRICTED'
  | 'MANUAL_COOLDOWN_REQUIRED';

export type PlatformRestrictionSource =
  | 'MANUAL'
  | 'PROVIDER_RESPONSE'
  | 'WEBHOOK'
  | 'UNKNOWN';

export const PLATFORM_RESTRICTION_BLOCK_MESSAGE =
  'Esta conta possui uma restricao operacional informada pela plataforma. Aguarde o prazo indicado e faca nova verificacao manual.';

export const PLATFORM_RESTRICTION_ACTIVE_STATUSES: ReadonlySet<PlatformRestrictionStatus> =
  new Set([
    'DEVICE_LINKING_RESTRICTED',
    'PLATFORM_RESTRICTED',
    'MANUAL_COOLDOWN_REQUIRED',
  ]);

export type PlatformRestrictionFields = {
  platformRestrictionStatus?: string | null;
  platformRestrictedUntil?: Date | string | null;
  requiresManualReview?: boolean | null;
};

export function normalizePlatformRestrictionStatus(
  value: string | null | undefined,
): PlatformRestrictionStatus {
  const v = (value ?? 'NONE').trim().toUpperCase();
  if (
    v === 'DEVICE_LINKING_RESTRICTED' ||
    v === 'PLATFORM_RESTRICTED' ||
    v === 'MANUAL_COOLDOWN_REQUIRED' ||
    v === 'NONE'
  ) {
    return v;
  }
  return 'NONE';
}

export function isPlatformRestrictionActive(
  input: PlatformRestrictionFields,
  now: Date = new Date(),
): boolean {
  const status = normalizePlatformRestrictionStatus(input.platformRestrictionStatus);
  if (!PLATFORM_RESTRICTION_ACTIVE_STATUSES.has(status)) return false;
  // Ativa enquanto nao liberada manualmente — prazo vencido NAO libera sozinho.
  void now;
  return true;
}

export function isPlatformRestrictionDeadlinePassed(
  input: PlatformRestrictionFields,
  now: Date = new Date(),
): boolean {
  if (!input.platformRestrictedUntil) return false;
  const until =
    typeof input.platformRestrictedUntil === 'string'
      ? new Date(input.platformRestrictedUntil)
      : input.platformRestrictedUntil;
  if (Number.isNaN(until.getTime())) return false;
  return now.getTime() >= until.getTime();
}

/**
 * Motivo de bloqueio de readiness por restricao administrativa.
 * - ACTIVE: ainda no prazo (ou sem prazo)
 * - REVIEW_REQUIRED: prazo encerrado, mas liberacao manual pendente
 */
export function platformRestrictionReadinessReason(
  input: PlatformRestrictionFields,
  now: Date = new Date(),
): 'PLATFORM_RESTRICTION_ACTIVE' | 'PLATFORM_RESTRICTION_REVIEW_REQUIRED' | null {
  if (!isPlatformRestrictionActive(input, now)) return null;
  if (
    input.platformRestrictedUntil &&
    isPlatformRestrictionDeadlinePassed(input, now)
  ) {
    return 'PLATFORM_RESTRICTION_REVIEW_REQUIRED';
  }
  return 'PLATFORM_RESTRICTION_ACTIVE';
}

export function sanitizePlatformRestrictionReason(
  reason: string | null | undefined,
): string | null {
  if (!reason?.trim()) return null;
  return sanitizeLogText(reason.trim(), { maxLength: 280 }) || null;
}

export function assertNoActivePlatformRestriction(
  input: PlatformRestrictionFields,
  now: Date = new Date(),
): { ok: true } | { ok: false; message: string; reason: string } {
  const reason = platformRestrictionReadinessReason(input, now);
  if (!reason) return { ok: true };
  return {
    ok: false,
    message: PLATFORM_RESTRICTION_BLOCK_MESSAGE,
    reason,
  };
}
