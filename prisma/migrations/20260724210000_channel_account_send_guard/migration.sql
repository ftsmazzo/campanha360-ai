-- 09.6.1 — Reserva atomica de slot por ChannelAccount + evidencia de blindagem

CREATE TABLE "ChannelAccountSendGuard" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "channelAccountId" TEXT NOT NULL,
    "nextAvailableAt" TIMESTAMP(3),
    "lastReservedAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3),
    "reservationToken" TEXT,
    "reservationExpiresAt" TIMESTAMP(3),
    "lastSelectedDelaySeconds" INTEGER,
    "sequenceNumber" INTEGER NOT NULL DEFAULT 0,
    "dailyUsageDate" DATE,
    "dailySentCount" INTEGER NOT NULL DEFAULT 0,
    "hourlyWindowStart" TIMESTAMP(3),
    "hourlySentCount" INTEGER NOT NULL DEFAULT 0,
    "protectionCooldownUntil" TIMESTAMP(3),
    "lastViolationAt" TIMESTAMP(3),
    "violationCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelAccountSendGuard_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelAccountSendGuard_channelAccountId_key" ON "ChannelAccountSendGuard"("channelAccountId");
CREATE INDEX "ChannelAccountSendGuard_organizationId_campaignId_idx" ON "ChannelAccountSendGuard"("organizationId", "campaignId");
CREATE INDEX "ChannelAccountSendGuard_nextAvailableAt_idx" ON "ChannelAccountSendGuard"("nextAvailableAt");
CREATE INDEX "ChannelAccountSendGuard_protectionCooldownUntil_idx" ON "ChannelAccountSendGuard"("protectionCooldownUntil");

ALTER TABLE "ChannelAccountSendGuard" ADD CONSTRAINT "ChannelAccountSendGuard_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChannelAccountSendGuard" ADD CONSTRAINT "ChannelAccountSendGuard_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChannelAccountSendGuard" ADD CONSTRAINT "ChannelAccountSendGuard_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "ChannelAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DispatchItem" ADD COLUMN "protectionDelaySeconds" INTEGER;
ALTER TABLE "DispatchItem" ADD COLUMN "protectionScheduledAt" TIMESTAMP(3);
ALTER TABLE "DispatchItem" ADD COLUMN "protectionRuleApplied" TEXT;
ALTER TABLE "DispatchItem" ADD COLUMN "protectionSequenceNumber" INTEGER;

ALTER TABLE "DispatchItemAttempt" ADD COLUMN "protectionProfile" TEXT;
ALTER TABLE "DispatchItemAttempt" ADD COLUMN "minDelaySeconds" INTEGER;
ALTER TABLE "DispatchItemAttempt" ADD COLUMN "maxDelaySeconds" INTEGER;
ALTER TABLE "DispatchItemAttempt" ADD COLUMN "selectedDelaySeconds" INTEGER;
ALTER TABLE "DispatchItemAttempt" ADD COLUMN "previousChannelSendAt" TIMESTAMP(3);
ALTER TABLE "DispatchItemAttempt" ADD COLUMN "reservedSendAt" TIMESTAMP(3);
ALTER TABLE "DispatchItemAttempt" ADD COLUMN "actualProviderRequestStartedAt" TIMESTAMP(3);
ALTER TABLE "DispatchItemAttempt" ADD COLUMN "intervalObservedSeconds" INTEGER;
ALTER TABLE "DispatchItemAttempt" ADD COLUMN "sequenceNumber" INTEGER;
ALTER TABLE "DispatchItemAttempt" ADD COLUMN "hourlyUsageBefore" INTEGER;
ALTER TABLE "DispatchItemAttempt" ADD COLUMN "dailyUsageBefore" INTEGER;
ALTER TABLE "DispatchItemAttempt" ADD COLUMN "effectiveDailyLimit" INTEGER;
ALTER TABLE "DispatchItemAttempt" ADD COLUMN "batchPosition" INTEGER;
ALTER TABLE "DispatchItemAttempt" ADD COLUMN "batchNumber" INTEGER;
ALTER TABLE "DispatchItemAttempt" ADD COLUMN "pauseApplied" BOOLEAN;
ALTER TABLE "DispatchItemAttempt" ADD COLUMN "pauseReason" TEXT;
ALTER TABLE "DispatchItemAttempt" ADD COLUMN "protectionDecision" TEXT;
ALTER TABLE "DispatchItemAttempt" ADD COLUMN "protectionReason" TEXT;

CREATE INDEX "DispatchItemAttempt_channelAccountId_idx" ON "DispatchItemAttempt"("channelAccountId");
