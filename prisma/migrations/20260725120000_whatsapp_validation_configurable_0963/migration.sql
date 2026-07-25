-- 09.6.3: validateWhatsAppNumber configuravel + evidencias/contadores

ALTER TABLE "Dispatch" ADD COLUMN IF NOT EXISTS "validationPendingItems" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Dispatch" ADD COLUMN IF NOT EXISTS "validDestinationItems" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Dispatch" ADD COLUMN IF NOT EXISTS "invalidDestinationItems" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Dispatch" ADD COLUMN IF NOT EXISTS "validationErrorItems" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "DispatchItem" ADD COLUMN IF NOT EXISTS "destinationValidationStatus" TEXT;
ALTER TABLE "DispatchItem" ADD COLUMN IF NOT EXISTS "destinationValidatedAt" TIMESTAMP(3);
ALTER TABLE "DispatchItem" ADD COLUMN IF NOT EXISTS "validationSource" TEXT;
ALTER TABLE "DispatchItem" ADD COLUMN IF NOT EXISTS "validationCacheHit" BOOLEAN;
ALTER TABLE "DispatchItem" ADD COLUMN IF NOT EXISTS "destinationValidationAttempts" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "DestinationWhatsAppValidationCache" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'EVOLUTION';
ALTER TABLE "DestinationWhatsAppValidationCache" ADD COLUMN IF NOT EXISTS "lastErrorCode" TEXT;
