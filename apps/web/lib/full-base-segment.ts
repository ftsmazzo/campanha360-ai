import {
  createSegment,
  type SegmentFilters,
  type SegmentItem,
} from './api';

/** Segmento implicito do tronco: toda a base elegivel (sem filtros). */
export const FULL_BASE_SEGMENT_NAME = 'Base completa';

const FULL_BASE_FILTERS: SegmentFilters = {
  tagIds: [],
  includeOptOut: false,
};

export function isFullBaseSegment(segment: SegmentItem): boolean {
  const filters = segment.filters ?? {};
  const tagIds = filters.tagIds ?? [];
  return (
    tagIds.length === 0 &&
    !filters.status &&
    !filters.channel &&
    filters.includeOptOut !== true
  );
}

export function findFullBaseSegment(
  segments: SegmentItem[],
): SegmentItem | null {
  const byName = segments.find(
    (segment) =>
      segment.name.trim().toLowerCase() === FULL_BASE_SEGMENT_NAME.toLowerCase(),
  );
  if (byName) return byName;
  return segments.find(isFullBaseSegment) ?? null;
}

/** Garante um segmento "Base completa" para o fluxo tronco (sem pedir Segmentos). */
export async function ensureFullBaseSegment(
  token: string,
  campaignId: string,
  segments: SegmentItem[],
): Promise<{ segment: SegmentItem; segments: SegmentItem[] }> {
  const existing = findFullBaseSegment(segments);
  if (existing) {
    return { segment: existing, segments };
  }

  const created = await createSegment(token, campaignId, {
    name: FULL_BASE_SEGMENT_NAME,
    description:
      'Publico padrao do primeiro envio: toda a base elegivel (sem opt-out).',
    filters: FULL_BASE_FILTERS,
  });

  return {
    segment: created,
    segments: [...segments, created],
  };
}

export function countActiveGenerationSets(
  variants: Array<{
    enabled: boolean;
    reviewPending?: boolean;
    generationSetId?: string | null;
  }>,
): number {
  const ids = new Set<string>();
  for (const variant of variants) {
    if (!variant.enabled || variant.reviewPending) continue;
    const setId = variant.generationSetId?.trim();
    if (setId) ids.add(setId);
  }
  return ids.size;
}
