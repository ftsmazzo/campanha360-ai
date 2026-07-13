import { normalizePhone } from '../common/phone.util';

export type NormalizedEvolutionInbound = {
  event: string | null;
  externalMessageId: string | null;
  phone: string | null;
  remoteJid: string | null;
  body: string | null;
  pushName: string | null;
  occurredAt: Date | null;
  fromMe: boolean;
  isInboundMessage: boolean;
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function asString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function extractTimestamp(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === 'string' && value.trim()) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      return extractTimestamp(asNumber);
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function extractPhoneFromJid(jid: string | null): string | null {
  if (!jid) return null;
  const base = jid.split('@')[0] ?? '';
  const withoutDevice = base.split(':')[0] ?? '';
  const digits = normalizePhone(withoutDevice);
  return digits || null;
}

function extractMessageBody(message: JsonRecord | null): string | null {
  if (!message) return null;

  return (
    asString(message.conversation) ??
    asString(asRecord(message.extendedTextMessage)?.text) ??
    asString(asRecord(message.imageMessage)?.caption) ??
    asString(asRecord(message.videoMessage)?.caption) ??
    asString(asRecord(message.documentMessage)?.caption) ??
    asString(asRecord(message.buttonsResponseMessage)?.selectedDisplayText) ??
    asString(asRecord(message.listResponseMessage)?.title) ??
    null
  );
}

function collectMessageItems(payload: unknown): JsonRecord[] {
  const root = asRecord(payload);
  if (!root) return [];

  const data = root.data;
  if (Array.isArray(data)) {
    return data.map(asRecord).filter((item): item is JsonRecord => Boolean(item));
  }

  const dataRecord = asRecord(data);
  if (!dataRecord) return [];

  if (Array.isArray(dataRecord.messages)) {
    return dataRecord.messages
      .map(asRecord)
      .filter((item): item is JsonRecord => Boolean(item));
  }

  return [dataRecord];
}

function isMessageEvent(event: string | null): boolean {
  if (!event) return true;
  const normalized = event.toLowerCase().replace(/_/g, '.');
  return (
    normalized.includes('messages.upsert') ||
    normalized.includes('message.upsert')
  );
}

export function normalizeEvolutionWebhookPayload(
  payload: unknown,
): NormalizedEvolutionInbound[] {
  const root = asRecord(payload);
  const event = asString(root?.event) ?? asString(root?.type);
  const items = collectMessageItems(payload);

  if (!isMessageEvent(event) && items.length === 0) {
    return [
      {
        event,
        externalMessageId: null,
        phone: null,
        remoteJid: null,
        body: null,
        pushName: null,
        occurredAt: null,
        fromMe: false,
        isInboundMessage: false,
      },
    ];
  }

  if (items.length === 0) {
    return [
      {
        event,
        externalMessageId: null,
        phone: null,
        remoteJid: null,
        body: null,
        pushName: null,
        occurredAt: null,
        fromMe: false,
        isInboundMessage: false,
      },
    ];
  }

  return items.map((item) => {
    const key = asRecord(item.key);
    const message = asRecord(item.message);
    const remoteJid =
      asString(key?.remoteJid) ??
      asString(item.remoteJid) ??
      asString(item.chatId);
    const fromMe = asBoolean(key?.fromMe) || asBoolean(item.fromMe);
    const externalMessageId =
      asString(key?.id) ??
      asString(item.id) ??
      asString(item.messageId) ??
      null;
    const phone =
      extractPhoneFromJid(remoteJid) ??
      (asString(item.sender) ? normalizePhone(asString(item.sender)!) || null : null);
    const body = extractMessageBody(message) ?? asString(item.text) ?? asString(item.body);
    const occurredAt =
      extractTimestamp(item.messageTimestamp) ??
      extractTimestamp(item.timestamp) ??
      extractTimestamp(root?.date_time) ??
      null;

    return {
      event,
      externalMessageId,
      phone,
      remoteJid,
      body,
      pushName: asString(item.pushName) ?? asString(item.notifyName),
      occurredAt,
      fromMe,
      isInboundMessage: !fromMe && Boolean(phone || body || externalMessageId),
    };
  });
}
