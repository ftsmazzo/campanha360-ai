/**
 * Re-export das constantes/contrato da fila de envio de disparo a partir
 * do pacote shared. Nao redeclarar literais aqui — a fonte de verdade
 * fica em packages/shared/src/dispatch-queue.constants.ts para ser
 * reutilizavel pelo worker (subetapa futura).
 */
export {
  DISPATCH_SEND_QUEUE_NAME,
  DISPATCH_SEND_JOB_ID_PREFIX,
  buildDispatchSendJobId,
  assertDispatchSendJobPayload,
  DISPATCH_SEND_JOB_OPTIONS,
  type DispatchSendJobPayload,
} from '@campanha360/shared';
