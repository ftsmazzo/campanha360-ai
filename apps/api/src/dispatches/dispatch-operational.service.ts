import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DispatchItemErrorCategory,
  DispatchItemStatus,
  DispatchStatus,
  type Prisma,
} from '@prisma/client';
import { assertDispatchSendAllowed } from '@campanha360/shared';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../common/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { DispatchSendProducer } from './dispatch-send.producer';
import {
  DISPATCH_CANCELABLE_ITEM_STATUSES,
  DISPATCH_CANCELABLE_STATUSES,
  DISPATCH_EMERGENCY_STOP_STATUSES,
  DISPATCH_RESUME_ELIGIBLE_ITEM_STATUSES,
  assertCanCancelDispatch,
  assertCanEmergencyStopDispatch,
  assertCanPauseDispatch,
  assertCanResumeDispatch,
  computeDispatchCountersFromStatusMap,
  isChannelPoolAptForResume,
  normalizeOperationalReason,
} from './dispatch-operational.util';
import { assertDispatchStartWithinPilotLimit } from './dispatch-start.util';

const ITEM_BATCH_SIZE = 100;

export type DispatchOperationalResult = {
  dispatchId: string;
  previousStatus: DispatchStatus;
  status: DispatchStatus;
  reason: string | null;
  counts: ReturnType<typeof computeDispatchCountersFromStatusMap>;
  jobsRepublished?: number;
  itemsCanceled?: number;
  jobsRemoved?: number;
};

/**
 * Controle operacional do Dispatch (09.5): pause, resume, cancel,
 * emergency-stop. O banco e a fonte de verdade; a fila e limpeza tecnica.
 */
@Injectable()
export class DispatchOperationalService {
  private readonly logger = new Logger(DispatchOperationalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly organizationAccess: OrganizationAccessService,
    private readonly dispatchSendProducer: DispatchSendProducer,
  ) {}

  async pause(
    userId: string,
    campaignId: string,
    dispatchId: string,
    reasonRaw?: string,
  ): Promise<DispatchOperationalResult> {
    const campaign = await this.getCampaignContext(userId, campaignId);
    await this.organizationAccess.requireApproveAccess(
      userId,
      campaign.organizationId,
    );

    let reason: string | null;
    try {
      reason = normalizeOperationalReason(reasonRaw, { required: false });
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Motivo invalido',
      );
    }

    const dispatch = await this.findDispatch(
      campaign.organizationId,
      campaignId,
      dispatchId,
    );

