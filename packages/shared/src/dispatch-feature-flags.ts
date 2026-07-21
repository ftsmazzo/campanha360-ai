/**
 * Feature flags conservadoras para a introducao gradual do motor de
 * disparo (fila BullMQ, subetapa 09.3). Todas as flags tem default
 * desligado — em especial DISPATCH_SEND_ENABLED, que NUNCA deve ter
 * default true, pois controla o envio real de mensagens.
 */

const TRUTHY_VALUES = new Set(['true', '1', 'yes', 'on']);

function parseBooleanEnv(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value == null) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return defaultValue;
  return TRUTHY_VALUES.has(normalized);
}

export function isDispatchEngineEnabled(): boolean {
  return parseBooleanEnv(process.env.DISPATCH_ENGINE_ENABLED, false);
}

export function isDispatchQueueEnabled(): boolean {
  return parseBooleanEnv(process.env.DISPATCH_QUEUE_ENABLED, false);
}

/** NUNCA default true: controla o disparo real de mensagens. */
export function isDispatchSendEnabled(): boolean {
  return parseBooleanEnv(process.env.DISPATCH_SEND_ENABLED, false);
}

/**
 * Garante que o motor de disparo e a fila estejam habilitados antes de
 * qualquer operacao de enfileiramento. Lanca erro caso contrario.
 */
export function assertDispatchQueueAllowed(): void {
  if (!isDispatchEngineEnabled()) {
    throw new Error(
      'Motor de disparo desabilitado (DISPATCH_ENGINE_ENABLED=false)',
    );
  }
  if (!isDispatchQueueEnabled()) {
    throw new Error(
      'Fila de disparo desabilitada (DISPATCH_QUEUE_ENABLED=false)',
    );
  }
}

/**
 * Garante que motor + fila + envio real estejam habilitados. Usado antes
 * de iniciar execucao (start) e antes de qualquer chamada a Evolution
 * (subetapa 09.4). Lanca erro caso qualquer uma das tres flags esteja off.
 */
export function assertDispatchSendAllowed(): void {
  assertDispatchQueueAllowed();
  if (!isDispatchSendEnabled()) {
    throw new Error(
      'Envio real de disparo desabilitado (DISPATCH_SEND_ENABLED=false)',
    );
  }
}

/**
 * Modo piloto (subetapa 09.4/09.8): default TRUE (conservador) — enquanto
 * nao houver homologacao explicita, o piloto permanece restrito por
 * padrao. So deve ser desligado deliberadamente em ambiente autorizado.
 */
export function isDispatchPilotMode(): boolean {
  return parseBooleanEnv(process.env.DISPATCH_PILOT_MODE, true);
}

const DEFAULT_DISPATCH_PILOT_MAX_ITEMS = 5;

/** Limite rigido de items por Dispatch durante o piloto (default 5). */
export function getDispatchPilotMaxItems(): number {
  const raw = process.env.DISPATCH_PILOT_MAX_ITEMS;
  if (raw == null || !raw.trim()) return DEFAULT_DISPATCH_PILOT_MAX_ITEMS;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_DISPATCH_PILOT_MAX_ITEMS;
  }
  return parsed;
}

function normalizeDestinationDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Lista de destinos autorizados no piloto, via CSV em
 * DISPATCH_ALLOWED_DESTINATIONS. Cada valor e normalizado para apenas
 * digitos. Lista vazia (default) significa "sem restricao de allowlist".
 */
export function getDispatchAllowedDestinations(): string[] {
  const raw = process.env.DISPATCH_ALLOWED_DESTINATIONS;
  if (!raw || !raw.trim()) return [];
  return raw
    .split(',')
    .map((value) => normalizeDestinationDigits(value.trim()))
    .filter((value) => value.length > 0);
}

/** Verifica se um destino normalizado esta na allowlist (ou se ela esta vazia). */
export function isDispatchDestinationAllowed(
  normalizedDestination: string,
): boolean {
  const allowlist = getDispatchAllowedDestinations();
  if (allowlist.length === 0) return true;
  const digits = normalizeDestinationDigits(normalizedDestination ?? '');
  return allowlist.includes(digits);
}
