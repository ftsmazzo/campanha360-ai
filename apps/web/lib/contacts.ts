export const CONTACT_STATUSES = [
  { value: 'ACTIVE', label: 'Ativo' },
  { value: 'INVALID', label: 'Invalido' },
  { value: 'DUPLICATE', label: 'Duplicado' },
  { value: 'BLOCKED', label: 'Bloqueado' },
  { value: 'DELETED', label: 'Excluido' },
] as const;

export const CONSENT_STATUSES = [
  { value: 'UNKNOWN', label: 'Desconhecido' },
  { value: 'GRANTED', label: 'Concedido' },
  { value: 'REVOKED', label: 'Revogado' },
  { value: 'OPT_OUT', label: 'Opt-out' },
] as const;

export const CONTACT_CHANNELS = [
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'EMAIL', label: 'E-mail' },
] as const;

export function getContactStatusLabel(status: string) {
  return CONTACT_STATUSES.find((item) => item.value === status)?.label ?? status;
}

export function getConsentStatusLabel(status: string) {
  return CONSENT_STATUSES.find((item) => item.value === status)?.label ?? status;
}

export function getChannelLabel(channel: string) {
  return CONTACT_CHANNELS.find((item) => item.value === channel)?.label ?? channel;
}

export function hasOptOut(contact: {
  status: string;
  optOuts: Array<{ id: string }>;
  consents: Array<{ status: string }>;
}) {
  return (
    contact.status === 'BLOCKED' ||
    contact.optOuts.length > 0 ||
    contact.consents.some((consent) => consent.status === 'OPT_OUT')
  );
}
