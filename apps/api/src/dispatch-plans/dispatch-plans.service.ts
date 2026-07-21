import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChannelType, DispatchPlanStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../common/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDispatchPlanDto } from './dto/create-dispatch-plan.dto';
import { UpdateDispatchPlanDto } from './dto/update-dispatch-plan.dto';
import {
  buildDispatchPlanAuditMetadata,
  canCancelDispatchPlan,
  isAllowedDispatchProvider,
  isArchivedChannelAccount,
  isDispatchPlanEditable,
  resolveDispatchChannelType,
  shouldBumpDispatchPlanVersion,
} from './dispatch-plan.util';

const dispatchPlanSelect = {
  id: true,
  organizationId: true,
  campaignId: true,
  segmentId: true,
  channelAccountId: true,
  name: true,
  description: true,
  channelType: true,
  content: true,
  status: true,
  version: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
  segment: {
    select: {
      id: true,
      name: true,
    },
  },
  channelAccount: {
    select: {
      id: true,
      name: true,
      provider: true,
      status: true,
    },
  },
  createdBy: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
} satisfies Prisma.DispatchPlanSelect;

@Injectable()
export class DispatchPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationAccess: OrganizationAccessService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, campaignId: string) {
    const campaign = await this.getCampaignContext(userId, campaignId);
    return this.prisma.dispatchPlan.findMany({
      where: {
        organizationId: campaign.organizationId,
        campaignId,
      },
      select: dispatchPlanSelect,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getById(userId: string, campaignId: string, dispatchPlanId: string) {
    const campaign = await this.getCampaignContext(userId, campaignId);
    return this.getDispatchPlanOrThrow(
      dispatchPlanId,
      campaign.organizationId,
      campaignId,
    );
  }

  async create(userId: string, campaignId: string, dto: CreateDispatchPlanDto) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    const segment = await this.resolveSegment(
      dto.segmentId,
      campaign.organizationId,
      campaignId,
    );
    const channelAccount = await this.resolveChannelAccount(
      dto.channelAccountId,
      campaign.organizationId,
      campaignId,
    );

    const plan = await this.prisma.dispatchPlan.create({
      data: {
        organizationId: campaign.organizationId,
        campaignId,
        segmentId: segment.id,
        channelAccountId: channelAccount.id,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        channelType: resolveDispatchChannelType(channelAccount.provider),
        content: dto.content.trim(),
        status: DispatchPlanStatus.DRAFT,
        version: 1,
        createdByUserId: userId,
      },
      select: dispatchPlanSelect,
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'DISPATCH_PLAN_CREATED',
      entityType: 'DispatchPlan',
      entityId: plan.id,
      metadata: buildDispatchPlanAuditMetadata({
        dispatchPlanId: plan.id,
        segmentId: plan.segmentId,
        channelAccountId: plan.channelAccountId,
        status: plan.status,
        version: plan.version,
      }),
    });

    return plan;
  }

  async update(
    userId: string,
    campaignId: string,
    dispatchPlanId: string,
    dto: UpdateDispatchPlanDto,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    const existing = await this.getDispatchPlanOrThrow(
      dispatchPlanId,
      campaign.organizationId,
      campaignId,
    );

    if (!isDispatchPlanEditable(existing.status)) {
      throw new BadRequestException(
        'Apenas planos em DRAFT podem ser editados',
      );
    }

    const nextSegmentId = dto.segmentId ?? existing.segmentId;
    const nextChannelAccountId =
      dto.channelAccountId ?? existing.channelAccountId;
    const nextContent =
      dto.content === undefined ? existing.content : dto.content.trim();

    if (!nextContent) {
      throw new BadRequestException('Conteudo textual e obrigatorio');
    }

    const segmentChanged = nextSegmentId !== existing.segmentId;
    const channelChanged = nextChannelAccountId !== existing.channelAccountId;
    const contentChanged = nextContent !== existing.content;

    if (segmentChanged) {
      await this.resolveSegment(
        nextSegmentId,
        campaign.organizationId,
        campaignId,
      );
    }

    let nextChannelType: ChannelType = existing.channelType;
    if (channelChanged) {
      const channelAccount = await this.resolveChannelAccount(
        nextChannelAccountId,
        campaign.organizationId,
        campaignId,
      );
      nextChannelType = resolveDispatchChannelType(channelAccount.provider);
    }

    const bumpVersion = shouldBumpDispatchPlanVersion({
      segmentChanged,
      channelChanged,
      contentChanged,
    });

    const plan = await this.prisma.dispatchPlan.update({
      where: { id: existing.id },
      data: {
        name: dto.name === undefined ? undefined : dto.name.trim(),
        description:
          dto.description === undefined
            ? undefined
            : dto.description?.trim() || null,
        segmentId: segmentChanged ? nextSegmentId : undefined,
        channelAccountId: channelChanged ? nextChannelAccountId : undefined,
        channelType: channelChanged ? nextChannelType : undefined,
        content: contentChanged ? nextContent : undefined,
        version: bumpVersion ? existing.version + 1 : undefined,
      },
      select: dispatchPlanSelect,
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'DISPATCH_PLAN_UPDATED',
      entityType: 'DispatchPlan',
      entityId: plan.id,
      metadata: buildDispatchPlanAuditMetadata({
        dispatchPlanId: plan.id,
        segmentId: plan.segmentId,
        channelAccountId: plan.channelAccountId,
        status: plan.status,
        version: plan.version,
      }),
    });

    return plan;
  }

  async cancel(userId: string, campaignId: string, dispatchPlanId: string) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    const existing = await this.getDispatchPlanOrThrow(
      dispatchPlanId,
      campaign.organizationId,
      campaignId,
    );

    if (!canCancelDispatchPlan(existing.status)) {
      throw new BadRequestException(
        'Este plano nao pode ser cancelado no status atual',
      );
    }

    const plan = await this.prisma.dispatchPlan.update({
      where: { id: existing.id },
      data: { status: DispatchPlanStatus.CANCELED },
      select: dispatchPlanSelect,
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'DISPATCH_PLAN_CANCELED',
      entityType: 'DispatchPlan',
      entityId: plan.id,
      metadata: buildDispatchPlanAuditMetadata({
        dispatchPlanId: plan.id,
        segmentId: plan.segmentId,
        channelAccountId: plan.channelAccountId,
        status: plan.status,
        version: plan.version,
      }),
    });

    return plan;
  }

