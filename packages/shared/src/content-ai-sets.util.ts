/**
 * 09.7.2 — Normalizacao, schema e diagnostico de payloads FULL_SETS da IA.
 * Nao inventa blocos ausentes em FULL_SETS; aceita bloco string ou objeto.
 */

import { createHash } from 'node:crypto';
import {
  CONTENT_LIMITS,
  extractContentVariableKeys,
  isAllowedContentVariable,
} from './content-variables.util';
import type { ContentAiGenerationMode } from './content-marketing.util';
import { sanitizeLogText } from './log-sanitizer.util';

export type AiGeneratedBlock = {
  text: string;
  requiresVariables?: string[];
};

export type AiGeneratedSet = {
  greeting: AiGeneratedBlock;
  body: AiGeneratedBlock;
  closing: AiGeneratedBlock;
  marketingAngle: string;
  summaryOfChanges: string;
  preservedFacts: boolean;
  protectedFactsUsed?: string[];
  warnings?: string[];
};

export type AiSetsDetectedFormat =
  | 'A_OBJECT_BLOCKS'
  | 'B_STRING_BLOCKS'
  | 'C_VARIANTS'
  | 'D_MARKDOWN_JSON'
  | 'E_NOT_JSON'
  | 'F_EMPTY_OR_MISSING_BLOCK'
  | 'MIXED'
  | 'UNKNOWN';

export type AiSetBlockName = 'greeting' | 'body' | 'closing';

export type AiSetStructureReason =
  | 'SETS_MISSING'
  | 'SETS_EMPTY'
  | 'TOO_MANY_SETS'
  | 'SET_NOT_OBJECT'
  | 'GREETING_MISSING'
  | 'GREETING_TEXT_EMPTY'
  | 'BODY_MISSING'
  | 'BODY_TEXT_EMPTY'
  | 'CLOSING_MISSING'
  | 'CLOSING_TEXT_EMPTY'
  | 'INVALID_BLOCK_TYPE'
  | 'INVALID_JSON'
  | 'RESPONSE_NOT_JSON'
  | 'PRESERVED_FACTS_FALSE'
  | 'UNKNOWN_PLACEHOLDER'
  | 'PERSONALIZATION_PLACEMENT_INVALID'
  | 'MISSING_TEXT';

export type AiSetStructureDiagnostic = {
  code: 'AI_SET_BLOCK_INVALID' | 'AI_SETS_PAYLOAD_INVALID';
  setIndex?: number;
  block?: AiSetBlockName;
  reason: AiSetStructureReason;
  detail?: string;
};

export const CONTENT_AI_SETS_JSON_SCHEMA_NAME = 'content_marketing_sets_v1';

/** Exemplo estrutural eleitoral (somente formato; sem conteudo fixo de campanha). */
export const CONTENT_AI_ELECTORAL_SETS_EXAMPLE = {
  sets: [
    {
      greeting: {
        text: 'Olá, {{firstName}}!',
        requiresVariables: ['firstName'],
      },
      body: {
        text: 'Mensagem eleitoral contextualizada...',
        requiresVariables: [] as string[],
      },
      closing: {
        text: 'Qual tema é mais importante para você?',
        requiresVariables: [] as string[],
      },
      marketingAngle: 'escuta da comunidade',
      summaryOfChanges: 'abordagem próxima e participativa',
      preservedFacts: true,
      protectedFactsUsed: [] as string[],
      warnings: [] as string[],
    },
  ],
} as const;

