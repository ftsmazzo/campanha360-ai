/**
 * Normalizacao unica de JID WhatsApp / destino numerico.
 * Impede sufixo duplicado `@s.whatsapp.net@s.whatsapp.net` (visto em logs Evolution).
 */

export type NormalizedWhatsAppJid = {
  ok: true;
  kind: 'PN' | 'LID' | 'DIGITS';
  /** Digitos do usuario (sem device suffix), quando aplicavel. */
  user: string;
  /** JID canonico ou digitos puros. */
  value: string;
};

export type NormalizedWhatsAppJidFailure = {
  ok: false;
  reason: 'EMPTY' | 'INVALID';
};

const PN_DOMAIN = 's.whatsapp.net';
const LID_DOMAIN = 'lid';

export function normalizeWhatsAppJid(
  input: string | null | undefined,
): NormalizedWhatsAppJid | NormalizedWhatsAppJidFailure {
  if (input == null) return { ok: false, reason: 'EMPTY' };
  let raw = String(input).trim().replace(/\s+/g, '');
  if (!raw) return { ok: false, reason: 'EMPTY' };

  // Colapsa dominios PN duplicados: user@s.whatsapp.net@s.whatsapp.net
  const duplicatedPn = new RegExp(
    `^(.+@${PN_DOMAIN.replace(/\./g, '\\.')})(?:@${PN_DOMAIN.replace(/\./g, '\\.')})+$`,
    'i',
  );
  const dupMatch = raw.match(duplicatedPn);
  if (dupMatch?.[1]) {
    raw = dupMatch[1];
  }

  const atCount = (raw.match(/@/g) ?? []).length;

  if (atCount === 0) {
    const digits = raw.replace(/\D/g, '');
    if (!digits || digits.length < 8) return { ok: false, reason: 'INVALID' };
    return { ok: true, kind: 'DIGITS', user: digits, value: digits };
  }

  const lastAt = raw.lastIndexOf('@');
  let userPart = raw.slice(0, lastAt);
  const domainPart = raw.slice(lastAt + 1).toLowerCase();

  // Se ainda houver @ no user (ex.: a@b@s.whatsapp.net malformado), fica com o ultimo dominio.
  if (userPart.includes('@')) {
    const innerLast = userPart.lastIndexOf('@');
    const maybeDomain = userPart.slice(innerLast + 1).toLowerCase();
    if (maybeDomain === PN_DOMAIN || maybeDomain === LID_DOMAIN) {
      userPart = userPart.slice(0, innerLast);
    }
  }

  // Device suffix: 5511...:12
  const userBase = (userPart.split(':')[0] ?? '').trim();
  if (!userBase) return { ok: false, reason: 'INVALID' };

  if (domainPart === LID_DOMAIN || domainPart.endsWith(`.${LID_DOMAIN}`)) {
    // Nao converter @lid em @s.whatsapp.net sem mapeamento comprovado.
    return {
      ok: true,
      kind: 'LID',
      user: userBase,
      value: `${userBase}@${LID_DOMAIN}`,
    };
  }

  if (
    domainPart === PN_DOMAIN ||
    domainPart === 'c.us' ||
    domainPart.endsWith(`.${PN_DOMAIN}`)
  ) {
    const digits = userBase.replace(/\D/g, '');
    if (!digits) return { ok: false, reason: 'INVALID' };
    return {
      ok: true,
      kind: 'PN',
      user: digits,
      value: `${digits}@${PN_DOMAIN}`,
    };
  }

  return { ok: false, reason: 'INVALID' };
}

/** Digitos E.164-like para envio Evolution (nunca duplica dominio). */
export function toEvolutionSendNumber(
  input: string | null | undefined,
): string | null {
  const n = normalizeWhatsAppJid(input);
  if (!n.ok) return null;
  if (n.kind === 'LID') return null; // sem mapeamento comprovado
  return n.user;
}
