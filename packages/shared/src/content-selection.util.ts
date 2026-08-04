/**
 * 09.7.1 — Selecao deterministica de variantes e composicao final.
 * Nunca usa Math.random().
 */

import { createHash } from 'node:crypto';
import {
  CONTENT_LIMITS,
  extractContentVariableKeys,
  isAllowedContentVariable,
  isVariantEligibleForContact,
  renderContentTemplate,
  type ContactVariableContext,
  type ContentVariableKey,
  type RenderContentResult,
} from './content-variables.util';
import {
  validateCompositionCoherence,
  type CoherenceAlert,
} from './content-coherence.util';
import type {
  ContentCombinationMode,
  ContentMarketingBrief,
  ContentPersonalizationPlacement,
} from './content-marketing.util';

export type ContentVariantType = 'BODY' | 'GREETING' | 'CLOSING';
export type ContentVariantSource = 'MANUAL' | 'AI_GENERATED' | 'BASE';

export type ContentVariantLike = {
  id: string;
  type: ContentVariantType;
  text: string;
  enabled: boolean;
  order: number;
  requiresVariables?: string[] | null;
  normalizedTextHash?: string | null;
  generationSetId?: string | null;
  tone?: string | null;
  formality?: string | null;
  personalizationPlacement?: ContentPersonalizationPlacement | null;
  marketingAngle?: string | null;
  compatibleGroup?: string | null;
};

export type ContentCompositionSnapshotV1 = {
  schemaVersion: 1;
  compositionId: string;
  compositionVersion: number;
  name: string;
  blockSeparator: string;
  selectionAlgorithmVersion: string;
  approvedAt: string;
  approvedByUserId: string;
  allowedVariables: ContentVariableKey[];
  fallbacks: Partial<Record<ContentVariableKey, string>>;
  combinationMode?: ContentCombinationMode;
  personalizationPlacement?: ContentPersonalizationPlacement;
  marketingBrief?: ContentMarketingBrief | null;
  variants: Array<{
    id: string;
    type: ContentVariantType;
    source: ContentVariantSource;
    text: string;
    normalizedTextHash: string;
    enabled: boolean;
    order: number;
    requiresVariables: string[];
    generationSetId?: string | null;
    tone?: string | null;
    formality?: string | null;
    personalizationPlacement?: ContentPersonalizationPlacement | null;
    marketingAngle?: string | null;
    compatibleGroup?: string | null;
  }>;
  compositionSnapshotHash: string;
  aiMeta?: {
    model?: string | null;
    generatedAt?: string | null;
    variantCount?: number;
    promptVersion?: string | null;
    approvedSetIds?: string[];
  } | null;
};

export function hashContentText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function normalizeContentTextForHash(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .toLowerCase();
}

export function hashNormalizedContent(text: string): string {
  return hashContentText(normalizeContentTextForHash(text));
}

