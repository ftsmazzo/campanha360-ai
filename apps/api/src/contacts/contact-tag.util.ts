import {
  ConsentStatus,
  ContactOperationalStatus,
  ContactStatus,
  Prisma,
} from '@prisma/client';
import { buildDefaultContactStatusFilter } from './contact-removal.util';

export function normalizeTagName(name: string): string {
  return name.trim();
}

export function resolveApplyContactTag(
  alreadyLinked: boolean,
): 'created' | 'unchanged' {
  return alreadyLinked ? 'unchanged' : 'created';
}

export function resolveRemoveContactTag(
  alreadyLinked: boolean,
): 'removed' | 'unchanged' {
  return alreadyLinked ? 'removed' : 'unchanged';
}

export function buildTagAssociationFilter(tagId: string): Prisma.ContactWhereInput {
  return {
    tags: {
      some: { tagId },
    },
  };
}

export type ContactListFilterParts = {
  organizationId: string;
  campaignId: string;
  q?: string;
  tagId?: string;
  status?: ContactStatus;
  operationalStatus?: ContactOperationalStatus;
  assignedToUserId?: string;
  hasOptOut?: boolean;
};

/** Monta clausulas AND da listagem, incluindo busca + filtro por tag juntos. */
export function buildContactListAndClauses(
  parts: ContactListFilterParts,
): Prisma.ContactWhereInput[] {
  const and: Prisma.ContactWhereInput[] = [
    { organizationId: parts.organizationId },
    { campaignId: parts.campaignId },
  ];

  const search = parts.q?.trim();
  if (search) {
    and.push({
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { phoneNumber: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
        { neighborhood: { contains: search, mode: 'insensitive' } },
      ],
    });
  }

  if (parts.status) {
    and.push({ status: parts.status });
  } else {
    and.push(buildDefaultContactStatusFilter(undefined));
  }

  if (parts.operationalStatus) {
    and.push({ operationalStatus: parts.operationalStatus });
  }

  if (parts.assignedToUserId) {
    and.push({ assignedToUserId: parts.assignedToUserId });
  }

  if (parts.tagId) {
    and.push(buildTagAssociationFilter(parts.tagId));
  }

  if (parts.hasOptOut === true) {
    and.push({
      OR: [
        { status: ContactStatus.BLOCKED },
        { optOuts: { some: {} } },
        { consents: { some: { status: ConsentStatus.OPT_OUT } } },
      ],
    });
  } else if (parts.hasOptOut === false) {
    and.push({
      AND: [
        { status: { not: ContactStatus.BLOCKED } },
        { optOuts: { none: {} } },
        { consents: { none: { status: ConsentStatus.OPT_OUT } } },
      ],
    });
  }

  return and;
}
