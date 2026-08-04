/**
 * Consolida CSVs bagunçados (export Google Contatos + Excel) em CSV
 * pronto para o Campanha360: nome,telefone,tags
 *
 * Uso: node scripts/consolidar-contatos.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'contato');
const OUTPUT = path.join(ROOT, 'contatos-import-campanha360.csv');
const REPORT = path.join(ROOT, 'relatorio-consolidacao.txt');
const BATCH_SIZE = 50;

function listInputCsvs() {
  return fs
    .readdirSync(ROOT)
    .filter((name) => name.toLowerCase().endsWith('.csv'))
    .filter((name) => !name.toLowerCase().startsWith('contatos-import-'))
    .map((name) => path.join(ROOT, name));
}

function detectSourceTag(filePath) {
  const base = path.basename(filePath).toLowerCase();
  if (base.includes('joel')) return 'Joel';
  if (base.includes('glaucia') || base.includes('glauc')) return 'Glaucia';
  return 'SemOrigem';
}

function splitCsvLine(line, separator) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === separator && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells.map((c) => c.trim().replace(/^"|"$/g, '').trim());
}

function detectSeparator(headerLine) {
  const commas = (headerLine.match(/,/g) || []).length;
  const semis = (headerLine.match(/;/g) || []).length;
  const tabs = (headerLine.match(/\t/g) || []).length;
  if (tabs >= commas && tabs >= semis && tabs > 0) return '\t';
  if (semis >= commas) return ';';
  return ',';
}

function normHeader(h) {
  return h
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isScientificPhone(value) {
  return /e\+/i.test(String(value));
}

/** Aceita apenas telefones BR recuperaveis (nao notacao cientifica). */
function normalizePhone(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text || isScientificPhone(text)) return null;

  let digits = text.replace(/\D/g, '');
  if (!digits) return null;
  digits = digits.replace(/^0+/, '');

  // 0800 / curtos demais
  if (digits.length < 10 || digits.length > 13) return null;

  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    digits = `55${digits}`;
  }

  // 55 + DDD(2) + 8 ou 9 digitos
  if (!/^55[1-9]\d{9,10}$/.test(digits)) return null;

  const national = digits.slice(2);
  const local = national.slice(2);
  // Celular BR costuma ter 9 digitos comecando em 9; fixo 8 digitos
  if (local.length === 9 && !local.startsWith('9')) return null;
  if (local.length !== 8 && local.length !== 9) return null;

  return digits;
}

