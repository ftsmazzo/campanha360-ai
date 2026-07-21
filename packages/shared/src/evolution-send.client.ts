/**
 * Cliente Evolution "Nest-free" para envio de texto (subetapa 09.4).
 * Usa fetch nativo, sem dependencia de @nestjs/*, para ser reutilizavel
 * pelo Worker (apps/worker) sem acoplar ao framework da API.
 *
 * Regras de seguranca:
 * - NUNCA loga apiKey, destino/telefone ou conteudo da mensagem.
 * - Mensagens de erro retornadas sao genericas (nao ecoam corpo bruto do
 *   provider, que poderia conter o numero de destino).
 */

export type EvolutionSendCategory =
  | 'TRANSIENT_NETWORK'
  | 'PROVIDER_RATE_LIMIT'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'AUTHENTICATION_ERROR'
  | 'INVALID_DESTINATION'
  | 'CONTENT_REJECTED'
  | 'UNKNOWN_PROVIDER_STATE'
  | 'UNKNOWN';

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
};

export type EvolutionSendFailure = {
  success: false;
  category: EvolutionSendCategory;
  errorCode: string;
  errorMessage: string;
  httpStatus: number | null;
  /** true quando a requisicao pode ter sido processada pelo provider mesmo sem resposta confirmada (timeout/abort). */
  ambiguous: boolean;
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

function failure(
  category: EvolutionSendCategory,
  errorCode: string,
  errorMessage: string,
  httpStatus: number | null,
  ambiguous: boolean,
): EvolutionSendFailure {
  return { success: false, category, errorCode, errorMessage, httpStatus, ambiguous };
}

function classifyHttpError(status: number): EvolutionSendFailure {
  if (status === 429) {
    return failure(
      'PROVIDER_RATE_LIMIT',
      'HTTP_429',
      'Provider retornou limite de taxa (429)',
      status,
      false,
    );
  }
  if (status === 401 || status === 403) {
    return failure(
      'AUTHENTICATION_ERROR',
      `HTTP_${status}`,
      'Provider recusou autenticacao',
      status,
      false,
    );
  }
  if (status === 404) {
    return failure(
      'INVALID_DESTINATION',
      'HTTP_404',
      'Provider nao encontrou instancia/destino',
      status,
      false,
    );
  }
  if (status === 400 || status === 422) {
    return failure(
      'CONTENT_REJECTED',
      `HTTP_${status}`,
      'Provider rejeitou o conteudo ou a requisicao',
      status,
      false,
    );
  }
  if (status === 502 || status === 503 || status === 504) {
    return failure(
      'PROVIDER_UNAVAILABLE',
      `HTTP_${status}`,
      'Provider indisponivel temporariamente',
      status,
      false,
    );
  }
  if (status >= 500) {
    return failure(
      'PROVIDER_UNAVAILABLE',
      `HTTP_${status}`,
      'Provider retornou erro interno',
      status,
      false,
    );
  }
  return failure(
    'UNKNOWN',
    `HTTP_${status}`,
    'Provider retornou erro nao mapeado',
    status,
    false,
  );
}

/**
 * Envia texto via Evolution API (`POST /message/sendText/{instanceName}`).
 * Nunca lanca — sempre retorna um `EvolutionSendResult` normalizado para
 * que o Worker decida SENT/RETRY_SCHEDULED/FAILED/UNKNOWN_PROVIDER_STATE.
 */
export async function sendEvolutionText(
  input: EvolutionSendInput,
): Promise<EvolutionSendResult> {
  const baseUrl = (input.baseUrl || '').trim().replace(/\/+$/, '');
  const instanceName = (input.instanceName || '').trim();
  const destination = (input.destination || '').replace(/\D/g, '');
  const text = (input.text || '').trim();
  const fetchFn = input.fetchImpl ?? fetch;

  if (!baseUrl) {
    return failure('UNKNOWN', 'MISSING_BASE_URL', 'EVOLUTION_API_URL nao configurada', null, false);
  }
  if (!instanceName) {
    return failure('UNKNOWN', 'MISSING_INSTANCE', 'instanceName ausente', null, false);
  }
  if (!destination) {
    return failure('INVALID_DESTINATION', 'MISSING_DESTINATION', 'Destino invalido', null, false);
  }
  if (!text) {
    return failure('CONTENT_REJECTED', 'EMPTY_CONTENT', 'Conteudo vazio', null, false);
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
      return classifyHttpError(response.status);
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
    };
  } catch (error) {
    if (isAbortError(error)) {
      return failure(
        'UNKNOWN_PROVIDER_STATE',
        'TIMEOUT_OR_ABORT',
        'Timeout/abort na chamada: envio pode ter sido processado pelo provider',
        null,
        true,
      );
    }
    return failure(
      'TRANSIENT_NETWORK',
      'NETWORK_ERROR',
      'Falha de rede antes de resposta do provider',
      null,
      false,
    );
  } finally {
    clearTimeout(timeoutHandle);
  }
}
