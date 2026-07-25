-- 09.6.4: diagnostico Evolution + contadores + estado de conexao

ALTER TYPE "DispatchItemErrorCategory" ADD VALUE IF NOT EXISTS 'PROVIDER_BAD_REQUEST';
ALTER TYPE "DispatchItemErrorCategory" ADD VALUE IF NOT EXISTS 'PROVIDER_CONNECTION_CLOSED';
ALTER TYPE "DispatchItemErrorCategory" ADD VALUE IF NOT EXISTS 'CHANNEL_NOT_FOUND';
ALTER TYPE "DispatchItemErrorCategory" ADD VALUE IF NOT EXISTS 'CHANNEL_UNAVAILABLE';

ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "disconnectedAt" TIMESTAMP(3);
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "lastConnectionError" TEXT;

ALTER TABLE "DispatchItem" ADD COLUMN IF NOT EXISTS "providerHttpStatus" INTEGER;
ALTER TABLE "DispatchItem" ADD COLUMN IF NOT EXISTS "providerErrorCode" TEXT;
ALTER TABLE "DispatchItem" ADD COLUMN IF NOT EXISTS "providerErrorType" TEXT;
ALTER TABLE "DispatchItem" ADD COLUMN IF NOT EXISTS "providerErrorMessageSafe" TEXT;
ALTER TABLE "DispatchItem" ADD COLUMN IF NOT EXISTS "providerRequestId" TEXT;
ALTER TABLE "DispatchItem" ADD COLUMN IF NOT EXISTS "providerResponseReceivedAt" TIMESTAMP(3);
ALTER TABLE "DispatchItem" ADD COLUMN IF NOT EXISTS "acceptanceState" TEXT;
ALTER TABLE "DispatchItem" ADD COLUMN IF NOT EXISTS "channelStatusAtSend" TEXT;
ALTER TABLE "DispatchItem" ADD COLUMN IF NOT EXISTS "channelStatusAfterFailure" TEXT;
ALTER TABLE "DispatchItem" ADD COLUMN IF NOT EXISTS "classificationConfidence" TEXT;
