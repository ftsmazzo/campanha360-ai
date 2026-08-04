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

export const CONTENT_PROMPT_VERSION = 'v4-invite-optin-2026-08';

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
  // legado documentado — deteccao real usa detectSensitiveContent (nao substring)
  'religiao',
  'raca',
  'etnia',
  'orientacaoSexual',
  'condicaoSaude',
  'cpf',
  'rg',
] as const;

export type SensitiveMatchCategory =
  | 'SENSITIVE_ATTRIBUTE'
  | 'PERSONAL_DOCUMENT';

export type SensitiveAttributeMatch = {
  code: 'SENSITIVE_ATTRIBUTE';
  category: SensitiveMatchCategory;
  matchedTerm: string;
  field?: string;
  block?: 'greeting' | 'body' | 'closing';
  setIndex?: number;
  safeExcerpt: string;
  reason: string;
};

function normalizeForSensitiveScan(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

function safeExcerptAround(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 24);
  const end = Math.min(text.length, index + len + 24);
  let excerpt = text.slice(start, end).replace(/\s+/g, ' ').trim();
  // mascara sequencias numericas longas (documentos)
  excerpt = excerpt.replace(/\d[\d.\-\s]{4,}\d/g, '[redacted]');
  if (start > 0) excerpt = `…${excerpt}`;
  if (end < text.length) excerpt = `${excerpt}…`;
  return excerpt.slice(0, 120);
}

const PERSONAL_DOCUMENT_PATTERNS: Array<{
  term: string;
  re: RegExp;
  reason: string;
}> = [
  {
    term: 'cpf',
    re: /\bcpf\b(?:\s*(?:n[ºo°.]?|numero|:))?\s*[\d.\-]{5,}|\bcpf\b/iu,
    reason: 'Possivel documento pessoal identificado (CPF)',
  },
  {
    term: 'rg',
    // exige contexto de documento — NAO basta a substring "rg"
    re: /\brg\b\s*(?:n[ºo°.]?|numero|:)\s*[\d.\-\/]{3,}|\brg\s*:\s*[\d.\-\/]+|\bregistro\s+geral\b(?:\s+do\s+eleitor)?|\buse\s+o\s+rg\b|\brg\s+individual\b/iu,
    reason: 'Possivel documento pessoal identificado (RG)',
  },
  {
    term: 'titulo de eleitor',
    re: /\btitulo\s+de\s+eleitor\b(?:\s*(?:n[ºo°.]?|:))?\s*[\d.\-\s]{5,}|\btitulo\s+de\s+eleitor\b/iu,
    reason: 'Possivel documento pessoal identificado (titulo de eleitor)',
  },
  {
    term: 'cnh',
    re: /\bcnh\b(?:\s*(?:n[ºo°.]?|:))?\s*[\d.\-]{5,}|\bcnh\b/iu,
    reason: 'Possivel documento pessoal identificado (CNH)',
  },
  {
    term: 'passaporte',
    re: /\bpassaporte\b(?:\s*(?:n[ºo°.]?|:))?\s*[a-z0-9]{5,}|\bpassaporte\b/iu,
    reason: 'Possivel documento pessoal identificado (passaporte)',
  },
];

const SENSITIVE_ATTRIBUTE_PATTERNS: Array<{
  term: string;
  re: RegExp;
  reason: string;
}> = [
  {
    term: 'religiao',
    re: /\breligi[aã]o\b|\breligion\b|\bcredo\s+religioso\b/iu,
    reason: 'Atributo sensivel identificado (religiao)',
  },
  {
    term: 'raca',
    re: /\bra[cç]a\b|\bethnicity\b|\betnia\b|\bcor\s+da\s+pele\b/iu,
    reason: 'Atributo sensivel identificado (raca/etnia)',
  },
  {
    term: 'orientacao sexual',
    re: /\borienta[cç][aã]o\s+sexual\b|\bsexual\s+orientation\b/iu,
    reason: 'Atributo sensivel identificado (orientacao sexual)',
  },
  {
    term: 'condicao de saude',
    re: /\bcondi[cç][aã]o\s+de\s+sa[uú]de\b|\bhist[oó]rico\s+m[eé]dico\b|\bdados\s+de\s+sa[uú]de\b|\bdoen[cç]a\s+do\s+contato\b/iu,
    reason: 'Atributo sensivel identificado (condicao de saude)',
  },
  {
    term: 'deficiencia',
    re: /\bdefici[eê]ncia\b|\bdado\s+biom[eé]trico\b|\bbiometria\b/iu,
    reason: 'Atributo sensivel identificado (deficiencia/biometria)',
  },
  {
    term: 'opiniao politica individual',
    // exige indicio de dado individual — contexto coletivo (publico-alvo) e permitido
    re: /\bopini[aã]o\s+pol[ií]tica\s+(?:do\s+contato|individual|pessoal|do\s+destinat[aá]rio)\b|\b(?:sua|dele|dela)\s+opini[aã]o\s+pol[ií]tica\b/iu,
    reason: 'Atributo sensivel identificado (opiniao politica individual)',
  },
  {
    term: 'condicao financeira individual',
    re: /\brenda\s+(?:individual|pessoal|do\s+contato)\b|\bcondi[cç][aã]o\s+financeira\s+(?:do\s+contato|individual|pessoal)\b|\bsal[aá]rio\s+do\s+contato\b/iu,
    reason: 'Atributo sensivel identificado (condicao financeira individual)',
  },
];

