/**
 * Configuração conservadora da simulação de disparo (Épico 08.4).
 * Não autoriza envio; apenas estimativa operacional.
 */

/** Fallback quando campanha/organização não possuem timezone próprio. */
export const DISPATCH_SIMULATION_DEFAULT_TIMEZONE = 'America/Sao_Paulo';

export const DISPATCH_SIMULATION_DEFAULTS = {
  messagesPerMinute: 4,
  minDelaySeconds: 10,
  maxDelaySeconds: 20,
  batchSize: 20,
  pauseBetweenBatchesSeconds: 120,
  allowedStartTime: '08:00',
  allowedEndTime: '20:00',
  /** ISO weekday: 1=segunda ... 6=sábado (domingo excluído). */
  allowedDays: [1, 2, 3, 4, 5, 6] as number[],
} as const;

export const DISPATCH_SIMULATION_LIMITS = {
  messagesPerMinute: { min: 1, max: 20 },
  minDelaySeconds: { min: 1, max: 300 },
  maxDelaySeconds: { min: 1, max: 600 },
  batchSize: { min: 1, max: 100 },
  pauseBetweenBatchesSeconds: { min: 0, max: 3600 },
} as const;

/** Warnings quando a simulação gera muitos lotes. */
export const DISPATCH_SIMULATION_HIGH_BATCH_COUNT = 10;

/** Warnings quando a duração de calendário excede este limiar (4h). */
export const DISPATCH_SIMULATION_LONG_DURATION_SECONDS = 4 * 60 * 60;

/** Warnings quando elegíveis chegam a este percentual do limite operacional. */
export const DISPATCH_SIMULATION_NEAR_LIMIT_RATIO = 0.8;
