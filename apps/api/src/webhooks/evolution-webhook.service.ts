import {
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { normalizePhone } from '../common/phone.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  EvolutionWebhookAuthHeaders,
  validateEvolutionWebhookAuth,
} from './evolution-webhook.auth';
import {
  NormalizedEvolutionInbound,
  normalizeEvolutionWebhookPayload,
} from './evolution-webhook.normalizer';

type ProcessResult = {
  ok: true;
  ignored?: boolean;
  reason?: string;
  processed: number;
  duplicates: number;
  skippedOutbound: number;
};

@Injectable()
export class EvolutionWebhookService {
  private readonly logger = new Logger(EvolutionWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async getHealth(channelAccountId: string) {
    const account = await this.findActiveEvolutionAccount(channelAccountId);

    return {
      ok: true as const,
      service: 'evolution-webhook',
      channelAccountId: account.id,
      campaignId: account.campaignId,
      provider: account.provider,
      status: account.status,
    };
  }

  async handleInbound(
    channelAccountId: string,
    payload: unknown,
    authHeaders: EvolutionWebhookAuthHeaders,
  ): Promise<ProcessResult> {
    this.assertWebhookAuth(authHeaders);

    const account = await this.findActiveEvolutionAccount(channelAccountId);

    const normalizedItems = normalizeEvolutionWebhookPayload(payload);
    const inboundItems = normalizedItems.filter((item) => item.isInboundMessage && !item.fromMe);

    this.logger.log(
      `Webhook Evolution recebido channelAccountId=${account.id} event=${normalizedItems[0]?.event ?? 'unknown'} inboundCandidates=${inboundItems.length}`,
    );

    if (inboundItems.length === 0) {
      await this.safeAudit(account, 'CHANNEL_EVOLUTION_WEBHOOK_IGNORED', {
        reason: 'no_inbound_message',
        event: normalizedItems[0]?.event ?? null,
      });

      return {
        ok: true,
        ignored: true,
        reason: 'no_inbound_message',
        processed: 0,
        duplicates: 0,
        skippedOutbound: normalizedItems.filter((item) => item.fromMe).length,
      };
    }

    let processed = 0;
    let duplicates = 0;
    let skippedOutbound = normalizedItems.filter((item) => item.fromMe).length;

    for (const item of inboundItems) {
      const result = await this.persistInboundMessage(account, item, payload);
      if (result === 'duplicate') {
        duplicates += 1;
      } else if (result === 'processed') {
        processed += 1;
      }
    }

    await this.safeAudit(account, 'CHANNEL_EVOLUTION_WEBHOOK_PROCESSED', {
      processed,
      duplicates,
      skippedOutbound,
      event: normalizedItems[0]?.event ?? null,
    });

    this.logger.log(
      `Webhook Evolution processado channelAccountId=${account.id} processed=${processed} duplicates=${duplicates}`,
    );

    return {
      ok: true,
      processed,
      duplicates,
      skippedOutbound,
    };
  }

  private async findActiveEvolutionAccount(channelAccountId: string) {
    const account = await this.prisma.channelAccount.findUnique({
      where: { id: channelAccountId },
      select: {
        id: true,
        organizationId: true,
        campaignId: true,
        provider: true,
        status: true,
      },
    });

    if (!account) {
      throw new NotFoundException('Conta de canal nao encontrada');
    }

    if (account.provider !== ChannelProvider.WHATSAPP_EVOLUTION) {
      throw new ForbiddenException('Conta de canal nao usa provider WHATSAPP_EVOLUTION');
    }

    if (account.status === ChannelAccountStatus.ARCHIVED) {
      throw new GoneException('Conta de canal arquivada');
    }

    return account;
  }

  private assertWebhookAuth(headers: EvolutionWebhookAuthHeaders) {
    const expected = (this.config.get<string>('EVOLUTION_WEBHOOK_SECRET') || '').trim();
    const result = validateEvolutionWebhookAuth(expected || null, headers);

    if (result.ok) {
      if (result.mode === 'disabled') {
        this.logger.warn(
          'EVOLUTION_WEBHOOK_SECRET nao configurado: webhook Evolution aceito sem autenticacao (apenas homologacao/teste; risco em producao)',
        );
        return;
      }

      this.logger.log(`Webhook Evolution autenticado mode=${result.mode}`);
      return;
    }

    switch (result.reason) {
      case 'missing_auth':
        this.logger.warn(
          'Webhook Evolution rejeitado: faltou Authorization Bearer ou header de secret',
        );
        throw new UnauthorizedException(
          'Autenticacao do webhook Evolution ausente (Authorization Bearer ou header de secret)',
        );
      case 'invalid_jwt':
        this.logger.warn('Webhook Evolution rejeitado: JWT invalido');
        throw new UnauthorizedException('JWT do webhook Evolution invalido');
      case 'invalid_jwt_claims':
        this.logger.warn('Webhook Evolution rejeitado: JWT com claims invalidas');
        throw new UnauthorizedException('JWT do webhook Evolution com claims invalidas');
      case 'invalid_secret':
        this.logger.warn('Webhook Evolution rejeitado: secret de header invalido');
        throw new UnauthorizedException('Secret do webhook Evolution invalido');
      default:
        this.logger.warn('Webhook Evolution rejeitado: nao autorizado');
        throw new UnauthorizedException('Webhook Evolution nao autorizado');
    }
  }

  private async persistInboundMessage(
    account: {
      id: string;
      organizationId: string;
      campaignId: string;
    },
    item: NormalizedEvolutionInbound,
    rawPayload: unknown,
  ): Promise<'processed' | 'duplicate' | 'skipped'> {
    const phone = item.phone ? normalizePhone(item.phone) : null;
    if (!phone) {
      this.logger.warn(
        `Webhook Evolution sem telefone util channelAccountId=${account.id} externalMessageId=${item.externalMessageId ?? 'n/a'}`,
      );
      return 'skipped';
    }

    if (item.externalMessageId) {
      const existing = await this.prisma.message.findFirst({
        where: {
          organizationId: account.organizationId,
          campaignId: account.campaignId,
          channelAccountId: account.id,
          externalMessageId: item.externalMessageId,
          direction: MessageDirection.INBOUND,
        },
        select: { id: true },
      });

      if (existing) {
        return 'duplicate';
      }
    }

    const contact = await this.findOrCreateContact(account, phone, item.pushName);
    const optOutActive = await this.isOptOutActive(contact.id);
    const occurredAt = item.occurredAt ?? new Date();

    let thread = await this.prisma.conversationThread.findFirst({
      where: {
        organizationId: account.organizationId,
        campaignId: account.campaignId,
        channelAccountId: account.id,
        contactId: contact.id,
        channel: ChannelType.WHATSAPP,
      },
      select: { id: true },
    });

    if (!thread) {
      thread = await this.prisma.conversationThread.create({
        data: {
          organizationId: account.organizationId,
          campaignId: account.campaignId,
          contactId: contact.id,
          channelAccountId: account.id,
          channel: ChannelType.WHATSAPP,
          status: 'OPEN',
          lastMessageAt: occurredAt,
        },
        select: { id: true },
      });
    } else {
      await this.prisma.conversationThread.update({
        where: { id: thread.id },
        data: { lastMessageAt: occurredAt },
      });
    }

    await this.prisma.message.create({
      data: {
        organizationId: account.organizationId,
        campaignId: account.campaignId,
        contactId: contact.id,
        conversationId: thread.id,
        channelAccountId: account.id,
        provider: ChannelProvider.WHATSAPP_EVOLUTION,
        direction: MessageDirection.INBOUND,
        externalMessageId: item.externalMessageId,
        body: item.body,
        status: 'RECEIVED',
        rawPayload: {
          source: 'evolution',
          optOutActive,
          normalized: {
            event: item.event,
            externalMessageId: item.externalMessageId,
            phone,
            remoteJid: item.remoteJid,
            occurredAt: occurredAt.toISOString(),
            pushName: item.pushName,
          },
          payload: rawPayload as Prisma.InputJsonValue,
        } as Prisma.InputJsonValue,
        createdAt: occurredAt,
      },
    });

    return 'processed';
  }

  private async findOrCreateContact(
    account: { organizationId: string; campaignId: string },
    phone: string,
    pushName: string | null,
  ) {
    const byChannel = await this.prisma.contactChannel.findFirst({
      where: {
        organizationId: account.organizationId,
        campaignId: account.campaignId,
        channel: ChannelType.WHATSAPP,
        normalizedValue: phone,
      },
      select: {
        contact: {
          select: { id: true, name: true, status: true },
        },
      },
    });

    if (byChannel?.contact) {
      if (pushName?.trim() && !byChannel.contact.name?.trim()) {
        await this.prisma.contact.update({
          where: { id: byChannel.contact.id },
          data: { name: pushName.trim() },
        });
        return { ...byChannel.contact, name: pushName.trim() };
      }
      return byChannel.contact;
    }

    const byPhone = await this.prisma.contact.findFirst({
      where: {
        organizationId: account.organizationId,
        campaignId: account.campaignId,
        OR: [{ phoneNumber: phone }, { phoneNumber: { endsWith: phone.slice(-11) } }],
        status: { not: ContactStatus.DELETED },
      },
      select: { id: true, name: true, status: true },
      orderBy: { createdAt: 'asc' },
    });

    if (byPhone) {
      await this.ensureWhatsappChannel(account, byPhone.id, phone);
      if (pushName?.trim() && !byPhone.name?.trim()) {
        await this.prisma.contact.update({
          where: { id: byPhone.id },
          data: { name: pushName.trim() },
        });
        return { ...byPhone, name: pushName.trim() };
      }
      return byPhone;
    }

    const created = await this.prisma.contact.create({
      data: {
        organizationId: account.organizationId,
        campaignId: account.campaignId,
        name: pushName?.trim() || phone,
        phoneNumber: phone,
        status: ContactStatus.ACTIVE,
        channels: {
          create: {
            organizationId: account.organizationId,
            campaignId: account.campaignId,
            channel: ChannelType.WHATSAPP,
            value: phone,
            normalizedValue: phone,
            isPrimary: true,
          },
        },
      },
      select: { id: true, name: true, status: true },
    });

    return created;
  }

  private async ensureWhatsappChannel(
    account: { organizationId: string; campaignId: string },
    contactId: string,
    phone: string,
  ) {
    const existing = await this.prisma.contactChannel.findFirst({
      where: {
        contactId,
        channel: ChannelType.WHATSAPP,
        normalizedValue: phone,
      },
      select: { id: true },
    });

    if (existing) return;

    await this.prisma.contactChannel.create({
      data: {
        organizationId: account.organizationId,
        campaignId: account.campaignId,
        contactId,
        channel: ChannelType.WHATSAPP,
        value: phone,
        normalizedValue: phone,
        isPrimary: true,
      },
    });
  }

  private async isOptOutActive(contactId: string): Promise<boolean> {
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      select: {
        status: true,
        optOuts: { select: { id: true }, take: 1 },
        consents: {
          where: {
            status: ConsentStatus.OPT_OUT,
            OR: [{ channel: ChannelType.WHATSAPP }],
          },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!contact) return false;
    if (contact.status === ContactStatus.BLOCKED) return true;
    if (contact.optOuts.length > 0) return true;
    if (contact.consents.length > 0) return true;
    return false;
  }

  private async safeAudit(
    account: { id: string; organizationId: string; campaignId: string },
    action: string,
    metadata: Record<string, unknown>,
  ) {
    try {
      await this.audit.log({
        organizationId: account.organizationId,
        campaignId: account.campaignId,
        actorUserId: null,
        action,
        entityType: 'ChannelAccount',
        entityId: account.id,
        metadata: metadata as Prisma.InputJsonValue,
      });
    } catch {
      this.logger.warn(
        `Falha ao gravar audit do webhook Evolution action=${action} channelAccountId=${account.id}`,
      );
    }
  }
}