/**
 * Detecta atributo sensivel / documento pessoal sem substring cega.
 * Ex.: "cargo", "regiao", "organizacao", "urgente" NAO disparam RG.
 */
export function detectSensitiveContent(
  text: string,
  meta?: {
    field?: string;
    block?: SensitiveAttributeMatch['block'];
    setIndex?: number;
  },
): SensitiveAttributeMatch | null {
  if (!text?.trim()) return null;
  const normalized = normalizeForSensitiveScan(text);

  for (const pattern of PERSONAL_DOCUMENT_PATTERNS) {
    const match = pattern.re.exec(normalized);
    if (!match) continue;
    // CPF/CNH/passaporte com so a palavra isolada: ok alertar
    // RG so casa com regex contextual (ja acima)
    return {
      code: 'SENSITIVE_ATTRIBUTE',
      category: 'PERSONAL_DOCUMENT',
      matchedTerm: pattern.term,
      field: meta?.field,
      block: meta?.block,
      setIndex: meta?.setIndex,
      safeExcerpt: safeExcerptAround(text, match.index, match[0].length),
      reason: pattern.reason,
    };
  }

  for (const pattern of SENSITIVE_ATTRIBUTE_PATTERNS) {
    const match = pattern.re.exec(normalized);
    if (!match) continue;
    // "opiniao politica do publico-alvo" nao deve casar o padrao individual
    if (
      pattern.term === 'opiniao politica individual' &&
      /\bp[uú]blico[\-\s]?alvo\b|\beleitores?\b|\bcampanha\b/i.test(normalized)
    ) {
      // se o match estiver claramente no contexto coletivo, ignora
      const window = normalized.slice(
        Math.max(0, match.index - 40),
        match.index + match[0].length + 40,
      );
      if (/\bp[uú]blico[\-\s]?alvo\b|\beleitores?\b/i.test(window)) {
        continue;
      }
    }
    return {
      code: 'SENSITIVE_ATTRIBUTE',
      category: 'SENSITIVE_ATTRIBUTE',
      matchedTerm: pattern.term,
      field: meta?.field,
      block: meta?.block,
      setIndex: meta?.setIndex,
      safeExcerpt: safeExcerptAround(text, match.index, match[0].length),
      reason: pattern.reason,
    };
  }

  return null;
}

/** @deprecated Prefer detectSensitiveContent — mantido para compat. */
export function containsDeniedSensitiveAttribute(text: string): string | null {
  return detectSensitiveContent(text)?.matchedTerm ?? null;
}

const SENSITIVE_FIELD_LABELS: Record<string, string> = {
  candidateCharacteristics: 'Características relevantes',
  targetAudience: 'Público-alvo',
  objective: 'Objetivo',
  offerDescription: 'Descrição da oferta',
  painPoints: 'Dores',
  primaryBenefit: 'Benefício principal',
  secondaryBenefits: 'Benefícios secundários',
  differentiators: 'Diferenciais',
  callToAction: 'Chamada para ação',
  additionalInstructions: 'Instruções adicionais',
  protectedFacts: 'Fatos protegidos',
  forbiddenClaims: 'Proibições',
  greeting: 'Saudação',
  body: 'Corpo',
  closing: 'Fechamento',
};

function displaySensitiveTerm(term: string): string {
  const upperDocs = new Set(['rg', 'cpf', 'cnh']);
  if (upperDocs.has(term.toLowerCase())) return term.toUpperCase();
  return term;
}

export function resolveSensitiveFieldLabel(match: SensitiveAttributeMatch): string {
  const key = match.field ?? match.block;
  if (!key) return 'conteúdo';
  return SENSITIVE_FIELD_LABELS[key] ?? key;
}

/**
 * Erro de validacao — nunca retorna apenas "SENSITIVE_ATTRIBUTE".
 */
export function formatSensitiveAttributeError(
  match: SensitiveAttributeMatch,
): string {
  const fieldLabel = match.field
    ? ` no campo '${match.field}'`
    : match.block
      ? ` no bloco '${match.block}'`
      : '';
  const setLabel =
    typeof match.setIndex === 'number'
      ? ` (conjunto ${match.setIndex + 1})`
      : '';
  return `SENSITIVE_ATTRIBUTE:${match.matchedTerm}${fieldLabel}${setLabel} — ${match.reason}`;
}

/** Mensagem amigavel para UI / BadRequestException. */
export function formatSensitiveAttributeUserMessage(
  match: SensitiveAttributeMatch,
): string {
  const fieldLabel = resolveSensitiveFieldLabel(match);
  const kind =
    match.category === 'PERSONAL_DOCUMENT'
      ? 'dado pessoal'
      : 'atributo sensível';
  return `Foi identificado um possível ${kind} no campo '${fieldLabel}': ${displaySensitiveTerm(match.matchedTerm)}. Revise esse campo.`;
}

