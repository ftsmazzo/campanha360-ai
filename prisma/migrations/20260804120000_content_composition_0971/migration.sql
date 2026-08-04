-- 09.7.1 — Conteudo personalizado, variaveis e variantes aprovadas

CREATE TYPE "ContentCompositionStatus" AS ENUM ('DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'ARCHIVED');
CREATE TYPE "ContentVariantType" AS ENUM ('BODY', 'GREETING', 'CLOSING');
CREATE TYPE "ContentVariantSource" AS ENUM ('MANUAL', 'AI_GENERATED', 'BASE');

CREATE TABLE "ContentComposition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ContentCompositionStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "blockSeparator" TEXT NOT NULL DEFAULT E'\n\n',
    "fallbacks" JSONB,
    "createdByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentComposition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentVariant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "compositionId" TEXT NOT NULL,
    "type" "ContentVariantType" NOT NULL,
    "source" "ContentVariantSource" NOT NULL DEFAULT 'MANUAL',
    "text" TEXT NOT NULL,
    "normalizedTextHash" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "requiresVariables" JSONB,
    "reviewPending" BOOLEAN NOT NULL DEFAULT false,
    "aiGenerationId" TEXT,
    "aiSummaryOfChanges" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentVariant_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DispatchPlan" ADD COLUMN "contentCompositionId" TEXT;

CREATE UNIQUE INDEX "ContentComposition_campaignId_name_key" ON "ContentComposition"("campaignId", "name");
CREATE INDEX "ContentComposition_organizationId_campaignId_idx" ON "ContentComposition"("organizationId", "campaignId");
CREATE INDEX "ContentComposition_campaignId_status_idx" ON "ContentComposition"("campaignId", "status");
CREATE INDEX "ContentComposition_approvedByUserId_idx" ON "ContentComposition"("approvedByUserId");

CREATE INDEX "ContentVariant_compositionId_type_enabled_idx" ON "ContentVariant"("compositionId", "type", "enabled");
CREATE INDEX "ContentVariant_organizationId_campaignId_idx" ON "ContentVariant"("organizationId", "campaignId");
CREATE INDEX "ContentVariant_normalizedTextHash_idx" ON "ContentVariant"("normalizedTextHash");

CREATE INDEX "DispatchPlan_contentCompositionId_idx" ON "DispatchPlan"("contentCompositionId");

ALTER TABLE "ContentComposition" ADD CONSTRAINT "ContentComposition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContentComposition" ADD CONSTRAINT "ContentComposition_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContentComposition" ADD CONSTRAINT "ContentComposition_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContentComposition" ADD CONSTRAINT "ContentComposition_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContentVariant" ADD CONSTRAINT "ContentVariant_compositionId_fkey" FOREIGN KEY ("compositionId") REFERENCES "ContentComposition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DispatchPlan" ADD CONSTRAINT "DispatchPlan_contentCompositionId_fkey" FOREIGN KEY ("contentCompositionId") REFERENCES "ContentComposition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