/** JSON Schema estrito para response_format (OpenAI Structured Outputs). */
export const CONTENT_AI_SETS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sets'],
  properties: {
    sets: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'greeting',
          'body',
          'closing',
          'marketingAngle',
          'summaryOfChanges',
          'preservedFacts',
          'protectedFactsUsed',
          'warnings',
        ],
        properties: {
          greeting: {
            type: 'object',
            additionalProperties: false,
            required: ['text', 'requiresVariables'],
            properties: {
              text: { type: 'string', minLength: 1 },
              requiresVariables: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
          body: {
            type: 'object',
            additionalProperties: false,
            required: ['text', 'requiresVariables'],
            properties: {
              text: { type: 'string', minLength: 1 },
              requiresVariables: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
          closing: {
            type: 'object',
            additionalProperties: false,
            required: ['text', 'requiresVariables'],
            properties: {
              text: { type: 'string', minLength: 1 },
              requiresVariables: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
          marketingAngle: { type: 'string' },
          summaryOfChanges: { type: 'string' },
          preservedFacts: { type: 'boolean' },
          protectedFactsUsed: {
            type: 'array',
            items: { type: 'string' },
          },
          warnings: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
    },
  },
} as const;

const BLOCK_LABEL_PT: Record<AiSetBlockName, string> = {
  greeting: 'saudação',
  body: 'corpo',
  closing: 'fechamento',
};

function hashPayload(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value ?? null), 'utf8')
    .digest('hex')
    .slice(0, 16);
}

/**
 * Remove fences ```json e extrai um unico objeto JSON inequívoco.
 * Nao usa regex destrutiva no conteudo interno.
 */
export function parseAiSetsRawContent(raw: string):
  | {
      ok: true;
      value: unknown;
      detectedFormat: AiSetsDetectedFormat;
      fromMarkdown: boolean;
    }
  | {
      ok: false;
      reason: 'RESPONSE_NOT_JSON' | 'INVALID_JSON';
      detectedFormat: AiSetsDetectedFormat;
      sanitizedExcerpt: string;
    } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      ok: false,
      reason: 'RESPONSE_NOT_JSON',
      detectedFormat: 'E_NOT_JSON',
      sanitizedExcerpt: '',
    };
  }

  let candidate = trimmed;
  let fromMarkdown = false;

  if (candidate.startsWith('```')) {
    fromMarkdown = true;
    const firstNl = candidate.indexOf('\n');
    if (firstNl >= 0) candidate = candidate.slice(firstNl + 1);
    if (candidate.endsWith('```')) {
      candidate = candidate.slice(0, -3);
    }
    candidate = candidate.trim();
  }

  const tryParse = (text: string): unknown | undefined => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  };

  let parsed = tryParse(candidate);
  if (parsed === undefined) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const slice = candidate.slice(start, end + 1);
      parsed = tryParse(slice);
      if (parsed !== undefined) fromMarkdown = true;
    }
  }

  if (parsed === undefined) {
    return {
      ok: false,
      reason: trimmed.startsWith('{') || trimmed.includes('{')
        ? 'INVALID_JSON'
        : 'RESPONSE_NOT_JSON',
      detectedFormat: 'E_NOT_JSON',
      sanitizedExcerpt: sanitizeLogText(trimmed, { maxLength: 180 }),
    };
  }

  return {
    ok: true,
    value: parsed,
    detectedFormat: fromMarkdown ? 'D_MARKDOWN_JSON' : 'UNKNOWN',
    fromMarkdown,
  };
}

function requiredBlocksForMode(
  mode: ContentAiGenerationMode,
): AiSetBlockName[] {
  switch (mode) {
    case 'GREETING_ONLY':
      return ['greeting'];
    case 'BODY_ONLY':
      return ['body'];
    case 'CLOSING_ONLY':
      return ['closing'];
    case 'FULL_SETS':
    case 'IMPROVE_CURRENT':
    default:
      return ['greeting', 'body', 'closing'];
  }
}

function readRequiresVariables(
  value: unknown,
  text: string,
): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((x): x is string => typeof x === 'string')
      .filter(isAllowedContentVariable);
  }
  return extractContentVariableKeys(text).filter(isAllowedContentVariable);
}

type BlockReadResult =
  | { ok: true; block: AiGeneratedBlock; asString: boolean }
  | {
      ok: false;
      reason: AiSetStructureReason;
      asString?: boolean;
    };

