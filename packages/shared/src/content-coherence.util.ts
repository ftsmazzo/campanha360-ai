/**
 * 09.7.2 — Validacao de conjuntos IA, coerencia e qualidade editorial.
 */

import {
  CONTENT_LIMITS,
  extractContentVariableKeys,
  isAllowedContentVariable,
} from './content-variables.util';
import { createHash } from 'node:crypto';
import type {
  ContentMarketingBrief,
  ContentPersonalizationPlacement,
} from './content-marketing.util';
import { containsDeniedSensitiveAttribute } from './content-marketing.util';

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

export type AiGeneratedBlock = {
  text: string;
  requiresVariables?: string[];
};

export type AiGeneratedSet = {
  greeting: AiGeneratedBlock;
  body: AiGeneratedBlock;
  closing: AiGeneratedBlock;
  marketingAngle: string;
  summaryOfChanges: string;
  preservedFacts: boolean;
  protectedFactsUsed?: string[];
  warnings?: string[];
};

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

export function validateAiSetsPayload(
  payload: unknown,
  input: {
    baseBody?: string;
    placement: ContentPersonalizationPlacement;
    protectedFacts?: string[];
    mode?: 'FULL_SETS' | 'GREETING_ONLY' | 'BODY_ONLY' | 'CLOSING_ONLY' | 'IMPROVE_CURRENT';
  },
):
  | { ok: true; sets: AiGeneratedSet[] }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, errors: ['SCHEMA_INVALID'] };
  }
  const mode = input.mode ?? 'FULL_SETS';
  const setsRaw = (payload as { sets?: unknown; variants?: unknown }).sets;
  // Compatibilidade 09.7.1: variants BODY_ONLY
  if (
    (mode === 'BODY_ONLY' || mode === 'GREETING_ONLY' || mode === 'CLOSING_ONLY') &&
    !Array.isArray(setsRaw)
  ) {
    const variants = (payload as { variants?: unknown }).variants;
    if (!Array.isArray(variants)) {
      return { ok: false, errors: ['SETS_OR_VARIANTS_MISSING'] };
    }
    const mapped: AiGeneratedSet[] = [];
    for (const row of variants) {
      if (!row || typeof row !== 'object') continue;
      const text = String((row as { text?: unknown }).text ?? '').trim();
      const summaryOfChanges = String(
        (row as { summaryOfChanges?: unknown }).summaryOfChanges ?? '',
      ).trim();
      const preservedFacts =
        (row as { preservedFacts?: unknown }).preservedFacts === true;
      if (mode === 'BODY_ONLY') {
        mapped.push({
          greeting: { text: 'Ola!', requiresVariables: [] },
          body: { text, requiresVariables: extractContentVariableKeys(text) },
          closing: { text: 'Posso te ajudar?', requiresVariables: [] },
          marketingAngle: 'body-only',
          summaryOfChanges,
          preservedFacts,
        });
      } else if (mode === 'GREETING_ONLY') {
        mapped.push({
          greeting: { text, requiresVariables: extractContentVariableKeys(text) },
          body: { text: input.baseBody || 'Mensagem', requiresVariables: [] },
          closing: { text: 'Obrigado.', requiresVariables: [] },
          marketingAngle: 'greeting-only',
          summaryOfChanges,
          preservedFacts,
        });
      } else {
        mapped.push({
          greeting: { text: 'Ola!', requiresVariables: [] },
          body: { text: input.baseBody || 'Mensagem', requiresVariables: [] },
          closing: { text, requiresVariables: extractContentVariableKeys(text) },
          marketingAngle: 'closing-only',
          summaryOfChanges,
          preservedFacts,
        });
      }
    }
    return validateMappedSets(mapped, input, errors, mode);
  }

  if (!Array.isArray(setsRaw)) {
    return { ok: false, errors: ['SETS_MISSING'] };
  }
  if (setsRaw.length < 1 || setsRaw.length > CONTENT_LIMITS.MAX_AI_VARIANTS) {
    errors.push('SETS_COUNT');
  }

  const mapped: AiGeneratedSet[] = [];
  for (const row of setsRaw) {
    if (!row || typeof row !== 'object') {
      errors.push('SET_ROW_INVALID');
      continue;
    }
    const r = row as Record<string, unknown>;
    const greeting = readBlock(r.greeting);
    const body = readBlock(r.body);
    const closing = readBlock(r.closing);
    if (!greeting || !body || !closing) {
      errors.push('SET_BLOCKS_INVALID');
      continue;
    }
    mapped.push({
      greeting,
      body,
      closing,
      marketingAngle: String(r.marketingAngle ?? '').trim().slice(0, 200),
      summaryOfChanges: String(r.summaryOfChanges ?? '').trim().slice(0, 500),
      preservedFacts: r.preservedFacts === true,
      protectedFactsUsed: Array.isArray(r.protectedFactsUsed)
        ? r.protectedFactsUsed.filter((x): x is string => typeof x === 'string')
        : [],
      warnings: Array.isArray(r.warnings)
        ? r.warnings.filter((x): x is string => typeof x === 'string')
        : [],
    });
  }

  return validateMappedSets(mapped, input, errors, mode);
}

