import { DispatchItemStatus, DispatchStatus } from '@prisma/client';
import { getDispatchPilotMaxItems } from '@campanha360/shared';
import { isDispatchStartWithinPilotLimit } from './dispatch-prepare.util';

/**
 * Regras puras da subetapa 09.4 (inicio de execucao real). Mantidas fora
 * do service para permitir testes unitarios sem mocks de Prisma/BullMQ.
 */

/** Items que, no momento do start, sao re-publicados no BullMQ (claim QUEUED -> RUNNING). */
export const DISPATCH_START_ELIGIBLE_ITEM_STATUSES: DispatchItemStatus[] = [
  DispatchItemStatus.QUEUED,
  DispatchItemStatus.RETRY_SCHEDULED,
  DispatchItemStatus.SCHEDULED,
];

export type DispatchForStartPreconditions = {
  status: DispatchStatus | string;
  totalItems: number;
  queuedItems: number;
  requiringRedistribution: boolean;
};

/**
 * Valida pre-condicoes de inicio (09.4, secao "start"). Lanca Error (texto
 * amigavel) para ser convertido em BadRequestException pelo service.
 * Nao valida as feature flags (ENGINE/QUEUE/SEND) — isso e feito
 * separadamente via `assertDispatchSendAllowed` (shared).
 */
export function assertDispatchStartPreconditions(
  dispatch: DispatchForStartPreconditions,
): void {
  if (dispatch.status !== DispatchStatus.QUEUED && dispatch.status !== 'QUEUED') {
    throw new Error('Somente Dispatch QUEUED pode ser iniciado');
  }
  if (dispatch.queuedItems <= 0) {
    throw new Error('Dispatch sem items QUEUED para iniciar');
  }
  if (dispatch.requiringRedistribution) {
    throw new Error('Dispatch exige redistribuicao antes de iniciar');
  }
}

/** Bloqueia o start quando o volume total excede o teto rigido do piloto. */
export function assertDispatchStartWithinPilotLimit(totalItems: number): void {
  if (!isDispatchStartWithinPilotLimit(totalItems)) {
    throw new Error(
      `Volume (${totalItems}) excede o teto do piloto (${getDispatchPilotMaxItems()} items); reduza o publico ou desative DISPATCH_PILOT_MODE em ambiente autorizado`,
    );
  }
}