function readFlexibleBlock(
  value: unknown,
  block: AiSetBlockName,
): BlockReadResult {
  if (value == null) {
    return {
      ok: false,
      reason:
        block === 'greeting'
          ? 'GREETING_MISSING'
          : block === 'body'
            ? 'BODY_MISSING'
            : 'CLOSING_MISSING',
    };
  }

  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) {
      return {
        ok: false,
        reason:
          block === 'greeting'
            ? 'GREETING_TEXT_EMPTY'
            : block === 'body'
              ? 'BODY_TEXT_EMPTY'
              : 'CLOSING_TEXT_EMPTY',
        asString: true,
      };
    }
    return {
      ok: true,
      asString: true,
      block: {
        text,
        requiresVariables: readRequiresVariables(undefined, text),
      },
    };
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'INVALID_BLOCK_TYPE' };
  }

  const obj = value as Record<string, unknown>;
  if (!('text' in obj)) {
    return {
      ok: false,
      reason:
        block === 'greeting'
          ? 'GREETING_MISSING'
          : block === 'body'
            ? 'BODY_MISSING'
            : 'CLOSING_MISSING',
    };
  }
  const text = String(obj.text ?? '').trim();
  if (!text) {
    return {
      ok: false,
      reason:
        block === 'greeting'
          ? 'GREETING_TEXT_EMPTY'
          : block === 'body'
            ? 'BODY_TEXT_EMPTY'
            : 'CLOSING_TEXT_EMPTY',
    };
  }
  return {
    ok: true,
    asString: false,
    block: {
      text,
      requiresVariables: readRequiresVariables(obj.requiresVariables, text),
    },
  };
}

function placeholderBlock(text: string): AiGeneratedBlock {
  return {
    text,
    requiresVariables: extractContentVariableKeys(text).filter(
      isAllowedContentVariable,
    ),
  };
}

/**
 * Normaliza payload da IA para schema canonico.
 * Aceita greeting/body/closing como string ou { text }.
 * Nao inventa blocos obrigatorios ausentes.
 */
