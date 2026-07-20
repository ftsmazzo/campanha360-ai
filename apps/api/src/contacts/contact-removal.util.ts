import { ContactStatus, Prisma } from '@prisma/client';

export type ContactRemovalSignals = {
  messageCount: number;
  threadCount: number;
  optOutCount: number;
  status: ContactStatus | string;
};

/** Soft delete quando ha historico/opt-out; hard delete so sem vinculos relevantes. */
export function resolveContactRemovalMode(
  signals: ContactRemovalSignals,
): 'soft' | 'hard' {
  if (
    signals.messageCount > 0 ||
    signals.threadCount > 0 ||
    signals.optOutCount > 0 ||
    signals.status === ContactStatus.BLOCKED ||
    signals.status === 'BLOCKED'
  ) {
    return 'soft';
  }
  return 'hard';
}

/** Listagem padrao oculta contatos removidos, salvo filtro explicito de status. */
export function buildDefaultContactStatusFilter(
  explicitStatus?: ContactStatus,
): Prisma.ContactWhereInput {
  if (explicitStatus) {
    return { status: explicitStatus };
  }
  return { status: { not: ContactStatus.DELETED } };
}

export function isContactRemoved(status: ContactStatus | string): boolean {
  return status === ContactStatus.DELETED || status === 'DELETED';
}
