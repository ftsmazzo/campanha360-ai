/**
 * Classificacao segura de erros Evolution (09.6.4).
 * HTTP status isolado NAO define categoria — exige evidencia no corpo/mensagem.
 */

export type EvolutionSendCategory =
  | 'TRANSIENT_NETWORK'
  | 'PROVIDER_RATE_LIMIT'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_CONNECTION_CLOSED'
  | 'PROVIDER_BAD_REQUEST'
  | 'PROVIDER_AUTH_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'CHANNEL_DISCONNECTED'
  | 'CHANNEL_NOT_FOUND'
  | 'CHANNEL_UNAVAILABLE'
  | 'INVALID_DESTINATION'
  | 'CONTENT_REJECTED'
  | 'UNKNOWN_PROVIDER_STATE'
  | 'UNKNOWN';

export type AcceptanceState =
  | 'NOT_ACCEPTED'
  | 'ACCEPTED'
  | 'UNKNOWN'
  | 'AMBIGUOUS';

export type SafeEvolutionErrorEvidence = {
  httpStatus: number | null;
  providerErrorCode: string | null;
  providerErrorType: string | null;
  providerErrorMessageSafe: string | null;
  providerRequestId: string | null;
  endpoint: string;
  instanceName: string | null;
};

export type ClassifiedEvolutionFailure = {
  category: EvolutionSendCategory;
  errorCode: string;
  errorMessage: string;
  httpStatus: number | null;
  ambiguous: boolean;
  acceptanceState: AcceptanceState;
  evidence: SafeEvolutionErrorEvidence;
};

const CONTENT_REJECT_HINTS =
  /invalid\s*payload|payload\s*invalid|missing\s*required|required\s*field|unsupported\s*(message|media|type)|conteudo\s*invalido|empty\s*(text|body|content)|text\s*is\s*required|message\s*type\s*not\s*supported|bad\s*payload/i;

const DISCONNECT_HINTS =
  /instance\s*disconnected|connection\s*closed|connection\s*lost|not\s*connected|websocket\s*closed|session\s*unavailable|instancia\s*(desconectada|nao\s*conectada)|logout|connection\s*close|closed\s*connection|stream\s*errored|device\s*removed/i;

const NOT_FOUND_HINTS =
  /instance\s*not\s*found|instancia\s*nao\s*encontrada|does\s*not\s*exist|not\s*exist/i;

const RATE_HINTS = /rate\s*limit|too\s*many\s*requests|throttle/i;

const AUTH_HINTS = /unauthorized|forbidden|invalid\s*apikey|authentication|api\s*key/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/** Remove digitos longos (telefones) e trunca mensagem. */
export function sanitizeProviderMessage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let text = String(raw)
    .replace(/\+?\d[\d\s().-]{8,}\d/g, '[redacted]')
    .replace(/apikey[=:]\s*\S+/gi, 'apikey=[redacted]')
    .replace(/authorization[=:]\s*\S+/gi, 'authorization=[redacted]')
    .trim();
  if (text.length > 240) text = `${text.slice(0, 237)}...`;
  return text || null;
}

export function extractSafeErrorFields(
  body: unknown,
  rawText: string,
): {
  code: string | null;
  type: string | null;
  message: string | null;
  requestId: string | null;
} {
  const record = asRecord(body);
  const nested =
    asRecord(record?.error) ??
    asRecord(record?.response) ??
    asRecord(record?.data) ??
    null;

  const code =
    asString(record?.code) ??
    asString(record?.errorCode) ??
    asString(record?.statusCode) ??
    asString(nested?.code) ??
    asString(nested?.errorCode) ??
    null;

  const type =
    asString(record?.name) ??
    asString(record?.type) ??
    asString(record?.error) ??
    asString(nested?.name) ??
    asString(nested?.type) ??
    null;

  const message =
    sanitizeProviderMessage(
      asString(record?.message) ??
        asString(record?.errorMessage) ??
        asString(nested?.message) ??
        asString(record?.responseMessage) ??
        (rawText && !rawText.trim().startsWith('{')
          ? rawText.slice(0, 240)
          : null),
    ) ?? null;

  const requestId =
    asString(record?.requestId) ??
    asString(record?.correlationId) ??
    asString(record?.id) ??
    asString(nested?.requestId) ??
    null;

  return { code, type, message, requestId };
}

export function isDisconnectSignal(text: string | null | undefined): boolean {
  if (!text) return false;
  return DISCONNECT_HINTS.test(text);
}

