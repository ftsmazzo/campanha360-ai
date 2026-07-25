/**
 * Consulta leve do estado de conexao Evolution (09.6.4).
 * Usado apos erro compativel com desconexao — nao envia mensagem.
 */

export type EvolutionConnectionCheckStatus =
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'UNKNOWN'
  | 'UNAVAILABLE';

export type EvolutionConnectionCheckResult = {
  status: EvolutionConnectionCheckStatus;
  rawState: string | null;
  httpStatus: number | null;
  errorCode: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t || null;
}

function mapState(raw: string | null): EvolutionConnectionCheckStatus {
  if (!raw) return 'UNKNOWN';
  const n = raw.toLowerCase();
  if (['open', 'connected', 'authenticated'].includes(n)) return 'CONNECTED';
  if (['connecting', 'pairing', 'qr', 'qrcode'].includes(n)) return 'CONNECTING';
  if (['close', 'closed', 'disconnected', 'logout'].includes(n)) {
    return 'DISCONNECTED';
  }
  return 'UNKNOWN';
}

export async function checkEvolutionConnectionState(input: {
  baseUrl: string;
  apiKey?: string;
  instanceName: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<EvolutionConnectionCheckResult> {
  const base = (input.baseUrl ?? '').replace(/\/+$/, '');
  const instance = (input.instanceName ?? '').trim();
  if (!base || !instance) {
    return {
      status: 'UNAVAILABLE',
      rawState: null,
      httpStatus: null,
      errorCode: 'EVOLUTION_CONFIG_MISSING',
    };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? 5_000,
  );

  try {
    const response = await fetchImpl(
      `${base}/instance/connectionState/${encodeURIComponent(instance)}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(input.apiKey ? { apikey: input.apiKey } : {}),
        },
        signal: controller.signal,
      },
    );
    const httpStatus = response.status;
    if (!response.ok) {
      return {
        status: 'UNAVAILABLE',
        rawState: null,
        httpStatus,
        errorCode: `HTTP_${httpStatus}`,
      };
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      return {
        status: 'UNKNOWN',
        rawState: null,
        httpStatus,
        errorCode: 'INVALID_JSON',
      };
    }
    const record = asRecord(body) ?? {};
    const nested =
      asRecord(record.instance) ?? asRecord(record.data) ?? record;
    const rawState =
      asString(nested.state) ??
      asString(nested.connectionStatus) ??
      asString(record.state) ??
      asString(record.connectionStatus);
    return {
      status: mapState(rawState),
      rawState,
      httpStatus,
      errorCode: null,
    };
  } catch {
    return {
      status: 'UNAVAILABLE',
      rawState: null,
      httpStatus: null,
      errorCode: 'CONNECTION_CHECK_FAILED',
    };
  } finally {
    clearTimeout(timeout);
  }
}
