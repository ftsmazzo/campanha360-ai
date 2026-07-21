/**
 * Constantes e contrato do payload de job da fila de envio de disparo
 * (BullMQ, subetapa 09.3). O payload deve permanecer minimo: apenas
 * identificadores. Dados sensiveis (destino, conteudo, tokens) NUNCA
 * devem trafegar no job — sempre re-lidos do banco pelo worker.
 *
 * Importante: BullMQ nao permite ":" em custom job IDs.
 */

export const DISPATCH_SEND_QUEUE_NAME = 'dispatch-send';

/** Prefixo do jobId customizado — alinhado ao nome da fila, sem ":". */
export const DISPATCH_SEND_JOB_ID_PREFIX = DISPATCH_SEND_QUEUE_NAME;

/**
 * JobId deterministico compativel com BullMQ.
 * Formato: dispatch-send-{dispatchId}-{dispatchItemId}
 * Nao usa ":" (rejeitado pelo BullMQ em custom IDs).
 */
export function buildDispatchSendJobId(
  dispatchId: string,
  dispatchItemId: string,
): string {
  if (!dispatchId || !dispatchId.trim()) {
    throw new Error('dispatchId obrigatorio para montar jobId');
  }
  if (!dispatchItemId || !dispatchItemId.trim()) {
    throw new Error('dispatchItemId obrigatorio para montar jobId');
  }

  const safeDispatchId = dispatchId.trim();
  const safeItemId = dispatchItemId.trim();
  const jobId = `${DISPATCH_SEND_JOB_ID_PREFIX}-${safeDispatchId}-${safeItemId}`;

  if (jobId.includes(':') || jobId.includes(' ')) {
    throw new Error('jobId de disparo invalido: nao pode conter ":" ou espacos');
  }

  return jobId;
}

export type DispatchSendJobPayload = {
  dispatchId: string;
  dispatchItemId: string;
  organizationId: string;
  campaignId: string;
};

/** Unicas chaves permitidas no payload do job — contrato minimo e fechado. */
const ALLOWED_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  'dispatchId',
  'dispatchItemId',
  'organizationId',
  'campaignId',
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Valida que o payload do job contem apenas os identificadores minimos
 * esperados. Rejeita qualquer chave adicional (ex.: destination, content,
 * token, telefone, phone, message) para impedir que dados sensiveis ou
 * PII vazem para a fila.
 */
export function assertDispatchSendJobPayload(
  value: unknown,
): DispatchSendJobPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Payload do job de disparo invalido: objeto esperado');
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);

  const unexpectedKeys = keys.filter((key) => !ALLOWED_PAYLOAD_KEYS.has(key));
  if (unexpectedKeys.length > 0) {
    throw new Error(
      `Payload do job de disparo contem campos nao permitidos: ${unexpectedKeys.join(', ')}`,
    );
  }

  for (const key of ALLOWED_PAYLOAD_KEYS) {
    if (!isNonEmptyString(record[key])) {
      throw new Error(
        `Payload do job de disparo invalido: campo obrigatorio ausente ou vazio (${key})`,
      );
    }
  }

  return {
    dispatchId: record.dispatchId as string,
    dispatchItemId: record.dispatchItemId as string,
    organizationId: record.organizationId as string,
    campaignId: record.campaignId as string,
  };
}

export const DISPATCH_SEND_JOB_OPTIONS = {
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
};
