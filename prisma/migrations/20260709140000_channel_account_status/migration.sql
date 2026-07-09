-- CreateEnum
CREATE TYPE "ChannelAccountStatus" AS ENUM ('DISCONNECTED', 'CONNECTING', 'CONNECTED', 'ERROR', 'ARCHIVED');

-- AlterTable
ALTER TABLE "ChannelAccount" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ChannelAccount" ALTER COLUMN "status" TYPE "ChannelAccountStatus" USING (
  CASE
    WHEN "status" = 'CONNECTED' THEN 'CONNECTED'::"ChannelAccountStatus"
    WHEN "status" = 'CONNECTING' THEN 'CONNECTING'::"ChannelAccountStatus"
    WHEN "status" = 'ERROR' THEN 'ERROR'::"ChannelAccountStatus"
    WHEN "status" = 'ARCHIVED' THEN 'ARCHIVED'::"ChannelAccountStatus"
    ELSE 'DISCONNECTED'::"ChannelAccountStatus"
  END
);
ALTER TABLE "ChannelAccount" ALTER COLUMN "status" SET DEFAULT 'DISCONNECTED';

-- CreateIndex
CREATE INDEX "ChannelAccount_organizationId_campaignId_idx" ON "ChannelAccount"("organizationId", "campaignId");
