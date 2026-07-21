-- CreateEnum
CREATE TYPE "DispatchPlanStatus" AS ENUM (
    'DRAFT',
    'VALIDATING',
    'VALIDATED',
    'BLOCKED',
    'APPROVED',
    'REJECTED',
    'EXPIRED',
    'CANCELED'
);

-- CreateTable
CREATE TABLE "DispatchPlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "channelAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "channelType" "ChannelType" NOT NULL,
    "content" TEXT NOT NULL,
    "status" "DispatchPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispatchPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DispatchPlan_organizationId_campaignId_idx"
    ON "DispatchPlan"("organizationId", "campaignId");

-- CreateIndex
CREATE INDEX "DispatchPlan_campaignId_status_idx"
    ON "DispatchPlan"("campaignId", "status");

-- CreateIndex
CREATE INDEX "DispatchPlan_segmentId_idx" ON "DispatchPlan"("segmentId");

-- CreateIndex
CREATE INDEX "DispatchPlan_channelAccountId_idx"
    ON "DispatchPlan"("channelAccountId");

-- AddForeignKey
ALTER TABLE "DispatchPlan"
    ADD CONSTRAINT "DispatchPlan_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchPlan"
    ADD CONSTRAINT "DispatchPlan_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchPlan"
    ADD CONSTRAINT "DispatchPlan_segmentId_fkey"
    FOREIGN KEY ("segmentId") REFERENCES "Segment"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchPlan"
    ADD CONSTRAINT "DispatchPlan_channelAccountId_fkey"
    FOREIGN KEY ("channelAccountId") REFERENCES "ChannelAccount"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchPlan"
    ADD CONSTRAINT "DispatchPlan_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
