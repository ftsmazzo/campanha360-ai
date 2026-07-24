/**
 * Matching seguro de keywords de opt-out (09.6.2).
 * Avaliado no webhook inbound — NAO no Worker outbound.
 *
 * Evita falso positivo por substring solta (ex.: "nao quero parar de receber"
 * nao casa com a keyword isolada "parar" se a mensagem for longa e ambigua).
 */

export const DEFAULT_OPT_OUT_KEYWORDS = [
  'sair',
  'parar',
  'remover',
  'cancelar',
  'descadastrar',
  'nao quero receber',
  'não quero receber',
] as const;

/** Mensagens com mais tokens que isso sao consideradas ambíguas para keyword isolada. */
const SHORT_MESSAGE_MAX_TOKENS = 6;

export function normalizeOptOutText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveOptOutKeywords(input?: {
  campaignKeywords?: string[] | null;
  organizationKeywords?: string[] | null;
  policyKeywords?: string[] | null;
}): string[] {
  const fromCampaign = (input?.campaignKeywords ?? []).filter(Boolean);
  if (fromCampaign.length > 0) return dedupeKeywords(fromCampaign);

  const fromOrg = (input?.organizationKeywords ?? []).filter(Boolean);
  if (fromOrg.length > 0) return dedupeKeywords(fromOrg);

  const fromPolicy = (input?.policyKeywords ?? []).filter(Boolean);
  if (fromPolicy.length > 0) return dedupeKeywords(fromPolicy);

  return [...DEFAULT_OPT_OUT_KEYWORDS];
}

function dedupeKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keywords) {
    const normalized = normalizeOptOutText(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export type OptOutKeywordMatch = {
  matched: boolean;
  keyword: string | null;
  strategy: 'EXACT_MESSAGE' | 'SHORT_MESSAGE_TOKEN' | 'PHRASE_IN_SHORT_MESSAGE' | null;
  reason: string;
};

/**
 * Classifica se o texto inbound e um pedido de opt-out.
 * - Mensagem exatamente igual a keyword → match
 * - Mensagem curta (<=6 tokens) contendo frase multi-palavra → match
 * - Mensagem curta onde a unica palavra relevante e a keyword → match
 * - Mensagem longa com keyword embutida → NAO match (ambiguidade)
 */
export function matchOptOutKeyword(
  rawBody: string | null | undefined,
  keywords: string[] = [...DEFAULT_OPT_OUT_KEYWORDS],
): OptOutKeywordMatch {
  const normalized = normalizeOptOutText(rawBody ?? '');
  if (!normalized) {
    return {
      matched: false,
      keyword: null,
      strategy: null,
      reason: 'EMPTY_BODY',
    };
  }

  const normalizedKeywords = dedupeKeywords(keywords);
  const tokens = normalized.split(' ').filter(Boolean);
  const isShort = tokens.length <= SHORT_MESSAGE_MAX_TOKENS;

  for (const keyword of normalizedKeywords) {
    if (normalized === keyword) {
      return {
        matched: true,
        keyword,
        strategy: 'EXACT_MESSAGE',
        reason: 'MESSAGE_EQUALS_KEYWORD',
      };
    }
  }

  if (!isShort) {
    return {
      matched: false,
      keyword: null,
      strategy: null,
      reason: 'LONG_AMBIGUOUS_MESSAGE',
    };
  }

  for (const keyword of normalizedKeywords) {
    const keywordTokens = keyword.split(' ').filter(Boolean);
    if (keywordTokens.length > 1) {
      if (normalized.includes(keyword)) {
        return {
          matched: true,
          keyword,
          strategy: 'PHRASE_IN_SHORT_MESSAGE',
          reason: 'SHORT_MESSAGE_CONTAINS_PHRASE',
        };
      }
      continue;
    }

    // Keyword de uma palavra: so casa se a mensagem for essencialmente essa palavra
    // (permite pontuacao ja removida e 1-2 tokens auxiliares tipo "por favor")
    if (tokens.length <= 3 && tokens.includes(keyword)) {
      const other = tokens.filter((t) => t !== keyword);
      const filler = new Set(['por', 'favor', 'pf', 'pfv', 'ok', 'ja', 'agora']);
      if (other.every((t) => filler.has(t))) {
        return {
          matched: true,
          keyword,
          strategy: 'SHORT_MESSAGE_TOKEN',
          reason: 'SHORT_MESSAGE_TOKEN_MATCH',
        };
      }
    }
  }

  return {
    matched: false,
    keyword: null,
    strategy: null,
    reason: 'NO_SAFE_MATCH',
  };
}
