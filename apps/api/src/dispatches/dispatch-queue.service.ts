import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChannelAccountStatus,
  DispatchItemStatus,
  DispatchStatus,
  Prisma,
} from '@prisma/client';
import { assertDispatchQueueAllowed } from '@campanha360/shared';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../common/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildReassignmentUpdate,
  selectNextEligibleDispatchChannel,
  type SelectableDispatchChannel,
} from './dispatch-channel-selection.util';
import { DISPATCH_SEND_QUEUE_NAME } from './dispatch-queue.constants';
import {
  assertDispatchQueuePreconditions,
  buildNoChannelDeferredScheduleAt,
  isDispatchChannelApta,
  resolveDispatchStatusAfterQueueRun,
} from './dispatch-queue.util';
import { DispatchSendProducer } from './dispatch-send.producer';

const QUEUE_ITEM_BATCH_SIZE = 100;
const RECONCILE_BATCH_LIMIT = 500;

export type DispatchQueueResult = {
  dispatchId: string;
  status: DispatchStatus;
  totalItems: number;
  jobsCreated: number;
  itemsReassigned: number;
  itemsDeferred: number;
  itemsBlocked: number;
  totalQueued: number;
  queuedAt: Date;
  queueName: string;
};

export type DispatchQueueReconcileResult = {
  dispatchId: string;
  itemsRequeued: number;
  itemsUnlocked: number;
  candidatesWithoutJob: number;
  candidatesStaleLock: number;
};

/**
 * Servico de enfileiramento tecnico (subetapa 09.3). Orquestra a
 * transicao READY -> QUEUED, materializa jobs BullMQ minimos via
 * DispatchSendProducer e resolve failover de canal antes de enfileirar.
 * NUNCA chama a Evolution nem marca items como SENT — isso pertence a 09.4.
 */
