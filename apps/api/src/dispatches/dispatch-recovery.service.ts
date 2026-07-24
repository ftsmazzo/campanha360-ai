import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DispatchItemErrorCategory,
  DispatchItemStatus,
  DispatchRetryMode,
  DispatchStatus,
  MembershipRole,
} from '@prisma/client';
import {
  DISPATCH_FAILED_RETRY_BATCH_MAX_ITEMS,
  classifyDispatchItemRecovery,
  evaluateManualRetryEligibility,
  isDispatchSendEnabled,
  type DispatchItemRecoveryClassification,
} from '@campanha360/shared';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../common/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { DispatchSendProducer } from './dispatch-send.producer';
import {
  computeDispatchCountersFromStatusMap,
  normalizeOperationalReason,
} from './dispatch-operational.util';
import {
  extractContactName,
  maskDestination,
  maskProviderMessageId,
} from './dispatch-prepare.util';

const RECOVERY_ITEM_BATCH = 200;

const RECOVERABLE_DISPATCH_STATUSES: DispatchStatus[] = [
  DispatchStatus.QUEUED,
  DispatchStatus.RUNNING,
  DispatchStatus.PAUSED,
];

export type RecoveryInspectionSummary = {
  totalItems: number;
  safeRequeue: number;
  safeRetry: number;
  waitingLock: number;
  unknownProviderState: number;
  manualReview: number;
  terminal: number;
  invalid: number;
  missingJobs: number;
  staleLocks: number;
  orphanJobs: number;
};

export type RecoveryItemView = {
  id: string;
  contactName: string | null;
  destinationMasked: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  errorCategory: string | null;
  errorCode: string | null;
  providerStatus: string | null;
  providerMessageIdMasked: string | null;
  providerRequestStartedAt: Date | null;
  providerRequestCompletedAt: Date | null;
  lastAttemptAt: Date | null;
  nextRetryAt: Date | null;
  lockExpiresAt: Date | null;
  recoveryClassification: DispatchItemRecoveryClassification;
  recoveryReason: string;
  channelAccountName: string | null;
  reassignmentCount: number;
};

@Injectable()
export class DispatchRecoveryService {
  private readonly logger = new Logger(DispatchRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly organizationAccess: OrganizationAccessService,
    private readonly dispatchSendProducer: DispatchSendProducer,
  ) {}

  async inspect(
    userId: string,
    campaignId: string,
    dispatchId: string,
  ): Promise<{
    dispatchId: string;
    status: DispatchStatus;
    summary: RecoveryInspectionSummary;
    items: RecoveryItemView[];
    allowedActions: {
      canViewRecovery: boolean;
      canRecover: boolean;
      canRetryFailedBatch: boolean;
    };
  }> {
    const { campaign, membership, dispatch } = await this.loadContext(
      userId,
      campaignId,
      dispatchId,
      { requireApprove: true },
    );

    const now = new Date();
    const items = await this.prisma.dispatchItem.findMany({
      where: {
        dispatchId: dispatch.id,
        organizationId: campaign.organizationId,
        campaignId,
      },
      select: this.itemSelect(),
      orderBy: { createdAt: 'asc' },
      take: 500,
    });

    const views: RecoveryItemView[] = [];
    const summary: RecoveryInspectionSummary = {
      totalItems: items.length,
      safeRequeue: 0,
      safeRetry: 0,
      waitingLock: 0,
      unknownProviderState: 0,
      manualReview: 0,
      terminal: 0,
      invalid: 0,
      missingJobs: 0,
      staleLocks: 0,
      orphanJobs: 0,
    };

    for (const item of items) {
      const classified = classifyDispatchItemRecovery(
        {
          status: item.status,
          lockExpiresAt: item.lockExpiresAt,
          providerRequestStartedAt: item.providerRequestStartedAt,
          providerRequestCompletedAt: item.providerRequestCompletedAt,
          providerMessageId: item.providerMessageId,
          sentAt: item.sentAt,
          attemptCount: item.attemptCount,
          maxAttempts: item.maxAttempts,
          nextRetryAt: item.nextRetryAt,
          errorCategory: item.errorCategory,
          errorCode: item.errorCode,
          queueJobId: item.queueJobId,
          dispatchStatus: dispatch.status,
          hasMissingJob: !item.queueJobId,
        },
        now,
      );

      this.bumpSummary(summary, classified.classification, item, now);

      views.push({
        id: item.id,
        contactName: extractContactName(item.contactSnapshot),
        destinationMasked: maskDestination(item.destination),
        status: item.status,
        attemptCount: item.attemptCount,
        maxAttempts: item.maxAttempts,
        errorCategory: item.errorCategory,
        errorCode: item.errorCode,
        providerStatus: item.providerStatus,
        providerMessageIdMasked: maskProviderMessageId(item.providerMessageId),
        providerRequestStartedAt: item.providerRequestStartedAt,
        providerRequestCompletedAt: item.providerRequestCompletedAt,
        lastAttemptAt: item.lastAttemptAt,
        nextRetryAt: item.nextRetryAt,
        lockExpiresAt: item.lockExpiresAt,
        recoveryClassification: classified.classification,
        recoveryReason: classified.reason,
        channelAccountName: item.channelAccount?.name ?? null,
        reassignmentCount: item.reassignmentCount,
      });
    }

    const canApprove =
      membership.role === MembershipRole.OWNER ||
      membership.role === MembershipRole.ADMIN;
    const recoverAllowed = RECOVERABLE_DISPATCH_STATUSES.includes(
      dispatch.status,
    );

    return {
      dispatchId: dispatch.id,
      status: dispatch.status,
      summary,
      items: views,
      allowedActions: {
        canViewRecovery: canApprove,
        canRecover: canApprove && recoverAllowed,
        canRetryFailedBatch:
          canApprove &&
          (dispatch.status === DispatchStatus.RUNNING ||
            dispatch.status === DispatchStatus.PAUSED) &&
          isDispatchSendEnabled(),
      },
    };
  }

