/**
 * Helpers de validacao WhatsApp (09.6.3) — TTL de cache e limites fail-closed.
 */

export const WHATSAPP_VALIDATION_SOURCE = 'EVOLUTION_WHATSAPP_NUMBERS' as const;

export const WHATSAPP_VALIDATION_CACHE_TTL_MS = {
  VALID: 7 * 24 * 60 * 60 * 1000,
  INVALID: 24 * 60 * 60 * 1000,
  UNKNOWN: 10 * 60 * 1000,
} as const;

/** Tentativas de validacao UNKNOWN/PROVIDER_UNAVAILABLE antes de falha terminal. */
export const WHATSAPP_VALIDATION_MAX_UNKNOWN_ATTEMPTS = 5;

export function cacheTtlMsForValidationStatus(
  status: 'VALID' | 'INVALID' | 'UNKNOWN' | string,
): number {
  if (status === 'VALID') return WHATSAPP_VALIDATION_CACHE_TTL_MS.VALID;
  if (status === 'INVALID') return WHATSAPP_VALIDATION_CACHE_TTL_MS.INVALID;
  return WHATSAPP_VALIDATION_CACHE_TTL_MS.UNKNOWN;
}

export function isEvolutionValidationConfigured(env: {
  EVOLUTION_API_URL?: string;
  EVOLUTION_API_KEY?: string;
} = process.env): boolean {
  return Boolean((env.EVOLUTION_API_URL ?? '').trim());
}
