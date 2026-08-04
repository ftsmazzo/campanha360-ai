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

/**
 * Divide CSV em pedacos menores para nao estourar limite de body (~100kb default).
 * Preserva o cabecalho em cada pedaco. Conta linhas de registro (respeita aspas).
 */
export function splitCsvForImport(csvText: string, maxDataRows = 400): string[] {
  const records: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const ch = csvText[i];
    current += ch;
    if (ch === '"') {
      if (inQuotes && csvText[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && csvText[i + 1] === '\n') {
        current += '\n';
        i += 1;
      }
      const line = current.replace(/\r?\n$/, '');
      if (line.trim()) records.push(line);
      current = '';
    }
  }
  if (current.trim()) records.push(current.replace(/\r?\n$/, ''));

  if (records.length <= 1) return records.length === 1 ? [records[0]] : [];

  const header = records[0];
  const dataRows = records.slice(1);
  if (dataRows.length <= maxDataRows) {
    return [`${header}\n${dataRows.join('\n')}\n`];
  }

  const chunks: string[] = [];
  for (let i = 0; i < dataRows.length; i += maxDataRows) {
    const slice = dataRows.slice(i, i + maxDataRows);
    chunks.push(`${header}\n${slice.join('\n')}\n`);
  }
  return chunks;
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

