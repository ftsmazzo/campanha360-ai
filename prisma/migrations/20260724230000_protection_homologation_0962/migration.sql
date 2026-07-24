-- 09.6.2 — Fechamento de blindagens (cache validacao, keywords, idade operacional)

ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "optOutKeywords" JSONB;

ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "accountOperationalSince" TIMESTAMP(3);
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "verifiedAccountAgeSource" TEXT;

ALTER TABLE "DispatchItemAttempt" ADD COLUMN IF NOT EXISTS "lastMileEvidence" JSONB;

CREATE TABLE IF NOT EXISTS "DestinationWhatsAppValidationCache" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "destinationHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'EVOLUTION_WHATSAPP_NUMBERS',
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DestinationWhatsAppValidationCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DestinationWhatsAppValidationCache_organizationId_destinationHash_key"
  ON "DestinationWhatsAppValidationCache"("organizationId", "destinationHash");
CREATE INDEX IF NOT EXISTS "DestinationWhatsAppValidationCache_expiresAt_idx"
  ON "DestinationWhatsAppValidationCache"("expiresAt");

ALTER TABLE "DestinationWhatsAppValidationCache"
  ADD CONSTRAINT "DestinationWhatsAppValidationCache_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
