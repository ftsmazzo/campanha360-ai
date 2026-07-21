import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CampaignStatus,
  ChannelType,
  ContactStatus,
  DispatchPlanRecipientEligibilityStatus,
  DispatchPlanStatus,
  MembershipRole,
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
import {
  assertChannelReadyForApproval,
  buildApprovalSnapshot,
  canApproveDispatchPlanPreconditions,
  canApproveRole,
  isDispatchPlanImmutable,
  normalizeDecisionReason,
} from './dispatch-plan-approval.util';
import {
  buildSimulationSnapshot,
  canSimulateDispatchPlan,
  isSimulationCurrent,
  normalizeSimulationConfig,
  DISPATCH_SIMULATION_DEFAULT_TIMEZONE,
} from './dispatch-plan-simulation.util';
import {
  buildValidationSnapshot,
  canReopenDispatchPlan,
  isValidationCurrent,
  resolveValidationFinalStatus,
  ValidationSnapshot,
} from './dispatch-plan-validation.util';
import { CancelDispatchPlanDto } from './dto/cancel-dispatch-plan.dto';
import { CreateDispatchPlanDto } from './dto/create-dispatch-plan.dto';
import { ListDispatchPlanRecipientsQueryDto } from './dto/list-dispatch-plan-recipients-query.dto';
import { RejectDispatchPlanDto } from './dto/reject-dispatch-plan.dto';
import { SimulateDispatchPlanDto } from './dto/simulate-dispatch-plan.dto';
import { UpdateDispatchPlanDto } from './dto/update-dispatch-plan.dto';
import {
  buildDispatchPlanAuditMetadata,
  canCancelDispatchPlan,
  canValidateDispatchPlan,
  isAllowedDispatchProvider,
  isArchivedChannelAccount,
  isDispatchPlanEditable,
  resolveDispatchChannelType,
  shouldBumpDispatchPlanVersion,
} from './dispatch-plan.util';

