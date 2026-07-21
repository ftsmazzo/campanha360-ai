import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DispatchChannelOperationalStatus,
  DispatchItemStatus,
  DispatchPlanRecipientEligibilityStatus,
  DispatchStatus,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../common/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  distributeRecipientsCapacityWeighted,
} from '../dispatch-plans/dispatch-plan-multi-instance.util';
import {
  buildReassignmentUpdate,
  canReassignDispatchItem,
} from './dispatch-channel-selection.util';
import {
  assertChannelReadyForDispatchCreation,
  buildDispatchAllowedActions,
  buildDispatchConfigurationSnapshot,
  buildDispatchContentSnapshot,
  canCreateDispatchFromPlan,
} from './dispatch.util';
import {
  assertChannelReadyForPrepare,
  assertDispatchContentSnapshotValid,
  assertEligibleRecipientsReadyForPrepare,
  assertPlanApprovedForPrepare,
  buildDispatchAllowedActionsForPrepare,
  buildItemStatusSummary,
  buildPreparedDispatchItems,
  extractContactName,
  maskDestination,
} from './dispatch-prepare.util';
import { CreateDispatchDto } from './dto/create-dispatch.dto';
import { ListDispatchItemsQueryDto } from './dto/list-dispatch-items-query.dto';
import { ListDispatchesQueryDto } from './dto/list-dispatches-query.dto';

