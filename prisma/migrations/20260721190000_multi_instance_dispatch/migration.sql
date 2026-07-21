-- Multi-instance DispatchPlanChannel / DispatchChannel + compatibility backfill

CREATE TYPE "ProtectionProfile" AS ENUM ('CONSERVATIVE', 'MODERATE', 'AGGRESSIVE', 'CUSTOM');
CREATE TYPE "DistributionStrategy" AS ENUM ('CAPACITY_WEIGHTED');
CREATE TYPE "DispatchChannelOperationalStatus" AS ENUM (
  'READY', 'COOLDOWN', 'DISCONNECTED', 'ARCHIVED', 'CAPACITY_EXHAUSTED', 'BLOCKED', 'DISABLED'
);

ALTER TABLE "DispatchPlan"
  ADD COLUMN "protectionPolicySnapshot" JSONB,
  ADD COLUMN "legacySingleChannel" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "multiInstanceEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "DispatchPlanChannel" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "dispatchPlanId" TEXT NOT NULL,
  "channelAccountId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "weight" INTEGER NOT NULL DEFAULT 100,
  "dailyLimit" INTEGER NOT NULL DEFAULT 200,
  "hourlyLimit" INTEGER,
  "newAccountDailyLimit" INTEGER NOT NULL DEFAULT 50,
  "warmupDailyLimit" INTEGER NOT NULL DEFAULT 20,
  "assignedCapacity" INTEGER NOT NULL DEFAULT 0,
  "assignedRecipients" INTEGER NOT NULL DEFAULT 0,
  "configurationSnapshot" JSONB,
  "healthSnapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DispatchPlanChannel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DispatchPlanChannel_dispatchPlanId_channelAccountId_key"
  ON "DispatchPlanChannel"("dispatchPlanId", "channelAccountId");
CREATE INDEX "DispatchPlanChannel_dispatchPlanId_idx" ON "DispatchPlanChannel"("dispatchPlanId");
CREATE INDEX "DispatchPlanChannel_organizationId_campaignId_idx" ON "DispatchPlanChannel"("organizationId", "campaignId");
CREATE INDEX "DispatchPlanChannel_channelAccountId_idx" ON "DispatchPlanChannel"("channelAccountId");

ALTER TABLE "DispatchPlanChannel"
  ADD CONSTRAINT "DispatchPlanChannel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DispatchPlanChannel_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DispatchPlanChannel_dispatchPlanId_fkey" FOREIGN KEY ("dispatchPlanId") REFERENCES "DispatchPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DispatchPlanChannel_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "ChannelAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: one DispatchPlanChannel per existing plan.channelAccountId
INSERT INTO "DispatchPlanChannel" (
  "id", "organizationId", "campaignId", "dispatchPlanId", "channelAccountId",
  "enabled", "priority", "weight", "dailyLimit", "newAccountDailyLimit", "warmupDailyLimit",
  "assignedCapacity", "assignedRecipients", "createdAt", "updatedAt"
)
SELECT
  md5(random()::text || clock_timestamp()::text || p.id)::text,
  p."organizationId",
  p."campaignId",
  p.id,
  p."channelAccountId",
  true,
  100,
  100,
  200,
  50,
  20,
  0,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "DispatchPlan" p
WHERE NOT EXISTS (
  SELECT 1 FROM "DispatchPlanChannel" c WHERE c."dispatchPlanId" = p.id
);

-- Mark existing APPROVED plans as legacy single-channel
UPDATE "DispatchPlan"
SET "legacySingleChannel" = true,
    "multiInstanceEnabled" = false
WHERE "status" = 'APPROVED';