function readBlock(value: unknown): AiGeneratedBlock | null {
  if (!value || typeof value !== 'object') return null;
  const text = String((value as { text?: unknown }).text ?? '').trim();
  if (!text) return null;
  const requiresVariables = Array.isArray(
    (value as { requiresVariables?: unknown }).requiresVariables,
  )
    ? ((value as { requiresVariables: unknown[] }).requiresVariables
        .filter((x): x is string => typeof x === 'string')
        .filter(isAllowedContentVariable) as string[])
    : extractContentVariableKeys(text).filter(isAllowedContentVariable);
  return { text, requiresVariables };
}

function validateMappedSets(
  mapped: AiGeneratedSet[],
  input: {
    baseBody?: string;
    placement: ContentPersonalizationPlacement;
    protectedFacts?: string[];
  },
  errors: string[],
  mode: string,
):
  | { ok: true; sets: AiGeneratedSet[] }
  | { ok: false; errors: string[] } {
  const baseHash = input.baseBody
    ? hashNormalizedContent(input.baseBody)
    : null;
  const seenBodies = new Set<string>();
  const out: AiGeneratedSet[] = [];

  for (const set of mapped) {
    if (!set.preservedFacts) errors.push('FACTS_NOT_PRESERVED');
    for (const block of [set.greeting, set.body, set.closing]) {
      if (block.text.length > CONTENT_LIMITS.MAX_VARIANT_CHARS) {
        errors.push('VARIANT_TOO_LONG');
      }
      for (const key of extractContentVariableKeys(block.text)) {
        if (!isAllowedContentVariable(key)) errors.push(`UNKNOWN_VAR:${key}`);
      }
      const denied = containsDeniedSensitiveAttribute(block.text);
      if (denied) errors.push(`SENSITIVE_ATTRIBUTE:${denied}`);
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
    errors.push(...placementErrors);

    const coherence = validateCompositionCoherence({
      greeting: set.greeting.text,
      body: set.body.text,
      closing: set.closing.text,
      placement: input.placement,
    });
    for (const alert of coherence) {
      if (alert.blocking) errors.push(alert.code);
    }

    if (input.protectedFacts?.length) {
      for (const fact of input.protectedFacts) {
        const f = fact.trim();
        if (!f) continue;
        const combined = `${set.greeting.text}\n${set.body.text}\n${set.closing.text}`;
        // Se o fato e numerico/curto e aparece no briefing, exigir preservacao aproximada
        if (/\d/.test(f) && !combined.toLowerCase().includes(f.toLowerCase())) {
          // so rejeita se o fato parece concreto (preco/data) e nao foi usado
          if (f.length <= 40) {
            errors.push(`PROTECTED_FACT_MISSING:${f.slice(0, 40)}`);
          }
        }
      }
    }

    out.push(set);
  }

  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };
  if (out.length < 1) return { ok: false, errors: ['SETS_EMPTY'] };
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

  const denied = containsDeniedSensitiveAttribute(all);
  if (denied) {
    alerts.push({
      code: 'SENSITIVE_ATTRIBUTE',
      blocking: true,
      message: `Atributo sensivel nao permitido: ${denied}`,
    });
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
