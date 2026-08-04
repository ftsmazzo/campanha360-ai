/**
 * 09.7.1 — Catalogo de variaveis, parser seguro e resolucao de nome.
 * Sem expressoes arbitrarias / sem execucao de codigo.
 */

export const CONTENT_VARIABLE_CATALOG = [
  {
    key: 'firstName',
    token: '{{firstName}}',
    label: 'Nome',
    description: 'Primeira parte util do nome do contato',
  },
  {
    key: 'fullName',
    token: '{{fullName}}',
    label: 'Nome completo',
    description: 'Nome completo do contato',
  },
  {
    key: 'companyName',
    token: '{{companyName}}',
    label: 'Empresa',
    description: 'Empresa do contato, quando disponivel em metadata',
  },
  {
    key: 'city',
    token: '{{city}}',
    label: 'Cidade',
    description: 'Cidade do contato (Contact.city)',
  },
] as const;

export type ContentVariableKey = (typeof CONTENT_VARIABLE_CATALOG)[number]['key'];

export const CONTENT_VARIABLE_TOKEN_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

export const CONTENT_LIMITS = {
  MAX_BODY_ACTIVE: 4,
  MAX_GREETING_ACTIVE: 5,
  MAX_CLOSING_ACTIVE: 5,
  MAX_AI_VARIANTS: 5,
  MAX_FINAL_MESSAGE_CHARS: 4000,
  MAX_VARIANT_CHARS: 3500,
  MAX_VARIABLES_PER_VARIANT: 8,
  FIRST_NAME_MAX_CHARS: 40,
  BLOCK_SEPARATOR_DEFAULT: '\n\n',
  SELECTION_ALGORITHM_VERSION: 'v1-sha256-mod',
  SELECTION_ALGORITHM_VERSION_LOCKED_SETS: 'v2-locked-sets-sha256-mod',
} as const;

const ALLOWED_KEYS = new Set<string>(
  CONTENT_VARIABLE_CATALOG.map((item) => item.key),
);

export function isAllowedContentVariable(key: string): key is ContentVariableKey {
  return ALLOWED_KEYS.has(key);
}

export function extractContentVariableKeys(text: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(CONTENT_VARIABLE_TOKEN_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const key = match[1]!;
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/** Resolve firstName a partir do nome completo do contato. */
export function resolveFirstName(
  fullName: string | null | undefined,
  options?: { maxChars?: number },
): string | null {
  if (!fullName) return null;
  const cleaned = fullName
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  const first = cleaned.split(' ')[0] ?? '';
  const max = options?.maxChars ?? CONTENT_LIMITS.FIRST_NAME_MAX_CHARS;
  const clipped = first.slice(0, max).trim();
  return clipped || null;
}

export function resolveFullName(fullName: string | null | undefined): string | null {
  if (!fullName) return null;
  const cleaned = fullName
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || null;
}

export type ContactVariableContext = {
  name?: string | null;
  companyName?: string | null;
  company?: string | null;
  city?: string | null;
};

export type ResolvedVariableMap = Partial<Record<ContentVariableKey, string>>;

export function buildResolvedVariables(
  contact: ContactVariableContext,
): ResolvedVariableMap {
  const full = resolveFullName(contact.name);
  const first = resolveFirstName(contact.name);
  const company =
    (contact.companyName || contact.company || '').trim().replace(/\s+/g, ' ') ||
    null;
  const city =
    (contact.city || '').trim().replace(/\s+/g, ' ').slice(0, 80) || null;
  const out: ResolvedVariableMap = {};
  if (first) out.firstName = first;
  if (full) out.fullName = full;
  if (company) out.companyName = company.slice(0, 80);
  if (city) out.city = city;
  return out;
}

export type RenderContentResult = {
  renderedText: string;
  resolvedVariables: ResolvedVariableMap;
  missingVariables: string[];
  usedFallbacks: string[];
  valid: boolean;
  errors: string[];
};

export function renderContentTemplate(
  template: string,
  contact: ContactVariableContext,
  fallbacks: Partial<Record<ContentVariableKey, string>> = {},
): RenderContentResult {
  const errors: string[] = [];
  const missingVariables: string[] = [];
  const usedFallbacks: string[] = [];
  const keys = extractContentVariableKeys(template);

  for (const key of keys) {
    if (!isAllowedContentVariable(key)) {
      errors.push(`VARIavel_DESCONHECIDA:${key}`);
    }
  }
  if (keys.length > CONTENT_LIMITS.MAX_VARIABLES_PER_VARIANT) {
    errors.push('DEMASIADAS_VARIAVEIS');
  }

  const resolved = buildResolvedVariables(contact);
  let rendered = template;

  for (const key of keys) {
    if (!isAllowedContentVariable(key)) continue;
    const value = resolved[key];
    const tokenRe = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
    if (value) {
      rendered = rendered.replace(tokenRe, value);
      continue;
    }
    const fb = (fallbacks[key] ?? '').trim();
    if (fb) {
      rendered = rendered.replace(tokenRe, fb);
      usedFallbacks.push(key);
      missingVariables.push(key);
      continue;
    }
    missingVariables.push(key);
    errors.push(`VARIAVEL_NAO_RESOLVIDA:${key}`);
  }

  // Nenhum placeholder residual permitido
  if (/\{\{[^}]+\}\}/.test(rendered)) {
    errors.push('PLACEHOLDER_RESIDUAL');
  }

  rendered = rendered.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  if (!rendered) {
    errors.push('TEXTO_VAZIO');
  }
  if (rendered.length > CONTENT_LIMITS.MAX_FINAL_MESSAGE_CHARS) {
    errors.push('TEXTO_EXCEDE_LIMITE');
  }

  return {
    renderedText: rendered,
    resolvedVariables: resolved,
    missingVariables,
    usedFallbacks,
    valid: errors.length === 0,
    errors,
  };
}

export function variantRequiresVariables(
  text: string,
  explicit?: string[] | null,
): string[] {
  if (explicit && explicit.length > 0) {
    return [...new Set(explicit)];
  }
  return extractContentVariableKeys(text).filter(isAllowedContentVariable);
}

export function isVariantEligibleForContact(input: {
  text: string;
  requiresVariables?: string[] | null;
  contact: ContactVariableContext;
  /** Se true, exige variavel resolvida (sem fallback) para elegibilidade. */
  requireResolvedWithoutFallback?: boolean;
}): boolean {
  const required = variantRequiresVariables(input.text, input.requiresVariables);
  if (required.length === 0) return true;
  const resolved = buildResolvedVariables(input.contact);
  for (const key of required) {
    if (!isAllowedContentVariable(key)) return false;
    if (!resolved[key]) return false;
  }
  return true;
}