function cleanName(parts) {
  const joined = parts
    .filter(Boolean)
    .map((p) => String(p).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
    .trim();

  if (!joined) return '';

  // Lixo comum desses exports
  if (/^[\.\-_]+$/.test(joined)) return '';
  if (/^-?\d+$/.test(joined)) return '';
  if (/^n[aã]o repassar/i.test(joined)) return '';

  return joined
    .replace(/^\.+/, '')
    .replace(/\?+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findHeaderIndexes(headers) {
  const norms = headers.map(normHeader);
  const find = (...needles) =>
    norms.findIndex((h) => needles.some((n) => h === n || h.includes(n)));

  return {
    first: find('first name', 'nome', 'given name'),
    middle: find('middle name'),
    last: find('last name', 'sobrenome', 'family name'),
    phone1: find('phone 1 value', 'phone 1 - value', 'telefone', 'mobile', 'whatsapp'),
    phone2: find('phone 2 value', 'phone 2 - value'),
    phone3: find('phone 3 value', 'phone 3 - value'),
  };
}

function extractPhonesFromRow(cells, idx) {
  const candidates = [];
  for (const key of ['phone1', 'phone2', 'phone3']) {
    const i = idx[key];
    if (i >= 0 && cells[i]) candidates.push(cells[i]);
  }
  // Qualquer celula que pareca telefone legivel
  for (const cell of cells) {
    if (!cell || isScientificPhone(cell)) continue;
    if (normalizePhone(cell)) candidates.push(cell);
  }

  const phones = [];
  const seen = new Set();
  for (const raw of candidates) {
    const phone = normalizePhone(raw);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    phones.push(phone);
  }
  return phones;
}

function readCsvText(filePath) {
  const buf = fs.readFileSync(filePath);
  const asUtf8 = buf.toString('utf8').replace(/^\uFEFF/, '');
  const asLatin1 = buf.toString('latin1');
  // Preferir latin1 quando UTF-8 mostra caracteres de substituicao ou mojibake
  if (asUtf8.includes('\uFFFD') || /Ã.|NÃ.|Ã§|Ã£|Ã¡|Ã©/.test(asUtf8)) {
    return asLatin1;
  }
  // Heuristica: se latin1 tem mais acentos PT validos que utf8
  const accentRe = /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/g;
  const utfAccents = (asUtf8.match(accentRe) || []).length;
  const latinAccents = (asLatin1.match(accentRe) || []).length;
  if (latinAccents > utfAccents) return asLatin1;
  return asUtf8;
}

function parseCsvFile(filePath) {
  const raw = readCsvText(filePath);
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return { rows: [], skippedScientific: 0, skippedInvalid: 0 };

  const separator = detectSeparator(lines[0]);
  let headerLineIndex = 0;
  let headers = splitCsvLine(lines[0], separator);

  // Export Excel costuma ter linha "Column1;Column2..." antes do cabecalho real
  if (normHeader(headers[0]).startsWith('column')) {
    headerLineIndex = 1;
    headers = splitCsvLine(lines[1], separator);
  }

  const idx = findHeaderIndexes(headers);
  const rows = [];
  let skippedScientific = 0;
  let skippedInvalid = 0;

  for (let i = headerLineIndex + 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i], separator);
    if (cells.every((c) => !c)) continue;

    const hasSci = cells.some((c) => isScientificPhone(c));
    const phones = extractPhonesFromRow(cells, idx);

    if (phones.length === 0) {
      if (hasSci) skippedScientific += 1;
      else skippedInvalid += 1;
      continue;
    }

    const name = cleanName([
      idx.first >= 0 ? cells[idx.first] : '',
      idx.middle >= 0 ? cells[idx.middle] : '',
      idx.last >= 0 ? cells[idx.last] : '',
    ]);

    for (const phone of phones) {
      rows.push({
        name,
        phone,
        sourceFile: path.basename(filePath),
      });
    }
  }

  return { rows, skippedScientific, skippedInvalid };
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",;\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function main() {
  const files = listInputCsvs();
  if (files.length === 0) {
    console.error(`Nenhum CSV em ${ROOT}`);
    process.exit(1);
  }

  const collected = [];
  const report = [];

  for (const file of files) {
    const sourceTag = detectSourceTag(file);
    const parsed = parseCsvFile(file);
    for (const row of parsed.rows) {
      collected.push({ ...row, sourceTag });
    }
    report.push(
      `${path.basename(file)} [${sourceTag}]: ${parsed.rows.length} telefones recuperaveis | sci ignorados: ${parsed.skippedScientific} | invalidos: ${parsed.skippedInvalid}`,
    );
  }

  const byPhone = new Map();
  let duplicates = 0;
  for (const row of collected) {
    const existing = byPhone.get(row.phone);
    if (existing) {
      duplicates += 1;
      if (!existing.name && row.name) existing.name = row.name;
      existing.origins.add(row.sourceTag);
      continue;
    }
    byPhone.set(row.phone, {
      name: row.name,
      phone: row.phone,
      origins: new Set([row.sourceTag]),
    });
  }

  const unique = [...byPhone.values()].sort((a, b) => {
    const aOrigin = [...a.origins].sort().join(';');
    const bOrigin = [...b.origins].sort().join(';');
    const bySource = aOrigin.localeCompare(bOrigin);
    if (bySource !== 0) return bySource;
    return a.phone.localeCompare(b.phone);
  });

  const outputRows = unique.map((row, index) => {
    const batch = Math.floor(index / BATCH_SIZE) + 1;
    const batchTag = `disparo-${String(batch).padStart(2, '0')}`;
    const originTags = [...row.origins].sort();
    const tags = [...originTags, batchTag].join(';');
    return {
      nome: row.name || '',
      telefone: row.phone,
      tags,
    };
  });

  const header = 'nome,telefone,tags';
  const body = outputRows
    .map((r) => [csvEscape(r.nome), csvEscape(r.telefone), csvEscape(r.tags)].join(','))
    .join('\n');
  fs.writeFileSync(OUTPUT, `${header}\n${body}\n`, 'utf8');

  const batchCount = Math.ceil(outputRows.length / BATCH_SIZE) || 0;
  const byOrigin = {};
  for (const row of outputRows) {
    const origin = row.tags.split(';').filter((t) => !t.startsWith('disparo-')).join(';') || '?';
    byOrigin[origin] = (byOrigin[origin] || 0) + 1;
  }

  const summary = [
    '=== Relatorio consolidacao Campanha360 ===',
    ...report,
    `duplicados removidos: ${duplicates}`,
    `unicos finais: ${outputRows.length}`,
    `por origem: ${JSON.stringify(byOrigin)}`,
    `lotes de ${BATCH_SIZE}: ${batchCount} (disparo-01 ... disparo-${String(batchCount).padStart(2, '0')})`,
    `saida: ${OUTPUT}`,
    '',
    'Obs: numeros em notacao cientifica do Excel (ex.: 5,51698E+12) foram descartados — digitos perdidos na exportacao.',
  ].join('\n');

  fs.writeFileSync(REPORT, `${summary}\n`, 'utf8');
  console.log(summary);
}

main();
