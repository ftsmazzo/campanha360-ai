-- CreateEnum
CREATE TYPE "ContactOperationalStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'SUPPORTER', 'UNDECIDED', 'OPPOSED', 'INVALID', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "operationalStatus" "ContactOperationalStatus" NOT NULL DEFAULT 'NEW';
ALTER TABLE "Contact" ADD COLUMN "assignedToUserId" TEXT;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
