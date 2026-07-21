import {
  ChannelType,
  ConsentStatus,
  ContactOperationalStatus,
  ContactStatus,
  DispatchPlanRecipientEligibilityStatus,
} from '@prisma/client';
import { isValidPhone, normalizePhone } from '../common/phone.util';

export const SNAPSHOT_EXCLUSION_REASONS = {
  [DispatchPlanRecipientEligibilityStatus.EXCLUDED_OPT_OUT]:
    'Contato possui opt-out para WhatsApp',
  [DispatchPlanRecipientEligibilityStatus.EXCLUDED_BLOCKED]:
    'Contato esta bloqueado',
  [DispatchPlanRecipientEligibilityStatus.EXCLUDED_DELETED]:
    'Contato foi removido',
  [DispatchPlanRecipientEligibilityStatus.EXCLUDED_INVALID_DESTINATION]:
    'Telefone ausente ou invalido',
  [DispatchPlanRecipientEligibilityStatus.EXCLUDED_DUPLICATE]:
    'Destino duplicado no snapshot',
  [DispatchPlanRecipientEligibilityStatus.EXCLUDED_NO_CHANNEL]:
    'Contato sem canal WhatsApp ativo',
  [DispatchPlanRecipientEligibilityStatus.EXCLUDED_POLICY]:
    'Contato inelegivel por politica vigente',
  [DispatchPlanRecipientEligibilityStatus.EXCLUDED_OTHER]:
    'Contato inelegivel',
} as const;

export type SnapshotContactInput = {
  id: string;
  name: string | null;
  phoneNumber: string | null;
  city: string | null;
  neighborhood: string | null;
  metadata: unknown;
  status: ContactStatus | string;
  operationalStatus: ContactOperationalStatus | string;
  assignedTo: { id: string; name: string } | null;
  channels: Array<{
    channel: ChannelType | string;
    status: string | null;
  }>;
  consents: Array<{
    channel: ChannelType | string;
    status: ConsentStatus | string;
    source: string | null;
    collectedAt: Date | null;
    revokedAt: Date | null;
  }>;
  optOuts: Array<{
    channel: ChannelType | string | null;
    reason: string | null;
    source: string | null;
    createdAt: Date;
  }>;
  tags: Array<{
    tag: {
      id: string;
      name: string;
      color: string | null;
    };
  }>;
};

export type SnapshotRecipient = {
  contactId: string;
  destination: string;
  normalizedDestination: string;
  eligibilityStatus: DispatchPlanRecipientEligibilityStatus;
  exclusionReason: string | null;
  contactSnapshot: Record<string, unknown>;
  consentSnapshot: Record<string, unknown> | null;
  optOutSnapshot: Record<string, unknown> | null;
};

function isStatus(
  value: ContactStatus | string,
  expected: ContactStatus,
): boolean {
  return value === expected || value === String(expected);
}

function isWhatsAppChannel(value: ChannelType | string | null): boolean {
  return value === ChannelType.WHATSAPP || value === 'WHATSAPP';
}

function getApplicableOptOut(contact: SnapshotContactInput) {
  return contact.optOuts.find(
    (optOut) => optOut.channel === null || isWhatsAppChannel(optOut.channel),
  );
}

function getApplicableConsentOptOut(contact: SnapshotContactInput) {
  return contact.consents.find(
    (consent) =>
      isWhatsAppChannel(consent.channel) &&
      (consent.status === ConsentStatus.OPT_OUT ||
        consent.status === 'OPT_OUT'),
  );
}

function hasActiveWhatsAppChannel(contact: SnapshotContactInput): boolean {
  return contact.channels.some(
    (channel) =>
      isWhatsAppChannel(channel.channel) &&
      (channel.status === null || channel.status === 'ACTIVE'),
  );
}

function getContactSource(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  const source = (metadata as Record<string, unknown>).lastImportSource;
  return typeof source === 'string' ? source : null;
}

function buildConsentSnapshot(contact: SnapshotContactInput) {
  const consent = contact.consents.find((item) =>
    isWhatsAppChannel(item.channel),
  );
  if (!consent) return null;

  return {
    channel: consent.channel,
    status: consent.status,
    source: consent.source,
    collectedAt: consent.collectedAt?.toISOString() ?? null,
    revokedAt: consent.revokedAt?.toISOString() ?? null,
  };
}

