import { Injectable, NotFoundException } from '@nestjs/common';
import { ConsentStatus, ContactStatus, Prisma } from '@prisma/client';
import { OrganizationAccessService } from '../common/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';

type ThreadListItem = {
  id: string;
  organizationId: string;
  campaignId: string;
  contactId: string;
  channelAccountId: string | null;
  channel: string;
  status: string;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  contact: {
    id: string;
    name: string | null;
    phoneNumber: string | null;
    status: string;
    optOutActive: boolean;
  };
  channelAccount: {
    id: string;
    name: string;
    provider: string;
    status: string;
  } | null;
  lastMessage: {
    id: string;
    body: string | null;
    direction: string;
    status: string;
    createdAt: string;
    optOutActive: boolean;
  } | null;
};

@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationAccess: OrganizationAccessService,
  ) {}

  async listThreads(userId: string, campaignId: string): Promise<ThreadListItem[]> {
    const campaign = await this.getCampaignContext(userId, campaignId);

    const threads = await this.prisma.conversationThread.findMany({
      where: {
        organizationId: campaign.organizationId,
        campaignId,
      },
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
      take: 200,
    });

    if (threads.length === 0) {
      return [];
    }

    const contactIds = [...new Set(threads.map((thread) => thread.contactId))];
    const channelAccountIds = [
      ...new Set(
        threads
          .map((thread) => thread.channelAccountId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const threadIds = threads.map((thread) => thread.id);

    const [contacts, channelAccounts, latestMessages] = await Promise.all([
      this.prisma.contact.findMany({
        where: {
          organizationId: campaign.organizationId,
          campaignId,
          id: { in: contactIds },
        },
        select: {
          id: true,
          name: true,
          phoneNumber: true,
          status: true,
          optOuts: { select: { id: true }, take: 1 },
          consents: {
            where: { status: ConsentStatus.OPT_OUT },
            select: { id: true },
            take: 1,
          },
        },
      }),
      channelAccountIds.length
        ? this.prisma.channelAccount.findMany({
            where: {
              organizationId: campaign.organizationId,
              campaignId,
              id: { in: channelAccountIds },
            },
            select: {
              id: true,
              name: true,
              provider: true,
              status: true,
            },
          })
        : Promise.resolve([]),
      this.prisma.message.findMany({
        where: {
          organizationId: campaign.organizationId,
          campaignId,
          conversationId: { in: threadIds },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          conversationId: true,
          body: true,
          direction: true,
          status: true,
          createdAt: true,
          rawPayload: true,
        },
      }),
    ]);

    const contactMap = new Map(contacts.map((contact) => [contact.id, contact]));
    const channelMap = new Map(channelAccounts.map((account) => [account.id, account]));
    const lastMessageByThread = new Map<
      string,
      (typeof latestMessages)[number]
    >();

    for (const message of latestMessages) {
      if (!message.conversationId) continue;
      if (!lastMessageByThread.has(message.conversationId)) {
        lastMessageByThread.set(message.conversationId, message);
      }
    }

    const items: ThreadListItem[] = [];

    for (const thread of threads) {
      const contact = contactMap.get(thread.contactId);
      if (!contact) continue;

      const lastMessage = lastMessageByThread.get(thread.id) ?? null;
      const channelAccount = thread.channelAccountId
        ? channelMap.get(thread.channelAccountId) ?? null
        : null;

      items.push({
        id: thread.id,
        organizationId: thread.organizationId,
        campaignId: thread.campaignId,
        contactId: thread.contactId,
        channelAccountId: thread.channelAccountId,
        channel: thread.channel,
        status: thread.status,
        lastMessageAt: thread.lastMessageAt?.toISOString() ?? null,
        createdAt: thread.createdAt.toISOString(),
        updatedAt: thread.updatedAt.toISOString(),
        contact: {
          id: contact.id,
          name: contact.name,
          phoneNumber: contact.phoneNumber,
          status: contact.status,
          optOutActive: this.isOptOutActive(contact),
        },
        channelAccount: channelAccount
          ? {
              id: channelAccount.id,
              name: channelAccount.name,
              provider: channelAccount.provider,
              status: channelAccount.status,
            }
          : null,
        lastMessage: lastMessage
          ? {
              id: lastMessage.id,
              body: lastMessage.body,
              direction: lastMessage.direction,
              status: lastMessage.status,
              createdAt: lastMessage.createdAt.toISOString(),
              optOutActive: this.extractOptOutFromPayload(lastMessage.rawPayload),
            }
          : null,
      });
    }

    return items;
  }

  async getThread(userId: string, campaignId: string, threadId: string) {
    const campaign = await this.getCampaignContext(userId, campaignId);

    const thread = await this.prisma.conversationThread.findFirst({
      where: {
        id: threadId,
        organizationId: campaign.organizationId,
        campaignId,
      },
    });

    if (!thread) {
      throw new NotFoundException('Conversa nao encontrada');
    }

    const [contact, channelAccount, messages] = await Promise.all([
      this.prisma.contact.findFirst({
        where: {
          id: thread.contactId,
          organizationId: campaign.organizationId,
          campaignId,
        },
        select: {
          id: true,
          name: true,
          phoneNumber: true,
          email: true,
          status: true,
          operationalStatus: true,
          optOuts: { select: { id: true, channel: true, createdAt: true }, take: 5 },
          consents: {
            where: { status: ConsentStatus.OPT_OUT },
            select: { id: true, channel: true, status: true },
            take: 5,
          },
        },
      }),
      thread.channelAccountId
        ? this.prisma.channelAccount.findFirst({
            where: {
              id: thread.channelAccountId,
              organizationId: campaign.organizationId,
              campaignId,
            },
            select: {
              id: true,
              name: true,
              provider: true,
              status: true,
            },
          })
        : Promise.resolve(null),
      this.prisma.message.findMany({
        where: {
          organizationId: campaign.organizationId,
          campaignId,
          conversationId: thread.id,
        },
        orderBy: { createdAt: 'asc' },
        take: 500,
        select: {
          id: true,
          direction: true,
          body: true,
          status: true,
          provider: true,
          externalMessageId: true,
          createdAt: true,
          rawPayload: true,
        },
      }),
    ]);

    if (!contact) {
      throw new NotFoundException('Contato da conversa nao encontrado');
    }

    return {
      id: thread.id,
      organizationId: thread.organizationId,
      campaignId: thread.campaignId,
      contactId: thread.contactId,
      channelAccountId: thread.channelAccountId,
      channel: thread.channel,
      status: thread.status,
      lastMessageAt: thread.lastMessageAt?.toISOString() ?? null,
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
      contact: {
        id: contact.id,
        name: contact.name,
        phoneNumber: contact.phoneNumber,
        email: contact.email,
        status: contact.status,
        operationalStatus: contact.operationalStatus,
        optOutActive: this.isOptOutActive(contact),
      },
      channelAccount: channelAccount
        ? {
            id: channelAccount.id,
            name: channelAccount.name,
            provider: channelAccount.provider,
            status: channelAccount.status,
          }
        : null,
      messages: messages.map((message) => ({
        id: message.id,
        direction: message.direction,
        body: message.body,
        status: message.status,
        provider: message.provider,
        externalMessageId: message.externalMessageId,
        createdAt: message.createdAt.toISOString(),
        optOutActive: this.extractOptOutFromPayload(message.rawPayload),
      })),
    };
  }

  private isOptOutActive(contact: {
    status: ContactStatus;
    optOuts: Array<{ id: string }>;
    consents: Array<{ id: string }>;
  }) {
    if (contact.status === ContactStatus.BLOCKED) return true;
    if (contact.optOuts.length > 0) return true;
    if (contact.consents.length > 0) return true;
    return false;
  }

  private extractOptOutFromPayload(rawPayload: Prisma.JsonValue | null): boolean {
    if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
      return false;
    }
    return (rawPayload as Record<string, unknown>).optOutActive === true;
  }

  private async getCampaignContext(userId: string, campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, organizationId: true, name: true },
    });

    if (!campaign) {
      throw new NotFoundException('Campanha nao encontrada');
    }

    await this.organizationAccess.requireMembership(userId, campaign.organizationId);
    return campaign;
  }
}