export function normalizeAiSetsPayload(
  rawPayload: unknown,
  mode: ContentAiGenerationMode = 'FULL_SETS',
  options?: { baseBody?: string },
):
  | {
      ok: true;
      sets: AiGeneratedSet[];
      detectedFormat: AiSetsDetectedFormat;
      structureDiagnostics: AiSetStructureDiagnostic[];
      payloadHash: string;
    }
  | {
      ok: false;
      sets: AiGeneratedSet[];
      detectedFormat: AiSetsDetectedFormat;
      structureDiagnostics: AiSetStructureDiagnostic[];
      payloadHash: string;
      errors: string[];
    } {
  const structureDiagnostics: AiSetStructureDiagnostic[] = [];
  const errors: string[] = [];
  const payloadHash = hashPayload(rawPayload);
  let detectedFormat: AiSetsDetectedFormat = 'UNKNOWN';

  if (rawPayload == null || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    structureDiagnostics.push({
      code: 'AI_SETS_PAYLOAD_INVALID',
      reason: 'RESPONSE_NOT_JSON',
    });
    return {
      ok: false,
      sets: [],
      detectedFormat: 'E_NOT_JSON',
      structureDiagnostics,
      payloadHash,
      errors: ['RESPONSE_NOT_JSON'],
    };
  }

  const root = rawPayload as Record<string, unknown>;
  const required = requiredBlocksForMode(mode);
  const wantsFullBlocks =
    mode === 'FULL_SETS' || mode === 'IMPROVE_CURRENT';

  // Caminho variants (09.7.1) para modos de bloco unico
  if (
    !Array.isArray(root.sets) &&
    Array.isArray(root.variants) &&
    !wantsFullBlocks
  ) {
    detectedFormat = 'C_VARIANTS';
    const variants = root.variants;
    if (variants.length < 1) {
      structureDiagnostics.push({
        code: 'AI_SETS_PAYLOAD_INVALID',
        reason: 'SETS_EMPTY',
      });
      return {
        ok: false,
        sets: [],
        detectedFormat,
        structureDiagnostics,
        payloadHash,
        errors: ['SETS_EMPTY'],
      };
    }
    if (variants.length > CONTENT_LIMITS.MAX_AI_VARIANTS) {
      structureDiagnostics.push({
        code: 'AI_SETS_PAYLOAD_INVALID',
        reason: 'TOO_MANY_SETS',
      });
      errors.push('TOO_MANY_SETS');
    }

    const mapped: AiGeneratedSet[] = [];
    variants.forEach((row, setIndex) => {
      if (!row || typeof row !== 'object') {
        structureDiagnostics.push({
          code: 'AI_SET_BLOCK_INVALID',
          setIndex,
          reason: 'SET_NOT_OBJECT',
        });
        errors.push('SET_NOT_OBJECT');
        return;
      }
      const r = row as Record<string, unknown>;
      const text = String(r.text ?? '').trim();
      if (!text) {
        const block = required[0] ?? 'body';
        structureDiagnostics.push({
          code: 'AI_SET_BLOCK_INVALID',
          setIndex,
          block,
          reason:
            block === 'greeting'
              ? 'GREETING_TEXT_EMPTY'
              : block === 'closing'
                ? 'CLOSING_TEXT_EMPTY'
                : 'BODY_TEXT_EMPTY',
        });
        errors.push(
          block === 'greeting'
            ? 'GREETING_TEXT_EMPTY'
            : block === 'closing'
              ? 'CLOSING_TEXT_EMPTY'
              : 'BODY_TEXT_EMPTY',
        );
        return;
      }
      const summaryOfChanges = String(r.summaryOfChanges ?? '').trim();
      const preservedFacts = r.preservedFacts !== false;
      if (r.preservedFacts === false) {
        structureDiagnostics.push({
          code: 'AI_SET_BLOCK_INVALID',
          setIndex,
          reason: 'PRESERVED_FACTS_FALSE',
        });
        errors.push('PRESERVED_FACTS_FALSE');
      }
      const primary: AiGeneratedBlock = {
        text,
        requiresVariables: readRequiresVariables(r.requiresVariables, text),
      };
      const base = options?.baseBody?.trim() || 'Mensagem';
      if (mode === 'BODY_ONLY') {
        mapped.push({
          greeting: placeholderBlock('Ola!'),
          body: primary,
          closing: placeholderBlock('Posso te ajudar?'),
          marketingAngle: 'body-only',
          summaryOfChanges,
          preservedFacts,
        });
      } else if (mode === 'GREETING_ONLY') {
        mapped.push({
          greeting: primary,
          body: placeholderBlock(base),
          closing: placeholderBlock('Obrigado.'),
          marketingAngle: 'greeting-only',
          summaryOfChanges,
          preservedFacts,
        });
      } else {
        mapped.push({
          greeting: placeholderBlock('Ola!'),
          body: placeholderBlock(base),
          closing: primary,
          marketingAngle: 'closing-only',
          summaryOfChanges,
          preservedFacts,
        });
      }
    });

    if (structureDiagnostics.length > 0 || errors.length > 0) {
      return {
        ok: false,
        sets: mapped,
        detectedFormat,
        structureDiagnostics,
        payloadHash,
        errors: [...new Set(errors)],
      };
    }
    if (mapped.length < 1) {
      return {
        ok: false,
        sets: [],
        detectedFormat,
        structureDiagnostics: [
          { code: 'AI_SETS_PAYLOAD_INVALID', reason: 'SETS_EMPTY' },
        ],
        payloadHash,
        errors: ['SETS_EMPTY'],
      };
    }
    return {
      ok: true,
      sets: mapped,
      detectedFormat,
      structureDiagnostics: [],
      payloadHash,
    };
  }

  if (!Array.isArray(root.sets)) {
    structureDiagnostics.push({
      code: 'AI_SETS_PAYLOAD_INVALID',
      reason: 'SETS_MISSING',
    });
    return {
      ok: false,
      sets: [],
      detectedFormat: 'UNKNOWN',
      structureDiagnostics,
      payloadHash,
      errors: ['SETS_MISSING'],
    };
  }

  const setsRaw = root.sets;
  if (setsRaw.length < 1) {
    structureDiagnostics.push({
      code: 'AI_SETS_PAYLOAD_INVALID',
      reason: 'SETS_EMPTY',
    });
    return {
      ok: false,
      sets: [],
      detectedFormat: 'UNKNOWN',
      structureDiagnostics,
      payloadHash,
      errors: ['SETS_EMPTY'],
    };
  }
  if (setsRaw.length > CONTENT_LIMITS.MAX_AI_VARIANTS) {
    structureDiagnostics.push({
      code: 'AI_SETS_PAYLOAD_INVALID',
      reason: 'TOO_MANY_SETS',
    });
    errors.push('TOO_MANY_SETS');
  }

  let sawString = false;
  let sawObject = false;
  let sawMissing = false;
  const mapped: AiGeneratedSet[] = [];

  setsRaw.forEach((row, setIndex) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      structureDiagnostics.push({
        code: 'AI_SET_BLOCK_INVALID',
        setIndex,
        reason: 'SET_NOT_OBJECT',
      });
      errors.push('SET_NOT_OBJECT');
      return;
    }
    const r = row as Record<string, unknown>;
    const base = options?.baseBody?.trim() || 'Mensagem';

    const greetingRead = readFlexibleBlock(r.greeting, 'greeting');
    const bodyRead = readFlexibleBlock(r.body, 'body');
    const closingRead = readFlexibleBlock(r.closing, 'closing');

    const applyRead = (
      block: AiSetBlockName,
      read: BlockReadResult,
      isRequired: boolean,
    ): AiGeneratedBlock | null => {
      if (read.ok) {
        if (read.asString) sawString = true;
        else sawObject = true;
        return read.block;
      }
      if (isRequired) {
        sawMissing = true;
        structureDiagnostics.push({
          code: 'AI_SET_BLOCK_INVALID',
          setIndex,
          block,
          reason: read.reason,
        });
        errors.push(read.reason);
        return null;
      }
      // Modo de bloco unico: placeholders apenas para blocos nao exigidos
      if (block === 'greeting') return placeholderBlock('Ola!');
      if (block === 'body') return placeholderBlock(base);
      return placeholderBlock('Posso te ajudar?');
    };

    const greeting = applyRead(
      'greeting',
      greetingRead,
      required.includes('greeting'),
    );
    const body = applyRead('body', bodyRead, required.includes('body'));
    const closing = applyRead(
      'closing',
      closingRead,
      required.includes('closing'),
    );

    if (!greeting || !body || !closing) {
      return;
    }

    // Ausente => assume true (modelos frequentemente omitem); so falha se false explicito
    const preservedFacts = r.preservedFacts !== false;
    if (wantsFullBlocks && r.preservedFacts === false) {
      structureDiagnostics.push({
        code: 'AI_SET_BLOCK_INVALID',
        setIndex,
        reason: 'PRESERVED_FACTS_FALSE',
      });
      errors.push('PRESERVED_FACTS_FALSE');
    }

    mapped.push({
      greeting,
      body,
      closing,
      marketingAngle: String(r.marketingAngle ?? '').trim().slice(0, 200),
      summaryOfChanges: String(r.summaryOfChanges ?? '').trim().slice(0, 500),
      preservedFacts,
      protectedFactsUsed: Array.isArray(r.protectedFactsUsed)
        ? r.protectedFactsUsed.filter((x): x is string => typeof x === 'string')
        : [],
      warnings: Array.isArray(r.warnings)
        ? r.warnings.filter((x): x is string => typeof x === 'string')
        : [],
    });
  });

  if (sawMissing) detectedFormat = 'F_EMPTY_OR_MISSING_BLOCK';
  else if (sawString && sawObject) detectedFormat = 'MIXED';
  else if (sawString) detectedFormat = 'B_STRING_BLOCKS';
  else if (sawObject) detectedFormat = 'A_OBJECT_BLOCKS';

  if (errors.length > 0 || structureDiagnostics.length > 0) {
    return {
      ok: false,
      sets: mapped,
      detectedFormat,
      structureDiagnostics,
      payloadHash,
      errors: [...new Set(errors)],
    };
  }

  if (mapped.length < 1) {
    return {
      ok: false,
      sets: [],
      detectedFormat,
      structureDiagnostics: [
        { code: 'AI_SETS_PAYLOAD_INVALID', reason: 'SETS_EMPTY' },
      ],
      payloadHash,
      errors: ['SETS_EMPTY'],
    };
  }

  return {
    ok: true,
    sets: mapped.slice(0, CONTENT_LIMITS.MAX_AI_VARIANTS),
    detectedFormat,
    structureDiagnostics: [],
    payloadHash,
  };
}