export function isExplicitContentRejection(
  text: string | null | undefined,
): boolean {
  if (!text) return false;
  return CONTENT_REJECT_HINTS.test(text);
}

/**
 * Classifica falha HTTP/corpo Evolution.
 * CONTENT_REJECTED so com evidencia explicita de payload/conteudo.
 */
export function classifyEvolutionSendFailure(input: {
  httpStatus: number | null;
  body?: unknown;
  rawText?: string;
  networkErrorMessage?: string | null;
  aborted?: boolean;
  endpoint?: string;
  instanceName?: string | null;
}): ClassifiedEvolutionFailure {
  const endpoint = input.endpoint ?? 'message/sendText';
  const instanceName = input.instanceName ?? null;
  const extracted = extractSafeErrorFields(
    input.body ?? null,
    input.rawText ?? '',
  );
  const combined = [extracted.code, extracted.type, extracted.message]
    .filter(Boolean)
    .join(' ');

  const evidence: SafeEvolutionErrorEvidence = {
    httpStatus: input.httpStatus,
    providerErrorCode: extracted.code,
    providerErrorType: extracted.type,
    providerErrorMessageSafe: extracted.message,
    providerRequestId: extracted.requestId,
    endpoint,
    instanceName,
  };

  if (input.aborted) {
    return {
      category: 'UNKNOWN_PROVIDER_STATE',
      errorCode: 'TIMEOUT_OR_ABORT',
      errorMessage:
        'Timeout/abort na chamada: envio pode ter sido processado pelo provider',
      httpStatus: input.httpStatus,
      ambiguous: true,
      acceptanceState: 'AMBIGUOUS',
      evidence,
    };
  }

  if (input.networkErrorMessage) {
    const net = sanitizeProviderMessage(input.networkErrorMessage) ?? 'NETWORK_ERROR';
    if (isDisconnectSignal(net)) {
      return {
        category: 'PROVIDER_CONNECTION_CLOSED',
        errorCode: 'CONNECTION_CLOSED',
        errorMessage: 'Conexao com o provider foi encerrada',
        httpStatus: input.httpStatus,
        ambiguous: false,
        acceptanceState: 'NOT_ACCEPTED',
        evidence: {
          ...evidence,
          providerErrorMessageSafe: net,
        },
      };
    }
    return {
      category: 'TRANSIENT_NETWORK',
      errorCode: 'NETWORK_ERROR',
      errorMessage: 'Falha de rede antes de resposta do provider',
      httpStatus: null,
      ambiguous: false,
      acceptanceState: 'NOT_ACCEPTED',
      evidence: {
        ...evidence,
        providerErrorMessageSafe: net,
      },
    };
  }

  const status = input.httpStatus;

  if (isDisconnectSignal(combined)) {
    return {
      category: 'CHANNEL_DISCONNECTED',
      errorCode: extracted.code ?? 'INSTANCE_DISCONNECTED',
      errorMessage: 'Instancia Evolution desconectada ou sessao indisponivel',
      httpStatus: status,
      ambiguous: false,
      acceptanceState: 'NOT_ACCEPTED',
      evidence,
    };
  }

  if (isExplicitContentRejection(combined)) {
    return {
      category: 'CONTENT_REJECTED',
      errorCode: extracted.code ?? (status != null ? `HTTP_${status}` : 'CONTENT_REJECTED'),
      errorMessage: 'Provider rejeitou o payload/conteudo com evidencia explicita',
      httpStatus: status,
      ambiguous: false,
      acceptanceState: 'NOT_ACCEPTED',
      evidence,
    };
  }

  if (status === 429 || RATE_HINTS.test(combined)) {
    return {
      category: 'PROVIDER_RATE_LIMIT',
      errorCode: extracted.code ?? 'HTTP_429',
      errorMessage: 'Provider retornou limite de taxa',
      httpStatus: status ?? 429,
      ambiguous: false,
      acceptanceState: 'NOT_ACCEPTED',
      evidence,
    };
  }

  if (status === 401 || status === 403 || AUTH_HINTS.test(combined)) {
    return {
      category: 'AUTHENTICATION_ERROR',
      errorCode: extracted.code ?? `HTTP_${status ?? 401}`,
      errorMessage: 'Provider recusou autenticacao',
      httpStatus: status,
      ambiguous: false,
      acceptanceState: 'NOT_ACCEPTED',
      evidence,
    };
  }

  if (status === 404 || NOT_FOUND_HINTS.test(combined)) {
    const channelMissing = NOT_FOUND_HINTS.test(combined);
    return {
      category: channelMissing ? 'CHANNEL_NOT_FOUND' : 'INVALID_DESTINATION',
      errorCode: extracted.code ?? 'HTTP_404',
      errorMessage: channelMissing
        ? 'Instancia nao encontrada no provider'
        : 'Provider nao encontrou instancia/destino',
      httpStatus: status ?? 404,
      ambiguous: false,
      acceptanceState: 'NOT_ACCEPTED',
      evidence,
    };
  }

  if (status === 400 || status === 422) {
    return {
      category: 'PROVIDER_BAD_REQUEST',
      errorCode: extracted.code ?? `HTTP_${status}`,
      errorMessage:
        'Provider rejeitou a requisicao (400/422) sem evidencia explicita de conteudo',
      httpStatus: status,
      ambiguous: false,
      acceptanceState: 'NOT_ACCEPTED',
      evidence,
    };
  }

  if (status === 502 || status === 503 || status === 504) {
    return {
      category: 'PROVIDER_UNAVAILABLE',
      errorCode: extracted.code ?? `HTTP_${status}`,
      errorMessage: 'Provider indisponivel temporariamente',
      httpStatus: status,
      ambiguous: false,
      acceptanceState: 'NOT_ACCEPTED',
      evidence,
    };
  }

  if (status != null && status >= 500) {
    return {
      category: 'PROVIDER_UNAVAILABLE',
      errorCode: extracted.code ?? `HTTP_${status}`,
      errorMessage: 'Provider retornou erro interno',
      httpStatus: status,
      ambiguous: false,
      acceptanceState: 'NOT_ACCEPTED',
      evidence,
    };
  }

  if (status != null) {
    return {
      category: 'UNKNOWN',
      errorCode: extracted.code ?? `HTTP_${status}`,
      errorMessage: 'Provider retornou erro nao mapeado',
      httpStatus: status,
      ambiguous: false,
      acceptanceState: 'NOT_ACCEPTED',
      evidence,
    };
  }

  return {
    category: 'UNKNOWN',
    errorCode: 'UNKNOWN_ERROR',
    errorMessage: 'Falha sem status HTTP classificavel',
    httpStatus: null,
    ambiguous: false,
    acceptanceState: 'UNKNOWN',
    evidence,
  };
}

