import {
  ChannelType,
  ConsentStatus,
  ContactStatus,
  Prisma,
} from '@prisma/client';
import { buildDefaultContactStatusFilter } from '../contacts/contact-removal.util';

export type SegmentFilterInput = {
  tagIds?: string[];
  status?: ContactStatus | string | null;
  /** Quando true, inclui BLOCKED/opt-out. Padrao: false (exclui). */
  includeOptOut?: boolean;
  channel?: ChannelType | string | null;
};

export type NormalizedSegmentFilters = {
  tagIds: string[];
  status: ContactStatus | null;
  includeOptOut: boolean;
  channel: ChannelType | null;
};

const CHANNEL_VALUES = new Set<string>(Object.values(ChannelType));
const STATUS_VALUES = new Set<string>(Object.values(ContactStatus));

export function normalizeSegmentFilters(
  input: SegmentFilterInput | null | undefined,
): NormalizedSegmentFilters {
  const tagIds = Array.isArray(input?.tagIds)
    ? [...new Set(input.tagIds.map((id) => id.trim()).filter(Boolean))]
    : [];

  let status: ContactStatus | null = null;
  if (input?.status && STATUS_VALUES.has(String(input.status))) {
    const candidate = input.status as ContactStatus;
    if (candidate !== ContactStatus.DELETED) {
      status = candidate;
    }
  }

  let channel: ChannelType | null = null;
  if (input?.channel && CHANNEL_VALUES.has(String(input.channel))) {
    channel = input.channel as ChannelType;
  }

  return {
    tagIds,
    status,
    includeOptOut: input?.includeOptOut === true,
    channel,
  };
}

export function buildSegmentContactWhere(
  organizationId: string,
  campaignId: string,
  filters: NormalizedSegmentFilters,
): Prisma.ContactWhereInput {
  const and: Prisma.ContactWhereInput[] = [
    { organizationId },
    { campaignId },
  ];

  // Sempre exclui DELETED, mesmo com status explicito.
  and.push(buildDefaultContactStatusFilter(undefined));

  if (filters.status) {
    and.push({ status: filters.status });
  }

  if (filters.tagIds.length === 1) {
    and.push({
      tags: { some: { tagId: filters.tagIds[0] } },
    });
  } else if (filters.tagIds.length > 1) {
    and.push({
      tags: {
        some: {
          tagId: { in: filters.tagIds },
        },
      },
    });
  }

  if (!filters.includeOptOut) {
    and.push({
      AND: [
        { status: { not: ContactStatus.BLOCKED } },
        { optOuts: { none: {} } },
        { consents: { none: { status: ConsentStatus.OPT_OUT } } },
      ],
    });
  }

  if (filters.channel) {
    and.push({
      channels: {
        some: {
          channel: filters.channel,
          status: 'ACTIVE',
        },
      },
    });
  }

  return { AND: and };
}

export function segmentRequiresOptOutWarning(filters: NormalizedSegmentFilters): boolean {
  return filters.includeOptOut === true;
}
