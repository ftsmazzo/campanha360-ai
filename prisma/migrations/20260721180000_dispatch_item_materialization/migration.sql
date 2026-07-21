-- CreateEnum
CREATE TYPE "DispatchItemStatus" AS ENUM (
    'PENDING',
    'SCHEDULED',
    'QUEUED',
    'PROCESSING',
    'SENT',
    'DELIVERED',
    'READ',
    'RETRY_SCHEDULED',
    'FAILED',
    'SKIPPED',
    'CANCELED',
    'UNKNOWN_PROVIDER_STATE'
);

-- CreateEnum
CREATE TYPE "DispatchItemErrorCategory" AS ENUM (
    'TRANSIENT_NETWORK',
    'PROVIDER_RATE_LIMIT',
    'PROVIDER_UNAVAILABLE',
    'PROVIDER_TIMEOUT',
    'CHANNEL_DISCONNECTED',
    'AUTHENTICATION_ERROR',
    'INVALID_DESTINATION',
    'CONTENT_REJECTED',
    'CONTACT_OPT_OUT',
    'CONTACT_BLOCKED',
    'CONTACT_DELETED',
    'DISPATCH_PAUSED',
    'DISPATCH_CANCELED',
    'OUTSIDE_WINDOW',
    'DUPLICATE_PREVENTED',
    'UNKNOWN'
);

-- CreateTable
CREATE TABLE "DispatchItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "dispatchId" TEXT NOT NULL,
    "dispatchPlanId" TEXT NOT NULL,
    "dispatchPlanRecipientId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channelAccountId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "normalizedDestination" TEXT NOT NULL,
    "contactSnapshot" JSONB NOT NULL,
    "contentSnapshot" JSONB NOT NULL,
    "status" "DispatchItemStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "scheduledAt" TIMESTAMP(3),
    "queuedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "lockToken" TEXT,
    "lockExpiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "providerStatus" TEXT,
    "errorCategory" "DispatchItemErrorCategory",
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DispatchItem_dispatchId_dispatchPlanRecipientId_key" ON "DispatchItem"("dispatchId", "dispatchPlanRecipientId");

-- CreateIndex
CREATE UNIQUE INDEX "DispatchItem_dispatchId_normalizedDestination_key" ON "DispatchItem"("dispatchId", "normalizedDestination");

-- CreateIndex
CREATE INDEX "DispatchItem_dispatchId_idx" ON "DispatchItem"("dispatchId");

-- CreateIndex
CREATE INDEX "DispatchItem_dispatchId_status_idx" ON "DispatchItem"("dispatchId", "status");

-- CreateIndex
CREATE INDEX "DispatchItem_organizationId_campaignId_idx" ON "DispatchItem"("organizationId", "campaignId");

-- CreateIndex
CREATE INDEX "DispatchItem_channelAccountId_status_idx" ON "DispatchItem"("channelAccountId", "status");

-- CreateIndex
CREATE INDEX "DispatchItem_contactId_idx" ON "DispatchItem"("contactId");

-- CreateIndex
CREATE INDEX "DispatchItem_normalizedDestination_idx" ON "DispatchItem"("normalizedDestination");

-- CreateIndex
CREATE INDEX "DispatchItem_providerMessageId_idx" ON "DispatchItem"("providerMessageId");

-- CreateIndex
CREATE INDEX "DispatchItem_nextRetryAt_idx" ON "DispatchItem"("nextRetryAt");

-- CreateIndex
CREATE INDEX "DispatchItem_lockedAt_idx" ON "DispatchItem"("lockedAt");

-- CreateIndex
CREATE INDEX "DispatchItem_createdAt_idx" ON "DispatchItem"("createdAt");

-- AddForeignKey
ALTER TABLE "DispatchItem" ADD CONSTRAINT "DispatchItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchItem" ADD CONSTRAINT "DispatchItem_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchItem" ADD CONSTRAINT "DispatchItem_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "Dispatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchItem" ADD CONSTRAINT "DispatchItem_dispatchPlanId_fkey" FOREIGN KEY ("dispatchPlanId") REFERENCES "DispatchPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchItem" ADD CONSTRAINT "DispatchItem_dispatchPlanRecipientId_fkey" FOREIGN KEY ("dispatchPlanRecipientId") REFERENCES "DispatchPlanRecipient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchItem" ADD CONSTRAINT "DispatchItem_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchItem" ADD CONSTRAINT "DispatchItem_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "ChannelAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
