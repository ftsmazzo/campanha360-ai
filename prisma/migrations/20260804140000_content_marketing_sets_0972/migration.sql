-- 09.7.2 — Briefing de marketing, conjuntos coerentes e metadados de variante

ALTER TABLE "ContentComposition" ADD COLUMN IF NOT EXISTS "marketingBrief" JSONB;
ALTER TABLE "ContentComposition" ADD COLUMN IF NOT EXISTS "personalizationPlacement" TEXT NOT NULL DEFAULT 'GREETING';
ALTER TABLE "ContentComposition" ADD COLUMN IF NOT EXISTS "combinationMode" TEXT NOT NULL DEFAULT 'LOCKED_SETS';

ALTER TABLE "ContentVariant" ADD COLUMN IF NOT EXISTS "generationSetId" TEXT;
ALTER TABLE "ContentVariant" ADD COLUMN IF NOT EXISTS "tone" TEXT;
ALTER TABLE "ContentVariant" ADD COLUMN IF NOT EXISTS "formality" TEXT;
ALTER TABLE "ContentVariant" ADD COLUMN IF NOT EXISTS "personalizationPlacement" TEXT;
ALTER TABLE "ContentVariant" ADD COLUMN IF NOT EXISTS "marketingAngle" TEXT;
ALTER TABLE "ContentVariant" ADD COLUMN IF NOT EXISTS "compatibleGroup" TEXT;

CREATE INDEX IF NOT EXISTS "ContentVariant_compositionId_generationSetId_idx"
  ON "ContentVariant"("compositionId", "generationSetId");