const WRITE_ROLES: MembershipRole[] = [
  MembershipRole.OWNER,
  MembershipRole.ADMIN,
  MembershipRole.MANAGER,
];

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
  validatedAt: true,
  validatedVersion: true,
  simulationSnapshot: true,
  simulatedAt: true,
  simulatedVersion: true,
  approvedByUserId: true,
  approvedAt: true,
  approvalSnapshot: true,
  rejectedByUserId: true,
  rejectedAt: true,
  rejectionReason: true,
  canceledByUserId: true,
  canceledAt: true,
  cancellationReason: true,
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
  approvedBy: {
    select: {
      id: true,
      name: true,
    },
  },
  rejectedBy: {
    select: {
      id: true,
      name: true,
    },
  },
  canceledBy: {
    select: {
      id: true,
      name: true,
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

    const [grouped, membership] = await Promise.all([
      this.prisma.dispatchPlanRecipient.groupBy({
        by: ['eligibilityStatus'],
        where: {
          organizationId: campaign.organizationId,
          campaignId,
          dispatchPlanId: plan.id,
        },
        _count: { _all: true },
      }),
      this.organizationAccess.requireMembership(
        userId,
        campaign.organizationId,
      ),
    ]);

    const canWrite = WRITE_ROLES.includes(membership.role);
    const canApprove = canApproveRole(membership.role);
    const validationIsCurrent = isValidationCurrent({
      validationSnapshot: plan.validationSnapshot,
      validatedVersion: plan.validatedVersion,
      planVersion: plan.version,
    });
    const canSimulate =
      canWrite &&
      canSimulateDispatchPlan({
        status: plan.status,
        snapshotCreatedAt: plan.snapshotCreatedAt,
        totalEligible: plan.totalEligible,
        validationSnapshot: plan.validationSnapshot,
        validatedVersion: plan.validatedVersion,
        planVersion: plan.version,
      });
    const simulationIsCurrent = isSimulationCurrent({
      simulationSnapshot: plan.simulationSnapshot,
      simulatedVersion: plan.simulatedVersion,
      validatedVersion: plan.validatedVersion,
      planVersion: plan.version,
      status: plan.status,
      validationIsCurrent,
    });
    const approvalReady =
      canApproveDispatchPlanPreconditions({
        status: plan.status,
        snapshotCreatedAt: plan.snapshotCreatedAt,
        totalEligible: plan.totalEligible,
        content: plan.content,
        validationSnapshot: plan.validationSnapshot,
        validatedAt: plan.validatedAt,
        validatedVersion: plan.validatedVersion,
        planVersion: plan.version,
        simulationSnapshot: plan.simulationSnapshot,
        simulatedAt: plan.simulatedAt,
        simulatedVersion: plan.simulatedVersion,
      }).ok === true;
    const planIsImmutable = isDispatchPlanImmutable(plan.status);

    return {
      ...plan,
      byEligibilityStatus: this.buildEligibilityStatusCounts(grouped),
      validationIsCurrent,
      simulationIsCurrent,
      planIsImmutable,
      allowedActions: {
        canEdit: canWrite && isDispatchPlanEditable(plan.status),
        canCancel: canWrite && canCancelDispatchPlan(plan.status),
        canGenerateSnapshot:
          canWrite && plan.status === DispatchPlanStatus.DRAFT,
        canRegenerateSnapshot:
          canWrite &&
          plan.status === DispatchPlanStatus.DRAFT &&
          Boolean(plan.snapshotCreatedAt),
        canValidate:
          canWrite &&
          canValidateDispatchPlan(plan.status) &&
          Boolean(plan.snapshotCreatedAt),
        canReopen: canWrite && canReopenDispatchPlan(plan.status),
        canSimulate,
        canRecalculateSimulation: canSimulate && Boolean(plan.simulationSnapshot),
        canApprove: canApprove && approvalReady,
        canReject:
          canApprove && plan.status === DispatchPlanStatus.VALIDATED,
      },
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
          validatedAt: null,
          validatedVersion: null,
          simulationSnapshot: Prisma.DbNull,
          simulatedAt: null,
          simulatedVersion: null,
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
        'Apenas planos em DRAFT ou BLOCKED podem ser editados',
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
    const wasBlocked = existing.status === DispatchPlanStatus.BLOCKED;
    const shouldInvalidateValidation =
      wasBlocked ||
      bumpVersion ||
      existing.validationSnapshot !== null ||
      existing.validatedAt !== null ||
      existing.validatedVersion !== null ||
      existing.simulationSnapshot !== null ||
      existing.simulatedAt !== null ||
      existing.simulatedVersion !== null;

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
        ...(shouldInvalidateValidation
          ? {
              status: DispatchPlanStatus.DRAFT,
              validationSnapshot: Prisma.DbNull,
              validatedAt: null,
              validatedVersion: null,
              simulationSnapshot: Prisma.DbNull,
              simulatedAt: null,
              simulatedVersion: null,
            }
          : {}),
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

  async validate(userId: string, campaignId: string, dispatchPlanId: string) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    const existing = await this.getDispatchPlanOrThrow(
      dispatchPlanId,
      campaign.organizationId,
      campaignId,
    );

    if (existing.status === DispatchPlanStatus.CANCELED) {
      throw new BadRequestException('Plano cancelado nao pode ser validado');
    }

    if (existing.status === DispatchPlanStatus.APPROVED) {
      throw new BadRequestException('Plano aprovado nao pode ser validado');
    }

    if (!canValidateDispatchPlan(existing.status)) {
      throw new BadRequestException(
        'Somente planos em DRAFT podem iniciar validacao',
      );
    }

    const lock = await this.prisma.dispatchPlan.updateMany({
      where: {
        id: existing.id,
        organizationId: campaign.organizationId,
        campaignId,
        status: DispatchPlanStatus.DRAFT,
        version: existing.version,
      },
      data: { status: DispatchPlanStatus.VALIDATING },
    });

    if (lock.count !== 1) {
      throw new ConflictException(
        'Nao foi possivel iniciar a validacao; o plano foi alterado ou ja esta em validacao',
      );
    }

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'DISPATCH_PLAN_VALIDATION_STARTED',
      entityType: 'DispatchPlan',
      entityId: existing.id,
      metadata: {
        dispatchPlanId: existing.id,
        version: existing.version,
        channelAccountId: existing.channelAccountId,
      },
    });

    try {
      const checkedAt = new Date();
      const facts = await this.collectValidationFacts({
        plan: existing,
        organizationId: campaign.organizationId,
        campaignId,
        campaignStatus: campaign.status,
        userCanValidate: true,
      });

      const validationSnapshot = buildValidationSnapshot({
        checkedAt,
        version: existing.version,
        facts,
      });
      const finalStatus = resolveValidationFinalStatus(
        validationSnapshot.passed,
      );

      const persisted = await this.prisma.dispatchPlan.updateMany({
        where: {
          id: existing.id,
          organizationId: campaign.organizationId,
          campaignId,
          status: DispatchPlanStatus.VALIDATING,
          version: existing.version,
        },
        data: {
          status: finalStatus,
          validationSnapshot:
            validationSnapshot as unknown as Prisma.InputJsonValue,
          validatedAt: checkedAt,
          validatedVersion: existing.version,
          simulationSnapshot: Prisma.DbNull,
          simulatedAt: null,
          simulatedVersion: null,
        },
      });

      if (persisted.count !== 1) {
        await this.resetValidatingToDraft(existing.id);
        throw new ConflictException(
          'O plano foi alterado durante a validacao; resultado nao foi persistido',
        );
      }

      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: validationSnapshot.passed
          ? 'DISPATCH_PLAN_VALIDATED'
          : 'DISPATCH_PLAN_BLOCKED',
        entityType: 'DispatchPlan',
        entityId: existing.id,
        metadata: this.buildValidationAuditMetadata({
          dispatchPlanId: existing.id,
          version: existing.version,
          snapshot: validationSnapshot,
          finalStatus,
        }),
      });

      const plan = await this.getDispatchPlanOrThrow(
        existing.id,
        campaign.organizationId,
        campaignId,
      );

      return {
        ...plan,
        validationIsCurrent: true,
        validationSnapshot,
        passed: validationSnapshot.passed,
        summary: validationSnapshot.summary,
      };
    } catch (error) {
      await this.resetValidatingToDraft(existing.id);
      throw error;
    }
  }

  async reopen(userId: string, campaignId: string, dispatchPlanId: string) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    const existing = await this.getDispatchPlanOrThrow(
      dispatchPlanId,
      campaign.organizationId,
      campaignId,
    );

    if (!canReopenDispatchPlan(existing.status)) {
      throw new BadRequestException(
        'Somente planos VALIDATED ou BLOCKED podem ser reabertos',
      );
    }

    const reopened = await this.prisma.dispatchPlan.updateMany({
      where: {
        id: existing.id,
        organizationId: campaign.organizationId,
        campaignId,
        status: { in: [DispatchPlanStatus.VALIDATED, DispatchPlanStatus.BLOCKED] },
        version: existing.version,
      },
      data: {
        status: DispatchPlanStatus.DRAFT,
        validationSnapshot: Prisma.DbNull,
        validatedAt: null,
        validatedVersion: null,
        simulationSnapshot: Prisma.DbNull,
        simulatedAt: null,
        simulatedVersion: null,
      },
    });

    if (reopened.count !== 1) {
      throw new ConflictException(
        'Nao foi possivel reabrir o plano; ele foi alterado por outra operacao',
      );
    }

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'DISPATCH_PLAN_REOPENED',
      entityType: 'DispatchPlan',
      entityId: existing.id,
      metadata: {
        dispatchPlanId: existing.id,
        version: existing.version,
        previousStatus: existing.status,
        finalStatus: DispatchPlanStatus.DRAFT,
        channelAccountId: existing.channelAccountId,
      },
    });

    return this.getDispatchPlanOrThrow(
      existing.id,
      campaign.organizationId,
      campaignId,
    );
  }

  async simulate(
    userId: string,
    campaignId: string,
    dispatchPlanId: string,
    dto: SimulateDispatchPlanDto,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    const existing = await this.getDispatchPlanOrThrow(
      dispatchPlanId,
      campaign.organizationId,
      campaignId,
    );

    if (existing.status !== DispatchPlanStatus.VALIDATED) {
      throw new BadRequestException(
        'Somente planos VALIDATED podem gerar simulacao',
      );
    }

    if (
      !canSimulateDispatchPlan({
        status: existing.status,
        snapshotCreatedAt: existing.snapshotCreatedAt,
        totalEligible: existing.totalEligible,
        validationSnapshot: existing.validationSnapshot,
        validatedVersion: existing.validatedVersion,
        planVersion: existing.version,
      })
    ) {
      throw new BadRequestException(
        'O Plano nao possui validacao atual elegivel para simulacao',
      );
    }

    const channelAccount = await this.prisma.channelAccount.findFirst({
      where: {
        id: existing.channelAccountId,
        organizationId: campaign.organizationId,
        campaignId,
      },
      select: { id: true },
    });

    if (!channelAccount) {
      throw new BadRequestException(
        'Canal invalido ou nao pertence a esta campanha',
      );
    }

    let config;
    try {
      config = normalizeSimulationConfig(
        {
          messagesPerMinute: dto.messagesPerMinute,
          minDelaySeconds: dto.minDelaySeconds,
          maxDelaySeconds: dto.maxDelaySeconds,
          batchSize: dto.batchSize,
          pauseBetweenBatchesSeconds: dto.pauseBetweenBatchesSeconds,
          timezone: dto.timezone,
          allowedStartTime: dto.allowedStartTime,
          allowedEndTime: dto.allowedEndTime,
          allowedDays: dto.allowedDays,
          plannedStartAt: dto.plannedStartAt,
        },
        DISPATCH_SIMULATION_DEFAULT_TIMEZONE,
      );
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Configuracao de simulacao invalida',
      );
    }

    const isRecalculation = existing.simulationSnapshot !== null;
    const simulatedAt = new Date();
    const simulationSnapshot = buildSimulationSnapshot({
      simulatedAt,
      version: existing.version,
      totalEligible: existing.totalEligible,
      config,
      now: simulatedAt,
    });

    const persisted = await this.prisma.dispatchPlan.updateMany({
      where: {
        id: existing.id,
        organizationId: campaign.organizationId,
        campaignId,
        status: DispatchPlanStatus.VALIDATED,
        version: existing.version,
        validatedVersion: existing.version,
      },
      data: {
        simulationSnapshot:
          simulationSnapshot as unknown as Prisma.InputJsonValue,
        simulatedAt,
        simulatedVersion: existing.version,
      },
    });

    if (persisted.count !== 1) {
      throw new ConflictException(
        'O plano foi alterado durante a simulacao; resultado nao foi persistido',
      );
    }

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: isRecalculation
        ? 'DISPATCH_PLAN_SIMULATION_RECALCULATED'
        : 'DISPATCH_PLAN_SIMULATED',
      entityType: 'DispatchPlan',
      entityId: existing.id,
      metadata: {
        dispatchPlanId: existing.id,
        version: existing.version,
        totalEligible: existing.totalEligible,
        requestedMessagesPerMinute:
          simulationSnapshot.configuration.requestedMessagesPerMinute,
        effectiveMessagesPerMinute:
          simulationSnapshot.estimates.effectiveMessagesPerMinute,
        batchSize: simulationSnapshot.configuration.batchSize,
        totalBatches: simulationSnapshot.estimates.totalBatches,
        estimatedActiveDurationSeconds:
          simulationSnapshot.estimates.estimatedActiveDurationSeconds,
        estimatedCalendarDurationSeconds:
          simulationSnapshot.estimates.estimatedCalendarDurationSeconds,
        estimatedStartAt: simulationSnapshot.estimates.estimatedStartAt,
        estimatedEndAt: simulationSnapshot.estimates.estimatedEndAt,
        timezone: simulationSnapshot.configuration.timezone,
      },
    });

    const plan = await this.getDispatchPlanOrThrow(
      existing.id,
      campaign.organizationId,
      campaignId,
    );

    return {
      ...plan,
      simulationSnapshot,
      simulationIsCurrent: true,
      recalculated: isRecalculation,
    };
  }

  async cancel(
    userId: string,
    campaignId: string,
    dispatchPlanId: string,
    dto: CancelDispatchPlanDto,
  ) {
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

    let reason: string;
    try {
      reason = normalizeDecisionReason(dto.reason);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Motivo invalido',
      );
    }

    const canceledAt = new Date();
    const updated = await this.prisma.dispatchPlan.updateMany({
      where: {
        id: existing.id,
        organizationId: campaign.organizationId,
        campaignId,
        status: {
          in: [
            DispatchPlanStatus.DRAFT,
            DispatchPlanStatus.BLOCKED,
            DispatchPlanStatus.VALIDATED,
          ],
        },
        version: existing.version,
      },
      data: {
        status: DispatchPlanStatus.CANCELED,
        canceledByUserId: userId,
        canceledAt,
        cancellationReason: reason,
      },
    });

    if (updated.count !== 1) {
      throw new ConflictException(
        'Nao foi possivel cancelar o plano; ele foi alterado por outra operacao',
      );
    }

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'DISPATCH_PLAN_CANCELED',
      entityType: 'DispatchPlan',
      entityId: existing.id,
      metadata: {
        dispatchPlanId: existing.id,
        version: existing.version,
        reasonLength: reason.length,
        finalStatus: DispatchPlanStatus.CANCELED,
        canceledAt: canceledAt.toISOString(),
      },
    });

    return this.getDispatchPlanOrThrow(
      existing.id,
      campaign.organizationId,
      campaignId,
    );
  }

  async approve(userId: string, campaignId: string, dispatchPlanId: string) {
    const campaign = await this.getCampaignContext(userId, campaignId);
    await this.organizationAccess.requireApproveAccess(
      userId,
      campaign.organizationId,
    );

    const existing = await this.getDispatchPlanOrThrow(
      dispatchPlanId,
      campaign.organizationId,
      campaignId,
    );

    const preconditions = canApproveDispatchPlanPreconditions({
      status: existing.status,
      snapshotCreatedAt: existing.snapshotCreatedAt,
      totalEligible: existing.totalEligible,
      content: existing.content,
      validationSnapshot: existing.validationSnapshot,
      validatedAt: existing.validatedAt,
      validatedVersion: existing.validatedVersion,
      planVersion: existing.version,
      simulationSnapshot: existing.simulationSnapshot,
      simulatedAt: existing.simulatedAt,
      simulatedVersion: existing.simulatedVersion,
    });
    if (!preconditions.ok) {
      throw new BadRequestException(preconditions.message);
    }

    await this.runApprovalFinalRecheck({
      plan: existing,
      organizationId: campaign.organizationId,
      campaignId,
    });

    const channelAccount = await this.prisma.channelAccount.findFirst({
      where: {
        id: existing.channelAccountId,
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
      assertChannelReadyForApproval({
        channelExists: Boolean(channelAccount),
        channelBelongsToCampaign: Boolean(
          channelAccount && channelAccount.campaignId === campaignId,
        ),
        provider: channelAccount?.provider ?? null,
        status: channelAccount?.status ?? null,
      });
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Canal invalido para aprovacao',
      );
    }

    const approvedAt = new Date();
    const approvalSnapshot = buildApprovalSnapshot({
      approvedAt,
      approvedByUserId: userId,
      channelProvider: String(channelAccount!.provider),
      plan: {
        id: existing.id,
        name: existing.name,
        campaignId: existing.campaignId,
        segmentId: existing.segmentId,
        channelAccountId: existing.channelAccountId,
        channelType: existing.channelType,
        version: existing.version,
        content: existing.content,
        totalEvaluated: existing.totalEvaluated,
        totalEligible: existing.totalEligible,
        totalExcluded: existing.totalExcluded,
        snapshotCreatedAt: existing.snapshotCreatedAt,
        validatedAt: existing.validatedAt,
        validatedVersion: existing.validatedVersion,
        validationSnapshot: existing.validationSnapshot,
        simulatedAt: existing.simulatedAt,
        simulatedVersion: existing.simulatedVersion,
        simulationSnapshot: existing.simulationSnapshot,
      },
    });

    const persisted = await this.prisma.dispatchPlan.updateMany({
      where: {
        id: existing.id,
        organizationId: campaign.organizationId,
        campaignId,
        status: DispatchPlanStatus.VALIDATED,
        version: existing.version,
        validatedVersion: existing.version,
        simulatedVersion: existing.version,
      },
      data: {
        status: DispatchPlanStatus.APPROVED,
        approvedByUserId: userId,
        approvedAt,
        approvalSnapshot: approvalSnapshot as unknown as Prisma.InputJsonValue,
      },
    });

    if (persisted.count !== 1) {
      throw new ConflictException(
        'Nao foi possivel aprovar o plano; ele foi alterado por outra operacao',
      );
    }

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'DISPATCH_PLAN_APPROVED',
      entityType: 'DispatchPlan',
      entityId: existing.id,
      metadata: {
        dispatchPlanId: existing.id,
        version: existing.version,
        totalEvaluated: existing.totalEvaluated,
        totalEligible: existing.totalEligible,
        totalExcluded: existing.totalExcluded,
        channelAccountId: existing.channelAccountId,
        validatedAt: existing.validatedAt?.toISOString() ?? null,
        simulatedAt: existing.simulatedAt?.toISOString() ?? null,
        contentHash: approvalSnapshot.content.hash,
        approvedAt: approvedAt.toISOString(),
        finalStatus: DispatchPlanStatus.APPROVED,
      },
    });

    return this.getById(userId, campaignId, existing.id);
  }

  async reject(
    userId: string,
    campaignId: string,
    dispatchPlanId: string,
    dto: RejectDispatchPlanDto,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId);
    await this.organizationAccess.requireApproveAccess(
      userId,
      campaign.organizationId,
    );

    const existing = await this.getDispatchPlanOrThrow(
      dispatchPlanId,
      campaign.organizationId,
      campaignId,
    );

    if (existing.status !== DispatchPlanStatus.VALIDATED) {
      throw new BadRequestException(
        'Somente planos VALIDATED podem ser rejeitados',
      );
    }

    let reason: string;
    try {
      reason = normalizeDecisionReason(dto.reason);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Motivo invalido',
      );
    }

    const rejectedAt = new Date();
    const updated = await this.prisma.dispatchPlan.updateMany({
      where: {
        id: existing.id,
        organizationId: campaign.organizationId,
        campaignId,
        status: DispatchPlanStatus.VALIDATED,
        version: existing.version,
      },
      data: {
        status: DispatchPlanStatus.REJECTED,
        rejectedByUserId: userId,
        rejectedAt,
        rejectionReason: reason,
      },
    });

    if (updated.count !== 1) {
      throw new ConflictException(
        'Nao foi possivel rejeitar o plano; ele foi alterado por outra operacao',
      );
    }

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'DISPATCH_PLAN_REJECTED',
      entityType: 'DispatchPlan',
      entityId: existing.id,
      metadata: {
        dispatchPlanId: existing.id,
        version: existing.version,
        reasonLength: reason.length,
        finalStatus: DispatchPlanStatus.REJECTED,
        rejectedAt: rejectedAt.toISOString(),
      },
    });

    return this.getById(userId, campaignId, existing.id);
  }

  private async runApprovalFinalRecheck(input: {
    plan: Awaited<ReturnType<DispatchPlansService['getDispatchPlanOrThrow']>>;
    organizationId: string;
    campaignId: string;
  }) {
    const { plan, organizationId, campaignId } = input;
    const scope = {
      organizationId,
      campaignId,
      dispatchPlanId: plan.id,
    };

    const [
      recipientCount,
      statusGroups,
      eligibleOptOutCount,
      eligibleBlockedCount,
      eligibleDeletedCount,
      eligibleDestinationGroups,
    ] = await Promise.all([
      this.prisma.dispatchPlanRecipient.count({ where: scope }),
      this.prisma.dispatchPlanRecipient.groupBy({
        by: ['eligibilityStatus'],
        where: scope,
        _count: { _all: true },
      }),
      this.prisma.dispatchPlanRecipient.count({
        where: {
          ...scope,
          eligibilityStatus: DispatchPlanRecipientEligibilityStatus.ELIGIBLE,
          optOutSnapshot: { not: Prisma.DbNull },
        },
      }),
      this.prisma.dispatchPlanRecipient.count({
        where: {
          ...scope,
          eligibilityStatus: DispatchPlanRecipientEligibilityStatus.ELIGIBLE,
          contact: { status: ContactStatus.BLOCKED },
        },
      }),
      this.prisma.dispatchPlanRecipient.count({
        where: {
          ...scope,
          eligibilityStatus: DispatchPlanRecipientEligibilityStatus.ELIGIBLE,
          contact: { status: ContactStatus.DELETED },
        },
      }),
      this.prisma.dispatchPlanRecipient.groupBy({
        by: ['normalizedDestination'],
        where: {
          ...scope,
          eligibilityStatus: DispatchPlanRecipientEligibilityStatus.ELIGIBLE,
        },
        _count: { _all: true },
      }),
    ]);

    if (recipientCount <= 0) {
      throw new BadRequestException(
        'Plano sem recipients nao pode ser aprovado',
      );
    }

    const counts = this.buildEligibilityStatusCounts(statusGroups);
    const eligibleCount =
      counts[DispatchPlanRecipientEligibilityStatus.ELIGIBLE] ?? 0;
    const excludedCount = recipientCount - eligibleCount;

    if (
      recipientCount !== plan.totalEvaluated ||
      eligibleCount !== plan.totalEligible ||
      excludedCount !== plan.totalExcluded ||
      plan.totalEligible + plan.totalExcluded !== plan.totalEvaluated
    ) {
      throw new BadRequestException(
        'Totais do Plano inconsistentes com os recipients',
      );
    }

    if (eligibleOptOutCount > 0) {
      throw new BadRequestException(
        'Existem recipients ELIGIBLE com opt-out',
      );
    }
    if (eligibleBlockedCount > 0) {
      throw new BadRequestException(
        'Existem contatos BLOCKED marcados como ELIGIBLE',
      );
    }
    if (eligibleDeletedCount > 0) {
      throw new BadRequestException(
        'Existem contatos DELETED marcados como ELIGIBLE',
      );
    }
    if (eligibleDestinationGroups.some((group) => group._count._all > 1)) {
      throw new BadRequestException(
        'Existem destinos duplicados entre recipients ELIGIBLE',
      );
    }
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
      select: { id: true, organizationId: true, status: true },
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

  private async resetValidatingToDraft(dispatchPlanId: string) {
    await this.prisma.dispatchPlan.updateMany({
      where: {
        id: dispatchPlanId,
        status: DispatchPlanStatus.VALIDATING,
      },
      data: { status: DispatchPlanStatus.DRAFT },
    });
  }

  private buildValidationAuditMetadata(input: {
    dispatchPlanId: string;
    version: number;
    snapshot: ValidationSnapshot;
    finalStatus: DispatchPlanStatus;
  }) {
    return {
      dispatchPlanId: input.dispatchPlanId,
      version: input.version,
      passed: input.snapshot.passed,
      errorCount: input.snapshot.summary.errors,
      warningCount: input.snapshot.summary.warnings,
      infoCount: input.snapshot.summary.infos,
      totalEvaluated: input.snapshot.audience.totalEvaluated,
      totalEligible: input.snapshot.audience.totalEligible,
      totalExcluded: input.snapshot.audience.totalExcluded,
      channelAccountId: input.snapshot.channel.channelAccountId,
      finalStatus: input.finalStatus,
    };
  }

  private async collectValidationFacts(input: {
    plan: Awaited<ReturnType<DispatchPlansService['getDispatchPlanOrThrow']>>;
    organizationId: string;
    campaignId: string;
    campaignStatus: CampaignStatus;
    userCanValidate: boolean;
  }) {
    const { plan, organizationId, campaignId } = input;
    const recipientScope = {
      organizationId,
      campaignId,
      dispatchPlanId: plan.id,
    };

    const [
      segment,
      channelAccount,
      recipientCount,
      statusGroups,
      eligibleOptOutCount,
      eligibleBlockedCount,
      eligibleDeletedCount,
      eligibleInvalidDestinationCount,
      eligibleDestinationGroups,
      unnamedContactCount,
    ] = await Promise.all([
      this.prisma.segment.findFirst({
        where: { id: plan.segmentId, organizationId },
        select: { id: true, campaignId: true },
      }),
      this.prisma.channelAccount.findFirst({
        where: { id: plan.channelAccountId, organizationId },
        select: {
          id: true,
          campaignId: true,
          provider: true,
          status: true,
        },
      }),
      this.prisma.dispatchPlanRecipient.count({ where: recipientScope }),
      this.prisma.dispatchPlanRecipient.groupBy({
        by: ['eligibilityStatus'],
        where: recipientScope,
        _count: { _all: true },
      }),
      this.prisma.dispatchPlanRecipient.count({
        where: {
          ...recipientScope,
          eligibilityStatus: DispatchPlanRecipientEligibilityStatus.ELIGIBLE,
          optOutSnapshot: { not: Prisma.DbNull },
        },
      }),
      this.prisma.dispatchPlanRecipient.count({
        where: {
          ...recipientScope,
          eligibilityStatus: DispatchPlanRecipientEligibilityStatus.ELIGIBLE,
          contact: { status: ContactStatus.BLOCKED },
        },
      }),
      this.prisma.dispatchPlanRecipient.count({
        where: {
          ...recipientScope,
          eligibilityStatus: DispatchPlanRecipientEligibilityStatus.ELIGIBLE,
          contact: { status: ContactStatus.DELETED },
        },
      }),
      this.prisma.dispatchPlanRecipient.count({
        where: {
          ...recipientScope,
          eligibilityStatus: DispatchPlanRecipientEligibilityStatus.ELIGIBLE,
          OR: [
            { normalizedDestination: '' },
            { destination: '' },
          ],
        },
      }),
      this.prisma.dispatchPlanRecipient.groupBy({
        by: ['normalizedDestination'],
        where: {
          ...recipientScope,
          eligibilityStatus: DispatchPlanRecipientEligibilityStatus.ELIGIBLE,
        },
        _count: { _all: true },
      }),
      this.prisma.dispatchPlanRecipient.count({
        where: {
          ...recipientScope,
          eligibilityStatus: DispatchPlanRecipientEligibilityStatus.ELIGIBLE,
          OR: [
            { contactSnapshot: { path: ['name'], equals: Prisma.JsonNull } },
            { contactSnapshot: { path: ['name'], equals: '' } },
          ],
        },
      }),
    ]);

    const counts = this.buildEligibilityStatusCounts(statusGroups);
    const eligibleCount =
      counts[DispatchPlanRecipientEligibilityStatus.ELIGIBLE] ?? 0;
    const excludedCount = recipientCount - eligibleCount;
    const eligibleDuplicateDestinationCount = eligibleDestinationGroups.filter(
      (group) => group._count._all > 1,
    ).length;

    return {
      planStatus: DispatchPlanStatus.DRAFT,
      planVersion: plan.version,
      content: plan.content,
      snapshotCreatedAt: plan.snapshotCreatedAt,
      totalEvaluated: plan.totalEvaluated,
      totalEligible: plan.totalEligible,
      totalExcluded: plan.totalExcluded,
      segmentExists: Boolean(segment),
      segmentBelongsToCampaign: Boolean(
        segment && segment.campaignId === campaignId,
      ),
      channelAccountId: channelAccount?.id ?? plan.channelAccountId,
      channelExists: Boolean(channelAccount),
      channelBelongsToCampaign: Boolean(
        channelAccount && channelAccount.campaignId === campaignId,
      ),
      channelProvider: channelAccount?.provider ?? null,
      channelStatus: channelAccount?.status ?? null,
      campaignExists: true,
      campaignStatus: input.campaignStatus,
      userCanValidate: input.userCanValidate,
      recipientCount,
      eligibleCount,
      excludedCount,
      eligibleOptOutCount,
      eligibleBlockedCount,
      eligibleDeletedCount,
      eligibleInvalidDestinationCount,
      eligibleDuplicateDestinationCount,
      unnamedContactCount,
    };
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
