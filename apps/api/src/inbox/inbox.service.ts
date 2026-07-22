import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ChannelAccountStatus,
  ChannelProvider,
  ChannelType,
  ConsentStatus,
  ContactStatus,
  MessageDirection,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../common/organization-access.service';
import {
  INBOX_INSTANCE_DISCONNECTED_MESSAGE,
  isEvolutionDisconnectErrorMessage,
  mapEvolutionConnectionStateToStatus,
} from '../evolution/evolution-connection.util';
import { EvolutionAdapter } from '../evolution/evolution.adapter';
import { EvolutionApiException } from '../evolution/evolution.errors';
import { PrismaService } from '../prisma/prisma.service';
import {
  normalizeOutboundReplyBody,
  resolveWhatsAppDestination,
} from './inbox-reply.util';

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
    optOutReason: 'BLOCKED' | 'OPT_OUT' | null;
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

type MappedMessage = {
  id: string;
  direction: string;
  body: string | null;
  status: string;
  provider: string;
  externalMessageId: string | null;
  createdAt: string;
  optOutActive: boolean;
};

type OutboundContext = {
  campaign: { id: string; organizationId: string; name: string };
  thread: {
    id: string;
    contactId: string;
    channelAccountId: string | null;
  };
  contact: {
    id: string;
    phoneNumber: string | null;
    status: ContactStatus;
    optOuts: Array<{ id: string }>;
    consents: Array<{ id: string }>;
  };
  channelAccount: {
    id: string;
    name: string;
    provider: ChannelProvider;
    status: ChannelAccountStatus;
    externalAccountId: string | null;
  };
  instanceName: string;
  number: string;
};

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationAccess: OrganizationAccessService,
    private readonly evolutionAdapter: EvolutionAdapter,
    private readonly audit: AuditService,
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
            optOutReason: this.getOptOutReason(contact),
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
        optOutReason: this.getOptOutReason(contact),
      },
      channelAccount: channelAccount
        ? {
            id: channelAccount.id,
            name: channelAccount.name,
            provider: channelAccount.provider,
            status: channelAccount.status,
          }
        : null,
      messages: messages.map((message) => this.mapMessage(message)),
    };
  }

  async sendReply(
    userId: string,
    campaignId: string,
    threadId: string,
    rawBody: string,
  ) {
    const body = normalizeOutboundReplyBody(rawBody);
    const context = await this.resolveOutboundContext(userId, campaignId, threadId);

    this.logger.log(
      `Envio manual inbox threadId=${context.thread.id} channelAccountId=${context.channelAccount.id}`,
    );

    try {
      const sent = await this.evolutionAdapter.sendTextMessage({
        instanceName: context.instanceName,
        number: context.number,
        text: body,
      });

      return this.persistOutboundMessage({
        userId,
        context,
        body,
        status: sent.status || 'SENT',
        externalMessageId: sent.externalMessageId,
        rawPayload: {
          source: 'manual_reply',
          evolution: {
            instanceName: sent.instanceName,
            hasExternalId: Boolean(sent.externalMessageId),
            status: sent.status ?? null,
          },
        },
        auditAction: 'INBOX_MANUAL_REPLY_SENT',
      });
    } catch (error) {
      const friendly = await this.toFriendlySendError(
        error,
        context.channelAccount.id,
      );
      const failed = await this.persistOutboundMessage({
        userId,
        context,
        body,
        status: 'ERROR',
        externalMessageId: null,
        rawPayload: {
          source: 'manual_reply',
          sendError: true,
        },
        auditAction: 'INBOX_MANUAL_REPLY_FAILED',
      });

      throw new HttpException(
        {
          message: friendly,
          failedMessage: failed.message,
          thread: failed.thread,
        },
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  async retryMessage(
    userId: string,
    campaignId: string,
    threadId: string,
    messageId: string,
  ) {
    const context = await this.resolveOutboundContext(userId, campaignId, threadId);

    const existing = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        organizationId: context.campaign.organizationId,
        campaignId,
        conversationId: threadId,
        direction: MessageDirection.OUTBOUND,
      },
      select: {
        id: true,
        body: true,
        status: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Mensagem nao encontrada');
    }

    if (existing.status !== 'ERROR') {
      throw new BadRequestException('Somente mensagens com falha podem ser reenviadas');
    }

    const body = normalizeOutboundReplyBody(existing.body || '');

    this.logger.log(
      `Reenvio manual inbox messageId=${existing.id} threadId=${threadId}`,
    );

    try {
      const sent = await this.evolutionAdapter.sendTextMessage({
        instanceName: context.instanceName,
        number: context.number,
        text: body,
      });

      const now = new Date();
      const updated = await this.prisma.message.update({
        where: { id: existing.id },
        data: {
          status: sent.status || 'SENT',
          externalMessageId: sent.externalMessageId,
          rawPayload: {
            source: 'manual_reply_retry',
            evolution: {
              instanceName: sent.instanceName,
              hasExternalId: Boolean(sent.externalMessageId),
              status: sent.status ?? null,
            },
          } as Prisma.InputJsonValue,
        },
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
      });

      await this.prisma.conversationThread.update({
        where: { id: threadId },
        data: { lastMessageAt: now },
      });

      await this.audit.log({
        organizationId: context.campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'INBOX_MANUAL_REPLY_RETRIED',
        entityType: 'Message',
        entityId: updated.id,
        metadata: {
          threadId,
          channelAccountId: context.channelAccount.id,
          contactId: context.contact.id,
          hasExternalId: Boolean(sent.externalMessageId),
          bodyLength: body.length,
        },
      });

      return {
        message: this.mapMessage(updated),
        thread: {
          id: threadId,
          lastMessageAt: now.toISOString(),
        },
      };
    } catch (error) {
      const friendly = await this.toFriendlySendError(
        error,
        context.channelAccount.id,
      );
      await this.prisma.message.update({
        where: { id: existing.id },
        data: {
          status: 'ERROR',
          rawPayload: {
            source: 'manual_reply_retry',
            sendError: true,
          } as Prisma.InputJsonValue,
        },
      });

      throw new HttpException(
        {
          message: friendly,
        },
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  private async resolveOutboundContext(
    userId: string,
    campaignId: string,
    threadId: string,
  ): Promise<OutboundContext> {
    const campaign = await this.getCampaignContext(userId, campaignId, true);

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

    if (!thread.channelAccountId) {
      throw new BadRequestException('Conversa sem canal associado para envio');
    }

    const [contact, channelAccount, whatsappChannel] = await Promise.all([
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
          status: true,
          optOuts: { select: { id: true }, take: 1 },
          consents: {
            where: { status: ConsentStatus.OPT_OUT },
            select: { id: true },
            take: 1,
          },
        },
      }),
      this.prisma.channelAccount.findFirst({
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
          externalAccountId: true,
        },
      }),
      this.prisma.contactChannel.findFirst({
        where: {
          contactId: thread.contactId,
          organizationId: campaign.organizationId,
          campaignId,
          channel: ChannelType.WHATSAPP,
        },
        select: { normalizedValue: true },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    if (!contact) {
      throw new NotFoundException('Contato da conversa nao encontrado');
    }

    if (this.isOptOutActive(contact)) {
      const reason = this.getOptOutReason(contact);
      throw new ForbiddenException(
        reason === 'BLOCKED'
          ? 'Contato bloqueado. Envio manual nao permitido.'
          : 'Contato com opt-out. Envio manual nao permitido.',
      );
    }

    if (!channelAccount) {
      throw new NotFoundException('Canal da conversa nao encontrado');
    }

    if (channelAccount.provider !== ChannelProvider.WHATSAPP_EVOLUTION) {
      throw new BadRequestException('Canal nao suporta envio via Evolution');
    }

    if (channelAccount.status === ChannelAccountStatus.ARCHIVED) {
      throw new BadRequestException('Canal arquivado. Envio nao permitido.');
    }

    const instanceName = channelAccount.externalAccountId?.trim();
    if (!instanceName) {
      throw new BadRequestException(
        'Canal sem instancia Evolution. Prepare a conexao novamente.',
      );
    }

    // Refresh controlado: valida estado real na Evolution antes do envio
    // manual, sincroniza o ChannelAccount desta conversa e nunca faz failover.
    const syncedStatus = await this.refreshConversationChannelStatus(
      channelAccount.id,
      instanceName,
      channelAccount.status,
    );

    if (
      syncedStatus === ChannelAccountStatus.DISCONNECTED ||
      syncedStatus === ChannelAccountStatus.ERROR ||
      syncedStatus === ChannelAccountStatus.CONNECTING ||
      syncedStatus !== ChannelAccountStatus.CONNECTED
    ) {
      throw new BadRequestException(INBOX_INSTANCE_DISCONNECTED_MESSAGE);
    }

    const number = resolveWhatsAppDestination({
      phoneNumber: contact.phoneNumber,
      channelNormalizedValue: whatsappChannel?.normalizedValue,
    });

    if (!number) {
      throw new BadRequestException(
        'Contato sem telefone WhatsApp valido para envio',
      );
    }

    return {
      campaign,
      thread: {
        id: thread.id,
        contactId: thread.contactId,
        channelAccountId: thread.channelAccountId,
      },
      contact,
      channelAccount: {
        ...channelAccount,
        status: syncedStatus,
      },
      instanceName,
      number,
    };
  }

  /**
   * Consulta connectionState apenas do ChannelAccount da conversa.
   * Nao escolhe outro canal. Em falha de rede, preserva o status local
   * (exceto quando a Evolution confirma instancia ausente).
   */
  private async refreshConversationChannelStatus(
    channelAccountId: string,
    instanceName: string,
    currentStatus: ChannelAccountStatus,
  ): Promise<ChannelAccountStatus> {
    try {
      const connection =
        await this.evolutionAdapter.getConnectionState(instanceName);
      const mapped = mapEvolutionConnectionStateToStatus(connection.state);
      if (!mapped || mapped === currentStatus) {
        return mapped ?? currentStatus;
      }

      await this.prisma.channelAccount.update({
        where: { id: channelAccountId },
        data: { status: mapped },
      });
      return mapped;
    } catch (error) {
      if (
        error instanceof EvolutionApiException &&
        (error.getStatus() === HttpStatus.NOT_FOUND ||
          isEvolutionDisconnectErrorMessage(error.message))
      ) {
        await this.prisma.channelAccount.update({
          where: { id: channelAccountId },
          data: { status: ChannelAccountStatus.DISCONNECTED },
        });
        return ChannelAccountStatus.DISCONNECTED;
      }
      // Falha transitória de consulta: nao inventa desconexao; o envio
      // subsequente ainda usa apenas este ChannelAccount.
      return currentStatus;
    }
  }

  private async persistOutboundMessage(input: {
    userId: string;
    context: OutboundContext;
    body: string;
    status: string;
    externalMessageId: string | null | undefined;
    rawPayload: Prisma.InputJsonValue;
    auditAction: string;
  }) {
    const now = new Date();
    const message = await this.prisma.message.create({
      data: {
        organizationId: input.context.campaign.organizationId,
        campaignId: input.context.campaign.id,
        contactId: input.context.contact.id,
        conversationId: input.context.thread.id,
        channelAccountId: input.context.channelAccount.id,
        provider: ChannelProvider.WHATSAPP_EVOLUTION,
        direction: MessageDirection.OUTBOUND,
        externalMessageId: input.externalMessageId,
        body: input.body,
        status: input.status,
        rawPayload: input.rawPayload,
        createdAt: now,
      },
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
    });

    await this.prisma.conversationThread.update({
      where: { id: input.context.thread.id },
      data: { lastMessageAt: now },
    });

    await this.audit.log({
      organizationId: input.context.campaign.organizationId,
      campaignId: input.context.campaign.id,
      actorUserId: input.userId,
      action: input.auditAction,
      entityType: 'Message',
      entityId: message.id,
      metadata: {
        threadId: input.context.thread.id,
        channelAccountId: input.context.channelAccount.id,
        contactId: input.context.contact.id,
        hasExternalId: Boolean(input.externalMessageId),
        bodyLength: input.body.length,
        status: input.status,
      },
    });

    return {
      message: this.mapMessage(message),
      thread: {
        id: input.context.thread.id,
        lastMessageAt: now.toISOString(),
      },
    };
  }

  private mapMessage(message: {
    id: string;
    direction: string;
    body: string | null;
    status: string;
    provider: string;
    externalMessageId: string | null;
    createdAt: Date;
    rawPayload: Prisma.JsonValue | null;
  }): MappedMessage {
    return {
      id: message.id,
      direction: message.direction,
      body: message.body,
      status: message.status,
      provider: message.provider,
      externalMessageId: message.externalMessageId,
      createdAt: message.createdAt.toISOString(),
      optOutActive: this.extractOptOutFromPayload(message.rawPayload),
    };
  }

  private async toFriendlySendError(
    error: unknown,
    channelAccountId: string,
  ): Promise<string> {
    let message = 'Nao foi possivel entregar a mensagem no WhatsApp. Tente novamente.';

    if (error instanceof EvolutionApiException) {
      const payload = error.getResponse();
      if (typeof payload === 'object' && payload && 'message' in payload) {
        const value = (payload as { message?: unknown }).message;
        if (typeof value === 'string' && value.trim()) {
          message = value;
        }
      } else if (error.message.trim()) {
        message = error.message;
      }
    } else if (error instanceof HttpException) {
      const payload = error.getResponse();
      if (typeof payload === 'string' && payload.trim()) message = payload;
      if (typeof payload === 'object' && payload && 'message' in payload) {
        const value = (payload as { message?: unknown }).message;
        if (typeof value === 'string' && value.trim()) message = value;
      }
    }

    if (isEvolutionDisconnectErrorMessage(message)) {
      try {
        await this.prisma.channelAccount.update({
          where: { id: channelAccountId },
          data: { status: ChannelAccountStatus.DISCONNECTED },
        });
      } catch {
        // Nao mascara o erro original do envio.
      }
      return INBOX_INSTANCE_DISCONNECTED_MESSAGE;
    }

    return message;
  }

  private isOptOutActive(contact: {
    status: ContactStatus;
    optOuts: Array<{ id: string }>;
    consents: Array<{ id: string }>;
  }) {
    return this.getOptOutReason(contact) !== null;
  }

  private getOptOutReason(contact: {
    status: ContactStatus;
    optOuts: Array<{ id: string }>;
    consents: Array<{ id: string }>;
  }): 'BLOCKED' | 'OPT_OUT' | null {
    if (contact.status === ContactStatus.BLOCKED) return 'BLOCKED';
    if (contact.optOuts.length > 0 || contact.consents.length > 0) return 'OPT_OUT';
    return null;
  }

  private extractOptOutFromPayload(rawPayload: Prisma.JsonValue | null): boolean {
    if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
      return false;
    }
    return (rawPayload as Record<string, unknown>).optOutActive === true;
  }

  private async getCampaignContext(
    userId: string,
    campaignId: string,
    requireWrite = false,
  ) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, organizationId: true, name: true },
    });

    if (!campaign) {
      throw new NotFoundException('Campanha nao encontrada');
    }

    if (requireWrite) {
      await this.organizationAccess.requireWriteAccess(userId, campaign.organizationId);
    } else {
      await this.organizationAccess.requireMembership(userId, campaign.organizationId);
    }

    return campaign;
  }
}
