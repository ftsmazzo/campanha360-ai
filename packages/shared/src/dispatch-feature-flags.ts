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
