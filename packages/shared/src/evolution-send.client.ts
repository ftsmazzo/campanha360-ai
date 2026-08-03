/**
 * Cliente Evolution "Nest-free" para envio de texto (subetapa 09.4 / 09.6.4).
 * Usa fetch nativo, sem dependencia de @nestjs/*.
 *
 * Regras de seguranca:
 * - NUNCA loga apiKey, destino/telefone ou conteudo da mensagem.
 * - Mensagens de erro sao sanitizadas (sem ecoar corpo bruto com telefone).
 * - HTTP status isolado NAO define CONTENT_REJECTED (09.6.4).
 */

import {
  classifyEvolutionSendFailure,
  type AcceptanceState,
  type EvolutionSendCategory,
  type SafeEvolutionErrorEvidence,
} from './evolution-error-classification.util';
import { toEvolutionSendNumber } from './whatsapp-jid.util';

export type {
  AcceptanceState,
  EvolutionSendCategory,
  SafeEvolutionErrorEvidence,
} from './evolution-error-classification.util';

export type EvolutionSendInput = {
  baseUrl: string;
  apiKey?: string;
  instanceName: string;
  destination: string;
  text: string;
  idempotencyKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export type EvolutionSendSuccess = {
  success: true;
  providerMessageId: string | null;
  providerStatus: string | null;
  httpStatus: number;
  acceptanceState: 'ACCEPTED';
};

export type EvolutionSendFailure = {
  success: false;
  category: EvolutionSendCategory;
  errorCode: string;
  errorMessage: string;
  httpStatus: number | null;
  /** true quando a requisicao pode ter sido processada pelo provider mesmo sem resposta confirmada (timeout/abort). */
  ambiguous: boolean;
  acceptanceState: AcceptanceState;
  evidence: SafeEvolutionErrorEvidence;
};

export type EvolutionSendResult = EvolutionSendSuccess | EvolutionSendFailure;

const DEFAULT_TIMEOUT_MS = 15_000;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function asString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || /abort/i.test(error.message))
  );
}

function toFailure(
  classified: ReturnType<typeof classifyEvolutionSendFailure>,
): EvolutionSendFailure {
  return {
    success: false,
    category: classified.category,
    errorCode: classified.errorCode,
    errorMessage: classified.errorMessage,
    httpStatus: classified.httpStatus,
    ambiguous: classified.ambiguous,
    acceptanceState: classified.acceptanceState,
    evidence: classified.evidence,
  };
}

/**
 * Envia texto via Evolution API (`POST /message/sendText/{instanceName}`).
 * Nunca lanca — sempre retorna um `EvolutionSendResult` normalizado.
 */
export async function sendEvolutionText(
  input: EvolutionSendInput,
): Promise<EvolutionSendResult> {
  const baseUrl = (input.baseUrl || '').trim().replace(/\/+$/, '');
  const instanceName = (input.instanceName || '').trim();
  const destination = toEvolutionSendNumber(input.destination) ?? (input.destination || '').replace(/\D/g, '');
  const text = (input.text || '').trim();
  const fetchFn = input.fetchImpl ?? fetch;
  const endpoint = 'message/sendText';

  if (!baseUrl) {
    return toFailure(
      classifyEvolutionSendFailure({
        httpStatus: null,
        rawText: 'EVOLUTION_API_URL nao configurada',
        endpoint,
        instanceName,
      }),
    );
  }
  if (!instanceName) {
    return toFailure(
      classifyEvolutionSendFailure({
        httpStatus: null,
        rawText: 'instanceName ausente',
        endpoint,
        instanceName: null,
      }),
    );
  }
  if (!destination) {
    return {
      success: false,
      category: 'INVALID_DESTINATION',
      errorCode: 'MISSING_DESTINATION',
      errorMessage: 'Destino invalido',
      httpStatus: null,
      ambiguous: false,
      acceptanceState: 'NOT_ACCEPTED',
      evidence: {
        httpStatus: null,
        providerErrorCode: 'MISSING_DESTINATION',
        providerErrorType: null,
        providerErrorMessageSafe: 'Destino invalido',
        providerRequestId: null,
        endpoint,
        instanceName,
      },
    };
  }
  if (!text) {
    return {
      success: false,
      category: 'CONTENT_REJECTED',
      errorCode: 'EMPTY_CONTENT',
      errorMessage: 'Conteudo vazio',
      httpStatus: null,
      ambiguous: false,
      acceptanceState: 'NOT_ACCEPTED',
      evidence: {
        httpStatus: null,
        providerErrorCode: 'EMPTY_CONTENT',
        providerErrorType: null,
        providerErrorMessageSafe: 'Conteudo vazio',
        providerRequestId: null,
        endpoint,
        instanceName,
      },
    };
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  const url = `${baseUrl}/message/sendText/${encodeURIComponent(instanceName)}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (input.apiKey) headers.apikey = input.apiKey;
  if (input.idempotencyKey) headers['x-idempotency-key'] = input.idempotencyKey;

  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ number: destination, text }),
      signal: controller.signal,
    });

    const raw = await response.text().catch(() => '');
    let data: unknown = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = null;
      }
    }

    if (!response.ok) {
      return toFailure(
        classifyEvolutionSendFailure({
          httpStatus: response.status,
          body: data,
          rawText: raw,
          endpoint,
          instanceName,
        }),
      );
    }

    const record = asRecord(data) ?? {};
    const key = asRecord(record.key);
    const providerMessageId =
      asString(key?.id) ?? asString(record.messageId) ?? asString(record.id);
    const providerStatus =
      asString(record.status) ?? asString(asRecord(record.message)?.status);

    return {
      success: true,
      providerMessageId,
      providerStatus,
      httpStatus: response.status,
      acceptanceState: 'ACCEPTED',
    };
  } catch (error) {
    if (isAbortError(error)) {
      return toFailure(
        classifyEvolutionSendFailure({
          httpStatus: null,
          aborted: true,
          endpoint,
          instanceName,
        }),
      );
    }
    const message = error instanceof Error ? error.message : 'NETWORK_ERROR';
    return toFailure(
      classifyEvolutionSendFailure({
        httpStatus: null,
        networkErrorMessage: message,
        endpoint,
        instanceName,
      }),
    );
  } finally {
    clearTimeout(timeoutHandle);
  }
}