const listSelect = {
  id: true,
  name: true,
  status: true,
  dispatchPlanId: true,
  channelType: true,
  totalItems: true,
  pendingItems: true,
  sentItems: true,
  failedItems: true,
  preparedAt: true,
  requiringRedistribution: true,
  multiInstance: true,
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
  requiringRedistribution: true,
  multiInstance: true,
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
      created = await this.prisma.$transaction(async (tx) => {
        const dispatch = await tx.dispatch.create({
          data: {
            organizationId: campaign.organizationId,
            campaignId,
            dispatchPlanId: plan.id,
            channelAccountId: plan.channelAccountId,
            name: plan.name,
            description: plan.description,
            channelType: plan.channelType,
            contentSnapshot:
              contentSnapshot as unknown as Prisma.InputJsonValue,
            configurationSnapshot:
              configurationSnapshot as unknown as Prisma.InputJsonValue,
            approvalSnapshot: plan.approvalSnapshot as Prisma.InputJsonValue,
            status: DispatchStatus.DRAFT,
            createdByUserId: userId,
            multiInstance: !plan.legacySingleChannel && Boolean(plan.multiInstanceEnabled),
            requiringRedistribution: false,
          },
          select: detailSelect,
        });

        const planChannels = await tx.dispatchPlanChannel.findMany({
          where: {
            dispatchPlanId: plan.id,
            organizationId: campaign.organizationId,
            campaignId,
            enabled: true,
          },
          orderBy: [{ priority: 'asc' }, { weight: 'desc' }],
        });

        if (planChannels.length === 0) {
          throw new BadRequestException(
            'Plano aprovado sem DispatchPlanChannel; reabra o Plano',
          );
        }

        if (plan.legacySingleChannel && planChannels.length > 1) {
          throw new BadRequestException(
            'Plano legado single-channel nao pode gerar Dispatch multi-instancia sem reabertura',
          );
        }

        const policy =
          (plan.protectionPolicySnapshot as {
            dailyLimitPerInstance?: number;
          } | null) ?? {};

        await tx.dispatchChannel.createMany({
          data: planChannels.map((row) => ({
            organizationId: campaign.organizationId,
            campaignId,
            dispatchId: dispatch.id,
            dispatchPlanChannelId: row.id,
            channelAccountId: row.channelAccountId,
            enabled: row.enabled,
            priority: row.priority,
            weight: row.weight,
            effectiveDailyLimit:
              row.assignedCapacity ||
              row.dailyLimit ||
              policy.dailyLimitPerInstance ||
              200,
            assignedItems: 0,
            processedItems: 0,
            sentItems: 0,
            failedItems: 0,
            consecutiveErrors: 0,
            operationalStatus: 'READY',
            configurationSnapshot: row.configurationSnapshot ?? undefined,
          })),
        });

        return dispatch;
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

    const membership = await this.organizationAccess.requireMembership(
      userId,
      campaign.organizationId,
    );

    return {
      ...created,
      allowedActions: buildDispatchAllowedActions({
        role: membership.role,
        status: created.status,
        totalItems: created.totalItems,
      }),
      approvedAudience: this.extractApprovedAudience(created.approvalSnapshot),
      itemSummary: buildItemStatusSummary([]),
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
        pendingItems: item.pendingItems,
        sentItems: item.sentItems,
        failedItems: item.failedItems,
        preparedAt: item.preparedAt,
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
    const membership = await this.organizationAccess.requireMembership(
      userId,
      campaign.organizationId,
    );
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

    const grouped = await this.prisma.dispatchItem.groupBy({
      by: ['status'],
      where: {
        organizationId: campaign.organizationId,
        campaignId,
        dispatchId: dispatch.id,
      },
      _count: { _all: true },
    });

    const channels = await this.prisma.dispatchChannel.findMany({
      where: {
        dispatchId: dispatch.id,
        organizationId: campaign.organizationId,
        campaignId,
      },
      select: {
        id: true,
        channelAccountId: true,
        dispatchPlanChannelId: true,
        enabled: true,
        priority: true,
        weight: true,
        effectiveDailyLimit: true,
        assignedItems: true,
        processedItems: true,
        sentItems: true,
        failedItems: true,
        consecutiveErrors: true,
        cooldownUntil: true,
        operationalStatus: true,
        channelAccount: {
          select: {
            id: true,
            name: true,
            provider: true,
            status: true,
          },
        },
      },
      orderBy: [{ priority: 'asc' }, { weight: 'desc' }],
    });

    return {
      ...dispatch,
      channels,
      allowedActions: buildDispatchAllowedActionsForPrepare({
        role: membership.role,
        status: dispatch.status,
        totalItems: dispatch.totalItems,
        queuedItems: dispatch.queuedItems,
        requiringRedistribution: dispatch.requiringRedistribution,
      }),
      approvedAudience: this.extractApprovedAudience(dispatch.approvalSnapshot),
      itemSummary: buildItemStatusSummary(grouped),
    };
  }

  async prepare(userId: string, campaignId: string, dispatchId: string) {
    const campaign = await this.getCampaignContext(userId, campaignId);
    await this.organizationAccess.requireApproveAccess(
      userId,
      campaign.organizationId,
    );

    const dispatch = await this.prisma.dispatch.findFirst({
      where: {
        id: dispatchId,
        organizationId: campaign.organizationId,
        campaignId,
      },
    });

    if (!dispatch) {
      throw new NotFoundException('Dispatch nao encontrado');
    }

    if (dispatch.status === DispatchStatus.READY || dispatch.totalItems > 0) {
      throw new ConflictException(
        'Dispatch ja preparado; nao e permitido preparar novamente',
      );
    }

    if (dispatch.status === DispatchStatus.PREPARING) {
      throw new ConflictException('Preparacao ja em andamento');
    }

    if (dispatch.status !== DispatchStatus.DRAFT) {
      throw new BadRequestException(
        'Somente Dispatch em DRAFT pode ser preparado',
      );
    }

    const claim = await this.prisma.dispatch.updateMany({
      where: {
        id: dispatch.id,
        organizationId: campaign.organizationId,
        campaignId,
        status: DispatchStatus.DRAFT,
        totalItems: 0,
      },
      data: {
        status: DispatchStatus.PREPARING,
      },
    });

    if (claim.count !== 1) {
      throw new ConflictException(
        'Nao foi possivel iniciar a preparacao (conflito de concorrencia)',
      );
    }

    const startedAt = new Date();
    let totalExpected = 0;

    try {
      const plan = await this.prisma.dispatchPlan.findFirst({
        where: {
          id: dispatch.dispatchPlanId,
          organizationId: campaign.organizationId,
          campaignId,
        },
        select: {
          id: true,
          status: true,
          totalEligible: true,
          approvalSnapshot: true,
          channelAccountId: true,
        },
      });

      try {
        assertPlanApprovedForPrepare({
          planExists: Boolean(plan),
          status: plan?.status ?? null,
          approvalSnapshot: plan?.approvalSnapshot ?? null,
        });
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error ? error.message : 'Plano invalido',
        );
      }

      const channelAccount = await this.prisma.channelAccount.findFirst({
        where: {
          id: dispatch.channelAccountId,
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
        assertChannelReadyForPrepare({
          channelExists: Boolean(channelAccount),
          channelBelongsToCampaign: Boolean(
            channelAccount && channelAccount.campaignId === campaignId,
          ),
          channelMatchesDispatch: Boolean(
            channelAccount && channelAccount.id === dispatch.channelAccountId,
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
      try {
        contentSnapshot = assertDispatchContentSnapshotValid(
          dispatch.contentSnapshot,
          dispatch.approvalSnapshot,
        );
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error ? error.message : 'contentSnapshot invalido',
        );
      }

      const recipients = await this.prisma.dispatchPlanRecipient.findMany({
        where: {
          organizationId: campaign.organizationId,
          campaignId,
          dispatchPlanId: dispatch.dispatchPlanId,
          eligibilityStatus: DispatchPlanRecipientEligibilityStatus.ELIGIBLE,
        },
        select: {
          id: true,
          organizationId: true,
          campaignId: true,
          dispatchPlanId: true,
          contactId: true,
          destination: true,
          normalizedDestination: true,
          eligibilityStatus: true,
          contactSnapshot: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });

      totalExpected = plan!.totalEligible;

      try {
        assertEligibleRecipientsReadyForPrepare({
          recipients,
          organizationId: campaign.organizationId,
          campaignId,
          dispatchPlanId: dispatch.dispatchPlanId,
          expectedEligible: totalExpected,
        });
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error ? error.message : 'Recipients invalidos',
        );
      }

      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'DISPATCH_PREPARATION_STARTED',
        entityType: 'Dispatch',
        entityId: dispatch.id,
        metadata: {
          dispatchId: dispatch.id,
          dispatchPlanId: dispatch.dispatchPlanId,
          totalExpected,
          status: DispatchStatus.PREPARING,
          startedAt: startedAt.toISOString(),
        },
      });

      const existingItems = await this.prisma.dispatchItem.count({
        where: { dispatchId: dispatch.id },
      });
      if (existingItems > 0) {
        throw new ConflictException(
          'Dispatch ja possui items materializados',
        );
      }

      const dispatchChannels = await this.prisma.dispatchChannel.findMany({
        where: {
          dispatchId: dispatch.id,
          organizationId: campaign.organizationId,
          campaignId,
          enabled: true,
        },
        include: {
          channelAccount: {
            select: {
              id: true,
              campaignId: true,
              provider: true,
              status: true,
            },
          },
        },
        orderBy: [{ priority: 'asc' }, { weight: 'desc' }],
      });

      if (dispatchChannels.length === 0) {
        throw new BadRequestException(
          'Dispatch sem canais materializados; recrie o Dispatch',
        );
      }

      for (const row of dispatchChannels) {
        try {
          assertChannelReadyForPrepare({
            channelExists: true,
            channelBelongsToCampaign:
              row.channelAccount.campaignId === campaignId,
            channelMatchesDispatch: true,
            provider: row.channelAccount.provider,
            status: row.channelAccount.status,
          });
        } catch (error) {
          throw new BadRequestException(
            error instanceof Error
              ? `Canal ${row.channelAccountId}: ${error.message}`
              : 'Canal do pool invalido',
          );
        }
      }

      const distribution = distributeRecipientsCapacityWeighted({
        totalEligible: recipients.length,
        channels: dispatchChannels.map((row) => ({
          id: row.id,
          priority: row.priority,
          weight: row.weight,
          effectiveDailyLimit: row.effectiveDailyLimit,
          enabled: row.enabled,
          assignedRecipients: row.assignedItems,
        })),
      });

      if (distribution.unassignedCount > 0) {
        throw new BadRequestException(
          `Capacidade insuficiente: ${distribution.unassignedCount} recipients sem canal`,
        );
      }

      const channelById = new Map(
        dispatchChannels.map((row) => [row.id, row]),
      );
      const assignedChannelIds: string[] = [];
      for (const assignment of distribution.assignments) {
        for (let i = 0; i < assignment.count; i += 1) {
          assignedChannelIds.push(assignment.channelId);
        }
      }

      if (assignedChannelIds.length !== recipients.length) {
        throw new BadRequestException(
          'Distribuicao CAPACITY_WEIGHTED inconsistente com destinatarios',
        );
      }

      const baseItems = buildPreparedDispatchItems({
        recipients,
        dispatchId: dispatch.id,
        organizationId: campaign.organizationId,
        campaignId,
        dispatchPlanId: dispatch.dispatchPlanId,
        channelAccountId: dispatch.channelAccountId,
        contentSnapshot,
      });

      const items = baseItems.map((item, index) => {
        const dispatchChannelId = assignedChannelIds[index]!;
        const channel = channelById.get(dispatchChannelId);
        if (!channel) {
          throw new BadRequestException('Canal de distribuicao invalido');
        }
        return {
          ...item,
          channelAccountId: channel.channelAccountId,
          dispatchChannelId: channel.id,
          originalDispatchChannelId: channel.id,
          reassignmentCount: 0,
        };
      });

      const preparedAt = new Date();

      await this.prisma.$transaction(async (tx) => {
        await tx.dispatchItem.createMany({
          data: items.map((item) => ({
            ...item,
            contactSnapshot: item.contactSnapshot as Prisma.InputJsonValue,
            contentSnapshot:
              item.contentSnapshot as unknown as Prisma.InputJsonValue,
          })),
        });

        const createdCount = await tx.dispatchItem.count({
          where: { dispatchId: dispatch.id },
        });
        if (createdCount !== items.length) {
          throw new Error(
            `Quantidade criada (${createdCount}) diverge do esperado (${items.length})`,
          );
        }

        for (const assignment of distribution.assignments) {
          await tx.dispatchChannel.update({
            where: { id: assignment.channelId },
            data: {
              assignedItems: assignment.count,
            },
          });
        }

        const updated = await tx.dispatch.updateMany({
          where: {
            id: dispatch.id,
            status: DispatchStatus.PREPARING,
            totalItems: 0,
          },
          data: {
            status: DispatchStatus.READY,
            totalItems: createdCount,
            pendingItems: createdCount,
            queuedItems: 0,
            processingItems: 0,
            sentItems: 0,
            deliveredItems: 0,
            readItems: 0,
            failedItems: 0,
            skippedItems: 0,
            canceledItems: 0,
            preparedAt,
            lastProgressAt: preparedAt,
            requiringRedistribution: false,
          },
        });

        if (updated.count !== 1) {
          throw new ConflictException(
            'Falha ao concluir preparacao (conflito de estado)',
          );
        }
      });

      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'DISPATCH_PREPARED',
        entityType: 'Dispatch',
        entityId: dispatch.id,
        metadata: {
          dispatchId: dispatch.id,
          totalExpected,
          totalCreated: items.length,
          pendingItems: items.length,
          preparedAt: preparedAt.toISOString(),
          finalStatus: DispatchStatus.READY,
        },
      });

      return {
        dispatchId: dispatch.id,
        status: DispatchStatus.READY,
        totalExpected,
        totalCreated: items.length,
        pendingItems: items.length,
        preparedAt,
      };
    } catch (error) {
      const itemCount = await this.prisma.dispatchItem.count({
        where: { dispatchId: dispatch.id },
      });

      // Preferencia 09.2: sem items materializados, volta para DRAFT.
      if (itemCount === 0) {
        await this.prisma.dispatch.updateMany({
          where: {
            id: dispatch.id,
            status: DispatchStatus.PREPARING,
          },
          data: {
            status: DispatchStatus.DRAFT,
          },
        });
      }

      const errorCode =
        error instanceof ConflictException
          ? 'CONFLICT'
          : error instanceof BadRequestException
            ? 'BAD_REQUEST'
            : error instanceof Prisma.PrismaClientKnownRequestError
              ? error.code
              : 'PREPARE_FAILED';

      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'DISPATCH_PREPARATION_FAILED',
        entityType: 'Dispatch',
        entityId: dispatch.id,
        metadata: {
          dispatchId: dispatch.id,
          stage: 'prepare',
          errorCode,
          finalStatus: itemCount === 0 ? DispatchStatus.DRAFT : DispatchStatus.PREPARING,
        },
      });

      throw error;
    }
  }

  /**
   * Redistribui items PENDING de Dispatch legado (requiringRedistribution).
   * Nao chama Evolution nem enfileira.
   */
  async redistribute(userId: string, campaignId: string, dispatchId: string) {
    const campaign = await this.getCampaignContext(userId, campaignId);
    await this.organizationAccess.requireApproveAccess(
      userId,
      campaign.organizationId,
    );

    const dispatch = await this.prisma.dispatch.findFirst({
      where: {
        id: dispatchId,
        organizationId: campaign.organizationId,
        campaignId,
      },
    });

    if (!dispatch) {
      throw new NotFoundException('Dispatch nao encontrado');
    }

    if (!dispatch.requiringRedistribution) {
      throw new BadRequestException(
        'Dispatch nao exige redistribuicao',
      );
    }

    if (dispatch.status !== DispatchStatus.READY) {
      throw new BadRequestException(
        'Somente Dispatch READY pode ser redistribuido',
      );
    }

    const channels = await this.prisma.dispatchChannel.findMany({
      where: {
        dispatchId: dispatch.id,
        organizationId: campaign.organizationId,
        campaignId,
        enabled: true,
      },
      include: {
        channelAccount: {
          select: {
            id: true,
            status: true,
            provider: true,
          },
        },
      },
      orderBy: [{ priority: 'asc' }, { weight: 'desc' }],
    });

    if (channels.length === 0) {
      throw new BadRequestException('Dispatch sem canais para redistribuir');
    }

    for (const channel of channels) {
      try {
        assertChannelReadyForPrepare({
          channelExists: true,
          channelBelongsToCampaign: true,
          channelMatchesDispatch: true,
          provider: channel.channelAccount.provider,
          status: channel.channelAccount.status,
        });
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error
            ? `Canal ${channel.channelAccountId}: ${error.message}`
            : 'Canal invalido no pool',
        );
      }
    }

    const items = await this.prisma.dispatchItem.findMany({
      where: {
        dispatchId: dispatch.id,
        organizationId: campaign.organizationId,
        campaignId,
        status: DispatchItemStatus.PENDING,
      },
      select: {
        id: true,
        status: true,
        dispatchChannelId: true,
        originalDispatchChannelId: true,
        channelAccountId: true,
        reassignmentCount: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const distribution = distributeRecipientsCapacityWeighted({
      totalEligible: items.length,
      channels: channels.map((row) => ({
        id: row.id,
        priority: row.priority,
        weight: row.weight,
        effectiveDailyLimit: row.effectiveDailyLimit,
        enabled: row.enabled,
        assignedRecipients: 0,
      })),
    });

    if (distribution.unassignedCount > 0) {
      throw new BadRequestException(
        `Capacidade insuficiente para redistribuir: ${distribution.unassignedCount} items sem canal`,
      );
    }

    const assignedChannelIds: string[] = [];
    for (const assignment of distribution.assignments) {
      for (let i = 0; i < assignment.count; i += 1) {
        assignedChannelIds.push(assignment.channelId);
      }
    }

    const channelById = new Map(channels.map((row) => [row.id, row]));
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]!;
        const targetId = assignedChannelIds[index]!;
        const target = channelById.get(targetId);
        if (!target) {
          throw new BadRequestException('Canal de redistribuicao invalido');
        }

        if (!canReassignDispatchItem(item.status)) {
          continue;
        }

        const update = buildReassignmentUpdate(
          {
            dispatchChannelId: item.dispatchChannelId,
            originalDispatchChannelId: item.originalDispatchChannelId,
            channelAccountId: item.channelAccountId,
            reassignmentCount: item.reassignmentCount,
            status: item.status,
          },
          {
            id: target.id,
            channelAccountId: target.channelAccountId,
          },
          now,
        );

        await tx.dispatchItem.update({
          where: { id: item.id },
          data: update,
        });
      }

      for (const channel of channels) {
        const assigned =
          distribution.assignments.find((row) => row.channelId === channel.id)
            ?.count ?? 0;
        await tx.dispatchChannel.update({
          where: { id: channel.id },
          data: {
            assignedItems: assigned,
            operationalStatus: DispatchChannelOperationalStatus.READY,
          },
        });
      }

      await tx.dispatch.update({
        where: { id: dispatch.id },
        data: {
          requiringRedistribution: false,
          multiInstance: channels.length > 1,
        },
      });
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'DISPATCH_REDISTRIBUTED',
      entityType: 'Dispatch',
      entityId: dispatch.id,
      metadata: {
        dispatchId: dispatch.id,
        totalItems: items.length,
        channels: channels.length,
        requiringRedistribution: false,
      },
    });

    return this.getById(userId, campaignId, dispatch.id);
  }

  /**
   * Gate futuro de enfileiramento: bloqueia legados sem redistribuicao.
   * Worker/BullMQ ainda nao existem.
   */
  assertCanEnqueue(dispatch: {
    status: DispatchStatus | string;
    requiringRedistribution: boolean;
    totalItems: number;
  }): void {
    if (dispatch.requiringRedistribution) {
      throw new BadRequestException(
        'Dispatch READY legado exige redistribuicao antes de enfileirar',
      );
    }
    if (dispatch.status !== DispatchStatus.READY && dispatch.status !== 'READY') {
      throw new BadRequestException('Somente Dispatch READY pode ser enfileirado');
    }
    if (dispatch.totalItems <= 0) {
      throw new BadRequestException('Dispatch sem items nao pode ser enfileirado');
    }
  }

  async listItems(
    userId: string,
    campaignId: string,
    dispatchId: string,
    query: ListDispatchItemsQueryDto,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId);
    const dispatch = await this.requireDispatch(
      campaign.organizationId,
      campaignId,
      dispatchId,
    );

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();

    const where: Prisma.DispatchItemWhereInput = {
      organizationId: campaign.organizationId,
      campaignId,
      dispatchId: dispatch.id,
    };

    if (query.status) {
      where.status = query.status;
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

    const [items, total] = await Promise.all([
      this.prisma.dispatchItem.findMany({
        where,
        select: {
          id: true,
          contactId: true,
          destination: true,
          contactSnapshot: true,
          contentSnapshot: true,
          status: true,
          attemptCount: true,
          maxAttempts: true,
          dispatchChannelId: true,
          originalDispatchChannelId: true,
          reassignmentCount: true,
          scheduledAt: true,
          queuedAt: true,
          startedAt: true,
          sentAt: true,
          failedAt: true,
          skippedAt: true,
          errorCategory: true,
          errorCode: true,
          technicalValidatedAt: true,
          queueJobId: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.dispatchItem.count({ where }),
    ]);

    return {
      items: items.map((item) => {
        const content = item.contentSnapshot as { hash?: string } | null;
        return {
          id: item.id,
          contactId: item.contactId,
          contactName: extractContactName(item.contactSnapshot),
          destinationMasked: maskDestination(item.destination),
          status: item.status,
          attemptCount: item.attemptCount,
          maxAttempts: item.maxAttempts,
          dispatchChannelId: item.dispatchChannelId,
          originalDispatchChannelId: item.originalDispatchChannelId,
          reassignmentCount: item.reassignmentCount,
          scheduledAt: item.scheduledAt,
          queuedAt: item.queuedAt,
          startedAt: item.startedAt,
          sentAt: item.sentAt,
          failedAt: item.failedAt,
          skippedAt: item.skippedAt,
          errorCategory: item.errorCategory,
          errorCode: item.errorCode,
          technicalValidatedAt: item.technicalValidatedAt,
          queueJobId: item.queueJobId,
          contentHash:
            typeof content?.hash === 'string' ? content.hash : null,
          createdAt: item.createdAt,
        };
      }),
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

  async getItemById(
    userId: string,
    campaignId: string,
    dispatchId: string,
    dispatchItemId: string,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId);
    await this.requireDispatch(
      campaign.organizationId,
      campaignId,
      dispatchId,
    );

    const item = await this.prisma.dispatchItem.findFirst({
      where: {
        id: dispatchItemId,
        organizationId: campaign.organizationId,
        campaignId,
        dispatchId,
      },
      select: {
        id: true,
        organizationId: true,
        campaignId: true,
        dispatchId: true,
        dispatchPlanId: true,
        dispatchPlanRecipientId: true,
        contactId: true,
        channelAccountId: true,
        dispatchChannelId: true,
        originalDispatchChannelId: true,
        reassignmentCount: true,
        destination: true,
        contactSnapshot: true,
        contentSnapshot: true,
        status: true,
        attemptCount: true,
        maxAttempts: true,
        scheduledAt: true,
        queuedAt: true,
        lockedAt: true,
        startedAt: true,
        sentAt: true,
        deliveredAt: true,
        readAt: true,
        failedAt: true,
        skippedAt: true,
        canceledAt: true,
        providerMessageId: true,
        providerStatus: true,
        errorCategory: true,
        errorCode: true,
        errorMessage: true,
        lastAttemptAt: true,
        nextRetryAt: true,
        queueJobId: true,
        queueName: true,
        queueCreatedAt: true,
        technicalValidatedAt: true,
        lastQueueError: true,
        createdAt: true,
        updatedAt: true,
        dispatchPlanRecipient: {
          select: {
            id: true,
            eligibilityStatus: true,
          },
        },
      },
    });

    if (!item) {
      throw new NotFoundException('DispatchItem nao encontrado');
    }

    return {
      id: item.id,
      organizationId: item.organizationId,
      campaignId: item.campaignId,
      dispatchId: item.dispatchId,
      dispatchPlanId: item.dispatchPlanId,
      dispatchPlanRecipientId: item.dispatchPlanRecipientId,
      contactId: item.contactId,
      channelAccountId: item.channelAccountId,
      dispatchChannelId: item.dispatchChannelId,
      originalDispatchChannelId: item.originalDispatchChannelId,
      reassignmentCount: item.reassignmentCount,
      contactName: extractContactName(item.contactSnapshot),
      contactSnapshot: item.contactSnapshot,
      destinationMasked: maskDestination(item.destination),
      contentSnapshot: item.contentSnapshot,
      status: item.status,
      attemptCount: item.attemptCount,
      maxAttempts: item.maxAttempts,
      scheduledAt: item.scheduledAt,
      queuedAt: item.queuedAt,
      lockedAt: item.lockedAt,
      startedAt: item.startedAt,
      sentAt: item.sentAt,
      deliveredAt: item.deliveredAt,
      readAt: item.readAt,
      failedAt: item.failedAt,
      skippedAt: item.skippedAt,
      canceledAt: item.canceledAt,
      providerMessageId: item.providerMessageId,
      providerStatus: item.providerStatus,
      errorCategory: item.errorCategory,
      errorCode: item.errorCode,
      errorMessage: item.errorMessage,
      lastAttemptAt: item.lastAttemptAt,
      nextRetryAt: item.nextRetryAt,
      queueJobId: item.queueJobId,
      queueName: item.queueName,
      queueCreatedAt: item.queueCreatedAt,
      technicalValidatedAt: item.technicalValidatedAt,
      lastQueueError: item.lastQueueError,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      dispatchPlanRecipient: item.dispatchPlanRecipient,
    };
  }

  private async requireDispatch(
    organizationId: string,
    campaignId: string,
    dispatchId: string,
  ) {
    const dispatch = await this.prisma.dispatch.findFirst({
      where: {
        id: dispatchId,
        organizationId,
        campaignId,
      },
      select: { id: true, status: true, totalItems: true },
    });
    if (!dispatch) {
      throw new NotFoundException('Dispatch nao encontrado');
    }
    return dispatch;
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
