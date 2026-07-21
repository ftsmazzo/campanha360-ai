-- CreateEnum
CREATE TYPE "DispatchPlanRecipientEligibilityStatus" AS ENUM (
    'ELIGIBLE',
    'EXCLUDED_OPT_OUT',
    'EXCLUDED_BLOCKED',
    'EXCLUDED_DELETED',
    'EXCLUDED_INVALID_DESTINATION',
    'EXCLUDED_DUPLICATE',
    'EXCLUDED_NO_CHANNEL',
    'EXCLUDED_POLICY',
    'EXCLUDED_OTHER'
);

-- AlterTable
ALTER TABLE "DispatchPlan"
    ADD COLUMN "totalEvaluated" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "totalEligible" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "totalExcluded" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "snapshotCreatedAt" TIMESTAMP(3),
    ADD COLUMN "filtersSnapshot" JSONB,
    ADD COLUMN "validationSnapshot" JSONB;

-- CreateTable
CREATE TABLE "DispatchPlanRecipient" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "dispatchPlanId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "normalizedDestination" TEXT NOT NULL,
    "eligibilityStatus" "DispatchPlanRecipientEligibilityStatus" NOT NULL,
    "exclusionReason" TEXT,
    "contactSnapshot" JSONB NOT NULL,
    "consentSnapshot" JSONB,
    "optOutSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispatchPlanRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DispatchPlanRecipient_dispatchPlanId_contactId_normalizedDestination_key"
    ON "DispatchPlanRecipient"("dispatchPlanId", "contactId", "normalizedDestination");

-- CreateIndex
CREATE INDEX "DispatchPlanRecipient_dispatchPlanId_idx"
    ON "DispatchPlanRecipient"("dispatchPlanId");

-- CreateIndex
CREATE INDEX "DispatchPlanRecipient_dispatchPlanId_eligibilityStatus_idx"
    ON "DispatchPlanRecipient"("dispatchPlanId", "eligibilityStatus");

-- CreateIndex
CREATE INDEX "DispatchPlanRecipient_organizationId_campaignId_idx"
    ON "DispatchPlanRecipient"("organizationId", "campaignId");

-- CreateIndex
CREATE INDEX "DispatchPlanRecipient_contactId_idx"
    ON "DispatchPlanRecipient"("contactId");

-- CreateIndex
CREATE INDEX "DispatchPlanRecipient_normalizedDestination_idx"
    ON "DispatchPlanRecipient"("normalizedDestination");

-- AddForeignKey
ALTER TABLE "DispatchPlanRecipient"
    ADD CONSTRAINT "DispatchPlanRecipient_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchPlanRecipient"
    ADD CONSTRAINT "DispatchPlanRecipient_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchPlanRecipient"
    ADD CONSTRAINT "DispatchPlanRecipient_dispatchPlanId_fkey"
    FOREIGN KEY ("dispatchPlanId") REFERENCES "DispatchPlan"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchPlanRecipient"
    ADD CONSTRAINT "DispatchPlanRecipient_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "Contact"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
