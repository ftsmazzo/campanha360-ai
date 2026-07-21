-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM (
    'DRAFT',
    'PREPARING',
    'READY',
    'QUEUED',
    'RUNNING',
    'PAUSING',
    'PAUSED',
    'COMPLETED',
    'COMPLETED_WITH_ERRORS',
    'FAILED',
    'CANCELED',
    'EMERGENCY_STOPPED'
);

-- CreateTable
CREATE TABLE "Dispatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "dispatchPlanId" TEXT NOT NULL,
    "channelAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "channelType" "ChannelType" NOT NULL,
    "contentSnapshot" JSONB NOT NULL,
    "configurationSnapshot" JSONB NOT NULL,
    "approvalSnapshot" JSONB NOT NULL,
    "status" "DispatchStatus" NOT NULL DEFAULT 'DRAFT',
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "pendingItems" INTEGER NOT NULL DEFAULT 0,
    "queuedItems" INTEGER NOT NULL DEFAULT 0,
    "processingItems" INTEGER NOT NULL DEFAULT 0,
    "sentItems" INTEGER NOT NULL DEFAULT 0,
    "deliveredItems" INTEGER NOT NULL DEFAULT 0,
    "readItems" INTEGER NOT NULL DEFAULT 0,
    "failedItems" INTEGER NOT NULL DEFAULT 0,
    "skippedItems" INTEGER NOT NULL DEFAULT 0,
    "canceledItems" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "preparedAt" TIMESTAMP(3),
    "queuedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "pausingAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "resumedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "emergencyStoppedAt" TIMESTAMP(3),
    "lastProgressAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Dispatch_dispatchPlanId_key" ON "Dispatch"("dispatchPlanId");

-- CreateIndex
CREATE INDEX "Dispatch_organizationId_campaignId_idx" ON "Dispatch"("organizationId", "campaignId");

-- CreateIndex
CREATE INDEX "Dispatch_campaignId_status_idx" ON "Dispatch"("campaignId", "status");

-- CreateIndex
CREATE INDEX "Dispatch_dispatchPlanId_idx" ON "Dispatch"("dispatchPlanId");

-- CreateIndex
CREATE INDEX "Dispatch_channelAccountId_idx" ON "Dispatch"("channelAccountId");

-- CreateIndex
CREATE INDEX "Dispatch_status_createdAt_idx" ON "Dispatch"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_dispatchPlanId_fkey" FOREIGN KEY ("dispatchPlanId") REFERENCES "DispatchPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "ChannelAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