  async recover(
    userId: string,
    campaignId: string,
    dispatchId: string,
    input: { mode?: string; reason: string },
  ) {
    const { campaign, dispatch } = await this.loadContext(
      userId,
      campaignId,
      dispatchId,
      { requireApprove: true },
    );

    if (input.mode && input.mode !== 'SAFE_ONLY') {
      throw new BadRequestException('Somente mode=SAFE_ONLY e suportado');
    }

    let reason: string;
    try {
      reason = normalizeOperationalReason(input.reason, { required: true })!;
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Motivo invalido',
      );
    }

    if (!RECOVERABLE_DISPATCH_STATUSES.includes(dispatch.status)) {
      throw new BadRequestException(
        `Dispatch em status ${dispatch.status} nao permite recuperacao`,
      );
    }

    const now = new Date();
    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'DISPATCH_RECOVERY_REQUESTED',
      entityType: 'Dispatch',
      entityId: dispatch.id,
      metadata: {
        dispatchId: dispatch.id,
        mode: 'SAFE_ONLY',
        reason,
        userId,
        timestamp: now.toISOString(),
      },
    });

    const items = await this.prisma.dispatchItem.findMany({
      where: {
        dispatchId: dispatch.id,
        organizationId: campaign.organizationId,
        campaignId,
      },
      select: this.itemSelect(),
      take: RECOVERY_ITEM_BATCH,
    });

    let inspected = 0;
    let requeued = 0;
    let markedUnknown = 0;
    let skipped = 0;
    let errors = 0;

    for (const item of items) {
      inspected += 1;
      const classified = classifyDispatchItemRecovery(
        {
          status: item.status,
          lockExpiresAt: item.lockExpiresAt,
          providerRequestStartedAt: item.providerRequestStartedAt,
          providerRequestCompletedAt: item.providerRequestCompletedAt,
          providerMessageId: item.providerMessageId,
          sentAt: item.sentAt,
          attemptCount: item.attemptCount,
          maxAttempts: item.maxAttempts,
          nextRetryAt: item.nextRetryAt,
          errorCategory: item.errorCategory,
          errorCode: item.errorCode,
          queueJobId: item.queueJobId,
          dispatchStatus: dispatch.status,
          hasMissingJob: !item.queueJobId,
        },
        now,
      );

      try {
        if (classified.classification === 'MARK_UNKNOWN') {
          const claim = await this.prisma.dispatchItem.updateMany({
            where: {
              id: item.id,
              status: DispatchItemStatus.PROCESSING,
              providerRequestStartedAt: { not: null },
              providerRequestCompletedAt: null,
            },
            data: {
              status: DispatchItemStatus.UNKNOWN_PROVIDER_STATE,
              failedAt: now,
              nextRetryAt: null,
              lockedAt: null,
              lockToken: null,
              lockExpiresAt: null,
              errorCode: 'STALE_LOCK_AMBIGUOUS',
              errorMessage:
                'Lock expirado apos inicio de chamada externa sem conclusao',
              lastQueueError: 'MARKED_UNKNOWN_BY_RECOVERY',
            },
          });
          if (claim.count === 1) markedUnknown += 1;
          else skipped += 1;
          continue;
        }

        if (
          classified.classification !== 'SAFE_REQUEUE' &&
          classified.classification !== 'SAFE_RETRY'
        ) {
          skipped += 1;
          continue;
        }

        // Nao tocar FAILED permanente / UNKNOWN existente neste recover SAFE_ONLY
        if (
          item.status === DispatchItemStatus.FAILED ||
          item.status === DispatchItemStatus.UNKNOWN_PROVIDER_STATE
        ) {
          skipped += 1;
          continue;
        }

        const claim = await this.prisma.dispatchItem.updateMany({
          where: {
            id: item.id,
            status: {
              in: [
                DispatchItemStatus.QUEUED,
                DispatchItemStatus.SCHEDULED,
                DispatchItemStatus.RETRY_SCHEDULED,
                DispatchItemStatus.PROCESSING,
              ],
            },
            providerMessageId: null,
            sentAt: null,
            providerRequestStartedAt: null,
          },
          data: {
            status: DispatchItemStatus.QUEUED,
            lockedAt: null,
            lockToken: null,
            lockExpiresAt: null,
            providerRequestStartedAt: null,
            providerRequestCompletedAt: null,
            lastQueueError: null,
            retryMode: DispatchRetryMode.RECOVERY,
            retryRequestedAt: now,
            retryReason: reason,
            retryRequestedByUserId: userId,
          },
        });

        if (claim.count !== 1) {
          skipped += 1;
          continue;
        }

        try {
          await this.dispatchSendProducer.ensureJob({
            dispatchId: dispatch.id,
            dispatchItemId: item.id,
            organizationId: campaign.organizationId,
            campaignId,
          });
          requeued += 1;
        } catch {
          await this.prisma.dispatchItem.updateMany({
            where: { id: item.id },
            data: { lastQueueError: 'RECOVERY_ENSURE_JOB_FAILED' },
          });
          errors += 1;
        }
      } catch {
        errors += 1;
      }
    }

    const counts = await this.recomputeCounters(dispatch.id);

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'DISPATCH_RECOVERY_COMPLETED',
      entityType: 'Dispatch',
      entityId: dispatch.id,
      metadata: {
        dispatchId: dispatch.id,
        reason,
        inspected,
        requeued,
        markedUnknown,
        skipped,
        errors,
        counts,
      },
    });

    return {
      dispatchId: dispatch.id,
      inspected,
      requeued,
      markedUnknown,
      skipped,
      errors,
      counts,
    };
  }

  async retryItem(
    userId: string,
    campaignId: string,
    dispatchId: string,
    itemId: string,
    reasonRaw: string,
  ) {
    const { campaign, dispatch } = await this.loadContext(
      userId,
      campaignId,
      dispatchId,
      { requireApprove: true },
    );

    let reason: string;
    try {
      reason = normalizeOperationalReason(reasonRaw, { required: true })!;
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Motivo invalido',
      );
    }

    if (
      dispatch.status !== DispatchStatus.RUNNING &&
      dispatch.status !== DispatchStatus.PAUSED
    ) {
      throw new BadRequestException(
        'Retry manual so e permitido com Dispatch RUNNING ou PAUSED',
      );
    }

    if (!isDispatchSendEnabled() && dispatch.status === DispatchStatus.RUNNING) {
      throw new BadRequestException(
        'DISPATCH_SEND_ENABLED=false: ligue o envio antes do retry em RUNNING',
      );
    }

    const item = await this.prisma.dispatchItem.findFirst({
      where: {
        id: itemId,
        dispatchId: dispatch.id,
        organizationId: campaign.organizationId,
        campaignId,
      },
    });

    if (!item) throw new NotFoundException('Item nao encontrado');

    const eligibility = evaluateManualRetryEligibility({
      status: item.status,
      providerMessageId: item.providerMessageId,
      sentAt: item.sentAt,
      errorCategory: item.errorCategory,
      attemptCount: item.attemptCount,
      maxAttempts: item.maxAttempts,
      allowExtraManualAttempt: true,
    });

    if (!eligibility.allowed) {
      throw new BadRequestException(
        `Retry manual nao permitido: ${eligibility.reason}`,
      );
    }

    const now = new Date();
    const claim = await this.prisma.dispatchItem.updateMany({
      where: {
        id: item.id,
        status: DispatchItemStatus.FAILED,
        providerMessageId: null,
        sentAt: null,
      },
      data: {
        status: DispatchItemStatus.QUEUED,
        nextRetryAt: now,
        lockedAt: null,
        lockToken: null,
        lockExpiresAt: null,
        providerRequestStartedAt: null,
        providerRequestCompletedAt: null,
        lastQueueError: null,
        failedAt: null,
        errorMessage: item.errorMessage,
        retryMode: DispatchRetryMode.MANUAL,
        retryRequestedAt: now,
        retryReason: reason,
        retryRequestedByUserId: userId,
      },
    });

    if (claim.count !== 1) {
      throw new ConflictException(
        'Nao foi possivel agendar retry (conflito de concorrencia)',
      );
    }

    try {
      await this.dispatchSendProducer.ensureJob({
        dispatchId: dispatch.id,
        dispatchItemId: item.id,
        organizationId: campaign.organizationId,
        campaignId,
      });
    } catch {
      await this.prisma.dispatchItem.updateMany({
        where: { id: item.id },
        data: { lastQueueError: 'MANUAL_RETRY_ENSURE_JOB_FAILED' },
      });
    }

    await this.recomputeCounters(dispatch.id);

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'DISPATCH_ITEM_MANUAL_RETRY_REQUESTED',
      entityType: 'DispatchItem',
      entityId: item.id,
      metadata: {
        dispatchId: dispatch.id,
        dispatchItemId: item.id,
        reason,
        previousErrorCategory: item.errorCategory,
        attemptCount: item.attemptCount,
        maxAttempts: item.maxAttempts,
      },
    });

    return {
      dispatchItemId: item.id,
      status: DispatchItemStatus.QUEUED,
      reason,
    };
  }

  async retryFailedBatch(
    userId: string,
    campaignId: string,
    dispatchId: string,
    input: {
      reason: string;
      itemIds?: string[];
      maxItems?: number;
      errorCategories?: string[];
    },
  ) {
    const { campaign, dispatch } = await this.loadContext(
      userId,
      campaignId,
      dispatchId,
      { requireApprove: true },
    );

    let reason: string;
    try {
      reason = normalizeOperationalReason(input.reason, { required: true })!;
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Motivo invalido',
      );
    }

    if (
      dispatch.status !== DispatchStatus.RUNNING &&
      dispatch.status !== DispatchStatus.PAUSED
    ) {
      throw new BadRequestException(
        'Retry em lote so e permitido com Dispatch RUNNING ou PAUSED',
      );
    }

    const maxItems = Math.min(
      Math.max(1, input.maxItems ?? DISPATCH_FAILED_RETRY_BATCH_MAX_ITEMS),
      DISPATCH_FAILED_RETRY_BATCH_MAX_ITEMS,
    );

    const where: Record<string, unknown> = {
      dispatchId: dispatch.id,
      organizationId: campaign.organizationId,
      campaignId,
      status: DispatchItemStatus.FAILED,
      providerMessageId: null,
      sentAt: null,
    };
    if (input.itemIds?.length) {
      where.id = { in: input.itemIds.slice(0, maxItems) };
    }
    if (input.errorCategories?.length) {
      where.errorCategory = { in: input.errorCategories };
    }

    const candidates = await this.prisma.dispatchItem.findMany({
      where: where as never,
      take: maxItems,
      orderBy: { id: 'asc' },
    });

    const results: Array<{
      dispatchItemId: string;
      status: 'retried' | 'skipped' | 'error';
      reason: string;
    }> = [];

    let republished = 0;

    for (const item of candidates) {
      const eligibility = evaluateManualRetryEligibility({
        status: item.status,
        providerMessageId: item.providerMessageId,
        sentAt: item.sentAt,
        errorCategory: item.errorCategory,
        attemptCount: item.attemptCount,
        maxAttempts: item.maxAttempts,
        allowExtraManualAttempt: true,
      });
      if (!eligibility.allowed) {
        results.push({
          dispatchItemId: item.id,
          status: 'skipped',
          reason: eligibility.reason,
        });
        continue;
      }

      try {
        await this.retryItem(
          userId,
          campaignId,
          dispatchId,
          item.id,
          reason,
        );
        republished += 1;
        results.push({
          dispatchItemId: item.id,
          status: 'retried',
          reason: 'OK',
        });
      } catch (error) {
        results.push({
          dispatchItemId: item.id,
          status: 'error',
          reason: error instanceof Error ? error.message : 'UNKNOWN',
        });
      }
    }

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'DISPATCH_FAILED_ITEMS_RETRY_REQUESTED',
      entityType: 'Dispatch',
      entityId: dispatch.id,
      metadata: {
        dispatchId: dispatch.id,
        reason,
        requested: input.itemIds?.length ?? candidates.length,
        eligible: results.filter((r) => r.status === 'retried').length,
        republished,
        categories: input.errorCategories ?? null,
        maxItems,
      },
    });

    return {
      dispatchId: dispatch.id,
      requested: candidates.length,
      republished,
      results,
    };
  }

  async resolveUnknown(
    userId: string,
    campaignId: string,
    dispatchId: string,
    itemId: string,
    input: {
      resolution: 'CONFIRMED_SENT' | 'CONFIRMED_NOT_SENT' | 'ABANDONED';
      reason: string;
      providerMessageId?: string;
      evidence?: string;
    },
  ) {
    const { campaign, membership, dispatch } = await this.loadContext(
      userId,
      campaignId,
      dispatchId,
      { requireApprove: true },
    );

    if (membership.role !== MembershipRole.OWNER) {
      throw new ForbiddenException(
        'Somente OWNER pode resolver UNKNOWN_PROVIDER_STATE',
      );
    }

    let reason: string;
    try {
      reason = normalizeOperationalReason(input.reason, { required: true })!;
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Motivo invalido',
      );
    }

    const evidence =
      input.evidence != null
        ? normalizeOperationalReason(input.evidence, { required: false })
        : null;

    const item = await this.prisma.dispatchItem.findFirst({
      where: {
        id: itemId,
        dispatchId: dispatch.id,
        organizationId: campaign.organizationId,
        campaignId,
      },
    });

    if (!item) throw new NotFoundException('Item nao encontrado');

    if (item.status !== DispatchItemStatus.UNKNOWN_PROVIDER_STATE) {
      throw new BadRequestException(
        'Somente items UNKNOWN_PROVIDER_STATE podem ser resolvidos',
      );
    }

    const now = new Date();

    if (input.resolution === 'CONFIRMED_SENT') {
      const providerMessageId =
        typeof input.providerMessageId === 'string' &&
        input.providerMessageId.trim()
          ? input.providerMessageId.trim().slice(0, 200)
          : item.providerMessageId;

      const claim = await this.prisma.dispatchItem.updateMany({
        where: {
          id: item.id,
          status: DispatchItemStatus.UNKNOWN_PROVIDER_STATE,
        },
        data: {
          status: DispatchItemStatus.SENT,
          sentAt: now,
          providerMessageId,
          providerStatus: item.providerStatus ?? 'ADMIN_CONFIRMED_SENT',
          failedAt: null,
          nextRetryAt: null,
          errorCategory: null,
          errorCode: 'ADMIN_CONFIRMED_SENT',
          errorMessage: evidence ?? reason,
          lockedAt: null,
          lockToken: null,
          lockExpiresAt: null,
        },
      });

      if (claim.count !== 1) {
        throw new ConflictException('Item ja foi resolvido');
      }

      // Uso diario: ajuste administrativo idempotente via metadata flag
      const meta = (item.metadata ?? {}) as Record<string, unknown>;
      if (!meta.adminSentUsageCounted && item.dispatchChannelId) {
        const usageDate = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
        );
        await this.prisma.dispatchChannelUsageDaily.upsert({
          where: {
            dispatchChannelId_usageDate: {
              dispatchChannelId: item.dispatchChannelId,
              usageDate,
            },
          },
          create: {
            organizationId: campaign.organizationId,
            campaignId,
            dispatchChannelId: item.dispatchChannelId,
            channelAccountId: item.channelAccountId,
            usageDate,
            sentCount: 1,
            lastSentAt: now,
          },
          update: {
            sentCount: { increment: 1 },
            lastSentAt: now,
          },
        });
        await this.prisma.dispatchItem.update({
          where: { id: item.id },
          data: {
            metadata: { ...meta, adminSentUsageCounted: true },
          },
        });
      }

      await this.recomputeCounters(dispatch.id);
      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'DISPATCH_ITEM_UNKNOWN_CONFIRMED_SENT',
        entityType: 'DispatchItem',
        entityId: item.id,
        metadata: {
          dispatchId: dispatch.id,
          dispatchItemId: item.id,
          reason,
          evidence,
          providerMessageIdMasked: maskProviderMessageId(providerMessageId),
        },
      });

      return { dispatchItemId: item.id, status: DispatchItemStatus.SENT };
    }

    if (input.resolution === 'CONFIRMED_NOT_SENT') {
      const claim = await this.prisma.dispatchItem.updateMany({
        where: {
          id: item.id,
          status: DispatchItemStatus.UNKNOWN_PROVIDER_STATE,
        },
        data: {
          status: DispatchItemStatus.FAILED,
          failedAt: now,
          errorCategory: DispatchItemErrorCategory.ADMIN_CONFIRMED_NOT_SENT,
          errorCode: 'ADMIN_CONFIRMED_NOT_SENT',
          errorMessage: evidence ?? reason,
          nextRetryAt: null,
          lockedAt: null,
          lockToken: null,
          lockExpiresAt: null,
        },
      });
      if (claim.count !== 1) {
        throw new ConflictException('Item ja foi resolvido');
      }
      await this.recomputeCounters(dispatch.id);
      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'DISPATCH_ITEM_UNKNOWN_CONFIRMED_NOT_SENT',
        entityType: 'DispatchItem',
        entityId: item.id,
        metadata: {
          dispatchId: dispatch.id,
          dispatchItemId: item.id,
          reason,
          evidence,
        },
      });
      return { dispatchItemId: item.id, status: DispatchItemStatus.FAILED };
    }

    // ABANDONED
    const claim = await this.prisma.dispatchItem.updateMany({
      where: {
        id: item.id,
        status: DispatchItemStatus.UNKNOWN_PROVIDER_STATE,
      },
      data: {
        status: DispatchItemStatus.FAILED,
        failedAt: now,
        errorCategory: DispatchItemErrorCategory.UNKNOWN_ABANDONED,
        errorCode: 'UNKNOWN_ABANDONED',
        errorMessage: evidence ?? reason,
        nextRetryAt: null,
        lockedAt: null,
        lockToken: null,
        lockExpiresAt: null,
      },
    });
    if (claim.count !== 1) {
      throw new ConflictException('Item ja foi resolvido');
    }
    await this.recomputeCounters(dispatch.id);
    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'DISPATCH_ITEM_UNKNOWN_ABANDONED',
      entityType: 'DispatchItem',
      entityId: item.id,
      metadata: {
        dispatchId: dispatch.id,
        dispatchItemId: item.id,
        reason,
        evidence,
      },
    });
    return { dispatchItemId: item.id, status: DispatchItemStatus.FAILED };
  }

  async listAttempts(
    userId: string,
    campaignId: string,
    dispatchId: string,
    itemId: string,
  ) {
    const { campaign, dispatch } = await this.loadContext(
      userId,
      campaignId,
      dispatchId,
      { requireApprove: false },
    );

    const item = await this.prisma.dispatchItem.findFirst({
      where: {
        id: itemId,
        dispatchId: dispatch.id,
        organizationId: campaign.organizationId,
        campaignId,
      },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('Item nao encontrado');

    const attempts = await this.prisma.dispatchItemAttempt.findMany({
      where: { dispatchItemId: item.id },
      orderBy: { attemptNumber: 'asc' },
      select: {
        id: true,
        attemptNumber: true,
        channelAccountId: true,
        dispatchChannelId: true,
        startedAt: true,
        completedAt: true,
        outcome: true,
        providerStatus: true,
        providerMessageId: true,
        httpStatus: true,
        errorCategory: true,
        errorCode: true,
        errorMessage: true,
        ambiguous: true,
        manual: true,
        retryMode: true,
      },
    });

    return {
      dispatchItemId: item.id,
      attempts: attempts.map((a) => ({
        ...a,
        providerMessageIdMasked: maskProviderMessageId(a.providerMessageId),
        providerMessageId: undefined,
      })),
    };
  }

  private bumpSummary(
    summary: RecoveryInspectionSummary,
    classification: DispatchItemRecoveryClassification,
    item: {
      status: string;
      queueJobId: string | null;
      lockExpiresAt: Date | null;
    },
    now: Date,
  ) {
    switch (classification) {
      case 'SAFE_REQUEUE':
        summary.safeRequeue += 1;
        break;
      case 'SAFE_RETRY':
        summary.safeRetry += 1;
        break;
      case 'WAIT_LOCK':
        summary.waitingLock += 1;
        break;
      case 'MARK_UNKNOWN':
        summary.manualReview += 1;
        break;
      case 'MANUAL_REVIEW':
        summary.manualReview += 1;
        break;
      case 'TERMINAL_NO_ACTION':
        summary.terminal += 1;
        break;
      default:
        summary.invalid += 1;
    }
    if (item.status === 'UNKNOWN_PROVIDER_STATE') {
      summary.unknownProviderState += 1;
    }
    if (!item.queueJobId && ['QUEUED', 'SCHEDULED', 'RETRY_SCHEDULED'].includes(item.status)) {
      summary.missingJobs += 1;
    }
    if (
      item.status === 'PROCESSING' &&
      item.lockExpiresAt &&
      item.lockExpiresAt.getTime() < now.getTime()
    ) {
      summary.staleLocks += 1;
    }
  }

  private itemSelect() {
    return {
      id: true,
      status: true,
      attemptCount: true,
      maxAttempts: true,
      errorCategory: true,
      errorCode: true,
      providerStatus: true,
      providerMessageId: true,
      providerRequestStartedAt: true,
      providerRequestCompletedAt: true,
      lastAttemptAt: true,
      nextRetryAt: true,
      lockExpiresAt: true,
      queueJobId: true,
      sentAt: true,
      destination: true,
      contactSnapshot: true,
      reassignmentCount: true,
      channelAccount: { select: { name: true } },
    } as const;
  }

  async recomputeCounters(dispatchId: string) {
    const grouped = await this.prisma.dispatchItem.groupBy({
      by: ['status'],
      where: { dispatchId },
      _count: { _all: true },
    });
    const map: Record<string, number> = {};
    for (const row of grouped) {
      map[row.status] = row._count._all;
    }
    const counts = computeDispatchCountersFromStatusMap(map);
    await this.prisma.dispatch.updateMany({
      where: { id: dispatchId },
      data: { ...counts, lastProgressAt: new Date() },
    });
    return counts;
  }

  private async loadContext(
    userId: string,
    campaignId: string,
    dispatchId: string,
    options: { requireApprove: boolean },
  ) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, organizationId: true },
    });
    if (!campaign) throw new NotFoundException('Campanha nao encontrada');

    const membership = options.requireApprove
      ? await this.organizationAccess.requireApproveAccess(
          userId,
          campaign.organizationId,
        )
      : await this.organizationAccess.requireMembership(
          userId,
          campaign.organizationId,
        );

    const dispatch = await this.prisma.dispatch.findFirst({
      where: {
        id: dispatchId,
        organizationId: campaign.organizationId,
        campaignId,
      },
      select: { id: true, status: true },
    });
    if (!dispatch) throw new NotFoundException('Dispatch nao encontrado');

    return { campaign, membership, dispatch };
  }
}
