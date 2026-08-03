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
import {
  DEFAULT_OPT_OUT_KEYWORDS,
  matchOptOutKeyword,
  resolveOptOutKeywords,
} from '@campanha360/shared';
import { AuditService } from '../audit/audit.service';
import { normalizePhone } from '../common/phone.util';
import { skipPendingDispatchItemsForContactOptOut } from '../contacts/contact-opt-out-dispatch.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  EvolutionWebhookAuthHeaders,
  validateEvolutionWebhookAuth,
} from './evolution-webhook.auth';
import {
  NormalizedEvolutionInbound,
  extractEvolutionConnectionMeta,
  isConnectionUpdateEvent,
  normalizeEvolutionWebhookPayload,
} from './evolution-webhook.normalizer';
import { EvolutionLifecycleService } from '../evolution/evolution-lifecycle.service';
import { sanitizeLogText } from '@campanha360/shared';

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
    private readonly evolutionLifecycle: EvolutionLifecycleService,
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

    const root =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : null;
    const eventRaw =
      (typeof root?.event === 'string' ? root.event : null) ??
      (typeof root?.type === 'string' ? root.type : null);

    if (isConnectionUpdateEvent(eventRaw)) {
      return this.handleConnectionUpdate(account, payload, eventRaw);
    }

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

  private async handleConnectionUpdate(
    account: {
      id: string;
      organizationId: string;
      campaignId: string;
      provider: ChannelProvider;
      status: ChannelAccountStatus;
    },
    payload: unknown,
    event: string | null,
  ): Promise<ProcessResult> {
    const meta = extractEvolutionConnectionMeta(payload);
    const receivedAt = new Date();

    const result = await this.evolutionLifecycle.applyWebhookConnectionState({
      accountId: account.id,
      rawState: meta.state,
      statusReason: meta.statusReason,
      reasonCode: meta.reasonCode,
      reasonType: meta.reasonType,
      eventAt: meta.eventAt,
      receivedAt,
      eventName: event,
    });

    if (!result.applied) {
      this.logger.warn(
        sanitizeLogText(
          `Webhook connection.update ignorado channelAccountId=${account.id} reason=${result.reason} state=${meta.state ?? 'n/a'}`,
        ),
      );
      await this.safeAudit(account, 'CHANNEL_EVOLUTION_CONNECTION_IGNORED', {
        reason: result.reason,
        event,
        evolutionState: meta.state,
        statusReason: meta.statusReason,
      });
      return {
        ok: true,
        ignored: true,
        reason: result.reason ?? 'unmapped_connection_state',
        processed: 0,
        duplicates: 0,
        skippedOutbound: 0,
      };
    }

    await this.safeAudit(account, 'CHANNEL_EVOLUTION_CONNECTION_UPDATED', {
      event,
      evolutionState: meta.state,
      statusReason: meta.statusReason,
      reasonType: meta.reasonType,
      previousStatus: account.status,
      remoteConnectionState: result.state?.normalizedConnectionState,
    });

    this.logger.log(
      sanitizeLogText(
        `Webhook connection.update channelAccountId=${account.id} state=${meta.state ?? 'n/a'} remote=${result.state?.normalizedConnectionState ?? 'n/a'}`,
      ),
    );

    return {
      ok: true,
      processed: 1,
      duplicates: 0,
      skippedOutbound: 0,
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

    if (!optOutActive) {
      await this.maybeApplyInboundOptOutKeyword(account, contact.id, item.body);
    }

    return 'processed';
  }

  /**
   * Avalia keywords de opt-out no inbound (09.6.2).
   * Nao cria resposta automatica.
   */
  private async maybeApplyInboundOptOutKeyword(
    account: { id: string; organizationId: string; campaignId: string },
    contactId: string,
    body: string | null,
  ): Promise<void> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: account.campaignId },
      select: { optOutKeywords: true },
    });

    const campaignKeywords = Array.isArray(campaign?.optOutKeywords)
      ? (campaign?.optOutKeywords as unknown[]).filter(
          (v): v is string => typeof v === 'string',
        )
      : null;

    const keywords = resolveOptOutKeywords({
      campaignKeywords,
      policyKeywords: [...DEFAULT_OPT_OUT_KEYWORDS],
    });

    const match = matchOptOutKeyword(body, keywords);
    if (!match.matched) return;

    // Idempotente: se ja BLOCKED/opt-out, ainda assim tenta skip de items pendentes
    const already = await this.isOptOutActive(contactId);
    if (!already) {
      await this.prisma.$transaction(async (tx) => {
        await tx.optOut.create({
          data: {
            organizationId: account.organizationId,
            campaignId: account.campaignId,
            contactId,
            channel: ChannelType.WHATSAPP,
            reason: 'INBOUND_KEYWORD',
            source: 'inbound_keyword',
          },
        });

        const existingConsent = await tx.consent.findFirst({
          where: {
            organizationId: account.organizationId,
            campaignId: account.campaignId,
            contactId,
            channel: ChannelType.WHATSAPP,
          },
          orderBy: { createdAt: 'desc' },
        });
        if (existingConsent) {
          await tx.consent.update({
            where: { id: existingConsent.id },
            data: {
              status: ConsentStatus.OPT_OUT,
              source: 'inbound_keyword',
              revokedAt: new Date(),
            },
          });
        } else {
          await tx.consent.create({
            data: {
              organizationId: account.organizationId,
              campaignId: account.campaignId,
              contactId,
              channel: ChannelType.WHATSAPP,
              status: ConsentStatus.OPT_OUT,
              source: 'inbound_keyword',
              revokedAt: new Date(),
            },
          });
        }

        await tx.contact.update({
          where: { id: contactId },
          data: { status: ContactStatus.BLOCKED },
        });
      });
    }

    const skipped = await skipPendingDispatchItemsForContactOptOut(this.prisma, {
      organizationId: account.organizationId,
      campaignId: account.campaignId,
      contactId,
    });

    await this.safeAudit(account, 'CONTACT_OPT_OUT_KEYWORD_MATCHED', {
      contactId,
      keywordMatched: match.keyword,
      strategy: match.strategy,
      skippedItems: skipped.skipped,
      // sem body/telefone
    });
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
