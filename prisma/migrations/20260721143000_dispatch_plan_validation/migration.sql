-- AlterTable
ALTER TABLE "DispatchPlan"
    ADD COLUMN "validatedAt" TIMESTAMP(3),
    ADD COLUMN "validatedVersion" INTEGER;
