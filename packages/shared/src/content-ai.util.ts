/**
 * 09.7.1 — Flags e limites de geracao assistida por IA (somente API; nunca no Worker).
 */

export const CONTENT_AI_DEFAULTS = {
  ENABLED: false,
  MAX_VARIANTS: 3,
  TIMEOUT_MS: 45_000,
  MAX_INPUT_CHARS: 3500,
  MAX_OUTPUT_CHARS: 12_000,
  MODEL: 'gpt-4o-mini',
} as const;

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === '') return fallback;
  const v = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return fallback;
}

function parseIntEnv(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function isContentAiEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return parseBool(env.CONTENT_AI_ENABLED, CONTENT_AI_DEFAULTS.ENABLED);
}

export function getContentAiConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    enabled: isContentAiEnabled(env),
    model: (env.CONTENT_AI_MODEL || CONTENT_AI_DEFAULTS.MODEL).trim(),
    maxVariants: Math.min(
      3,
      parseIntEnv(env.CONTENT_AI_MAX_VARIANTS, CONTENT_AI_DEFAULTS.MAX_VARIANTS),
    ),
    timeoutMs: parseIntEnv(
      env.CONTENT_AI_TIMEOUT_MS,
      CONTENT_AI_DEFAULTS.TIMEOUT_MS,
    ),
    maxInputChars: parseIntEnv(
      env.CONTENT_AI_MAX_INPUT_CHARS,
      CONTENT_AI_DEFAULTS.MAX_INPUT_CHARS,
    ),
    maxOutputChars: parseIntEnv(
      env.CONTENT_AI_MAX_OUTPUT_CHARS,
      CONTENT_AI_DEFAULTS.MAX_OUTPUT_CHARS,
    ),
    apiKey: (env.CONTENT_AI_API_KEY || env.OPENAI_API_KEY || '').trim() || null,
    baseUrl: (env.CONTENT_AI_BASE_URL || 'https://api.openai.com/v1').replace(
      /\/$/,
      '',
    ),
  };
}

export type ContentSimilarityAlert =
  | 'MUITO_SEMELHANTE'
  | 'POSSIVEL_DUPLICATA'
  | 'CONTEUDO_RECENTE_REPETIDO'
  | 'DUPLICATA_EXATA';

export function classifyContentSimilarity(score0to100: number): ContentSimilarityAlert | null {
  if (score0to100 >= 99.5) return 'DUPLICATA_EXATA';
  if (score0to100 >= 90) return 'MUITO_SEMELHANTE';
  if (score0to100 >= 70) return 'POSSIVEL_DUPLICATA';
  return null;
}
