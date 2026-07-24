/**
 * Cliente Evolution para validacao de numero WhatsApp (09.6.2).
 * NAO envia mensagem. Timeout controlado. Sem log de telefone/apiKey.
 */

import { createHash } from 'node:crypto';

export type WhatsAppNumberValidationStatus =
  | 'VALID'
  | 'INVALID'
  | 'UNKNOWN'
  | 'PROVIDER_UNAVAILABLE';

export type ValidateWhatsAppNumberInput = {
  baseUrl: string;
  apiKey?: string;
  instanceName: string;
  destinationDigits: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export type ValidateWhatsAppNumberResult = {
  status: WhatsAppNumberValidationStatus;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
};

const DEFAULT_TIMEOUT_MS = 8_000;

function failure(
  status: WhatsAppNumberValidationStatus,
  errorCode: string,
  errorMessage: string,
  httpStatus: number | null,
): ValidateWhatsAppNumberResult {
  return { status, httpStatus, errorCode, errorMessage };
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || /abort/i.test(error.message))
  );
}

export async function validateWhatsAppNumber(
  input: ValidateWhatsAppNumberInput,
): Promise<ValidateWhatsAppNumberResult> {
  const digits = (input.destinationDigits ?? '').replace(/\D/g, '');
  if (!/^\d{10,15}$/.test(digits)) {
    return failure('INVALID', 'STRUCTURAL_INVALID', 'Destino estruturalmente invalido', null);
  }

  const base = (input.baseUrl ?? '').replace(/\/+$/, '');
  const instance = (input.instanceName ?? '').trim();
  if (!base || !instance) {
    return failure(
      'PROVIDER_UNAVAILABLE',
      'EVOLUTION_CONFIG_MISSING',
      'Configuracao Evolution incompleta para validacao',
      null,
    );
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const response = await fetchImpl(
      `${base}/chat/whatsappNumbers/${encodeURIComponent(instance)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(input.apiKey ? { apikey: input.apiKey } : {}),
        },
        body: JSON.stringify({ numbers: [digits] }),
        signal: controller.signal,
      },
    );

    const httpStatus = response.status;
    if (httpStatus === 401 || httpStatus === 403) {
      return failure(
        'PROVIDER_UNAVAILABLE',
        'EVOLUTION_AUTH',
        'Autenticacao Evolution falhou na validacao',
        httpStatus,
      );
    }
    if (httpStatus === 429 || httpStatus >= 500) {
      return failure(
        'PROVIDER_UNAVAILABLE',
        'EVOLUTION_UNAVAILABLE',
        'Provider indisponivel na validacao',
        httpStatus,
      );
    }
    if (!response.ok) {
      return failure(
        'UNKNOWN',
        `HTTP_${httpStatus}`,
        'Resposta inesperada na validacao',
        httpStatus,
      );
    }

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      return failure('UNKNOWN', 'INVALID_JSON', 'Resposta de validacao ilegivel', httpStatus);
    }

    const exists = extractExistsFlag(body, digits);
    if (exists === true) {
      return { status: 'VALID', httpStatus, errorCode: null, errorMessage: null };
    }
    if (exists === false) {
      return { status: 'INVALID', httpStatus, errorCode: null, errorMessage: null };
    }
    return failure(
      'UNKNOWN',
      'AMBIGUOUS_RESPONSE',
      'Nao foi possivel interpretar validacao',
      httpStatus,
    );
  } catch (error) {
    if (isAbortError(error)) {
      return failure('PROVIDER_UNAVAILABLE', 'VALIDATION_TIMEOUT', 'Timeout na validacao', null);
    }
    return failure(
      'PROVIDER_UNAVAILABLE',
      'VALIDATION_NETWORK',
      'Falha de rede na validacao',
      null,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function extractExistsFlag(body: unknown, digits: string): boolean | null {
  if (Array.isArray(body)) {
    for (const row of body) {
      const flag = readRowExists(row, digits);
      if (flag !== null) return flag;
    }
    return null;
  }
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (Array.isArray(record.numbers)) {
      for (const row of record.numbers) {
        const flag = readRowExists(row, digits);
        if (flag !== null) return flag;
      }
    }
    if (typeof record.exists === 'boolean') return record.exists;
    if (typeof record.isWhatsapp === 'boolean') return record.isWhatsapp;
    if (typeof record.numberExists === 'boolean') return record.numberExists;
  }
  return null;
}

function readRowExists(row: unknown, digits: string): boolean | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const number =
    typeof r.number === 'string'
      ? r.number.replace(/\D/g, '')
      : typeof r.jid === 'string'
        ? r.jid.split('@')[0]?.replace(/\D/g, '')
        : null;
  if (
    number &&
    number !== digits &&
    !digits.endsWith(number) &&
    !number.endsWith(digits)
  ) {
    return null;
  }
  if (typeof r.exists === 'boolean') return r.exists;
  if (typeof r.isWhatsapp === 'boolean') return r.isWhatsapp;
  if (typeof r.numberExists === 'boolean') return r.numberExists;
  return null;
}

export function hashDestinationForCache(digits: string): string {
  return createHash('sha256').update(digits.replace(/\D/g, '')).digest('hex');
}
