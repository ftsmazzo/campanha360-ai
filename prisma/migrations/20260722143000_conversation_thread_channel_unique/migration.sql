-- Isola conversas do Inbox por ChannelAccount (multi-instancia).
-- A mesma pessoa em duas instancias deve gerar threads distintas.
-- channelAccountId NULL continua permitido (historico legado); uniques
-- com NULL no Postgres nao colidem entre si.

CREATE UNIQUE INDEX IF NOT EXISTS "ConversationThread_org_campaign_contact_channel_account_key"
ON "ConversationThread" (
  "organizationId",
  "campaignId",
  "contactId",
  "channelAccountId",
  "channel"
)
WHERE "channelAccountId" IS NOT NULL;