ALTER TABLE "Dispatch"
  ADD COLUMN "requiringRedistribution" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "multiInstance" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "DispatchChannel" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "dispatchId" TEXT NOT NULL,
  "dispatchPlanChannelId" TEXT NOT NULL,
  "channelAccountId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "weight" INTEGER NOT NULL DEFAULT 100,
  "effectiveDailyLimit" INTEGER NOT NULL DEFAULT 0,
  "assignedItems" INTEGER NOT NULL DEFAULT 0,
  "processedItems" INTEGER NOT NULL DEFAULT 0,
  "sentItems" INTEGER NOT NULL DEFAULT 0,
  "failedItems" INTEGER NOT NULL DEFAULT 0,
  "consecutiveErrors" INTEGER NOT NULL DEFAULT 0,
  "cooldownUntil" TIMESTAMP(3),
  "operationalStatus" "DispatchChannelOperationalStatus" NOT NULL DEFAULT 'READY',
  "configurationSnapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DispatchChannel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DispatchChannel_dispatchId_channelAccountId_key"
  ON "DispatchChannel"("dispatchId", "channelAccountId");
CREATE INDEX "DispatchChannel_dispatchId_idx" ON "DispatchChannel"("dispatchId");
CREATE INDEX "DispatchChannel_organizationId_campaignId_idx" ON "DispatchChannel"("organizationId", "campaignId");
CREATE INDEX "DispatchChannel_channelAccountId_idx" ON "DispatchChannel"("channelAccountId");
CREATE INDEX "DispatchChannel_operationalStatus_idx" ON "DispatchChannel"("operationalStatus");

ALTER TABLE "DispatchChannel"
  ADD CONSTRAINT "DispatchChannel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DispatchChannel_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DispatchChannel_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "Dispatch"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DispatchChannel_dispatchPlanChannelId_fkey" FOREIGN KEY ("dispatchPlanChannelId") REFERENCES "DispatchPlanChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DispatchChannel_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "ChannelAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill DispatchChannel for existing dispatches from plan channel
INSERT INTO "DispatchChannel" (
  "id", "organizationId", "campaignId", "dispatchId", "dispatchPlanChannelId", "channelAccountId",
  "enabled", "priority", "weight", "effectiveDailyLimit", "assignedItems",
  "processedItems", "sentItems", "failedItems", "consecutiveErrors",
  "operationalStatus", "createdAt", "updatedAt"
)
SELECT
  md5(random()::text || clock_timestamp()::text || d.id)::text,
  d."organizationId",
  d."campaignId",
  d.id,
  pc.id,
  d."channelAccountId",
  true,
  100,
  100,
  GREATEST(d."totalItems", 0),
  d."totalItems",
  0,
  d."sentItems",
  d."failedItems",
  0,
  'READY',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Dispatch" d
JOIN "DispatchPlanChannel" pc
  ON pc."dispatchPlanId" = d."dispatchPlanId"
 AND pc."channelAccountId" = d."channelAccountId"
WHERE NOT EXISTS (
  SELECT 1 FROM "DispatchChannel" dc WHERE dc."dispatchId" = d.id
);

ALTER TABLE "DispatchItem"
  ADD COLUMN "dispatchChannelId" TEXT,
  ADD COLUMN "originalDispatchChannelId" TEXT,
  ADD COLUMN "reassignmentCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastReassignedAt" TIMESTAMP(3);

CREATE INDEX "DispatchItem_dispatchChannelId_idx" ON "DispatchItem"("dispatchChannelId");

ALTER TABLE "DispatchItem"
  ADD CONSTRAINT "DispatchItem_dispatchChannelId_fkey" FOREIGN KEY ("dispatchChannelId") REFERENCES "DispatchChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "DispatchItem_originalDispatchChannelId_fkey" FOREIGN KEY ("originalDispatchChannelId") REFERENCES "DispatchChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Link existing items to the single backfilled DispatchChannel; mark READY dispatches requiring redistribution if multi would apply later
UPDATE "DispatchItem" di
SET "dispatchChannelId" = dc.id,
    "originalDispatchChannelId" = dc.id
FROM "DispatchChannel" dc
WHERE di."dispatchId" = dc."dispatchId"
  AND di."channelAccountId" = dc."channelAccountId"
  AND di."dispatchChannelId" IS NULL;

-- Existing READY dispatches are legacy single-channel materializations
UPDATE "Dispatch"
SET "requiringRedistribution" = true,
    "multiInstance" = false
WHERE "status" = 'READY' AND "totalItems" > 0;
