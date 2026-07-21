/**
 * Backoff centralizado de retry do envio de disparo (subetapa 09.4/09.6).
 * Valores conceituais do epico: 1 minuto, 5 minutos, 15 minutos por
 * attemptCount. Apos esgotar o backoff (attemptCount >= maxAttempts),
 * o item deve ser marcado FAILED (falha definitiva) — decisao tomada
 * pelo chamador, nao por este modulo.
 */

export const DISPATCH_SEND_RETRY_BACKOFF_MS: readonly number[] = [
  60_000, // 1 min
  300_000, // 5 min
  900_000, // 15 min
];

/**
 * Delay em ms para o proximo retry, dado o numero de tentativas ja
 * realizadas (attemptCount, 1-based: 1 = primeira tentativa falhou).
 * Valores acima do tamanho da tabela usam o ultimo backoff (15 min).
 */
export function getDispatchRetryDelayMs(attemptCount: number): number {
  const safeAttempt = Number.isFinite(attemptCount) && attemptCount > 0 ? attemptCount : 1;
  const index = Math.min(
    safeAttempt - 1,
    DISPATCH_SEND_RETRY_BACKOFF_MS.length - 1,
  );
  return DISPATCH_SEND_RETRY_BACKOFF_MS[index]!;
}

/** Calcula o instante do proximo retry a partir de `now` + backoff(attemptCount). */
export function computeDispatchNextRetryAt(
  now: Date,
  attemptCount: number,
): Date {
  return new Date(now.getTime() + getDispatchRetryDelayMs(attemptCount));
}

/**
 * Indica se o item esgotou as tentativas permitidas (deve ir para FAILED
 * definitivo em vez de novo RETRY_SCHEDULED).
 */
export function isDispatchRetryExhausted(
  attemptCount: number,
  maxAttempts: number,
): boolean {
  return attemptCount >= maxAttempts;
}
