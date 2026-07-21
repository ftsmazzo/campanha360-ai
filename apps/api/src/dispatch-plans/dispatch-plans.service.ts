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
  buildValidationSnapshot,
  canReopenDispatchPlan,
  isValidationCurrent,
  resolveValidationFinalStatus,
  ValidationSnapshot,
} from './dispatch-plan-validation.util';
import { CreateDispatchPlanDto } from './dto/create-dispatch-plan.dto';
import { ListDispatchPlanRecipientsQueryDto } from './dto/list-dispatch-plan-recipients-query.dto';
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
    const validationIsCurrent = isValidationCurrent({
      validationSnapshot: plan.validationSnapshot,
      validatedVersion: plan.validatedVersion,
      planVersion: plan.version,
    });

    return {
      ...plan,
      byEligibilityStatus: this.buildEligibilityStatusCounts(grouped),
      validationIsCurrent,
      allowedActions: {
        canEdit: canWrite && isDispatchPlanEditable(plan.status),
        canCancel: canWrite && canCancelDispatchPlan(plan.status),
        canGenerateSnapshot:
          canWrite && plan.status === DispatchPlanStatus.DRAFT,
        canValidate:
          canWrite &&
          canValidateDispatchPlan(plan.status) &&
          Boolean(plan.snapshotCreatedAt),
        canReopen: canWrite && canReopenDispatchPlan(plan.status),
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
      existing.validatedVersion !== null;

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
