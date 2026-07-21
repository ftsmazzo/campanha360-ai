import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChannelType,
  DispatchPlanRecipientEligibilityStatus,
  DispatchPlanStatus,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../common/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeSegmentFilters } from '../segments/segment-filters.util';
import { buildSegmentStructuralWhere } from '../segments/segment-prevalidate.util';
import {
  buildDispatchPlanSnapshotRecipients,
  summarizeSnapshotRecipients,
} from './dispatch-plan-snapshot.util';
import { CreateDispatchPlanDto } from './dto/create-dispatch-plan.dto';
import { ListDispatchPlanRecipientsQueryDto } from './dto/list-dispatch-plan-recipients-query.dto';
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
  totalEvaluated: true,
  totalEligible: true,
  totalExcluded: true,
  snapshotCreatedAt: true,
  filtersSnapshot: true,
  validationSnapshot: true,
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

const SNAPSHOT_CONTACT_LIMIT = 5000;

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
    const plan = await this.getDispatchPlanOrThrow(
      dispatchPlanId,
      campaign.organizationId,
      campaignId,
    );

    const grouped = await this.prisma.dispatchPlanRecipient.groupBy({
      by: ['eligibilityStatus'],
      where: {
        organizationId: campaign.organizationId,
        campaignId,
        dispatchPlanId: plan.id,
      },
      _count: { _all: true },
    });

    return {
      ...plan,
      byEligibilityStatus: this.buildEligibilityStatusCounts(grouped),
    };
  }

  async generateSnapshot(
    userId: string,
    campaignId: string,
    dispatchPlanId: string,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    const plan = await this.getDispatchPlanOrThrow(
      dispatchPlanId,
      campaign.organizationId,
      campaignId,
    );

    if (plan.status !== DispatchPlanStatus.DRAFT) {
      throw new BadRequestException(
        'Apenas planos em DRAFT podem gerar snapshot',
      );
    }

    const segment = await this.prisma.segment.findFirst({
      where: {
        id: plan.segmentId,
        organizationId: campaign.organizationId,
        campaignId,
      },
      select: {
        id: true,
        filters: true,
      },
    });

    if (!segment) {
      throw new BadRequestException(
        'Segmento invalido ou nao pertence a esta campanha',
      );
    }

    await this.resolveChannelAccount(
      plan.channelAccountId,
      campaign.organizationId,
      campaignId,
    );

    const filters = normalizeSegmentFilters(
      segment.filters as Record<string, unknown>,
    );
    const contacts = await this.prisma.contact.findMany({
      where: buildSegmentStructuralWhere(
        campaign.organizationId,
        campaignId,
        filters,
      ),
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        city: true,
        neighborhood: true,
        metadata: true,
        status: true,
        operationalStatus: true,
        assignedTo: {
          select: {
            id: true,
            name: true,
          },
        },
        channels: {
          where: { channel: ChannelType.WHATSAPP },
          select: {
            channel: true,
            status: true,
          },
        },
        consents: {
          where: { channel: ChannelType.WHATSAPP },
          select: {
            channel: true,
            status: true,
            source: true,
            collectedAt: true,
            revokedAt: true,
          },
          orderBy: { updatedAt: 'desc' },
        },
        optOuts: {
          where: {
            OR: [
              { channel: null },
              { channel: ChannelType.WHATSAPP },
            ],
          },
          select: {
            channel: true,
            reason: true,
            source: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        tags: {
          select: {
            tag: {
              select: {
                id: true,
                name: true,
                color: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: SNAPSHOT_CONTACT_LIMIT + 1,
    });

    if (contacts.length > SNAPSHOT_CONTACT_LIMIT) {
      throw new BadRequestException(
        `O segmento excede o limite atual de ${SNAPSHOT_CONTACT_LIMIT} contatos para snapshot`,
      );
    }

    const recipients = buildDispatchPlanSnapshotRecipients(contacts);
    const summary = summarizeSnapshotRecipients(recipients);
    const snapshotCreatedAt = new Date();
    const isRegeneration = plan.snapshotCreatedAt !== null;
    const nextVersion = plan.version + 1;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.dispatchPlan.updateMany({
        where: {
          id: plan.id,
          organizationId: campaign.organizationId,
          campaignId,
          status: DispatchPlanStatus.DRAFT,
          version: plan.version,
        },
        data: {
          totalEvaluated: summary.totalEvaluated,
          totalEligible: summary.totalEligible,
          totalExcluded: summary.totalExcluded,
          snapshotCreatedAt,
          filtersSnapshot: filters as unknown as Prisma.InputJsonValue,
          validationSnapshot: Prisma.DbNull,
          version: { increment: 1 },
        },
      });

      if (updated.count !== 1) {
        throw new ConflictException(
          'O plano foi alterado durante a geracao do snapshot; tente novamente',
        );
      }

      await tx.dispatchPlanRecipient.deleteMany({
        where: {
          organizationId: campaign.organizationId,
          campaignId,
          dispatchPlanId: plan.id,
        },
      });

      if (recipients.length > 0) {
        await tx.dispatchPlanRecipient.createMany({
          data: recipients.map((recipient) => ({
            organizationId: campaign.organizationId,
            campaignId,
            dispatchPlanId: plan.id,
            contactId: recipient.contactId,
            destination: recipient.destination,
            normalizedDestination: recipient.normalizedDestination,
            eligibilityStatus: recipient.eligibilityStatus,
            exclusionReason: recipient.exclusionReason,
            contactSnapshot:
              recipient.contactSnapshot as Prisma.InputJsonValue,
            consentSnapshot: recipient.consentSnapshot
              ? (recipient.consentSnapshot as Prisma.InputJsonValue)
              : Prisma.DbNull,
            optOutSnapshot: recipient.optOutSnapshot
              ? (recipient.optOutSnapshot as Prisma.InputJsonValue)
              : Prisma.DbNull,
          })),
        });
      }
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: isRegeneration
        ? 'DISPATCH_PLAN_SNAPSHOT_REGENERATED'
        : 'DISPATCH_PLAN_SNAPSHOT_CREATED',
      entityType: 'DispatchPlan',
      entityId: plan.id,
      metadata: {
        dispatchPlanId: plan.id,
        segmentId: plan.segmentId,
        version: nextVersion,
        totalEvaluated: summary.totalEvaluated,
        totalEligible: summary.totalEligible,
        totalExcluded: summary.totalExcluded,
        snapshotCreatedAt: snapshotCreatedAt.toISOString(),
      },
    });

    return {
      dispatchPlanId: plan.id,
      version: nextVersion,
      snapshotCreatedAt,
      ...summary,
      regenerated: isRegeneration,
    };
  }

  async listRecipients(
    userId: string,
    campaignId: string,
    dispatchPlanId: string,
    query: ListDispatchPlanRecipientsQueryDto,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId);
    const plan = await this.getDispatchPlanOrThrow(
      dispatchPlanId,
      campaign.organizationId,
      campaignId,
    );

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();
    const where: Prisma.DispatchPlanRecipientWhereInput = {
      organizationId: campaign.organizationId,
      campaignId,
      dispatchPlanId: plan.id,
    };

    if (query.eligibilityStatus === 'EXCLUDED') {
      where.eligibilityStatus = {
        not: DispatchPlanRecipientEligibilityStatus.ELIGIBLE,
      };
    } else if (query.eligibilityStatus) {
      where.eligibilityStatus = query.eligibilityStatus;
    }

    if (search) {
      where.OR = [
        { destination: { contains: search, mode: 'insensitive' } },
        {
          normalizedDestination: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          contactSnapshot: {
            path: ['name'],
            string_contains: search,
          },
        },
      ];
    }

    const [recipients, total, grouped] = await Promise.all([
      this.prisma.dispatchPlanRecipient.findMany({
        where,
        select: {
          id: true,
          contactId: true,
          destination: true,
          normalizedDestination: true,
          eligibilityStatus: true,
          exclusionReason: true,
          contactSnapshot: true,
          consentSnapshot: true,
          optOutSnapshot: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.dispatchPlanRecipient.count({ where }),
      this.prisma.dispatchPlanRecipient.groupBy({
        by: ['eligibilityStatus'],
        where: {
          organizationId: campaign.organizationId,
          campaignId,
          dispatchPlanId: plan.id,
        },
        _count: { _all: true },
      }),
    ]);

    return {
      recipients,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      totals: {
        totalEvaluated: plan.totalEvaluated,
        totalEligible: plan.totalEligible,
        totalExcluded: plan.totalExcluded,
        byEligibilityStatus: this.buildEligibilityStatusCounts(grouped),
      },
      filters: {
        eligibilityStatus: query.eligibilityStatus ?? null,
        search: search ?? null,
      },
    };
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

  private buildEligibilityStatusCounts(
    grouped: Array<{
      eligibilityStatus: DispatchPlanRecipientEligibilityStatus;
      _count: { _all: number };
    }>,
  ) {
    const counts = Object.values(
      DispatchPlanRecipientEligibilityStatus,
    ).reduce<Record<string, number>>((result, status) => {
      result[status] = 0;
      return result;
    }, {});

    for (const item of grouped) {
      counts[item.eligibilityStatus] = item._count._all;
    }

    return counts;
  }
}