@Injectable()
export class DispatchQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly organizationAccess: OrganizationAccessService,
    private readonly dispatchSendProducer: DispatchSendProducer,
  ) {}

  async queue(
    userId: string,
    campaignId: string,
    dispatchId: string,
  ): Promise<DispatchQueueResult> {
    const campaign = await this.getCampaignContext(userId, campaignId);
    await this.organizationAccess.requireApproveAccess(
      userId,
      campaign.organizationId,
    );

    try {
      assertDispatchQueueAllowed();
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Fila de disparo desabilitada',
      );
    }

    const dispatch = await this.prisma.dispatch.findFirst({
      where: {
        id: dispatchId,
        organizationId: campaign.organizationId,
        campaignId,
      },
      select: {
        id: true,
        status: true,
        totalItems: true,
        pendingItems: true,
        requiringRedistribution: true,
        approvalSnapshot: true,
        configurationSnapshot: true,
      },
    });

    if (!dispatch) {
      throw new NotFoundException('Dispatch nao encontrado');
    }

    try {
      assertDispatchQueuePreconditions(dispatch);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Dispatch nao pode ser enfileirado',
      );
    }

    const dispatchChannelRows = await this.prisma.dispatchChannel.findMany({
      where: {
        dispatchId: dispatch.id,
        organizationId: campaign.organizationId,
        campaignId,
      },
      include: {
        channelAccount: {
          select: { id: true, status: true },
        },
      },
    });

    if (dispatchChannelRows.length === 0) {
      throw new BadRequestException(
        'Dispatch sem canais configurados; nao e possivel enfileirar',
      );
    }
    for (const row of dispatchChannelRows) {
      if (!row.channelAccount) {
        throw new BadRequestException(
          `DispatchChannel ${row.id} sem ChannelAccount valido`,
        );
      }
    }

    const channelStates: SelectableDispatchChannel[] = dispatchChannelRows.map(
      (row) => ({
        id: row.id,
        channelAccountId: row.channelAccountId,
        enabled: row.enabled,
        priority: row.priority,
        weight: row.weight,
        effectiveDailyLimit: row.effectiveDailyLimit,
        assignedItems: row.assignedItems,
        sentItems: row.sentItems,
        consecutiveErrors: row.consecutiveErrors,
        cooldownUntil: row.cooldownUntil,
        operationalStatus: row.operationalStatus,
        connected: row.channelAccount.status === ChannelAccountStatus.CONNECTED,
        archived: row.channelAccount.status === ChannelAccountStatus.ARCHIVED,
      }),
    );
    const channelStateById = new Map(channelStates.map((c) => [c.id, c]));

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'DISPATCH_QUEUE_REQUESTED',
      entityType: 'Dispatch',
      entityId: dispatch.id,
      metadata: {
        dispatchId: dispatch.id,
        totalItems: dispatch.totalItems,
        pendingItems: dispatch.pendingItems,
        queueName: DISPATCH_SEND_QUEUE_NAME,
      },
    });

    const queuedAt = new Date();
    const claim = await this.prisma.dispatch.updateMany({
      where: {
        id: dispatch.id,
        organizationId: campaign.organizationId,
        campaignId,
        status: DispatchStatus.READY,
      },
      data: {
        status: DispatchStatus.QUEUED,
        queuedAt,
      },
    });

    if (claim.count !== 1) {
      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'DISPATCH_QUEUE_FAILED',
        entityType: 'Dispatch',
        entityId: dispatch.id,
        metadata: {
          dispatchId: dispatch.id,
          reason: 'CLAIM_CONFLICT',
        },
      });
      throw new ConflictException(
        'Nao foi possivel iniciar o enfileiramento (conflito de concorrencia)',
      );
    }

    let jobsCreated = 0;
    let itemsReassigned = 0;
    let itemsDeferred = 0;

    try {
      let cursor: string | undefined;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const items = await this.prisma.dispatchItem.findMany({
          where: {
            dispatchId: dispatch.id,
            organizationId: campaign.organizationId,
            campaignId,
            status: DispatchItemStatus.PENDING,
          },
          orderBy: { id: 'asc' },
          take: QUEUE_ITEM_BATCH_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });

        if (items.length === 0) {
          break;
        }

        for (const item of items) {
          const now = new Date();
          const currentChannel = item.dispatchChannelId
            ? channelStateById.get(item.dispatchChannelId) ?? null
            : null;
          const apta = currentChannel
            ? isDispatchChannelApta(currentChannel, now)
            : false;

          let effectiveChannel: SelectableDispatchChannel | null = currentChannel;
          let reassignmentData: Prisma.DispatchItemUpdateInput | null = null;

          if (!apta) {
            const next = selectNextEligibleDispatchChannel(channelStates, {
              now,
              excludeChannelIds: item.dispatchChannelId
                ? [item.dispatchChannelId]
                : [],
            });

            if (next) {
              reassignmentData = buildReassignmentUpdate(
                {
                  dispatchChannelId: item.dispatchChannelId,
                  originalDispatchChannelId: item.originalDispatchChannelId,
                  channelAccountId: item.channelAccountId,
                  reassignmentCount: item.reassignmentCount,
                  status: item.status,
                },
                { id: next.id, channelAccountId: next.channelAccountId },
                now,
              ) as unknown as Prisma.DispatchItemUpdateInput;
              effectiveChannel = next;
            } else {
              effectiveChannel = null;
            }
          }

          if (!effectiveChannel) {
            await this.prisma.dispatchItem.update({
              where: { id: item.id },
              data: {
                status: DispatchItemStatus.SCHEDULED,
                scheduledAt: buildNoChannelDeferredScheduleAt(now),
                lastQueueError: 'NO_ELIGIBLE_CHANNEL',
              },
            });
            itemsDeferred += 1;
            continue;
          }

          const enqueueResult = await this.dispatchSendProducer.enqueueItem({
            dispatchId: dispatch.id,
            dispatchItemId: item.id,
            organizationId: campaign.organizationId,
            campaignId,
          });

          await this.prisma.dispatchItem.update({
            where: { id: item.id },
            data: {
              ...(reassignmentData ?? {}),
              status: DispatchItemStatus.QUEUED,
              queueJobId: enqueueResult.jobId,
              queueName: DISPATCH_SEND_QUEUE_NAME,
              queueCreatedAt: now,
              queuedAt: now,
              lastQueueError: null,
            },
          });

          jobsCreated += 1;
          if (reassignmentData) {
            itemsReassigned += 1;
          }
          effectiveChannel.assignedItems += 1;
        }

        cursor = items[items.length - 1]!.id;
        if (items.length < QUEUE_ITEM_BATCH_SIZE) {
          break;
        }
      }

      const [pendingCount, queuedCount] = await Promise.all([
        this.prisma.dispatchItem.count({
          where: {
            dispatchId: dispatch.id,
            organizationId: campaign.organizationId,
            campaignId,
            status: DispatchItemStatus.PENDING,
          },
        }),
        this.prisma.dispatchItem.count({
          where: {
            dispatchId: dispatch.id,
            organizationId: campaign.organizationId,
            campaignId,
            status: DispatchItemStatus.QUEUED,
          },
        }),
      ]);

      const finalStatus = resolveDispatchStatusAfterQueueRun({
        jobsCreated,
        itemsReassigned,
        itemsDeferred,
        itemsBlocked: 0,
      });

      await this.prisma.dispatch.update({
        where: { id: dispatch.id },
        data: {
          pendingItems: pendingCount,
          queuedItems: queuedCount,
          status: finalStatus,
          lastProgressAt: new Date(),
        },
      });

      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'DISPATCH_QUEUED',
        entityType: 'Dispatch',
        entityId: dispatch.id,
        metadata: {
          dispatchId: dispatch.id,
          jobsCreated,
          itemsReassigned,
          itemsDeferred,
          totalQueued: queuedCount,
          finalStatus,
          queueName: DISPATCH_SEND_QUEUE_NAME,
        },
      });

      return {
        dispatchId: dispatch.id,
        status: finalStatus,
        totalItems: dispatch.totalItems,
        jobsCreated,
        itemsReassigned,
        itemsDeferred,
        itemsBlocked: 0,
        totalQueued: queuedCount,
        queuedAt,
        queueName: DISPATCH_SEND_QUEUE_NAME,
      };
    } catch (error) {
      try {
        const queuedNow = await this.prisma.dispatchItem.count({
          where: {
            dispatchId: dispatch.id,
            organizationId: campaign.organizationId,
            campaignId,
            status: DispatchItemStatus.QUEUED,
          },
        });
        if (queuedNow === 0) {
          await this.prisma.dispatch.updateMany({
            where: { id: dispatch.id, status: DispatchStatus.QUEUED },
            data: { status: DispatchStatus.READY, queuedAt: null },
          });
        }
      } catch {
        // Nao mascarar o erro original por falha ao tentar revert.
      }

      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'DISPATCH_QUEUE_FAILED',
        entityType: 'Dispatch',
        entityId: dispatch.id,
        metadata: {
          dispatchId: dispatch.id,
          jobsCreated,
          itemsReassigned,
          itemsDeferred,
          errorMessage: error instanceof Error ? error.message : 'ERRO_DESCONHECIDO',
        },
      });

      throw error;
    }
  }

  /**
   * Reconcilia a fila: garante queueJobId para items QUEUED sem job e
   * libera/reenfileira items PROCESSING com lock expirado. Nao chama
   * Evolution — apenas restaura consistencia entre banco e BullMQ.
   */
  async reconcileQueue(
    userId: string,
    campaignId: string,
    dispatchId: string,
  ): Promise<DispatchQueueReconcileResult> {
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
      select: { id: true, status: true },
    });

    if (!dispatch) {
      throw new NotFoundException('Dispatch nao encontrado');
    }

    const now = new Date();

    const missingJobItems = await this.prisma.dispatchItem.findMany({
      where: {
        dispatchId: dispatch.id,
        organizationId: campaign.organizationId,
        campaignId,
        status: DispatchItemStatus.QUEUED,
        queueJobId: null,
      },
      select: { id: true },
      take: RECONCILE_BATCH_LIMIT,
    });

    const staleProcessingItems = await this.prisma.dispatchItem.findMany({
      where: {
        dispatchId: dispatch.id,
        organizationId: campaign.organizationId,
        campaignId,
        status: DispatchItemStatus.PROCESSING,
        lockExpiresAt: { lt: now },
      },
      select: { id: true },
      take: RECONCILE_BATCH_LIMIT,
    });

    let itemsUnlocked = 0;
    for (const item of staleProcessingItems) {
      const reset = await this.prisma.dispatchItem.updateMany({
        where: { id: item.id, status: DispatchItemStatus.PROCESSING },
        data: {
          status: DispatchItemStatus.QUEUED,
          lockedAt: null,
          lockToken: null,
          lockExpiresAt: null,
        },
      });
      if (reset.count === 1) {
        itemsUnlocked += 1;
      }
    }

    let itemsRequeued = 0;
    const toEnqueue = [...missingJobItems, ...staleProcessingItems];
    for (const item of toEnqueue) {
      try {
        const result = await this.dispatchSendProducer.enqueueItem({
          dispatchId: dispatch.id,
          dispatchItemId: item.id,
          organizationId: campaign.organizationId,
          campaignId,
        });
        await this.prisma.dispatchItem.update({
          where: { id: item.id },
          data: {
            queueJobId: result.jobId,
            queueName: DISPATCH_SEND_QUEUE_NAME,
            queueCreatedAt: now,
            lastQueueError: null,
          },
        });
        itemsRequeued += 1;
      } catch (error) {
        await this.prisma.dispatchItem
          .update({
            where: { id: item.id },
            data: {
              lastQueueError:
                error instanceof Error ? error.message : 'RECONCILE_FAILED',
            },
          })
          .catch(() => undefined);
      }
    }

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'DISPATCH_QUEUE_RECONCILED',
      entityType: 'Dispatch',
      entityId: dispatch.id,
      metadata: {
        dispatchId: dispatch.id,
        itemsRequeued,
        itemsUnlocked,
        candidatesWithoutJob: missingJobItems.length,
        candidatesStaleLock: staleProcessingItems.length,
      },
    });

    return {
      dispatchId: dispatch.id,
      itemsRequeued,
      itemsUnlocked,
      candidatesWithoutJob: missingJobItems.length,
      candidatesStaleLock: staleProcessingItems.length,
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