    try {
      assertCanPauseDispatch(dispatch.status);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Nao e possivel pausar',
      );
    }

    const previousStatus = dispatch.status;
    const now = new Date();

    const claim = await this.prisma.dispatch.updateMany({
      where: {
        id: dispatch.id,
        organizationId: campaign.organizationId,
        campaignId,
        status: DispatchStatus.RUNNING,
      },
      data: {
        status: DispatchStatus.PAUSING,
        pausingAt: now,
        pauseRequestedAt: now,
        pauseReason: reason,
        pausedByUserId: userId,
        lastProgressAt: now,
      },
    });

    if (claim.count !== 1) {
      throw new ConflictException(
        'Nao foi possivel pausar (conflito de concorrencia)',
      );
    }

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'DISPATCH_PAUSE_REQUESTED',
      entityType: 'Dispatch',
      entityId: dispatch.id,
      metadata: {
        dispatchId: dispatch.id,
        previousStatus,
        newStatus: DispatchStatus.PAUSING,
        reason,
        userId,
        timestamp: now.toISOString(),
      },
    });

    // Items PROCESSING sem chamada externa: liberar para QUEUED.
    await this.prisma.dispatchItem.updateMany({
      where: {
        dispatchId: dispatch.id,
        organizationId: campaign.organizationId,
        campaignId,
        status: DispatchItemStatus.PROCESSING,
        providerRequestStartedAt: null,
      },
      data: {
        status: DispatchItemStatus.QUEUED,
        lockedAt: null,
        lockToken: null,
        lockExpiresAt: null,
        lastQueueError: 'DISPATCH_PAUSING_RELEASED',
      },
    });

    const finalized = await this.tryFinalizePause(dispatch.id, {
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
    });

    const counts = await this.recomputeCounters(dispatch.id);

    return {
      dispatchId: dispatch.id,
      previousStatus,
      status: finalized
        ? DispatchStatus.PAUSED
        : DispatchStatus.PAUSING,
      reason,
      counts,
    };
  }

  /**
   * PAUSING → PAUSED quando nao ha mais PROCESSING.
   * Pode ser chamado pela API (pause) ou pelo Worker apos cada item.
   */
  async tryFinalizePause(
    dispatchId: string,
    context?: {
      organizationId?: string;
      campaignId?: string;
      actorUserId?: string | null;
    },
  ): Promise<boolean> {
    const processingCount = await this.prisma.dispatchItem.count({
      where: {
        dispatchId,
        status: DispatchItemStatus.PROCESSING,
      },
    });

    if (processingCount > 0) {
      return false;
    }

    const now = new Date();
    const claim = await this.prisma.dispatch.updateMany({
      where: {
        id: dispatchId,
        status: DispatchStatus.PAUSING,
      },
      data: {
        status: DispatchStatus.PAUSED,
        pausedAt: now,
        pausingAt: null,
        lastProgressAt: now,
      },
    });

    if (claim.count !== 1) {
      return false;
    }

    const dispatch = await this.prisma.dispatch.findUnique({
      where: { id: dispatchId },
      select: {
        id: true,
        organizationId: true,
        campaignId: true,
        pauseReason: true,
        pausedByUserId: true,
        pendingItems: true,
        queuedItems: true,
        processingItems: true,
        sentItems: true,
        failedItems: true,
        canceledItems: true,
      },
    });

    if (dispatch) {
      const counts = await this.recomputeCounters(dispatchId);
      await this.audit.log({
        organizationId: context?.organizationId ?? dispatch.organizationId,
        campaignId: context?.campaignId ?? dispatch.campaignId,
        actorUserId:
          context?.actorUserId ?? dispatch.pausedByUserId ?? undefined,
        action: 'DISPATCH_PAUSED',
        entityType: 'Dispatch',
        entityId: dispatch.id,
        metadata: {
          dispatchId: dispatch.id,
          previousStatus: DispatchStatus.PAUSING,
          newStatus: DispatchStatus.PAUSED,
          reason: dispatch.pauseReason,
          userId: dispatch.pausedByUserId,
          timestamp: now.toISOString(),
          counts,
        },
      });
    }

    return true;
  }

  async resume(
    userId: string,
    campaignId: string,
    dispatchId: string,
  ): Promise<DispatchOperationalResult> {
    const campaign = await this.getCampaignContext(userId, campaignId);
    await this.organizationAccess.requireApproveAccess(
      userId,
      campaign.organizationId,
    );

    try {
      assertDispatchSendAllowed();
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Envio real de disparo desabilitado',
      );
    }

    const dispatch = await this.findDispatch(
      campaign.organizationId,
      campaignId,
      dispatchId,
    );

    try {
      assertCanResumeDispatch(dispatch);
      assertDispatchStartWithinPilotLimit(dispatch.totalItems);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Nao e possivel retomar',
      );
    }

    const channels = await this.prisma.dispatchChannel.findMany({
      where: { dispatchId: dispatch.id },
      select: {
        enabled: true,
        operationalStatus: true,
        channelAccount: { select: { status: true } },
      },
    });

    if (
      !isChannelPoolAptForResume(
        channels.map((c) => ({
          enabled: c.enabled,
          operationalStatus: c.operationalStatus,
          channelAccountStatus: c.channelAccount.status,
        })),
      )
    ) {
      throw new BadRequestException(
        'Nenhuma instancia apta (CONNECTED + READY) para retomar o envio',
      );
    }

    const previousStatus = dispatch.status;
    const now = new Date();

    const claim = await this.prisma.dispatch.updateMany({
      where: {
        id: dispatch.id,
        organizationId: campaign.organizationId,
        campaignId,
        status: DispatchStatus.PAUSED,
      },
      data: {
        status: DispatchStatus.RUNNING,
        resumedAt: now,
        pausingAt: null,
        pauseRequestedAt: null,
        lastProgressAt: now,
      },
    });

    if (claim.count !== 1) {
      throw new ConflictException(
        'Nao foi possivel retomar (conflito de concorrencia)',
      );
    }

    let jobsRepublished = 0;
    let cursor: string | undefined;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const items = await this.prisma.dispatchItem.findMany({
        where: {
          dispatchId: dispatch.id,
          organizationId: campaign.organizationId,
          campaignId,
          status: { in: DISPATCH_RESUME_ELIGIBLE_ITEM_STATUSES },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: ITEM_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (items.length === 0) break;

      for (const item of items) {
        try {
          const result = await this.dispatchSendProducer.ensureJob({
            dispatchId: dispatch.id,
            dispatchItemId: item.id,
            organizationId: campaign.organizationId,
            campaignId,
          });
          if (result.status === 'enqueued') {
            jobsRepublished += 1;
          }
        } catch {
          // reconcile / worker recuperam depois
        }
      }

      cursor = items[items.length - 1]!.id;
      if (items.length < ITEM_BATCH_SIZE) break;
    }

    // PROCESSING com lock expirado: recuperar com segurança para QUEUED + ensureJob
    const expiredLocks = await this.prisma.dispatchItem.findMany({
      where: {
        dispatchId: dispatch.id,
        status: DispatchItemStatus.PROCESSING,
        OR: [{ lockExpiresAt: null }, { lockExpiresAt: { lt: now } }],
        providerRequestStartedAt: null,
      },
      select: { id: true },
      take: ITEM_BATCH_SIZE,
    });

    for (const item of expiredLocks) {
      await this.prisma.dispatchItem.updateMany({
        where: {
          id: item.id,
          status: DispatchItemStatus.PROCESSING,
          providerRequestStartedAt: null,
        },
        data: {
          status: DispatchItemStatus.QUEUED,
          lockedAt: null,
          lockToken: null,
          lockExpiresAt: null,
          lastQueueError: 'LOCK_EXPIRED_ON_RESUME',
        },
      });
      try {
        const result = await this.dispatchSendProducer.ensureJob({
          dispatchId: dispatch.id,
          dispatchItemId: item.id,
          organizationId: campaign.organizationId,
          campaignId,
        });
        if (result.status === 'enqueued') jobsRepublished += 1;
      } catch {
        // ignore
      }
    }

    const counts = await this.recomputeCounters(dispatch.id);

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'DISPATCH_RESUMED',
      entityType: 'Dispatch',
      entityId: dispatch.id,
      metadata: {
        dispatchId: dispatch.id,
        previousStatus,
        newStatus: DispatchStatus.RUNNING,
        userId,
        timestamp: now.toISOString(),
        jobsRepublished,
        counts,
      },
    });

    return {
      dispatchId: dispatch.id,
      previousStatus,
      status: DispatchStatus.RUNNING,
      reason: null,
      counts,
      jobsRepublished,
    };
  }

  async cancel(
    userId: string,
    campaignId: string,
    dispatchId: string,
    reasonRaw: string,
  ): Promise<DispatchOperationalResult> {
    const campaign = await this.getCampaignContext(userId, campaignId);
    await this.organizationAccess.requireApproveAccess(
      userId,
      campaign.organizationId,
    );

    let reason: string;
    try {
      reason = normalizeOperationalReason(reasonRaw, { required: true })!;
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Motivo invalido',
      );
    }

    const dispatch = await this.findDispatch(
      campaign.organizationId,
      campaignId,
      dispatchId,
    );

    // Idempotente: ja CANCELED
    if (dispatch.status === DispatchStatus.CANCELED) {
      const counts = await this.recomputeCounters(dispatch.id);
      return {
        dispatchId: dispatch.id,
        previousStatus: DispatchStatus.CANCELED,
        status: DispatchStatus.CANCELED,
        reason: dispatch.cancelReason,
        counts,
        itemsCanceled: 0,
        jobsRemoved: 0,
      };
    }

    try {
      assertCanCancelDispatch(dispatch.status);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Nao e possivel cancelar',
      );
    }

    const previousStatus = dispatch.status;
    const now = new Date();

    const claim = await this.prisma.dispatch.updateMany({
      where: {
        id: dispatch.id,
        organizationId: campaign.organizationId,
        campaignId,
        status: { in: DISPATCH_CANCELABLE_STATUSES },
      },
      data: {
        status: DispatchStatus.CANCELED,
        canceledAt: now,
        cancelReason: reason,
        canceledByUserId: userId,
        pausingAt: null,
        lastProgressAt: now,
      },
    });

    if (claim.count !== 1) {
      throw new ConflictException(
        'Nao foi possivel cancelar (conflito de concorrencia)',
      );
    }

    const cancelItems = await this.prisma.dispatchItem.updateMany({
      where: {
        dispatchId: dispatch.id,
        organizationId: campaign.organizationId,
        campaignId,
        status: { in: DISPATCH_CANCELABLE_ITEM_STATUSES },
      },
      data: {
        status: DispatchItemStatus.CANCELED,
        canceledAt: now,
        lockedAt: null,
        lockToken: null,
        lockExpiresAt: null,
        errorCategory: DispatchItemErrorCategory.DISPATCH_CANCELED,
        errorCode: 'DISPATCH_CANCELED',
        errorMessage: 'Dispatch cancelado',
      },
    });

    // PROCESSING sem chamada externa → CANCELED
    const processingReleased = await this.prisma.dispatchItem.updateMany({
      where: {
        dispatchId: dispatch.id,
        status: DispatchItemStatus.PROCESSING,
        providerRequestStartedAt: null,
      },
      data: {
        status: DispatchItemStatus.CANCELED,
        canceledAt: now,
        lockedAt: null,
        lockToken: null,
        lockExpiresAt: null,
        errorCategory: DispatchItemErrorCategory.DISPATCH_CANCELED,
        errorCode: 'DISPATCH_CANCELED',
        errorMessage: 'Dispatch cancelado antes da chamada externa',
      },
    });

    const itemsCanceled = cancelItems.count + processingReleased.count;
    let jobsRemoved = 0;

    // Limpeza tecnica de jobs waiting/delayed apos persistir banco
    const itemsForCleanup = await this.prisma.dispatchItem.findMany({
      where: {
        dispatchId: dispatch.id,
        status: DispatchItemStatus.CANCELED,
      },
      select: { id: true },
      take: 500,
    });

    for (const item of itemsForCleanup) {
      try {
        const removed = await this.dispatchSendProducer.removeWaitingOrDelayedJob(
          {
            dispatchId: dispatch.id,
            dispatchItemId: item.id,
          },
        );
        if (removed) jobsRemoved += 1;
      } catch {
        // limpeza best-effort
      }
    }

    const counts = await this.recomputeCounters(dispatch.id, {
      allowTerminalStatuses: true,
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'DISPATCH_CANCELED',
      entityType: 'Dispatch',
      entityId: dispatch.id,
      metadata: {
        dispatchId: dispatch.id,
        previousStatus,
        newStatus: DispatchStatus.CANCELED,
        reason,
        userId,
        timestamp: now.toISOString(),
        itemsCanceled,
        jobsRemoved,
        counts,
      },
    });

    this.logger.log(
      JSON.stringify({
        operationalAction: 'CANCEL',
        dispatchId: dispatch.id,
        previousStatus,
        nextStatus: DispatchStatus.CANCELED,
        userId,
        reasonCode: 'DISPATCH_CANCELED',
        itemsCanceled,
      }),
    );

    return {
      dispatchId: dispatch.id,
      previousStatus,
      status: DispatchStatus.CANCELED,
      reason,
      counts,
      itemsCanceled,
      jobsRemoved,
    };
  }

  async emergencyStop(
    userId: string,
    campaignId: string,
    dispatchId: string,
    reasonRaw: string,
  ): Promise<DispatchOperationalResult> {
    const campaign = await this.getCampaignContext(userId, campaignId);
    await this.organizationAccess.requireApproveAccess(
      userId,
      campaign.organizationId,
    );

    let reason: string;
    try {
      reason = normalizeOperationalReason(reasonRaw, { required: true })!;
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Motivo invalido',
      );
    }

    const dispatch = await this.findDispatch(
      campaign.organizationId,
      campaignId,
      dispatchId,
    );

    if (dispatch.status === DispatchStatus.EMERGENCY_STOPPED) {
      const counts = await this.recomputeCounters(dispatch.id);
      return {
        dispatchId: dispatch.id,
        previousStatus: DispatchStatus.EMERGENCY_STOPPED,
        status: DispatchStatus.EMERGENCY_STOPPED,
        reason: dispatch.emergencyStopReason,
        counts,
        jobsRemoved: 0,
      };
    }

    try {
      assertCanEmergencyStopDispatch(dispatch.status);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Nao e possivel acionar parada emergencial',
      );
    }

    const previousStatus = dispatch.status;
    const now = new Date();

    const claim = await this.prisma.dispatch.updateMany({
      where: {
        id: dispatch.id,
        organizationId: campaign.organizationId,
        campaignId,
        status: { in: DISPATCH_EMERGENCY_STOP_STATUSES },
      },
      data: {
        status: DispatchStatus.EMERGENCY_STOPPED,
        emergencyStoppedAt: now,
        emergencyStopReason: reason,
        emergencyStoppedByUserId: userId,
        pausingAt: null,
        lastProgressAt: now,
      },
    });

    if (claim.count !== 1) {
      throw new ConflictException(
        'Nao foi possivel acionar parada emergencial (conflito de concorrencia)',
      );
    }

    // Liberar PROCESSING sem chamada externa para QUEUED (recuperavel)
    await this.prisma.dispatchItem.updateMany({
      where: {
        dispatchId: dispatch.id,
        status: DispatchItemStatus.PROCESSING,
        providerRequestStartedAt: null,
      },
      data: {
        status: DispatchItemStatus.QUEUED,
        lockedAt: null,
        lockToken: null,
        lockExpiresAt: null,
        lastQueueError: 'DISPATCH_EMERGENCY_STOPPED',
      },
    });

    let jobsRemoved = 0;
    const pendingJobs = await this.prisma.dispatchItem.findMany({
      where: {
        dispatchId: dispatch.id,
        status: {
          in: [
            DispatchItemStatus.QUEUED,
            DispatchItemStatus.SCHEDULED,
            DispatchItemStatus.RETRY_SCHEDULED,
          ],
        },
      },
      select: { id: true },
      take: 500,
    });

    for (const item of pendingJobs) {
      try {
        const removed = await this.dispatchSendProducer.removeWaitingOrDelayedJob(
          {
            dispatchId: dispatch.id,
            dispatchItemId: item.id,
          },
        );
        if (removed) jobsRemoved += 1;
      } catch {
        // best-effort
      }
    }

    const counts = await this.recomputeCounters(dispatch.id, {
      allowTerminalStatuses: true,
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'DISPATCH_EMERGENCY_STOPPED',
      entityType: 'Dispatch',
      entityId: dispatch.id,
      metadata: {
        dispatchId: dispatch.id,
        previousStatus,
        newStatus: DispatchStatus.EMERGENCY_STOPPED,
        reason,
        userId,
        timestamp: now.toISOString(),
        jobsRemoved,
        counts,
      },
    });

    this.logger.log(
      JSON.stringify({
        operationalAction: 'EMERGENCY_STOP',
        dispatchId: dispatch.id,
        previousStatus,
        nextStatus: DispatchStatus.EMERGENCY_STOPPED,
        userId,
        reasonCode: 'DISPATCH_EMERGENCY_STOPPED',
      }),
    );

    return {
      dispatchId: dispatch.id,
      previousStatus,
      status: DispatchStatus.EMERGENCY_STOPPED,
      reason,
      counts,
      jobsRemoved,
    };
  }

  async recomputeCounters(
    dispatchId: string,
    options?: { allowTerminalStatuses?: boolean },
  ): Promise<ReturnType<typeof computeDispatchCountersFromStatusMap>> {
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
    const now = new Date();

    const where: Prisma.DispatchWhereInput = { id: dispatchId };
    if (!options?.allowTerminalStatuses) {
      where.status = {
        in: [
          DispatchStatus.RUNNING,
          DispatchStatus.PAUSING,
          DispatchStatus.PAUSED,
          DispatchStatus.QUEUED,
        ],
      };
    }

    await this.prisma.dispatch.updateMany({
      where,
      data: {
        ...counts,
        lastProgressAt: now,
      },
    });

    // Sempre atualizar contadores em estados terminais operacionais tambem
    if (options?.allowTerminalStatuses) {
      await this.prisma.dispatch.updateMany({
        where: {
          id: dispatchId,
          status: {
            in: [
              DispatchStatus.CANCELED,
              DispatchStatus.EMERGENCY_STOPPED,
              DispatchStatus.PAUSED,
              DispatchStatus.PAUSING,
              DispatchStatus.RUNNING,
              DispatchStatus.QUEUED,
            ],
          },
        },
        data: {
          ...counts,
          lastProgressAt: now,
        },
      });
    }

    return counts;
  }

  private async findDispatch(
    organizationId: string,
    campaignId: string,
    dispatchId: string,
  ) {
    const dispatch = await this.prisma.dispatch.findFirst({
      where: { id: dispatchId, organizationId, campaignId },
      select: {
        id: true,
        status: true,
        totalItems: true,
        queuedItems: true,
        requiringRedistribution: true,
        cancelReason: true,
        emergencyStopReason: true,
        pauseReason: true,
      },
    });

    if (!dispatch) {
      throw new NotFoundException('Dispatch nao encontrado');
    }

    return dispatch;
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
