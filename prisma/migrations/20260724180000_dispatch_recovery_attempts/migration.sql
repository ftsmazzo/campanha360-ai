-- AlterEnum DispatchItemErrorCategory
ALTER TYPE "DispatchItemErrorCategory" ADD VALUE IF NOT EXISTS 'ADMIN_CONFIRMED_NOT_SENT';
ALTER TYPE "DispatchItemErrorCategory" ADD VALUE IF NOT EXISTS 'UNKNOWN_ABANDONED';

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "DispatchRetryMode" AS ENUM ('AUTOMATIC', 'MANUAL', 'RECOVERY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "DispatchItemAttemptOutcome" AS ENUM (
    'SENT',
    'FAILED',
    'RETRY_SCHEDULED',
    'UNKNOWN_PROVIDER_STATE',
    'SKIPPED',
    'CANCELED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable Dispatch
ALTER TABLE "Dispatch" ADD COLUMN IF NOT EXISTS "unknownItems" INTEGER NOT NULL DEFAULT 0;

-- AlterTable DispatchItem
ALTER TABLE "DispatchItem" ADD COLUMN IF NOT EXISTS "retryMode" "DispatchRetryMode";
ALTER TABLE "DispatchItem" ADD COLUMN IF NOT EXISTS "retryRequestedAt" TIMESTAMP(3);
ALTER TABLE "DispatchItem" ADD COLUMN IF NOT EXISTS "retryReason" TEXT;
ALTER TABLE "DispatchItem" ADD COLUMN IF NOT EXISTS "retryRequestedByUserId" TEXT;

CREATE INDEX IF NOT EXISTS "DispatchItem_retryRequestedByUserId_idx" ON "DispatchItem"("retryRequestedByUserId");

DO $$ BEGIN
  ALTER TABLE "DispatchItem"
    ADD CONSTRAINT "DispatchItem_retryRequestedByUserId_fkey"
    FOREIGN KEY ("retryRequestedByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable DispatchItemAttempt
CREATE TABLE IF NOT EXISTS "DispatchItemAttempt" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "dispatchId" TEXT NOT NULL,
  "dispatchItemId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "channelAccountId" TEXT,
  "dispatchChannelId" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "outcome" "DispatchItemAttemptOutcome",
  "providerStatus" TEXT,
  "providerMessageId" TEXT,
  "httpStatus" INTEGER,
  "errorCategory" "DispatchItemErrorCategory",
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "ambiguous" BOOLEAN NOT NULL DEFAULT false,
  "manual" BOOLEAN NOT NULL DEFAULT false,
  "retryMode" "DispatchRetryMode",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DispatchItemAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DispatchItemAttempt_dispatchItemId_attemptNumber_key"
  ON "DispatchItemAttempt"("dispatchItemId", "attemptNumber");
CREATE INDEX IF NOT EXISTS "DispatchItemAttempt_dispatchId_idx" ON "DispatchItemAttempt"("dispatchId");
CREATE INDEX IF NOT EXISTS "DispatchItemAttempt_dispatchItemId_idx" ON "DispatchItemAttempt"("dispatchItemId");
CREATE INDEX IF NOT EXISTS "DispatchItemAttempt_organizationId_campaignId_idx"
  ON "DispatchItemAttempt"("organizationId", "campaignId");
CREATE INDEX IF NOT EXISTS "DispatchItemAttempt_outcome_idx" ON "DispatchItemAttempt"("outcome");

DO $$ BEGIN
  ALTER TABLE "DispatchItemAttempt"
    ADD CONSTRAINT "DispatchItemAttempt_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "DispatchItemAttempt"
    ADD CONSTRAINT "DispatchItemAttempt_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "DispatchItemAttempt"
    ADD CONSTRAINT "DispatchItemAttempt_dispatchId_fkey"
    FOREIGN KEY ("dispatchId") REFERENCES "Dispatch"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "DispatchItemAttempt"
    ADD CONSTRAINT "DispatchItemAttempt_dispatchItemId_fkey"
    FOREIGN KEY ("dispatchItemId") REFERENCES "DispatchItem"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill unknownItems from existing items
UPDATE "Dispatch" d
SET "unknownItems" = sub.cnt
FROM (
  SELECT "dispatchId", COUNT(*)::int AS cnt
  FROM "DispatchItem"
  WHERE "status" = 'UNKNOWN_PROVIDER_STATE'
  GROUP BY "dispatchId"
) sub
WHERE d."id" = sub."dispatchId";

-- Separate unknown from failedItems aggregation historically stored together
UPDATE "Dispatch" d
SET "failedItems" = GREATEST(
  0,
  (
    SELECT COUNT(*)::int
    FROM "DispatchItem" i
    WHERE i."dispatchId" = d."id" AND i."status" = 'FAILED'
  )
);