export function formatAiSetStructureUserMessage(
  d: AiSetStructureDiagnostic,
): string {
  const msgN =
    typeof d.setIndex === 'number' ? `na mensagem ${d.setIndex + 1}` : '';
  const blockLabel = d.block ? BLOCK_LABEL_PT[d.block] : null;

  switch (d.reason) {
    case 'GREETING_MISSING':
      return `A IA nao retornou a saudação ${msgN}. Nenhuma versão foi salva. Tente gerar novamente.`.replace(
        /\s+/g,
        ' ',
      );
    case 'GREETING_TEXT_EMPTY':
      return `A IA retornou a saudação vazia ${msgN}. Nenhuma versão foi salva. Tente gerar novamente.`.replace(
        /\s+/g,
        ' ',
      );
    case 'BODY_MISSING':
      return `A IA nao retornou o corpo ${msgN}. Nenhuma versão foi salva. Tente gerar novamente.`.replace(
        /\s+/g,
        ' ',
      );
    case 'BODY_TEXT_EMPTY':
      return `A IA retornou o corpo vazio ${msgN}. Nenhuma versão foi salva. Tente gerar novamente.`.replace(
        /\s+/g,
        ' ',
      );
    case 'CLOSING_MISSING':
      return `A IA nao retornou o fechamento ${msgN}. Nenhuma versão foi salva. Tente gerar novamente.`.replace(
        /\s+/g,
        ' ',
      );
    case 'CLOSING_TEXT_EMPTY':
      return `A IA retornou o fechamento vazio ${msgN}. Nenhuma versão foi salva. Tente gerar novamente.`.replace(
        /\s+/g,
        ' ',
      );
    case 'SETS_MISSING':
      return 'A IA nao retornou o campo sets. Nenhuma versão foi salva. Tente gerar novamente.';
    case 'SETS_EMPTY':
      return 'A IA retornou uma lista de mensagens vazia. Nenhuma versão foi salva. Tente gerar novamente.';
    case 'TOO_MANY_SETS':
      return 'A IA retornou mais mensagens do que o permitido. Nenhuma versão foi salva. Tente gerar novamente.';
    case 'SET_NOT_OBJECT':
      return `A IA retornou um conjunto invalido ${msgN}. Nenhuma versão foi salva. Tente gerar novamente.`.replace(
        /\s+/g,
        ' ',
      );
    case 'INVALID_BLOCK_TYPE':
      return blockLabel
        ? `A IA retornou o bloco ${blockLabel} em formato invalido ${msgN}. Nenhuma versão foi salva. Tente gerar novamente.`.replace(
            /\s+/g,
            ' ',
          )
        : `A IA retornou um bloco em formato invalido ${msgN}. Nenhuma versão foi salva. Tente gerar novamente.`.replace(
            /\s+/g,
            ' ',
          );
    case 'INVALID_JSON':
      return 'A resposta da IA nao e um JSON valido. Nenhuma versão foi salva. Tente gerar novamente.';
    case 'RESPONSE_NOT_JSON':
      return 'A IA nao retornou JSON. Nenhuma versão foi salva. Tente gerar novamente.';
    case 'PRESERVED_FACTS_FALSE':
      return `A IA nao confirmou a preservacao de fatos ${msgN}. Nenhuma versão foi salva. Tente gerar novamente.`.replace(
        /\s+/g,
        ' ',
      );
    case 'UNKNOWN_PLACEHOLDER':
      return `A IA usou um placeholder desconhecido ${msgN}. Nenhuma versão foi salva. Tente gerar novamente.`.replace(
        /\s+/g,
        ' ',
      );
    case 'PERSONALIZATION_PLACEMENT_INVALID':
      return `A personalizacao de nome esta no bloco incorreto ${msgN}. Nenhuma versão foi salva. Tente gerar novamente.`.replace(
        /\s+/g,
        ' ',
      );
    case 'MISSING_TEXT':
      return blockLabel
        ? `A IA retornou a ${blockLabel} vazia ${msgN}. Nenhuma versão foi salva. Tente gerar novamente.`.replace(
            /\s+/g,
            ' ',
          )
        : `A IA retornou um bloco vazio ${msgN}. Nenhuma versão foi salva. Tente gerar novamente.`.replace(
            /\s+/g,
            ' ',
          );
    default:
      return `A resposta da IA e invalida (${d.reason}). Nenhuma versão foi salva. Tente gerar novamente.`;
  }
}

