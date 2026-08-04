import { BadRequestException } from '@nestjs/common';
import {
  ContentVariantSource,
  ContentVariantType,
} from '@prisma/client';
import {
  CONTENT_LIMITS,
  CONTENT_VARIABLE_CATALOG,
  computeCompositionSnapshotHash,
  extractContentVariableKeys,
  isAllowedContentVariable,
  type ContentCompositionSnapshotV1,
  type ContentVariableKey,
} from '@campanha360/shared';

export function parseFallbacks(
  value: unknown,
): Partial<Record<ContentVariableKey, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Partial<Record<ContentVariableKey, string>> = {};
  for (const item of CONTENT_VARIABLE_CATALOG) {
    const raw = (value as Record<string, unknown>)[item.key];
    if (typeof raw === 'string' && raw.trim()) {
      out[item.key] = raw.trim().slice(0, 80);
    }
  }
  return out;
}

export function validateVariantText(
  text: string,
  type: ContentVariantType | string,
): void {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new BadRequestException(`Texto de ${type} nao pode ser vazio`);
  }
  if (trimmed.length > CONTENT_LIMITS.MAX_VARIANT_CHARS) {
    throw new BadRequestException(
      `Texto de ${type} excede ${CONTENT_LIMITS.MAX_VARIANT_CHARS} caracteres`,
    );
  }
  const keys = extractContentVariableKeys(trimmed);
  for (const key of keys) {
    if (!isAllowedContentVariable(key)) {
      throw new BadRequestException(`Variavel nao permitida: {{${key}}}`);
    }
  }
  if (keys.length > CONTENT_LIMITS.MAX_VARIABLES_PER_VARIANT) {
    throw new BadRequestException('Demasiadas variaveis na variante');
  }
}

export function assertActiveVariantLimits(
  type: ContentVariantType | string,
  activeCount: number,
): void {
  const max =
    type === ContentVariantType.BODY || type === 'BODY'
      ? CONTENT_LIMITS.MAX_BODY_ACTIVE
      : type === ContentVariantType.GREETING || type === 'GREETING'
        ? CONTENT_LIMITS.MAX_GREETING_ACTIVE
        : CONTENT_LIMITS.MAX_CLOSING_ACTIVE;
  if (activeCount > max) {
    throw new BadRequestException(
      `Limite de ${max} variantes ativas de ${type} excedido`,
    );
  }
}

export function buildCompositionSnapshotFromRows(input: {
  composition: {
    id: string;
    name: string;
    version: number;
    blockSeparator: string;
    fallbacks: Partial<Record<ContentVariableKey, string>>;
  };
  variants: Array<{
    id: string;
    type: ContentVariantType | string;
    source: ContentVariantSource | string;
    text: string;
    normalizedTextHash: string;
    enabled: boolean;
    order: number;
    requiresVariables: string[];
  }>;
  approvedAt: Date;
  approvedByUserId: string;
}): ContentCompositionSnapshotV1 {
  const withoutHash = {
    schemaVersion: 1 as const,
    compositionId: input.composition.id,
    compositionVersion: input.composition.version,
    name: input.composition.name,
    blockSeparator:
      input.composition.blockSeparator || CONTENT_LIMITS.BLOCK_SEPARATOR_DEFAULT,
    selectionAlgorithmVersion: CONTENT_LIMITS.SELECTION_ALGORITHM_VERSION,
    approvedAt: input.approvedAt.toISOString(),
    approvedByUserId: input.approvedByUserId,
    allowedVariables: CONTENT_VARIABLE_CATALOG.map((v) => v.key),
    fallbacks: input.composition.fallbacks,
    variants: input.variants.map((v) => ({
      id: v.id,
      type: v.type as ContentCompositionSnapshotV1['variants'][number]['type'],
      source: v.source as ContentCompositionSnapshotV1['variants'][number]['source'],
      text: v.text,
      normalizedTextHash: v.normalizedTextHash,
      enabled: v.enabled,
      order: v.order,
      requiresVariables: v.requiresVariables.filter(isAllowedContentVariable),
    })),
  };
  return {
    ...withoutHash,
    compositionSnapshotHash: computeCompositionSnapshotHash(withoutHash),
  };
}

export function extractCompositionFromApproval(
  approvalSnapshot: unknown,
): ContentCompositionSnapshotV1 | null {
  const snap = approvalSnapshot as {
    content?: { composition?: ContentCompositionSnapshotV1 | null };
  } | null;
  const composition = snap?.content?.composition;
  if (!composition || typeof composition !== 'object') return null;
  if (composition.schemaVersion !== 1) return null;
  if (!composition.compositionSnapshotHash) return null;
  return composition;
}
