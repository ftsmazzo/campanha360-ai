import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DispatchStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../common/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertChannelReadyForDispatchCreation,
  buildDispatchAllowedActions,
  buildDispatchConfigurationSnapshot,
  buildDispatchContentSnapshot,
  canCreateDispatchFromPlan,
} from './dispatch.util';
import { CreateDispatchDto } from './dto/create-dispatch.dto';
import { ListDispatchesQueryDto } from './dto/list-dispatches-query.dto';

const listSelect = {
  id: true,
  name: true,
  status: true,
  dispatchPlanId: true,
  channelType: true,
  totalItems: true,
  sentItems: true,
  failedItems: true,
  approvalSnapshot: true,
  createdAt: true,
  dispatchPlan: {
    select: {
      id: true,
      name: true,
      totalEligible: true,
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
    },
  },
} satisfies Prisma.DispatchSelect;

const detailSelect = {
  id: true,
  organizationId: true,
  campaignId: true,
  dispatchPlanId: true,
  channelAccountId: true,
  name: true,
  description: true,
  channelType: true,
  contentSnapshot: true,
  configurationSnapshot: true,
  approvalSnapshot: true,
  status: true,
  totalItems: true,
  pendingItems: true,
  queuedItems: true,
  processingItems: true,
  sentItems: true,
  deliveredItems: true,
  readItems: true,
  failedItems: true,
  skippedItems: true,
  canceledItems: true,
  createdByUserId: true,
  preparedAt: true,
  queuedAt: true,
  startedAt: true,
  pausingAt: true,
  pausedAt: true,
  resumedAt: true,
  completedAt: true,
  failedAt: true,
  canceledAt: true,
  emergencyStoppedAt: true,
  lastProgressAt: true,
  createdAt: true,
  updatedAt: true,
  dispatchPlan: {
    select: {
      id: true,
      name: true,
      status: true,
      version: true,
      totalEligible: true,
      totalEvaluated: true,
      totalExcluded: true,
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
    },
  },
} satisfies Prisma.DispatchSelect;

