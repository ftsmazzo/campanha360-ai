import { ContactStatus } from '@prisma/client';

/** Status apos limpar opt-out/bloqueio manual. */
export function resolveStatusAfterClearOptOut(
  currentStatus: ContactStatus | string,
): ContactStatus | undefined {
  if (currentStatus === ContactStatus.BLOCKED || currentStatus === 'BLOCKED') {
    return ContactStatus.ACTIVE;
  }
  return undefined;
}
