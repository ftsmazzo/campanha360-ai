-- Gestao confiavel de instancias Evolution (criar/vincular/reconectar/QR).
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "provisioningMode" TEXT;
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "evolutionInstanceId" TEXT;
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "evolutionInstanceName" TEXT;
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "linkedAt" TIMESTAMP(3);
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "lastRemoteVerificationAt" TIMESTAMP(3);
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "lastRemoteState" TEXT;
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "remoteConnectionState" TEXT;
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "sessionState" TEXT;
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "remoteOwnerHash" TEXT;
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "remoteOwnerLast4" TEXT;
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "statusReason" TEXT;
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "lastStateSource" TEXT;
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "lastStateEventAt" TIMESTAMP(3);
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "reconnectRequestedAt" TIMESTAMP(3);
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "reconnectFinishedAt" TIMESTAMP(3);
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "reconnectResult" TEXT;
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "reconnectErrorSafe" TEXT;
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "remoteStateBefore" TEXT;
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "remoteStateAfter" TEXT;
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "operationInProgress" TEXT;
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "restartAttemptCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "ChannelAccount_organizationId_evolutionInstanceName_idx"
  ON "ChannelAccount"("organizationId", "evolutionInstanceName");
CREATE INDEX IF NOT EXISTS "ChannelAccount_organizationId_externalAccountId_idx"
  ON "ChannelAccount"("organizationId", "externalAccountId");
