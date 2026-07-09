import { Injectable, NotFoundException } from '@nestjs/common';
import { ChannelAccountStatus, ChannelProvider, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../common/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChannelAccountDto } from './dto/create-channel-account.dto';
import { UpdateChannelAccountDto } from './dto/update-channel-account.dto';

const channelAccountSelect = {
  id: true,
  organizationId: true,
  campaignId: true,
  provider: true,
  name: true,
  status: true,
  externalAccountId: true,
  config: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ChannelAccountSelect;

@Injectable()
export class ChannelAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationAccess: OrganizationAccessService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, campaignId: string) {
    const campaign = await this.getCampaignContext(userId, campaignId);

    return this.prisma.channelAccount.findMany({
      where: {
        organizationId: campaign.organizationId,
        campaignId,
      },
      select: channelAccountSelect,
      orderBy: [{ name: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async getById(userId: string, campaignId: string, channelAccountId: string) {
    const campaign = await this.getCampaignContext(userId, campaignId);
    return this.getChannelAccountOrThrow(
      channelAccountId,
      campaign.organizationId,
      campaignId,
    );
  }

  async create(userId: string, campaignId: string, dto: CreateChannelAccountDto) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);

    const account = await this.prisma.channelAccount.create({
      data: {
        organizationId: campaign.organizationId,
        campaignId,
        name: dto.name.trim(),
        provider: dto.provider ?? ChannelProvider.WHATSAPP_EVOLUTION,
        status: dto.status ?? ChannelAccountStatus.DISCONNECTED,
        externalAccountId: dto.externalAccountId?.trim() || null,
        config: dto.config as Prisma.InputJsonValue | undefined,
      },
      select: channelAccountSelect,
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'CHANNEL_ACCOUNT_CREATED',
      entityType: 'ChannelAccount',
      entityId: account.id,
      metadata: {
        name: account.name,
        provider: account.provider,
        status: account.status,
        externalAccountId: account.externalAccountId,
      },
    });

    return account;
  }

  async update(
    userId: string,
    campaignId: string,
    channelAccountId: string,
    dto: UpdateChannelAccountDto,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    const existing = await this.getChannelAccountOrThrow(
      channelAccountId,
      campaign.organizationId,
      campaignId,
    );

    const account = await this.prisma.channelAccount.update({
      where: { id: existing.id },
      data: {
        name: dto.name === undefined ? undefined : dto.name.trim(),
        provider: dto.provider,
        status: dto.status,
        externalAccountId:
          dto.externalAccountId === undefined
            ? undefined
            : dto.externalAccountId?.trim() || null,
        config:
          dto.config === undefined
            ? undefined
            : dto.config === null
              ? Prisma.JsonNull
              : (dto.config as Prisma.InputJsonValue),
      },
      select: channelAccountSelect,
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'CHANNEL_ACCOUNT_UPDATED',
      entityType: 'ChannelAccount',
      entityId: account.id,
      metadata: {
        changes: JSON.parse(JSON.stringify(dto)),
      },
    });

    return account;
  }

  private async getCampaignContext(
    userId: string,
    campaignId: string,
    requireWrite = false,
  ) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, organizationId: true },
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

  private async getChannelAccountOrThrow(
    channelAccountId: string,
    organizationId: string,
    campaignId: string,
  ) {
    const account = await this.prisma.channelAccount.findFirst({
      where: { id: channelAccountId, organizationId, campaignId },
      select: channelAccountSelect,
    });

    if (!account) {
      throw new NotFoundException('Conta de canal nao encontrada');
    }

    return account;
  }
}
