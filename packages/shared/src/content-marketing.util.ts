/**
 * 09.7.2 — Briefing de marketing, allowlists e posicionamento de personalizacao.
 */

export const CONTENT_PERSONALIZATION_PLACEMENTS = [
  'GREETING',
  'BODY',
  'NONE',
] as const;

export type ContentPersonalizationPlacement =
  (typeof CONTENT_PERSONALIZATION_PLACEMENTS)[number];

export const CONTENT_COMBINATION_MODES = [
  'LOCKED_SETS',
  'MIX_AND_MATCH',
] as const;

export type ContentCombinationMode = (typeof CONTENT_COMBINATION_MODES)[number];

export const CONTENT_AI_GENERATION_MODES = [
  'FULL_SETS',
  'GREETING_ONLY',
  'BODY_ONLY',
  'CLOSING_ONLY',
  'IMPROVE_CURRENT',
] as const;

export type ContentAiGenerationMode =
  (typeof CONTENT_AI_GENERATION_MODES)[number];

export const CONTENT_PROMPT_VERSION = 'v2-marketing-sets-2026-08';

/** Contexto coletivo permitido no briefing (nao vira variavel individual). */
export const COLLECTIVE_CONTEXT_ALLOWLIST = [
  'perfilProfissional',
  'cargoDesejado',
  'experienciaEsperada',
  'habilidades',
  'segmento',
  'necessidade',
  'estagioFunil',
  'interesseDeclarado',
] as const;

export const SENSITIVE_ATTRIBUTE_DENYLIST = [
  'saude',
  'health',
  'religiao',
  'religion',
  'raca',
  'race',
  'etnia',
  'orientacaoSexual',
  'sexualOrientation',
  'opiniaoPolitica',
  'politicalOpinion',
  'condicaoFinanceira',
  'financialCondition',
  'renda',
  'income',
  'condicaoFamiliar',
  'familyStatus',
  'cpf',
  'rg',
] as const;

export type ContentMarketingBrief = {
  objective?: string | null;
  offerName?: string | null;
  offerDescription?: string | null;
  targetAudience?: string | null;
  candidateCharacteristics?: string | null;
  painPoints?: string | null;
  primaryBenefit?: string | null;
  secondaryBenefits?: string | null;
  differentiators?: string | null;
  callToAction?: string | null;
  tone?: string | null;
  formality?: string | null;
  language?: string | null;
  maxLength?: number | null;
  protectedFacts?: string[] | null;
  forbiddenClaims?: string[] | null;
  personalizationPlacement?: ContentPersonalizationPlacement | null;
  additionalInstructions?: string | null;
  /** Contexto coletivo tipado (allowlist). */
  collectiveContext?: Partial<
    Record<(typeof COLLECTIVE_CONTEXT_ALLOWLIST)[number], string>
  > | null;
};

export const MARKETING_BRIEF_RECOMMENDED_FIELDS = [
  'objective',
  'targetAudience',
  'primaryBenefit',
  'callToAction',
] as const;

export function emptyMarketingBrief(): ContentMarketingBrief {
  return {
    objective: null,
    offerName: null,
    offerDescription: null,
    targetAudience: null,
    candidateCharacteristics: null,
    painPoints: null,
    primaryBenefit: null,
    secondaryBenefits: null,
    differentiators: null,
    callToAction: null,
    tone: 'profissional e natural',
    formality: 'semi-formal',
    language: 'pt-BR',
    maxLength: 800,
    protectedFacts: [],
    forbiddenClaims: [],
    personalizationPlacement: 'GREETING',
    additionalInstructions: null,
    collectiveContext: {},
  };
}

export function parseMarketingBrief(value: unknown): ContentMarketingBrief {
  const base = emptyMarketingBrief();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
  const raw = value as Record<string, unknown>;
  const str = (k: string, max = 2000) =>
    typeof raw[k] === 'string' ? String(raw[k]).trim().slice(0, max) || null : null;
  const arr = (k: string): string[] => {
    if (!Array.isArray(raw[k])) return [];
    return raw[k]
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim().slice(0, 500))
      .filter(Boolean)
      .slice(0, 30);
  };

  const placement = str('personalizationPlacement', 20);
  const collectiveRaw =
    raw.collectiveContext && typeof raw.collectiveContext === 'object'
      ? (raw.collectiveContext as Record<string, unknown>)
      : {};
  const collectiveContext: ContentMarketingBrief['collectiveContext'] = {};
  for (const key of COLLECTIVE_CONTEXT_ALLOWLIST) {
    if (typeof collectiveRaw[key] === 'string' && collectiveRaw[key].trim()) {
      collectiveContext[key] = String(collectiveRaw[key]).trim().slice(0, 500);
    }
  }

  return {
    objective: str('objective', 500),
    offerName: str('offerName', 200),
    offerDescription: str('offerDescription', 2000),
    targetAudience: str('targetAudience', 1000),
    candidateCharacteristics: str('candidateCharacteristics', 1000),
    painPoints: str('painPoints', 1000),
    primaryBenefit: str('primaryBenefit', 500),
    secondaryBenefits: str('secondaryBenefits', 1000),
    differentiators: str('differentiators', 1000),
    callToAction: str('callToAction', 300),
    tone: str('tone', 80) ?? base.tone,
    formality: str('formality', 40) ?? base.formality,
    language: str('language', 20) ?? base.language,
    maxLength:
      typeof raw.maxLength === 'number' && Number.isFinite(raw.maxLength)
        ? Math.max(50, Math.min(3500, Math.round(raw.maxLength)))
        : base.maxLength,
    protectedFacts: arr('protectedFacts'),
    forbiddenClaims: arr('forbiddenClaims'),
    personalizationPlacement:
      placement === 'GREETING' || placement === 'BODY' || placement === 'NONE'
        ? placement
        : 'GREETING',
    additionalInstructions: str('additionalInstructions', 1500),
    collectiveContext,
  };
}

export function marketingBriefQualityHints(brief: ContentMarketingBrief): {
  missingRecommended: string[];
  readyForGeneration: boolean;
} {
  const missingRecommended = MARKETING_BRIEF_RECOMMENDED_FIELDS.filter((k) => {
    const v = brief[k];
    return !(typeof v === 'string' && v.trim());
  });
  return {
    missingRecommended: [...missingRecommended],
    readyForGeneration: missingRecommended.length === 0,
  };
}

export function containsDeniedSensitiveAttribute(text: string): string | null {
  const lower = text.toLowerCase();
  for (const key of SENSITIVE_ATTRIBUTE_DENYLIST) {
    if (lower.includes(key.toLowerCase())) return key;
  }
  return null;
}

export function isContentCombinationMode(
  value: string | null | undefined,
): value is ContentCombinationMode {
  return (
    value === 'LOCKED_SETS' ||
    value === 'MIX_AND_MATCH'
  );
}

export function isContentPersonalizationPlacement(
  value: string | null | undefined,
): value is ContentPersonalizationPlacement {
  return value === 'GREETING' || value === 'BODY' || value === 'NONE';
}