const BRIEF_SENSITIVE_SCAN_FIELDS: Array<keyof ContentMarketingBrief> = [
  'objective',
  'offerName',
  'offerDescription',
  'targetAudience',
  'candidateCharacteristics',
  'painPoints',
  'primaryBenefit',
  'secondaryBenefits',
  'differentiators',
  'callToAction',
  'additionalInstructions',
];

/** Varre campos do briefing; retorna o primeiro match (com field preenchido). */
export function scanMarketingBriefForSensitive(
  brief: ContentMarketingBrief,
): SensitiveAttributeMatch | null {
  for (const field of BRIEF_SENSITIVE_SCAN_FIELDS) {
    const value = brief[field];
    if (typeof value !== 'string' || !value.trim()) continue;
    const match = detectSensitiveContent(value, { field });
    if (match) return match;
  }
  for (const fact of brief.protectedFacts ?? []) {
    const match = detectSensitiveContent(fact, { field: 'protectedFacts' });
    if (match) return match;
  }
  for (const claim of brief.forbiddenClaims ?? []) {
    const match = detectSensitiveContent(claim, { field: 'forbiddenClaims' });
    if (match) return match;
  }
  const collective = brief.collectiveContext ?? {};
  for (const [key, value] of Object.entries(collective)) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const match = detectSensitiveContent(value, { field: key });
    if (match) return match;
  }
  return null;
}

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

export function isContentCombinationMode(
  value: string | null | undefined,
): value is ContentCombinationMode {
  return value === 'LOCKED_SETS' || value === 'MIX_AND_MATCH';
}

export function isContentPersonalizationPlacement(
  value: string | null | undefined,
): value is ContentPersonalizationPlacement {
  return value === 'GREETING' || value === 'BODY' || value === 'NONE';
}

export const DEFAULT_INVITE_COMPOSITION_NAME = 'Convite inicial';

export const DEFAULT_INVITE_INTENTION =
  'Criar mensagens de convite inicial para acompanhar conteúdos e informações sobre as pautas que defendo. Não pode parecer pedido de voto ou propaganda de candidatura.';

export const DEFAULT_INVITE_BASE_BODY =
  'Oi, {{firstName}}! Quero te convidar a acompanhar conteúdos e informações sobre pautas que defendo. Se fizer sentido pra você, fico feliz em seguir conversando por aqui.';

export type InviteCandidateInput = {
  name: string;
  party?: string | null;
  office?: string | null;
  bio?: string | null;
  toneOfVoice?: string | null;
  mainProposals?: string[] | null;
  restrictedTopics?: string[] | null;
};

/** Monta briefing completo a partir do candidato + intenção curta (fluxo Convite inicial). */
export function buildInviteMarketingBriefFromCandidate(
  candidate: InviteCandidateInput | null | undefined,
  intention?: string | null,
): ContentMarketingBrief {
  const proposals = (candidate?.mainProposals ?? [])
    .map((item) => String(item).trim())
    .filter(Boolean)
    .join('; ');
  const characteristics = [
    candidate?.name,
    candidate?.office,
    candidate?.party,
    candidate?.bio,
    candidate?.toneOfVoice,
  ]
    .map((item) => (item == null ? '' : String(item).trim()))
    .filter(Boolean)
    .join(' · ');

  const brief = emptyMarketingBrief();
  brief.objective =
    'Convidar a pessoa a receber conteúdos e informações sobre pautas públicas, sem pedido de voto.';
  brief.offerName = 'Convite para acompanhar conteúdos';
  brief.offerDescription =
    'Canal de informações e conteúdos sobre temas e propostas de interesse coletivo.';
  brief.targetAudience =
    'Pessoas da base de contatos interessadas em acompanhar pautas locais e temas públicos.';
  brief.candidateCharacteristics =
    characteristics || 'Responsável pela comunicação da campanha.';
  brief.painPoints =
    'Falta de informação clara e acessível sobre temas públicos relevantes.';
  brief.primaryBenefit =
    proposals || 'Acompanhar informações claras sobre temas e pautas defendidas.';
  brief.differentiators = proposals || null;
  brief.callToAction =
    'Aceitar receber conteúdos e informações por este canal, se fizer sentido.';
  brief.tone = candidate?.toneOfVoice?.trim() || 'profissional, acolhedor e natural';
  brief.formality = 'semi-formal';
  brief.maxLength = 600;
  brief.personalizationPlacement = 'GREETING';
  brief.protectedFacts = (candidate?.restrictedTopics ?? [])
    .map((item) => String(item).trim())
    .filter(Boolean);
  brief.forbiddenClaims = [
    'pedido explícito de voto',
    'propaganda agressiva de candidatura',
    'promessas ilegais ou inventadas',
    'afirmações falsas sobre pesquisa ou percentual',
  ];
  brief.additionalInstructions = (
    intention?.trim() || DEFAULT_INVITE_INTENTION
  ).slice(0, 2000);
  return brief;
}

