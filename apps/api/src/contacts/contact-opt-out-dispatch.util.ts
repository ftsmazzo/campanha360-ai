import {
  DispatchItemStatus,
  type PrismaClient,
} from '@prisma/client';

/** Estados ainda nao enviados que podem ser skipped apos opt-out. */
export const OPT_OUT_SKIPPABLE_ITEM_STATUSES: DispatchItemStatus[] = [
  DispatchItemStatus.PENDING,
  DispatchItemStatus.SCHEDULED,
  DispatchItemStatus.QUEUED,
  DispatchItemStatus.RETRY_SCHEDULED,
];

/**
 * Marca items nao enviados do contato como SKIPPED_CONTACT_OPT_OUT.
 * Nao toca items com providerRequestStartedAt (chamada externa iniciada).
 */
export async function skipPendingDispatchItemsForContactOptOut(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    campaignId: string;
    contactId: string;
    now?: Date;
  },
): Promise<{ skipped: number }> {
  const now = input.now ?? new Date();
  const result = await prisma.dispatchItem.updateMany({
    where: {
      organizationId: input.organizationId,
      campaignId: input.campaignId,
      contactId: input.contactId,
      status: { in: OPT_OUT_SKIPPABLE_ITEM_STATUSES },
      providerRequestStartedAt: null,
      providerMessageId: null,
      sentAt: null,
    },
    data: {
      status: DispatchItemStatus.SKIPPED,
      skippedAt: now,
      errorCategory: 'CONTACT_OPT_OUT',
      errorCode: 'CONTACT_OPT_OUT',
      errorMessage: 'Contato em opt-out; envio cancelado',
      nextRetryAt: null,
      lockedAt: null,
      lockToken: null,
      lockExpiresAt: null,
      lastQueueError: 'SKIPPED_CONTACT_OPT_OUT',
      protectionScheduledAt: null,
      protectionDelaySeconds: null,
      protectionRuleApplied: null,
      protectionSequenceNumber: null,
    },
  });

  // PROCESSING sem request externa
  const processing = await prisma.dispatchItem.updateMany({
    where: {
      organizationId: input.organizationId,
      campaignId: input.campaignId,
      contactId: input.contactId,
      status: DispatchItemStatus.PROCESSING,
      providerRequestStartedAt: null,
      providerMessageId: null,
      sentAt: null,
    },
    data: {
      status: DispatchItemStatus.SKIPPED,
      skippedAt: now,
      errorCategory: 'CONTACT_OPT_OUT',
      errorCode: 'CONTACT_OPT_OUT',
      errorMessage: 'Contato em opt-out; envio cancelado',
      nextRetryAt: null,
      lockedAt: null,
      lockToken: null,
      lockExpiresAt: null,
      lastQueueError: 'SKIPPED_CONTACT_OPT_OUT',
    },
  });

  return { skipped: result.count + processing.count };
}
