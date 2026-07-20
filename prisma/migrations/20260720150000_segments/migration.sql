-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "filters" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Segment_organizationId_campaignId_idx" ON "Segment"("organizationId", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "Segment_campaignId_name_key" ON "Segment"("campaignId", "name");
