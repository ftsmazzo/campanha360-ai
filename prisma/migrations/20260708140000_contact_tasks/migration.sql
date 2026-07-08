-- CreateEnum
CREATE TYPE "ContactTaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELED');

-- CreateTable
CREATE TABLE "ContactTask" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "assignedToUserId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ContactTaskStatus" NOT NULL DEFAULT 'OPEN',
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactTask_organizationId_campaignId_contactId_idx" ON "ContactTask"("organizationId", "campaignId", "contactId");

-- CreateIndex
CREATE INDEX "ContactTask_organizationId_campaignId_status_idx" ON "ContactTask"("organizationId", "campaignId", "status");

-- AddForeignKey
ALTER TABLE "ContactTask" ADD CONSTRAINT "ContactTask_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactTask" ADD CONSTRAINT "ContactTask_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactTask" ADD CONSTRAINT "ContactTask_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
