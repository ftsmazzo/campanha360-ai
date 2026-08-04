/**
 * 09.7.2 — Validacao de conjuntos IA, coerencia e qualidade editorial.
 */

import {
  CONTENT_LIMITS,
  extractContentVariableKeys,
  isAllowedContentVariable,
} from './content-variables.util';
import { createHash } from 'node:crypto';
import {
  detectSensitiveContent,
  formatSensitiveAttributeError,
  type ContentAiGenerationMode,
  type ContentMarketingBrief,
  type ContentPersonalizationPlacement,
  type SensitiveAttributeMatch,
} from './content-marketing.util';
import {
  normalizeAiSetsPayload,
  type AiGeneratedSet,
  type AiSetStructureDiagnostic,
  type AiSetsDetectedFormat,
} from './content-ai-sets.util';

export type {
  AiGeneratedBlock,
  AiGeneratedSet,
  AiSetStructureDiagnostic,
  AiSetsDetectedFormat,
} from './content-ai-sets.util';

function hashNormalizedContent(text: string): string {
  const normalized = text
    .normalize('NFC')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .toLowerCase();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export type CoherenceAlertCode =
  | 'DUPLICATE_NAME_PERSONALIZATION'
  | 'MULTIPLE_GREETING'
  | 'DUPLICATE_CALL_TO_ACTION'
  | 'INCOMPATIBLE_TONE'
  | 'BLOCK_CONTINUITY_WARNING'
  | 'NAME_IN_WRONG_BLOCK'
  | 'SENSITIVE_ATTRIBUTE';

export type CoherenceAlert = {
  code: CoherenceAlertCode;
  blocking: boolean;
  message: string;
};

export type EditorialQualityScores = {
  clarityScore: number;
  relevanceScore: number;
  specificityScore: number;
  callToActionScore: number;
  personalizationScore: number;
  riskWarnings: string[];
};

const GREETING_MARKERS =
  /\b(ola|olá|oi|bom dia|boa tarde|boa noite|e ai|e aí)\b/i;
const CTA_MARKERS =
  /\b(responde|responda|me chama|chama|agende|agenda|clique|acesse|confira|saiba mais|vamos conversar|posso te)\b/i;

export type ValidateAiSetsResult =
  | { ok: true; sets: AiGeneratedSet[] }
  | {
      ok: false;
      errors: string[];
      diagnostics: SensitiveAttributeMatch[];
      structureDiagnostics: AiSetStructureDiagnostic[];
      detectedFormat: AiSetsDetectedFormat;
      payloadHash: string;
    };

export function validateAiSetsPayload(
  payload: unknown,
  input: {
    baseBody?: string;
    placement: ContentPersonalizationPlacement;
    protectedFacts?: string[];
    mode?: ContentAiGenerationMode;
  },
): ValidateAiSetsResult {
  const mode = input.mode ?? 'FULL_SETS';
  const normalized = normalizeAiSetsPayload(payload, mode, {
    baseBody: input.baseBody,
  });

  if (!normalized.ok) {
    const errors = normalized.errors.filter((e) => e !== 'SET_BLOCKS_INVALID');
    return {
      ok: false,
      errors: errors.length > 0 ? errors : ['AI_SET_BLOCK_INVALID'],
      diagnostics: [],
      structureDiagnostics: normalized.structureDiagnostics,
      detectedFormat: normalized.detectedFormat,
      payloadHash: normalized.payloadHash,
    };
  }

  return validateMappedSets(
    normalized.sets,
    input,
    [],
    [],
    mode,
    normalized.detectedFormat,
    normalized.payloadHash,
  );
}

function validateMappedSets(
  mapped: AiGeneratedSet[],
  input: {
    baseBody?: string;
    placement: ContentPersonalizationPlacement;
    protectedFacts?: string[];
  },
  errors: string[],
  diagnostics: SensitiveAttributeMatch[],
  mode: string,
  detectedFormat: AiSetsDetectedFormat = 'UNKNOWN',
  payloadHash = '',
): ValidateAiSetsResult {
  const baseHash = input.baseBody
    ? hashNormalizedContent(input.baseBody)
    : null;
  const seenBodies = new Set<string>();
  const out: AiGeneratedSet[] = [];
  const seenSensitiveKeys = new Set<string>();
  const structureDiagnostics: AiSetStructureDiagnostic[] = [];

  mapped.forEach((set, setIndex) => {
    if (!set.preservedFacts) {
      errors.push('PRESERVED_FACTS_FALSE');
      structureDiagnostics.push({
        code: 'AI_SET_BLOCK_INVALID',
        setIndex,
        reason: 'PRESERVED_FACTS_FALSE',
      });
    }
    const blocks: Array<{
      block: 'greeting' | 'body' | 'closing';
      text: string;
    }> = [
      { block: 'greeting', text: set.greeting.text },
      { block: 'body', text: set.body.text },
      { block: 'closing', text: set.closing.text },
    ];
    for (const { block, text } of blocks) {
      if (text.length > CONTENT_LIMITS.MAX_VARIANT_CHARS) {
        errors.push('VARIANT_TOO_LONG');
      }
      for (const key of extractContentVariableKeys(text)) {
        if (!isAllowedContentVariable(key)) {
          errors.push(`UNKNOWN_VAR:${key}`);
          structureDiagnostics.push({
            code: 'AI_SET_BLOCK_INVALID',
            setIndex,
            block,
            reason: 'UNKNOWN_PLACEHOLDER',
            detail: key,
          });
        }
      }
      const match = detectSensitiveContent(text, { block, setIndex });
      if (match) {
        const dedupeKey = `${match.matchedTerm}:${match.block}:${match.setIndex}`;
        if (!seenSensitiveKeys.has(dedupeKey)) {
          seenSensitiveKeys.add(dedupeKey);
          diagnostics.push(match);
          errors.push(formatSensitiveAttributeError(match));
        }
      }
    }

    if (mode === 'FULL_SETS' || mode === 'IMPROVE_CURRENT' || mode === 'BODY_ONLY') {
      const bh = hashNormalizedContent(set.body.text);
      if (baseHash && bh === baseHash) errors.push('VARIANT_IDENTICAL_TO_BASE');
      if (seenBodies.has(bh)) errors.push('VARIANT_DUPLICATE');
      seenBodies.add(bh);
    }

    const placementErrors = assertPersonalizationPlacementOnSet(
      set,
      input.placement,
    );
    for (const pe of placementErrors) {
      errors.push(pe);
      if (
        pe === 'NAME_IN_WRONG_BLOCK' ||
        pe === 'DUPLICATE_NAME_PERSONALIZATION'
      ) {
        structureDiagnostics.push({
          code: 'AI_SET_BLOCK_INVALID',
          setIndex,
          reason: 'PERSONALIZATION_PLACEMENT_INVALID',
          detail: pe,
        });
      }
    }

    const coherence = validateCompositionCoherence({
      greeting: set.greeting.text,
      body: set.body.text,
      closing: set.closing.text,
      placement: input.placement,
      skipSensitiveScan: true,
    });
    for (const alert of coherence) {
      if (alert.blocking) errors.push(alert.code);
    }

    if (input.protectedFacts?.length) {
      for (const fact of input.protectedFacts) {
        const f = fact.trim();
        if (!f) continue;
        const combined = `${set.greeting.text}\n${set.body.text}\n${set.closing.text}`;
        if (/\d/.test(f) && !combined.toLowerCase().includes(f.toLowerCase())) {
          if (f.length <= 40) {
            errors.push(`PROTECTED_FACT_MISSING:${f.slice(0, 40)}`);
          }
        }
      }
    }

    out.push(set);
  });

  const uniqueErrors = [...new Set(errors)].filter(
    (e) => e !== 'SET_BLOCKS_INVALID',
  );
  if (uniqueErrors.length > 0) {
    return {
      ok: false,
      errors: uniqueErrors,
      diagnostics,
      structureDiagnostics,
      detectedFormat,
      payloadHash,
    };
  }
  if (out.length < 1) {
    return {
      ok: false,
      errors: ['SETS_EMPTY'],
      diagnostics,
      structureDiagnostics: [
        { code: 'AI_SETS_PAYLOAD_INVALID', reason: 'SETS_EMPTY' },
      ],
      detectedFormat,
      payloadHash,
    };
  }
  return { ok: true, sets: out };
}

export function assertPersonalizationPlacementOnSet(
  set: AiGeneratedSet,
  placement: ContentPersonalizationPlacement,
): string[] {
  const errors: string[] = [];
  const gHas = extractContentVariableKeys(set.greeting.text).includes('firstName');
  const bHas = extractContentVariableKeys(set.body.text).includes('firstName');
  const cHas = extractContentVariableKeys(set.closing.text).includes(
    'firstName',
  );
  const fullHas =
    extractContentVariableKeys(
      `${set.greeting.text} ${set.body.text} ${set.closing.text}`,
    ).includes('fullName');

  if (placement === 'GREETING') {
    if (bHas || cHas || fullHas) errors.push('NAME_IN_WRONG_BLOCK');
  } else if (placement === 'BODY') {
    if (gHas || cHas) errors.push('NAME_IN_WRONG_BLOCK');
    if (bHas && (gHas || cHas)) errors.push('DUPLICATE_NAME_PERSONALIZATION');
  } else if (placement === 'NONE') {
    if (gHas || bHas || cHas || fullHas) errors.push('NAME_IN_WRONG_BLOCK');
  }

  const nameTokenCount = (
    `${set.greeting.text}\n${set.body.text}\n${set.closing.text}`.match(
      /\{\{\s*(firstName|fullName)\s*\}\}/g,
    ) ?? []
  ).length;
  if (nameTokenCount > 1) errors.push('DUPLICATE_NAME_PERSONALIZATION');

  return errors;
}

export function validateCompositionCoherence(input: {
  greeting?: string | null;
  body: string;
  closing?: string | null;
  placement?: ContentPersonalizationPlacement;
  /** Quando true, nao emite SENSITIVE_ATTRIBUTE generico (ja validado por bloco). */
  skipSensitiveScan?: boolean;
}): CoherenceAlert[] {
  const alerts: CoherenceAlert[] = [];
  const greeting = (input.greeting ?? '').trim();
  const body = input.body.trim();
  const closing = (input.closing ?? '').trim();
  const all = [greeting, body, closing].filter(Boolean).join('\n\n');

  const nameTokens =
    all.match(/\{\{\s*(firstName|fullName)\s*\}\}/g)?.length ?? 0;
  if (nameTokens > 1) {
    alerts.push({
      code: 'DUPLICATE_NAME_PERSONALIZATION',
      blocking: true,
      message: 'Personalizacao de nome aparece mais de uma vez',
    });
  }

  if (greeting && GREETING_MARKERS.test(body)) {
    alerts.push({
      code: 'MULTIPLE_GREETING',
      blocking: true,
      message: 'Corpo inicia/repete saudacao enquanto GREETING existe',
    });
  }

  const ctaCount =
    (GREETING_MARKERS.test(greeting) ? 0 : 0) +
    (CTA_MARKERS.test(body) ? 1 : 0) +
    (CTA_MARKERS.test(closing) ? 1 : 0);
  if (CTA_MARKERS.test(body) && CTA_MARKERS.test(closing)) {
    alerts.push({
      code: 'DUPLICATE_CALL_TO_ACTION',
      blocking: false,
      message: 'CTA parece repetido entre corpo e fechamento',
    });
  }
  void ctaCount;

  if (greeting && body && greeting.toLowerCase() === body.toLowerCase()) {
    alerts.push({
      code: 'BLOCK_CONTINUITY_WARNING',
      blocking: true,
      message: 'Saudacao e corpo identicos',
    });
  }

  if (!input.skipSensitiveScan) {
    const match = detectSensitiveContent(all);
    if (match) {
      alerts.push({
        code: 'SENSITIVE_ATTRIBUTE',
        blocking: true,
        message: formatSensitiveAttributeError(match),
      });
    }
  }

  return alerts;
}

export function assessEditorialQuality(input: {
  greeting?: string | null;
  body: string;
  closing?: string | null;
  brief?: ContentMarketingBrief | null;
}): EditorialQualityScores {
  const text = [input.greeting, input.body, input.closing]
    .filter(Boolean)
    .join(' ');
  const riskWarnings: string[] = [];
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const unique = new Set(words);

  let clarityScore = 70;
  let relevanceScore = 50;
  let specificityScore = 50;
  let callToActionScore = CTA_MARKERS.test(text) ? 80 : 30;
  let personalizationScore = /\{\{\s*firstName\s*\}\}/.test(text) ? 75 : 40;

  if (text.length > 1200) {
    riskWarnings.push('texto excessivamente longo');
    clarityScore -= 15;
  }
  if (words.length > 0 && unique.size / words.length < 0.55) {
    riskWarnings.push('repeticao de palavras');
    clarityScore -= 10;
  }
  if (/\b(melhor do brasil|garantido|imperd[ií]vel|ultima chance|última chance)\b/i.test(text)) {
    riskWarnings.push('promessa ou urgencia artificial');
  }
  if (/\b(incr[ií]vel|fant[aá]stico|revolucion[aá]rio|exclusiv[oa])\b/i.test(text)) {
    riskWarnings.push('excesso de adjetivos');
    specificityScore -= 10;
  }
  if (input.brief?.primaryBenefit && text.toLowerCase().includes(input.brief.primaryBenefit.toLowerCase().slice(0, 20))) {
    relevanceScore += 20;
    specificityScore += 15;
  }
  if (input.brief?.callToAction && CTA_MARKERS.test(text)) {
    callToActionScore = Math.min(100, callToActionScore + 10);
  } else if (!CTA_MARKERS.test(text)) {
    riskWarnings.push('CTA ausente');
  }
  if (!input.brief?.primaryBenefit) {
    riskWarnings.push('beneficio ausente no briefing');
  }
  if (text.length < 40) {
    riskWarnings.push('mensagem generica ou curta demais');
    specificityScore -= 20;
  }

  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  return {
    clarityScore: clamp(clarityScore),
    relevanceScore: clamp(relevanceScore),
    specificityScore: clamp(specificityScore),
    callToActionScore: clamp(callToActionScore),
    personalizationScore: clamp(personalizationScore),
    riskWarnings,
  };
}

export function groupVariantsByGenerationSet<
  T extends {
    id: string;
    type: string;
    generationSetId?: string | null;
    enabled?: boolean;
  },
>(variants: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const v of variants) {
    const setId = v.generationSetId?.trim();
    if (!setId) continue;
    const list = map.get(setId) ?? [];
    list.push(v);
    map.set(setId, list);
  }
  return map;
}

export function isCompleteGenerationSet(
  variants: Array<{ type: string }>,
): boolean {
  return variants.some((v) => v.type === 'BODY');
}