export function computeCompositionSnapshotHash(
  snapshot: Omit<ContentCompositionSnapshotV1, 'compositionSnapshotHash'>,
): string {
  const canonical = JSON.stringify({
    compositionId: snapshot.compositionId,
    compositionVersion: snapshot.compositionVersion,
    blockSeparator: snapshot.blockSeparator,
    selectionAlgorithmVersion: snapshot.selectionAlgorithmVersion,
    combinationMode: snapshot.combinationMode ?? 'MIX_AND_MATCH',
    personalizationPlacement: snapshot.personalizationPlacement ?? 'GREETING',
    fallbacks: snapshot.fallbacks,
    marketingBrief: snapshot.marketingBrief ?? null,
    variants: snapshot.variants
      .map((v) => ({
        id: v.id,
        type: v.type,
        text: v.text,
        enabled: v.enabled,
        order: v.order,
        requiresVariables: v.requiresVariables,
        generationSetId: v.generationSetId ?? null,
        compatibleGroup: v.compatibleGroup ?? null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
  return hashContentText(canonical);
}

/**
 * Indice deterministico estavel em [0, modulus).
 */
export function deterministicIndex(input: {
  dispatchId: string;
  dispatchItemId?: string | null;
  contactId?: string | null;
  contentSnapshotVersion: number | string;
  slot: 'GREETING' | 'BODY' | 'CLOSING';
  modulus: number;
  algorithmVersion?: string;
}): number {
  if (input.modulus <= 0) return 0;
  const seed = [
    input.algorithmVersion ?? CONTENT_LIMITS.SELECTION_ALGORITHM_VERSION,
    input.dispatchId,
    input.dispatchItemId ?? '',
    input.contactId ?? '',
    String(input.contentSnapshotVersion),
    input.slot,
  ].join('::');
  const digest = createHash('sha256').update(seed, 'utf8').digest();
  // Usa 4 bytes big-endian
  const n =
    ((digest[0]! << 24) >>> 0) +
    (digest[1]! << 16) +
    (digest[2]! << 8) +
    digest[3]!;
  return n % input.modulus;
}

export function selectDeterministicContentVariant(input: {
  dispatchId: string;
  dispatchItemId?: string | null;
  contactId?: string | null;
  contentSnapshotVersion: number | string;
  eligibleVariantIds: string[];
  slot: 'GREETING' | 'BODY' | 'CLOSING';
}): string | null {
  const ids = [...input.eligibleVariantIds].sort();
  if (ids.length === 0) return null;
  const idx = deterministicIndex({
    ...input,
    modulus: ids.length,
  });
  return ids[idx] ?? null;
}

export function composeMessageBlocks(input: {
  greeting?: string | null;
  body: string;
  closing?: string | null;
  separator?: string;
}): string {
  const sep = input.separator ?? CONTENT_LIMITS.BLOCK_SEPARATOR_DEFAULT;
  const parts = [input.greeting, input.body, input.closing]
    .map((p) => (p ?? '').trim())
    .filter(Boolean);
  return parts.join(sep);
}

export type SelectedCompositionResult = {
  greetingVariantId: string | null;
  bodyVariantId: string;
  closingVariantId: string | null;
  generationSetId: string | null;
  renderedText: string;
  renderedTextHash: string;
  personalizationStatus: 'FULL' | 'PARTIAL' | 'NONE' | 'BLOCKED';
  missingVariables: string[];
  usedFallbacks: string[];
  selectionSeedVersion: string;
  coherenceAlerts: CoherenceAlert[];
  render: RenderContentResult;
  valid: boolean;
  errors: string[];
};

export function selectAndRenderComposition(input: {
  snapshot: ContentCompositionSnapshotV1;
  dispatchId: string;
  dispatchItemId?: string | null;
  contactId?: string | null;
  contact: ContactVariableContext;
}): SelectedCompositionResult {
  const mode = input.snapshot.combinationMode ?? 'MIX_AND_MATCH';
  const selectionSeedVersion =
    mode === 'LOCKED_SETS'
      ? CONTENT_LIMITS.SELECTION_ALGORITHM_VERSION_LOCKED_SETS
      : input.snapshot.selectionAlgorithmVersion ||
        CONTENT_LIMITS.SELECTION_ALGORITHM_VERSION;

  const enabled = input.snapshot.variants.filter((v) => v.enabled);
  const errors: string[] = [];

  const pickEligible = (type: ContentVariantType, pool = enabled) =>
    pool
      .filter((v) => v.type === type)
      .filter((v) =>
        isVariantEligibleForContact({
          text: v.text,
          requiresVariables: v.requiresVariables,
          contact: input.contact,
        }),
      )
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  let greetingVariantId: string | null = null;
  let bodyVariantId: string | undefined;
  let closingVariantId: string | null = null;
  let generationSetId: string | null = null;

  if (mode === 'LOCKED_SETS') {
    const setIds = [
      ...new Set(
        enabled
          .map((v) => v.generationSetId?.trim())
          .filter((id): id is string => Boolean(id)),
      ),
    ].sort();

    const eligibleSetIds = setIds.filter((setId) => {
      const members = enabled.filter((v) => v.generationSetId === setId);
      const body = members.find((v) => v.type === 'BODY');
      if (!body) return false;
      return members.every((v) =>
        isVariantEligibleForContact({
          text: v.text,
          requiresVariables: v.requiresVariables,
          contact: input.contact,
        }),
      );
    });

    if (eligibleSetIds.length > 0) {
      generationSetId = selectDeterministicContentVariant({
        dispatchId: input.dispatchId,
        dispatchItemId: input.dispatchItemId,
        contactId: input.contactId,
        contentSnapshotVersion: input.snapshot.compositionVersion,
        eligibleVariantIds: eligibleSetIds,
        slot: 'BODY',
      });
      const members = enabled.filter((v) => v.generationSetId === generationSetId);
      const body = members.find((v) => v.type === 'BODY');
      const greeting = members.find((v) => v.type === 'GREETING');
      const closing = members.find((v) => v.type === 'CLOSING');
      bodyVariantId = body?.id;
      greetingVariantId = greeting?.id ?? null;
      closingVariantId = closing?.id ?? null;
    }
  }

  if (!bodyVariantId) {
    // MIX_AND_MATCH ou fallback sem sets
    const greetings = pickEligible('GREETING');
    const bodies = pickEligible('BODY');
    const closings = pickEligible('CLOSING');
    if (bodies.length === 0) errors.push('NENHUM_BODY_ELEGIVEL');

    bodyVariantId =
      selectDeterministicContentVariant({
        dispatchId: input.dispatchId,
        dispatchItemId: input.dispatchItemId,
        contactId: input.contactId,
        contentSnapshotVersion: input.snapshot.compositionVersion,
        eligibleVariantIds: bodies.map((b) => b.id),
        slot: 'BODY',
      }) ?? bodies[0]?.id;

    greetingVariantId = selectDeterministicContentVariant({
      dispatchId: input.dispatchId,
      dispatchItemId: input.dispatchItemId,
      contactId: input.contactId,
      contentSnapshotVersion: input.snapshot.compositionVersion,
      eligibleVariantIds: greetings.map((g) => g.id),
      slot: 'GREETING',
    });

    closingVariantId = selectDeterministicContentVariant({
      dispatchId: input.dispatchId,
      dispatchItemId: input.dispatchItemId,
      contactId: input.contactId,
      contentSnapshotVersion: input.snapshot.compositionVersion,
      eligibleVariantIds: closings.map((c) => c.id),
      slot: 'CLOSING',
    });

    const bodyMeta = bodies.find((b) => b.id === bodyVariantId);
    generationSetId = bodyMeta?.generationSetId ?? null;
  }

  const body = enabled.find((b) => b.id === bodyVariantId && b.type === 'BODY');
  const greeting = greetingVariantId
    ? enabled.find((g) => g.id === greetingVariantId)
    : undefined;
  const closing = closingVariantId
    ? enabled.find((c) => c.id === closingVariantId)
    : undefined;

  if (!body) {
    return {
      greetingVariantId: null,
      bodyVariantId: bodyVariantId ?? '',
      closingVariantId: null,
      generationSetId: null,
      renderedText: '',
      renderedTextHash: '',
      personalizationStatus: 'BLOCKED',
      missingVariables: [],
      usedFallbacks: [],
      selectionSeedVersion,
      coherenceAlerts: [],
      render: {
        renderedText: '',
        resolvedVariables: {},
        missingVariables: [],
        usedFallbacks: [],
        valid: false,
        errors,
      },
      valid: false,
      errors,
    };
  }

  const coherenceAlerts = validateCompositionCoherence({
    greeting: greeting?.text,
    body: body.text,
    closing: closing?.text,
    placement: input.snapshot.personalizationPlacement,
  });
  const blockingCoherence = coherenceAlerts.filter((a) => a.blocking);
  if (blockingCoherence.length > 0) {
    errors.push(...blockingCoherence.map((a) => a.code));
  }

  // MIX_AND_MATCH: formalidade incompativel
  if (
    mode === 'MIX_AND_MATCH' &&
    greeting?.formality &&
    body.formality &&
    greeting.formality !== body.formality
  ) {
    coherenceAlerts.push({
      code: 'INCOMPATIBLE_TONE',
      blocking: false,
      message: 'Formalidade da saudacao diverge do corpo',
    });
  }

  const composedTemplate = composeMessageBlocks({
    greeting: greeting?.text,
    body: body.text,
    closing: closing?.text,
    separator: input.snapshot.blockSeparator,
  });

  const render = renderContentTemplate(
    composedTemplate,
    input.contact,
    input.snapshot.fallbacks,
  );

  const allErrors = [...errors, ...render.errors];
  const personalizationStatus: SelectedCompositionResult['personalizationStatus'] =
    !render.valid || blockingCoherence.length > 0
      ? 'BLOCKED'
      : render.usedFallbacks.length > 0
        ? 'PARTIAL'
        : Object.keys(render.resolvedVariables).length > 0
          ? 'FULL'
          : 'NONE';

  return {
    greetingVariantId: greeting?.id ?? null,
    bodyVariantId: body.id,
    closingVariantId: closing?.id ?? null,
    generationSetId,
    renderedText: render.renderedText,
    renderedTextHash: hashContentText(render.renderedText),
    personalizationStatus,
    missingVariables: render.missingVariables,
    usedFallbacks: render.usedFallbacks,
    selectionSeedVersion,
    coherenceAlerts,
    render,
    valid: allErrors.length === 0 && Boolean(bodyVariantId),
    errors: allErrors,
  };
}

export function countTheoreticalCombinations(input: {
  greetingCount: number;
  bodyCount: number;
  closingCount: number;
}): number {
  const g = Math.max(1, input.greetingCount); // sem greeting = 1 caminho vazio
  const b = Math.max(0, input.bodyCount);
  const c = Math.max(1, input.closingCount);
  if (input.greetingCount === 0) {
    return b * (input.closingCount === 0 ? 1 : input.closingCount);
  }
  if (input.closingCount === 0) {
    return input.greetingCount * b;
  }
  return g * b * c;
}

export type AiVariantDraft = {
  text: string;
  summaryOfChanges: string;
  preservedFacts: boolean;
};

export function validateAiVariantsPayload(
  payload: unknown,
  baseText: string,
): { ok: true; variants: AiVariantDraft[] } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, errors: ['SCHEMA_INVALID'] };
  }
  const variantsRaw = (payload as { variants?: unknown }).variants;
  if (!Array.isArray(variantsRaw)) {
    return { ok: false, errors: ['VARIANTS_MISSING'] };
  }
  if (variantsRaw.length < 1 || variantsRaw.length > CONTENT_LIMITS.MAX_AI_VARIANTS) {
    errors.push('VARIANTS_COUNT');
  }
  const baseHash = hashNormalizedContent(baseText);
  const seen = new Set<string>();
  const out: AiVariantDraft[] = [];
  for (const row of variantsRaw) {
    if (!row || typeof row !== 'object') {
      errors.push('VARIANT_ROW_INVALID');
      continue;
    }
    const text = String((row as { text?: unknown }).text ?? '').trim();
    const summaryOfChanges = String(
      (row as { summaryOfChanges?: unknown }).summaryOfChanges ?? '',
    ).trim();
    const preservedFacts = (row as { preservedFacts?: unknown }).preservedFacts === true;
    if (!text) errors.push('VARIANT_EMPTY');
    if (text.length > CONTENT_LIMITS.MAX_VARIANT_CHARS) errors.push('VARIANT_TOO_LONG');
    if (!preservedFacts) errors.push('FACTS_NOT_PRESERVED');
    const h = hashNormalizedContent(text);
    if (h === baseHash) errors.push('VARIANT_IDENTICAL_TO_BASE');
    if (seen.has(h)) errors.push('VARIANT_DUPLICATE');
    seen.add(h);
    for (const key of extractContentVariableKeys(text)) {
      if (!isAllowedContentVariable(key)) errors.push(`UNKNOWN_VAR:${key}`);
    }
    out.push({ text, summaryOfChanges, preservedFacts });
  }
  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };
  return { ok: true, variants: out };
}