  private async resolveSegment(
    segmentId: string,
    organizationId: string,
    campaignId: string,
  ) {
    const segment = await this.prisma.segment.findFirst({
      where: { id: segmentId, organizationId, campaignId },
      select: { id: true },
    });

    if (!segment) {
      throw new BadRequestException(
        'Segmento invalido ou nao pertence a esta campanha',
      );
    }

    return segment;
  }

  private async resolveChannelAccount(
    channelAccountId: string,
    organizationId: string,
    campaignId: string,
  ) {
    const channelAccount = await this.prisma.channelAccount.findFirst({
      where: { id: channelAccountId, organizationId, campaignId },
      select: {
        id: true,
        provider: true,
        status: true,
      },
    });

    if (!channelAccount) {
      throw new BadRequestException(
        'Canal invalido ou nao pertence a esta campanha',
      );
    }

    if (!isAllowedDispatchProvider(channelAccount.provider)) {
      throw new BadRequestException(
        'Apenas canais WhatsApp Evolution sao permitidos nesta etapa',
      );
    }

    if (isArchivedChannelAccount(channelAccount.status)) {
      throw new BadRequestException('Canal arquivado nao pode ser usado');
    }

    return channelAccount;
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
      await this.organizationAccess.requireWriteAccess(
        userId,
        campaign.organizationId,
      );
    } else {
      await this.organizationAccess.requireMembership(
        userId,
        campaign.organizationId,
      );
    }

    return campaign;
  }

  private async getDispatchPlanOrThrow(
    dispatchPlanId: string,
    organizationId: string,
    campaignId: string,
  ) {
    const plan = await this.prisma.dispatchPlan.findFirst({
      where: { id: dispatchPlanId, organizationId, campaignId },
      select: dispatchPlanSelect,
    });

    if (!plan) {
      throw new NotFoundException('Plano de disparo nao encontrado');
    }

    return plan;
  }
}