export function formatAiSetsValidationUserMessages(
  diagnostics: AiSetStructureDiagnostic[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of diagnostics) {
    const msg = formatAiSetStructureUserMessage(d).replace(/\s+/g, ' ').trim();
    if (seen.has(msg)) continue;
    seen.add(msg);
    out.push(msg);
  }
  return out;
}

/** Metadados seguros para log/audit em falha de validacao. */
export function buildAiSetsValidationLogMeta(input: {
  generationId: string;
  model: string;
  mode: string;
  promptVersion: string;
  httpStatus?: number;
  finishReason?: string | null;
  detectedFormat?: AiSetsDetectedFormat;
  payloadHash?: string;
  structureDiagnostics: AiSetStructureDiagnostic[];
  sets?: AiGeneratedSet[];
  rawExcerptDevOnly?: string | null;
  includeDevExcerpt?: boolean;
}): Record<string, unknown> {
  const sets = input.sets ?? [];
  return {
    generationId: input.generationId,
    model: input.model,
    mode: input.mode,
    promptVersion: input.promptVersion,
    httpStatus: input.httpStatus ?? null,
    finishReason: input.finishReason ?? null,
    detectedFormat: input.detectedFormat ?? null,
    payloadHash: input.payloadHash ?? null,
    setCount: sets.length,
    blockShapes: sets.map((s, i) => ({
      setIndex: i,
      greetingChars: s.greeting.text.length,
      bodyChars: s.body.text.length,
      closingChars: s.closing.text.length,
    })),
    validationCodes: input.structureDiagnostics.map((d) => ({
      code: d.code,
      reason: d.reason,
      setIndex: d.setIndex ?? null,
      block: d.block ?? null,
    })),
    ...(input.includeDevExcerpt && input.rawExcerptDevOnly
      ? {
          sanitizedExcerpt: sanitizeLogText(input.rawExcerptDevOnly, {
            maxLength: 200,
          }),
        }
      : {}),
  };
}

