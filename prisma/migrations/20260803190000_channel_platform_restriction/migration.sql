-- Restricao operacional administrativa da plataforma (complemento lifecycle).
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "platformRestrictionStatus" TEXT DEFAULT 'NONE';
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "platformRestrictedAt" TIMESTAMP(3);
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "platformRestrictedUntil" TIMESTAMP(3);
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "platformRestrictionSource" TEXT;
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "platformRestrictionReasonSafe" TEXT;
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "requiresManualReview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "platformRestrictionClearedAt" TIMESTAMP(3);
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "platformRestrictionClearedByUserId" TEXT;