function buildOptOutSnapshot(contact: SnapshotContactInput) {
  const optOut = getApplicableOptOut(contact);
  const consentOptOut = getApplicableConsentOptOut(contact);
  if (!optOut && !consentOptOut) return null;

  return {
    exists: true,
    channel: optOut?.channel ?? consentOptOut?.channel ?? ChannelType.WHATSAPP,
    createdAt:
      optOut?.createdAt.toISOString() ??
      consentOptOut?.revokedAt?.toISOString() ??
      null,
    reason: optOut?.reason ?? null,
    source: optOut?.source ?? consentOptOut?.source ?? null,
  };
}

export function buildDispatchPlanSnapshotRecipients(
  contacts: SnapshotContactInput[],
): SnapshotRecipient[] {
  const seenDestinations = new Set<string>();

  return contacts.map((contact) => {
    const destination = contact.phoneNumber?.trim() ?? '';
    const normalizedDestination = destination
      ? normalizePhone(destination)
      : '';
    const optOutSnapshot = buildOptOutSnapshot(contact);
    const consentSnapshot = buildConsentSnapshot(contact);

    let eligibilityStatus: DispatchPlanRecipientEligibilityStatus =
      DispatchPlanRecipientEligibilityStatus.ELIGIBLE;
    let exclusionReason: string | null = null;

    if (isStatus(contact.status, ContactStatus.DELETED)) {
      eligibilityStatus =
        DispatchPlanRecipientEligibilityStatus.EXCLUDED_DELETED;
    } else if (optOutSnapshot) {
      eligibilityStatus =
        DispatchPlanRecipientEligibilityStatus.EXCLUDED_OPT_OUT;
    } else if (isStatus(contact.status, ContactStatus.BLOCKED)) {
      eligibilityStatus =
        DispatchPlanRecipientEligibilityStatus.EXCLUDED_BLOCKED;
    } else if (!destination || !isValidPhone(destination)) {
      eligibilityStatus =
        DispatchPlanRecipientEligibilityStatus.EXCLUDED_INVALID_DESTINATION;
    } else if (seenDestinations.has(normalizedDestination)) {
      eligibilityStatus =
        DispatchPlanRecipientEligibilityStatus.EXCLUDED_DUPLICATE;
    } else {
      // Preserva a ordem de deduplicacao usada pela pre-validacao 07.1.
      seenDestinations.add(normalizedDestination);
      if (!hasActiveWhatsAppChannel(contact)) {
        eligibilityStatus =
          DispatchPlanRecipientEligibilityStatus.EXCLUDED_NO_CHANNEL;
      }
    }

    if (
      eligibilityStatus !==
      DispatchPlanRecipientEligibilityStatus.ELIGIBLE
    ) {
      exclusionReason = SNAPSHOT_EXCLUSION_REASONS[eligibilityStatus];
    }

    return {
      contactId: contact.id,
      destination,
      normalizedDestination,
      eligibilityStatus,
      exclusionReason,
      contactSnapshot: {
        name: contact.name,
        originalPhone: contact.phoneNumber,
        normalizedPhone: normalizedDestination || null,
        city: contact.city,
        neighborhood: contact.neighborhood,
        operationalStatus: contact.operationalStatus,
        source: getContactSource(contact.metadata),
        tags: contact.tags.map(({ tag }) => ({
          id: tag.id,
          name: tag.name,
          color: tag.color,
        })),
        assignedTo: contact.assignedTo
          ? {
              id: contact.assignedTo.id,
              name: contact.assignedTo.name,
            }
          : null,
      },
      consentSnapshot,
      optOutSnapshot,
    };
  });
}

export function summarizeSnapshotRecipients(
  recipients: SnapshotRecipient[],
) {
  const byEligibilityStatus = Object.values(
    DispatchPlanRecipientEligibilityStatus,
  ).reduce<Record<string, number>>((summary, status) => {
    summary[status] = 0;
    return summary;
  }, {});

  for (const recipient of recipients) {
    byEligibilityStatus[recipient.eligibilityStatus] += 1;
  }

  const totalEligible =
    byEligibilityStatus[DispatchPlanRecipientEligibilityStatus.ELIGIBLE];

  return {
    totalEvaluated: recipients.length,
    totalEligible,
    totalExcluded: recipients.length - totalEligible,
    byEligibilityStatus,
  };
}
