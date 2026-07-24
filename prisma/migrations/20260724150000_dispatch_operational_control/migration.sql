-- AlterTable Dispatch: controle operacional 09.5
ALTER TABLE "Dispatch" ADD COLUMN IF NOT EXISTS "pauseRequestedAt" TIMESTAMP(3);
ALTER TABLE "Dispatch" ADD COLUMN IF NOT EXISTS "pauseReason" TEXT;
ALTER TABLE "Dispatch" ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;
ALTER TABLE "Dispatch" ADD COLUMN IF NOT EXISTS "emergencyStopReason" TEXT;
ALTER TABLE "Dispatch" ADD COLUMN IF NOT EXISTS "pausedByUserId" TEXT;
ALTER TABLE "Dispatch" ADD COLUMN IF NOT EXISTS "canceledByUserId" TEXT;
ALTER TABLE "Dispatch" ADD COLUMN IF NOT EXISTS "emergencyStoppedByUserId" TEXT;

-- AlterTable DispatchItem: marco de chamada externa
ALTER TABLE "DispatchItem" ADD COLUMN IF NOT EXISTS "providerRequestStartedAt" TIMESTAMP(3);
ALTER TABLE "DispatchItem" ADD COLUMN IF NOT EXISTS "providerRequestCompletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Dispatch_pausedByUserId_idx" ON "Dispatch"("pausedByUserId");
CREATE INDEX IF NOT EXISTS "Dispatch_canceledByUserId_idx" ON "Dispatch"("canceledByUserId");
CREATE INDEX IF NOT EXISTS "Dispatch_emergencyStoppedByUserId_idx" ON "Dispatch"("emergencyStoppedByUserId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Dispatch_pausedByUserId_fkey'
  ) THEN
    ALTER TABLE "Dispatch"
      ADD CONSTRAINT "Dispatch_pausedByUserId_fkey"
      FOREIGN KEY ("pausedByUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Dispatch_canceledByUserId_fkey'
  ) THEN
    ALTER TABLE "Dispatch"
      ADD CONSTRAINT "Dispatch_canceledByUserId_fkey"
      FOREIGN KEY ("canceledByUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Dispatch_emergencyStoppedByUserId_fkey'
  ) THEN
    ALTER TABLE "Dispatch"
      ADD CONSTRAINT "Dispatch_emergencyStoppedByUserId_fkey"
      FOREIGN KEY ("emergencyStoppedByUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