@Injectable()
export class DispatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationAccess: OrganizationAccessService,
    private readonly audit: AuditService,
  ) {}

  async create(userId: string, campaignId: string, dto: CreateDispatchDto) {
    const campaign = await this.getCampaignContext(userId, campaignId);
    await this.organizationAccess.requireApproveAccess(
      userId,
      campaign.organizationId,
    );

    const plan = await this.prisma.dispatchPlan.findFirst({
      where: {
        id: dto.dispatchPlanId,
        organizationId: campaign.organizationId,
        campaignId,
      },
    });

    if (!plan) {
      throw new NotFoundException('Plano de disparo nao encontrado');
    }

    const preconditions = canCreateDispatchFromPlan({
      status: plan.status,
      approvedAt: plan.approvedAt,
      approvedByUserId: plan.approvedByUserId,
      approvalSnapshot: plan.approvalSnapshot,
      snapshotCreatedAt: plan.snapshotCreatedAt,
      totalEligible: plan.totalEligible,
      validationSnapshot: plan.validationSnapshot,
      validatedVersion: plan.validatedVersion,
      planVersion: plan.version,
      simulationSnapshot: plan.simulationSnapshot,
      simulatedVersion: plan.simulatedVersion,
    });
    if (!preconditions.ok) {
      throw new BadRequestException(preconditions.message);
    }

    const existing = await this.prisma.dispatch.findUnique({
      where: { dispatchPlanId: plan.id },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'Ja existe um Dispatch para este Plano aprovado',
      );
    }

    const channelAccount = await this.prisma.channelAccount.findFirst({
      where: {
        id: plan.channelAccountId,
        organizationId: campaign.organizationId,
      },
      select: {
        id: true,
        campaignId: true,
        provider: true,
        status: true,
      },
    });

    try {
      assertChannelReadyForDispatchCreation({
        channelExists: Boolean(channelAccount),
        channelBelongsToCampaign: Boolean(
          channelAccount && channelAccount.campaignId === campaignId,
        ),
        provider: channelAccount?.provider ?? null,
        status: channelAccount?.status ?? null,
      });
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Canal invalido',
      );
    }

    let contentSnapshot;
    let configurationSnapshot;
    try {
      contentSnapshot = buildDispatchContentSnapshot(plan.approvalSnapshot);
      configurationSnapshot = buildDispatchConfigurationSnapshot(
        plan.simulationSnapshot,
      );
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Snapshots invalidos',
      );
    }

    let created;
    try {
      created = await this.prisma.dispatch.create({
        data: {
          organizationId: campaign.organizationId,
          campaignId,
          dispatchPlanId: plan.id,
          channelAccountId: plan.channelAccountId,
          name: plan.name,
          description: plan.description,
          channelType: plan.channelType,
          contentSnapshot: contentSnapshot as unknown as Prisma.InputJsonValue,
          configurationSnapshot:
            configurationSnapshot as unknown as Prisma.InputJsonValue,
          approvalSnapshot: plan.approvalSnapshot as Prisma.InputJsonValue,
          status: DispatchStatus.DRAFT,
          createdByUserId: userId,
        },
        select: detailSelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ja existe um Dispatch para este Plano aprovado',
        );
      }
      throw error;
    }

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'DISPATCH_CREATED',
      entityType: 'Dispatch',
      entityId: created.id,
      metadata: {
        dispatchId: created.id,
        dispatchPlanId: plan.id,
        campaignId,
        approvedVersion: contentSnapshot.approvedVersion,
        totalEligible: plan.totalEligible,
        channelAccountId: plan.channelAccountId,
        channelType: plan.channelType,
        contentHash: contentSnapshot.hash,
        status: DispatchStatus.DRAFT,
        createdAt: created.createdAt.toISOString(),
      },
    });

    return {
      ...created,
      allowedActions: buildDispatchAllowedActions(),
      approvedAudience: this.extractApprovedAudience(created.approvalSnapshot),
    };
  }

  async list(userId: string, campaignId: string, query: ListDispatchesQueryDto) {
    const campaign = await this.getCampaignContext(userId, campaignId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();

    const where: Prisma.DispatchWhereInput = {
      organizationId: campaign.organizationId,
      campaignId,
    };

    if (query.status) {
      where.status = query.status;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        {
          dispatchPlan: {
            name: { contains: search, mode: 'insensitive' },
          },
        },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.dispatch.findMany({
        where,
        select: listSelect,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.dispatch.count({ where }),
    ]);

    return {
      dispatches: items.map((item) => ({
        id: item.id,
        name: item.name,
        status: item.status,
        dispatchPlanId: item.dispatchPlanId,
        dispatchPlan: item.dispatchPlan,
        channelAccount: item.channelAccount,
        channelType: item.channelType,
        totalItems: item.totalItems,
        sentItems: item.sentItems,
        failedItems: item.failedItems,
        approvedAudience: this.extractApprovedAudience(item.approvalSnapshot),
        createdAt: item.createdAt,
        createdBy: item.createdBy,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      filters: {
        status: query.status ?? null,
        search: search ?? null,
      },
    };
  }

  async getById(userId: string, campaignId: string, dispatchId: string) {
    const campaign = await this.getCampaignContext(userId, campaignId);
    const dispatch = await this.prisma.dispatch.findFirst({
      where: {
        id: dispatchId,
        organizationId: campaign.organizationId,
        campaignId,
      },
      select: detailSelect,
    });

    if (!dispatch) {
      throw new NotFoundException('Dispatch nao encontrado');
    }

    return {
      ...dispatch,
      allowedActions: buildDispatchAllowedActions(),
      approvedAudience: this.extractApprovedAudience(dispatch.approvalSnapshot),
    };
  }

  private extractApprovedAudience(approvalSnapshot: unknown) {
    const snapshot = (approvalSnapshot ?? {}) as {
      audience?: {
        totalEvaluated?: number;
        totalEligible?: number;
        totalExcluded?: number;
      };
    };
    return {
      totalEvaluated: snapshot.audience?.totalEvaluated ?? 0,
      totalEligible: snapshot.audience?.totalEligible ?? 0,
      totalExcluded: snapshot.audience?.totalExcluded ?? 0,
    };
  }

  private async getCampaignContext(userId: string, campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, organizationId: true },
    });

    if (!campaign) {
      throw new NotFoundException('Campanha nao encontrada');
    }

    await this.organizationAccess.requireMembership(
      userId,
      campaign.organizationId,
    );

    return campaign;
  }
}
