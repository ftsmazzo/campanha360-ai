-- CreateIndex
CREATE INDEX "ConversationThread_organizationId_campaignId_channelAccountId_contactId_idx" ON "ConversationThread"("organizationId", "campaignId", "channelAccountId", "contactId");

-- CreateIndex
CREATE INDEX "Message_organizationId_campaignId_externalMessageId_idx" ON "Message"("organizationId", "campaignId", "externalMessageId");

-- CreateIndex
CREATE INDEX "Message_organizationId_campaignId_channelAccountId_idx" ON "Message"("organizationId", "campaignId", "channelAccountId");
