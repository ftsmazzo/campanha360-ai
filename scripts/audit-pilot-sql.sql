-- Diagnostico seguro do piloto 09.4 (EasyPanel → Postgres → Query)
-- Nao expoe telefone completo; use no console SQL do EasyPanel.

WITH pilot AS (
  SELECT d.*
  FROM "Dispatch" d
  WHERE d."totalItems" = 4
    AND d."startedAt" IS NOT NULL
  ORDER BY d."startedAt" DESC
  LIMIT 1
)
SELECT
  p.id AS dispatch_id,
  p.name,
  p.status AS dispatch_status,
  p."totalItems",
  p."sentItems",
  p."failedItems",
  p."queuedItems",
  p."processingItems",
  p."skippedItems",
  p."pendingItems",
  p."canceledItems",
  p."startedAt",
  p."lastProgressAt",
  p."completedAt"
FROM pilot p;

WITH pilot AS (
  SELECT id FROM "Dispatch"
  WHERE "totalItems" = 4 AND "startedAt" IS NOT NULL
  ORDER BY "startedAt" DESC LIMIT 1
)
SELECT
  i.id,
  i.status,
  i."dispatchChannelId",
  i."channelAccountId",
  i."reassignmentCount",
  i."attemptCount",
  i."maxAttempts",
  CASE
    WHEN i."providerMessageId" IS NULL THEN NULL
    ELSE left(i."providerMessageId", 6) || '…' || right(i."providerMessageId", 4)
  END AS provider_message_id_masked,
  i."providerStatus",
  i."sentAt",
  i."failedAt",
  i."nextRetryAt",
  i."errorCategory",
  i."errorCode",
  i."errorMessage",
  i."lastAttemptAt",
  i."lockedAt",
  i."lockExpiresAt",
  i."queueJobId",
  i."technicalValidatedAt",
  right(regexp_replace(i."normalizedDestination", '\D', '', 'g'), 4) AS dest_last4,
  length(regexp_replace(i."normalizedDestination", '\D', '', 'g')) AS dest_len
FROM "DispatchItem" i
JOIN pilot p ON p.id = i."dispatchId"
ORDER BY i."createdAt";

WITH pilot AS (
  SELECT id FROM "Dispatch"
  WHERE "totalItems" = 4 AND "startedAt" IS NOT NULL
  ORDER BY "startedAt" DESC LIMIT 1
)
SELECT
  dc.id,
  dc."channelAccountId",
  ca."externalAccountId",
  ca.name AS channel_name,
  ca.status AS channel_status,
  dc.enabled,
  dc."operationalStatus",
  dc."sentItems",
  dc."failedItems",
  dc."processedItems",
  dc."consecutiveErrors",
  dc."cooldownUntil",
  dc."effectiveDailyLimit"
FROM "DispatchChannel" dc
JOIN pilot p ON p.id = dc."dispatchId"
JOIN "ChannelAccount" ca ON ca.id = dc."channelAccountId";

WITH pilot AS (
  SELECT id FROM "Dispatch"
  WHERE "totalItems" = 4 AND "startedAt" IS NOT NULL
  ORDER BY "startedAt" DESC LIMIT 1
)
SELECT u.*
FROM "DispatchChannelUsageDaily" u
JOIN "DispatchChannel" dc ON dc.id = u."dispatchChannelId"
JOIN pilot p ON p.id = dc."dispatchId";
