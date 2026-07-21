-- CreateTable
CREATE TABLE "DispatchChannelUsageDaily" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "dispatchChannelId" TEXT NOT NULL,
    "channelAccountId" TEXT NOT NULL,
    "usageDate" DATE NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispatchChannelUsageDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DispatchChannelUsageDaily_dispatchChannelId_usageDate_key" ON "DispatchChannelUsageDaily"("dispatchChannelId", "usageDate");

-- CreateIndex
CREATE INDEX "DispatchChannelUsageDaily_organizationId_campaignId_idx" ON "DispatchChannelUsageDaily"("organizationId", "campaignId");

-- CreateIndex
CREATE INDEX "DispatchChannelUsageDaily_channelAccountId_usageDate_idx" ON "DispatchChannelUsageDaily"("channelAccountId", "usageDate");

-- AddForeignKey
ALTER TABLE "DispatchChannelUsageDaily" ADD CONSTRAINT "DispatchChannelUsageDaily_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchChannelUsageDaily" ADD CONSTRAINT "DispatchChannelUsageDaily_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchChannelUsageDaily" ADD CONSTRAINT "DispatchChannelUsageDaily_dispatchChannelId_fkey" FOREIGN KEY ("dispatchChannelId") REFERENCES "DispatchChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchChannelUsageDaily" ADD CONSTRAINT "DispatchChannelUsageDaily_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "ChannelAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
