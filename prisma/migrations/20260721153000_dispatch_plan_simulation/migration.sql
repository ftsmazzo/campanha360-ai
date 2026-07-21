-- AlterTable
ALTER TABLE "DispatchPlan"
    ADD COLUMN "simulationSnapshot" JSONB,
    ADD COLUMN "simulatedAt" TIMESTAMP(3),
    ADD COLUMN "simulatedVersion" INTEGER;
