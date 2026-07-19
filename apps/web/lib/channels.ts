export const CHANNEL_PROVIDERS = [
  { value: 'WHATSAPP_EVOLUTION', label: 'WhatsApp (Evolution)', available: true },
  { value: 'WHATSAPP_CLOUD_API', label: 'WhatsApp Cloud API', available: false },
  { value: 'EMAIL', label: 'E-mail', available: false },
  { value: 'SMS', label: 'SMS', available: false },
  { value: 'TELEGRAM', label: 'Telegram', available: false },
  { value: 'INSTAGRAM', label: 'Instagram', available: false },
] as const;

export const CHANNEL_ACCOUNT_STATUSES = [
  { value: 'DISCONNECTED', label: 'Desconectado' },
  { value: 'CONNECTING', label: 'Conectando' },
  { value: 'CONNECTED', label: 'Conectado' },
  { value: 'ERROR', label: 'Erro' },
  { value: 'ARCHIVED', label: 'Arquivado' },
] as const;

export function getChannelProviderLabel(provider: string) {
  return CHANNEL_PROVIDERS.find((item) => item.value === provider)?.label ?? provider;
}

export function getChannelAccountStatusLabel(status: string) {
  return CHANNEL_ACCOUNT_STATUSES.find((item) => item.value === status)?.label ?? status;
}

export function getActiveWhatsappEvolutionAccount<
  T extends { provider: string; status: string },
>(accounts: T[]): T | null {
  return (
    accounts.find(
      (account) =>
        account.provider === 'WHATSAPP_EVOLUTION' && account.status !== 'ARCHIVED',
    ) ?? null
  );
}

export function listVisibleWhatsappEvolutionAccounts<
  T extends { provider: string; status: string; name: string },
>(accounts: T[]): T[] {
  return accounts
    .filter(
      (account) =>
        account.provider === 'WHATSAPP_EVOLUTION' && account.status !== 'ARCHIVED',
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function toQrCodeImageSrc(base64: string) {
  const trimmed = base64.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('data:')) return trimmed;
  return `data:image/png;base64,${trimmed}`;
}

export function configToText(value: Record<string, unknown> | null) {
  if (!value) return '';
  return JSON.stringify(value, null, 2);
}

export function parseConfig(value: string) {
  if (!value.trim()) return undefined;
  return JSON.parse(value) as Record<string, unknown>;
}

export function getApiPublicBaseUrl() {
  const raw =
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.API_PUBLIC_URL ||
    'http://localhost:3001';
  return raw.trim().replace(/\/+$/, '');
}

export function buildEvolutionWebhookUrl(channelAccountId: string) {
  return `${getApiPublicBaseUrl()}/webhooks/evolution/${channelAccountId}`;
}
