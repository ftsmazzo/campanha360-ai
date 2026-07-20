import { ChannelType, ConsentStatus, ContactStatus, Prisma } from '@prisma/client';
import { isValidPhone, normalizePhone } from '../common/phone.util';
import {
  NormalizedSegmentFilters,
  SegmentFilterInput,
  normalizeSegmentFilters,
} from './segment-filters.util';

/** Limite provisório de volume para alerta (sem disparo). */
export const PROVISIONAL_DISPATCH_SOFT_LIMIT = 500;

export type PrevalidateContactInput = {
  id: string;
  status: ContactStatus | string;
  phoneNumber: string | null;
  optOutCount?: number;
  hasOptOutConsent?: boolean;
  channels?: Array<{ channel: ChannelType | string; status?: string | null }>;
};

export type SegmentPrevalidateAlert = {
  code:
    | 'NO_WHATSAPP_CHANNEL'
    | 'EMPTY_AUDIENCE'
    | 'HAS_OPT_OUT'
    | 'HAS_INVALID_PHONE'
    | 'HAS_DUPLICATES'
    | 'HAS_NO_COMPATIBLE_CHANNEL'
    | 'VOLUME_ABOVE_SOFT_LIMIT'
    | 'HAS_DELETED';
  severity: 'info' | 'warning' | 'critical';
  message: string;
};

export type SegmentPrevalidateSummary = {
  totalGross: number;
  eligible: number;
  optOutOrBlocked: number;
  deleted: number;
  invalidPhone: number;
  duplicatePhone: number;
  missingCompatibleChannel: number;
  softLimit: number;
  whatsappChannelConnected: boolean;
  alerts: SegmentPrevalidateAlert[];
  canDispatch: false;
};

/** Criterios estruturais do segmento sem excluir DELETED/opt-out (para analise bruta). */
export function buildSegmentStructuralWhere(
  organizationId: string,
  campaignId: string,
  filters: NormalizedSegmentFilters,
): Prisma.ContactWhereInput {
  const and: Prisma.ContactWhereInput[] = [
    { organizationId },
    { campaignId },
  ];

  if (filters.status) {
    and.push({ status: filters.status });
  }

  if (filters.tagIds.length === 1) {
    and.push({ tags: { some: { tagId: filters.tagIds[0] } } });
  } else if (filters.tagIds.length > 1) {
    and.push({ tags: { some: { tagId: { in: filters.tagIds } } } });
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

function isOptOutOrBlocked(contact: PrevalidateContactInput): boolean {
  if (contact.status === ContactStatus.BLOCKED || contact.status === 'BLOCKED') {
    return true;
  }
  if ((contact.optOutCount ?? 0) > 0) return true;
  if (contact.hasOptOutConsent) return true;
  return false;
}

function hasCompatibleChannel(
  contact: PrevalidateContactInput,
  requiredChannel: ChannelType | null,
): boolean {
  const channels = contact.channels ?? [];
  if (requiredChannel) {
    return channels.some(
      (channel) =>
        channel.channel === requiredChannel &&
        (channel.status == null || channel.status === 'ACTIVE'),
    );
  }
  return channels.some(
    (channel) =>
      channel.channel === ChannelType.WHATSAPP &&
      (channel.status == null || channel.status === 'ACTIVE'),
  );
}

export function analyzeSegmentDispatchReadiness(input: {
  contacts: PrevalidateContactInput[];
  filters: NormalizedSegmentFilters | SegmentFilterInput;
  whatsappChannelConnected: boolean;
  softLimit?: number;
}): SegmentPrevalidateSummary {
  const filters = normalizeSegmentFilters(input.filters);
  const softLimit = input.softLimit ?? PROVISIONAL_DISPATCH_SOFT_LIMIT;
  const requiredChannel = filters.channel;

  let optOutOrBlocked = 0;
  let deleted = 0;
  let invalidPhone = 0;
  let missingCompatibleChannel = 0;
  let duplicatePhone = 0;
  let eligible = 0;

  const phoneFirstSeen = new Map<string, string>();

  for (const contact of input.contacts) {
    if (contact.status === ContactStatus.DELETED || contact.status === 'DELETED') {
      deleted += 1;
      continue;
    }

    if (isOptOutOrBlocked(contact)) {
      optOutOrBlocked += 1;
      // Opt-out nunca entra em elegiveis, mesmo com includeOptOut no segmento.
      continue;
    }

    const phone = contact.phoneNumber?.trim() || '';
    if (!phone || !isValidPhone(phone)) {
      invalidPhone += 1;
      continue;
    }

    const normalized = normalizePhone(phone);
    if (phoneFirstSeen.has(normalized)) {
      duplicatePhone += 1;
      continue;
    }
    phoneFirstSeen.set(normalized, contact.id);

    if (!hasCompatibleChannel(contact, requiredChannel)) {
      missingCompatibleChannel += 1;
      continue;
    }

    eligible += 1;
  }

  const alerts: SegmentPrevalidateAlert[] = [];

  if (!input.whatsappChannelConnected) {
    alerts.push({
      code: 'NO_WHATSAPP_CHANNEL',
      severity: 'critical',
      message: 'Nenhum canal WhatsApp conectado nesta campanha.',
    });
  }

  if (eligible === 0) {
    alerts.push({
      code: 'EMPTY_AUDIENCE',
      severity: 'critical',
      message: 'Publico elegivel vazio para disparo.',
    });
  }

  if (optOutOrBlocked > 0) {
    alerts.push({
      code: 'HAS_OPT_OUT',
      severity: 'warning',
      message: `${optOutOrBlocked} contato(s) com opt-out/BLOCKED foram excluidos dos elegiveis.`,
    });
  }

  if (deleted > 0) {
    alerts.push({
      code: 'HAS_DELETED',
      severity: 'info',
      message: `${deleted} contato(s) removidos (DELETED) foram excluidos.`,
    });
  }

  if (invalidPhone > 0) {
    alerts.push({
      code: 'HAS_INVALID_PHONE',
      severity: 'warning',
      message: `${invalidPhone} contato(s) sem telefone valido.`,
    });
  }

  if (duplicatePhone > 0) {
    alerts.push({
      code: 'HAS_DUPLICATES',
      severity: 'warning',
      message: `${duplicatePhone} telefone(s) duplicado(s) no publico.`,
    });
  }

  if (missingCompatibleChannel > 0) {
    alerts.push({
      code: 'HAS_NO_COMPATIBLE_CHANNEL',
      severity: 'warning',
      message: `${missingCompatibleChannel} contato(s) sem canal/origem compativel.`,
    });
  }

  if (eligible > softLimit) {
    alerts.push({
      code: 'VOLUME_ABOVE_SOFT_LIMIT',
      severity: 'warning',
      message: `Volume elegivel (${eligible}) acima o limite provisório de ${softLimit}.`,
    });
  }

  return {
    totalGross: input.contacts.length,
    eligible,
    optOutOrBlocked,
    deleted,
    invalidPhone,
    duplicatePhone,
    missingCompatibleChannel,
    softLimit,
    whatsappChannelConnected: input.whatsappChannelConnected,
    alerts,
    canDispatch: false,
  };
}

export function consentHasOptOut(
  consents: Array<{ status: ConsentStatus | string }>,
): boolean {
  return consents.some(
    (consent) =>
      consent.status === ConsentStatus.OPT_OUT || consent.status === 'OPT_OUT',
  );
}
