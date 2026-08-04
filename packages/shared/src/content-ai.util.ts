/**
 * 09.7.1 — Flags e limites de geracao assistida por IA (somente API; nunca no Worker).
 */

export const CONTENT_AI_DEFAULTS = {
  ENABLED: false,
  MAX_VARIANTS: 5,
  TIMEOUT_MS: 45_000,
  MAX_INPUT_CHARS: 3500,
  MAX_OUTPUT_CHARS: 12_000,
  MODEL: 'gpt-4o-mini',
  FORMAT_RETRY_ENABLED: true,
  FORMAT_MAX_RETRIES: 1,
  JSON_SCHEMA_ENABLED: true,
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
  const formatMaxRetries = Math.min(
    2,
    Math.max(
      0,
      parseIntEnv(
        env.CONTENT_AI_FORMAT_MAX_RETRIES,
        CONTENT_AI_DEFAULTS.FORMAT_MAX_RETRIES,
      ),
    ),
  );
  return {
    enabled: isContentAiEnabled(env),
    model: (env.CONTENT_AI_MODEL || CONTENT_AI_DEFAULTS.MODEL).trim(),
    maxVariants: Math.min(
      CONTENT_AI_DEFAULTS.MAX_VARIANTS,
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
    formatRetryEnabled: parseBool(
      env.CONTENT_AI_FORMAT_RETRY_ENABLED,
      CONTENT_AI_DEFAULTS.FORMAT_RETRY_ENABLED,
    ),
    formatMaxRetries,
    jsonSchemaEnabled: parseBool(
      env.CONTENT_AI_JSON_SCHEMA_ENABLED,
      CONTENT_AI_DEFAULTS.JSON_SCHEMA_ENABLED,
    ),
  };
}

/** gpt-4o / gpt-4o-mini e o1 suportam json_schema strict. */
export function contentAiModelSupportsJsonSchema(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (!m) return false;
  if (m.includes('gpt-4o')) return true;
  if (m.includes('gpt-4.1')) return true;
  if (m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) return true;
  return false;
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