export function resolveProtectionThroughputDisplay(input: {
  requestedMessagesPerMinute: number | null;
  minDelaySeconds: number | null;
  maxDelaySeconds: number | null;
  instanceCount?: number;
}): {
  requestedMessagesPerMinute: number | null;
  protectionCeilingMessagesPerMinute: number | null;
  averageEstimateMessagesPerMinute: number | null;
  effectiveMessagesPerMinute: number | null;
  aggregateCapacityMessagesPerMinute: number | null;
  instanceCount: number;
} {
  const instances = Math.max(1, input.instanceCount ?? 1);
  const minDelay = input.minDelaySeconds;
  const maxDelay = input.maxDelaySeconds;
  const requested = input.requestedMessagesPerMinute;

  const protectionCeiling =
    minDelay != null && minDelay > 0 ? 60 / minDelay : null;
  const averageEstimate =
    minDelay != null &&
    maxDelay != null &&
    minDelay > 0 &&
    maxDelay >= minDelay
      ? 60 / ((minDelay + maxDelay) / 2)
      : null;

  let effective: number | null = null;
  if (averageEstimate != null && requested != null) {
    effective = Math.min(requested, averageEstimate);
  } else if (averageEstimate != null) {
    effective = averageEstimate;
  } else if (requested != null && protectionCeiling != null) {
    effective = Math.min(requested, protectionCeiling);
  } else {
    effective = requested;
  }

  const perInstance = effective ?? averageEstimate ?? protectionCeiling;
  const aggregate =
    perInstance != null ? perInstance * instances : null;

  return {
    requestedMessagesPerMinute: requested,
    protectionCeilingMessagesPerMinute:
      protectionCeiling != null
        ? Number(protectionCeiling.toFixed(4))
        : null,
    averageEstimateMessagesPerMinute:
      averageEstimate != null ? Number(averageEstimate.toFixed(4)) : null,
    effectiveMessagesPerMinute:
      effective != null ? Number(effective.toFixed(4)) : null,
    aggregateCapacityMessagesPerMinute:
      aggregate != null ? Number(aggregate.toFixed(4)) : null,
    instanceCount: instances,
  };
}
