-- AlterTable
ALTER TABLE "DispatchItem" ADD COLUMN     "queueJobId" TEXT,
ADD COLUMN     "queueName" TEXT,
ADD COLUMN     "queueCreatedAt" TIMESTAMP(3),
ADD COLUMN     "technicalValidatedAt" TIMESTAMP(3),
ADD COLUMN     "lastQueueError" TEXT;

-- CreateIndex
CREATE INDEX "DispatchItem_queueJobId_idx" ON "DispatchItem"("queueJobId");