export function isStructuralAiSetsFailure(
  diagnostics: AiSetStructureDiagnostic[],
): boolean {
  if (diagnostics.length < 1) return false;
  const structural = new Set<AiSetStructureReason>([
    'SETS_MISSING',
    'SETS_EMPTY',
    'TOO_MANY_SETS',
    'SET_NOT_OBJECT',
    'GREETING_MISSING',
    'GREETING_TEXT_EMPTY',
    'BODY_MISSING',
    'BODY_TEXT_EMPTY',
    'CLOSING_MISSING',
    'CLOSING_TEXT_EMPTY',
    'INVALID_BLOCK_TYPE',
    'INVALID_JSON',
    'RESPONSE_NOT_JSON',
    'PRESERVED_FACTS_FALSE',
  ]);
  return diagnostics.some((d) => structural.has(d.reason));
}

export function buildContentAiFormatCorrectionUserMessage(
  diagnostics: AiSetStructureDiagnostic[],
): string {
  const codes = [...new Set(diagnostics.map((d) => d.reason))].join(', ');
  return [
    'A resposta anterior estava em formato invalido.',
    `Problemas: ${codes || 'estrutura'}.`,
    'Reenvie SOMENTE o JSON canonico, sem markdown e sem texto fora do JSON.',
    'Em FULL_SETS cada item de sets DEVE ter greeting, body e closing como objetos { "text": "...", "requiresVariables": [] } com text nao vazio.',
    'preservedFacts deve ser true.',
    `Exemplo de estrutura (conteudo ilustrativo): ${JSON.stringify(CONTENT_AI_ELECTORAL_SETS_EXAMPLE)}`,
  ].join(' ');
}
