import { ContactStatus } from '@prisma/client';
import { isValidPhone, normalizePhone } from '../common/phone.util';
import { normalizeTagName } from './contact-tag.util';

export type ParsedCsvRow = {
  lineNumber: number;
  nome: string;
  telefone: string;
  observacao: string;
  tagsRaw: string;
};

export type ValidatedImportRow = {
  lineNumber: number;
  name: string | null;
  phone: string;
  note: string | null;
  tagNames: string[];
};

export type ImportRowError = {
  lineNumber: number;
  reason: string;
};

export type ImportParseResult = {
  rows: ValidatedImportRow[];
  errors: ImportRowError[];
  ignored: number;
};

const HEADER_ALIASES = {
  nome: ['nome', 'name'],
  telefone: ['telefone', 'phone', 'phonenumber', 'celular', 'whatsapp'],
  observacao: ['observacao', 'observação', 'obs', 'nota', 'note', 'notes'],
  tags: ['tags', 'tag'],
} as const;

export function normalizeImportHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function parseTagNames(value: string): string[] {
  if (!value.trim()) return [];

  const parts = value
    .split(/[;|]/)
    .map((part) => normalizeTagName(part))
    .filter(Boolean);

  return [...new Set(parts)];
}

/** Importacao nunca desbloqueia contato. */
export function shouldPreserveBlockedStatus(status: ContactStatus | string): boolean {
  return status === ContactStatus.BLOCKED || status === 'BLOCKED';
}

export function resolveImportNameUpdate(
  incomingName: string | null,
  existingName: string | null,
): string | null | undefined {
  if (incomingName === null) return undefined;
  if (!incomingName.trim()) return undefined;
  return incomingName.trim();
}

export function parseCsvRecords(csvText: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    current.push(field);
    field = '';
  };

  const pushRow = () => {
    // Ignora linhas totalmente vazias.
    if (current.some((cell) => cell.trim() !== '')) {
      rows.push(current);
    }
    current = [];
  };

  const text = csvText.replace(/^\uFEFF/, '');

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      pushField();
      continue;
    }

    if (char === '\n') {
      pushField();
      pushRow();
      continue;
    }

    if (char === '\r') {
      continue;
    }

    field += char;
  }

  pushField();
  if (current.length > 1 || current[0]?.trim()) {
    pushRow();
  }

  return rows;
}

function resolveColumnIndex(headers: string[], aliases: readonly string[]): number {
  const normalized = headers.map(normalizeImportHeader);
  return normalized.findIndex((header) => aliases.includes(header));
}

export function parseAndValidateImportCsv(csvText: string): ImportParseResult {
  const records = parseCsvRecords(csvText);
  if (records.length === 0) {
    return {
      rows: [],
      errors: [{ lineNumber: 1, reason: 'CSV vazio' }],
      ignored: 0,
    };
  }

  const headers = records[0];
  const nomeIdx = resolveColumnIndex(headers, HEADER_ALIASES.nome);
  const telefoneIdx = resolveColumnIndex(headers, HEADER_ALIASES.telefone);
  const observacaoIdx = resolveColumnIndex(headers, HEADER_ALIASES.observacao);
  const tagsIdx = resolveColumnIndex(headers, HEADER_ALIASES.tags);

  if (telefoneIdx < 0) {
    return {
      rows: [],
      errors: [{ lineNumber: 1, reason: 'Coluna telefone obrigatoria ausente' }],
      ignored: 0,
    };
  }

  const rows: ValidatedImportRow[] = [];
  const errors: ImportRowError[] = [];
  let ignored = 0;

  for (let i = 1; i < records.length; i += 1) {
    const record = records[i];
    const lineNumber = i + 1;
    const nome = nomeIdx >= 0 ? (record[nomeIdx] ?? '').trim() : '';
    const telefone = (record[telefoneIdx] ?? '').trim();
    const observacao = observacaoIdx >= 0 ? (record[observacaoIdx] ?? '').trim() : '';
    const tagsRaw = tagsIdx >= 0 ? (record[tagsIdx] ?? '').trim() : '';

    if (!telefone && !nome && !observacao && !tagsRaw) {
      ignored += 1;
      continue;
    }

    if (!telefone) {
      errors.push({ lineNumber, reason: 'Telefone obrigatorio' });
      continue;
    }

    if (!isValidPhone(telefone)) {
      errors.push({ lineNumber, reason: 'Telefone invalido' });
      continue;
    }

    rows.push({
      lineNumber,
      name: nome || null,
      phone: normalizePhone(telefone),
      note: observacao || null,
      tagNames: parseTagNames(tagsRaw),
    });
  }

  return { rows, errors, ignored };
}

export function buildImportAuditMetadata(summary: {
  created: number;
  updated: number;
  ignored: number;
  errors: number;
  totalRows: number;
}) {
  return {
    source: 'csv',
    created: summary.created,
    updated: summary.updated,
    ignored: summary.ignored,
    errors: summary.errors,
    totalRows: summary.totalRows,
  };
}
