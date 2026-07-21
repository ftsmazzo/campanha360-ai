-- AlterTable
ALTER TABLE "DispatchPlan"
    ADD COLUMN "approvedByUserId" TEXT,
    ADD COLUMN "approvedAt" TIMESTAMP(3),
    ADD COLUMN "approvalSnapshot" JSONB,
    ADD COLUMN "rejectedByUserId" TEXT,
    ADD COLUMN "rejectedAt" TIMESTAMP(3),
    ADD COLUMN "rejectionReason" TEXT,
    ADD COLUMN "canceledByUserId" TEXT,
    ADD COLUMN "canceledAt" TIMESTAMP(3),
    ADD COLUMN "cancellationReason" TEXT;

-- CreateIndex
CREATE INDEX "DispatchPlan_approvedByUserId_idx" ON "DispatchPlan"("approvedByUserId");

-- CreateIndex
CREATE INDEX "DispatchPlan_rejectedByUserId_idx" ON "DispatchPlan"("rejectedByUserId");

-- CreateIndex
CREATE INDEX "DispatchPlan_canceledByUserId_idx" ON "DispatchPlan"("canceledByUserId");

-- AddForeignKey
ALTER TABLE "DispatchPlan"
    ADD CONSTRAINT "DispatchPlan_approvedByUserId_fkey"
    FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchPlan"
    ADD CONSTRAINT "DispatchPlan_rejectedByUserId_fkey"
    FOREIGN KEY ("rejectedByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchPlan"
    ADD CONSTRAINT "DispatchPlan_canceledByUserId_fkey"
    FOREIGN KEY ("canceledByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
