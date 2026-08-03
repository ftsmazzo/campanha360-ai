/**
 * Sanitizacao central de logs/audit — nunca expor API key, tokens, QR ou PII completa.
 */

const API_KEY_PATTERNS = [
  /apikey[=:\s]+[^\s&"'\\]+/gi,
  /api[_-]?key[=:\s]+[^\s&"'\\]+/gi,
  /authorization[=:\s]+bearer\s+[^\s&"'\\]+/gi,
  /authorization[=:\s]+[^\s&"'\\]+/gi,
  /"apikey"\s*:\s*"[^"]*"/gi,
  /"apiKey"\s*:\s*"[^"]*"/gi,
  /"authorization"\s*:\s*"[^"]*"/gi,
  /jwt_key[=:\s]+[^\s&"'\\]+/gi,
  /"jwt_key"\s*:\s*"[^"]*"/gi,
];

const QR_PATTERNS = [
  /data:image\/[a-zA-Z+]+;base64,[A-Za-z0-9+/=\r\n]+/gi,
  /"base64"\s*:\s*"[^"]{64,}"/gi,
  /"qrcode"\s*:\s*"[^"]{64,}"/gi,
];

const PHONE_LIKE = /\+?\d[\d\s().-]{8,}\d/g;
const JID_LIKE = /[0-9]+@[a-z0-9.-]+/gi;

export function sanitizeLogText(
  input: string | null | undefined,
  options?: { maxLength?: number },
): string {
  if (input == null) return '';
  let text = String(input);
  for (const pattern of API_KEY_PATTERNS) {
    text = text.replace(pattern, '[redacted-secret]');
  }
  for (const pattern of QR_PATTERNS) {
    text = text.replace(pattern, '[redacted-qr]');
  }
  text = text.replace(JID_LIKE, '[redacted-jid]');
  text = text.replace(PHONE_LIKE, '[redacted-phone]');
  text = text.replace(/profilePictureUrl["'\s:=]+[^\s"',}]+/gi, 'profilePictureUrl=[redacted]');
  const max = options?.maxLength ?? 500;
  if (text.length > max) text = `${text.slice(0, max - 3)}...`;
  return text;
}

export function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (value == null) return value;
  if (typeof value === 'string') return sanitizeLogText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 40).map((item) => sanitizeLogValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      if (
        lower.includes('apikey') ||
        lower.includes('api_key') ||
        lower === 'authorization' ||
        lower === 'jwt_key' ||
        lower === 'token' ||
        lower === 'secret'
      ) {
        out[key] = '[redacted-secret]';
        continue;
      }
      if (
        lower.includes('base64') ||
        lower === 'qrcode' ||
        lower === 'qr' ||
        lower === 'qrcodebase64'
      ) {
        out[key] = '[redacted-qr]';
        continue;
      }
      if (
        lower.includes('phone') ||
        lower.includes('jid') ||
        lower === 'number' ||
        lower === 'owner' ||
        lower === 'ownerjid' ||
        lower === 'profilepictureurl'
      ) {
        out[key] = '[redacted-pii]';
        continue;
      }
      out[key] = sanitizeLogValue(child, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function assertNoSecretsInText(text: string): boolean {
  if (/apikey[=:\s]+\S+/i.test(text) && !/\[redacted-secret\]/i.test(text)) {
    return false;
  }
  if (/data:image\/[^;]+;base64,[A-Za-z0-9+/=]{80,}/i.test(text)) {
    return false;
  }
  return true;
}
