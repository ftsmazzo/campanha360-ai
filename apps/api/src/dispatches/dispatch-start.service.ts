import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DispatchStatus } from '@prisma/client';
import { assertDispatchSendAllowed } from '@campanha360/shared';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../common/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { DispatchSendProducer } from './dispatch-send.producer';
import {
  DISPATCH_START_ELIGIBLE_ITEM_STATUSES,
  assertDispatchStartPreconditions,
  assertDispatchStartWithinPilotLimit,
} from './dispatch-start.util';

const START_ITEM_BATCH_SIZE = 100;

export type DispatchStartResult = {
  dispatchId: string;
  status: DispatchStatus;
  startedAt: Date;
  totalItems: number;
  queuedItems: number;
  itemsEligible: number;
  jobsRepublished: number;
};

/**
 * Orquestra o inicio da execucao real (subetapa 09.4): claim
 * QUEUED -> RUNNING e republicacao dos jobs BullMQ dos items elegiveis
 * (QUEUED/RETRY_SCHEDULED/SCHEDULED). NAO chama a Evolution diretamente —
 * apenas libera o Worker para faze-lo (DISPATCH_SEND_ENABLED=true).
 */
@Injectable()
export class DispatchStartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly organizationAccess: OrganizationAccessService,
    private readonly dispatchSendProducer: DispatchSendProducer,
  ) {}

  async start(
    userId: string,
    campaignId: string,
    dispatchId: string,
  ): Promise<DispatchStartResult> {
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
        queuedItems: true,
        requiringRedistribution: true,
      },
    });

    if (!dispatch) {
      throw new NotFoundException('Dispatch nao encontrado');
    }

    try {
      assertDispatchStartPreconditions(dispatch);
      assertDispatchStartWithinPilotLimit(dispatch.totalItems);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Dispatch nao pode ser iniciado',
      );
    }

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'DISPATCH_START_REQUESTED',
      entityType: 'Dispatch',
      entityId: dispatch.id,
      metadata: {
        dispatchId: dispatch.id,
        totalItems: dispatch.totalItems,
        queuedItems: dispatch.queuedItems,
      },
    });

    const startedAt = new Date();
    const claim = await this.prisma.dispatch.updateMany({
      where: {
        id: dispatch.id,
        organizationId: campaign.organizationId,
        campaignId,
        status: DispatchStatus.QUEUED,
      },
      data: {
        status: DispatchStatus.RUNNING,
        startedAt,
        lastProgressAt: startedAt,
      },
    });

    if (claim.count !== 1) {
      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'DISPATCH_START_FAILED',
        entityType: 'Dispatch',
        entityId: dispatch.id,
        metadata: { dispatchId: dispatch.id, reason: 'CLAIM_CONFLICT' },
      });
      throw new ConflictException(
        'Nao foi possivel iniciar a execucao (conflito de concorrencia)',
      );
    }

    let jobsRepublished = 0;
    let itemsEligible = 0;
    let cursor: string | undefined;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const items = await this.prisma.dispatchItem.findMany({
        where: {
          dispatchId: dispatch.id,
          organizationId: campaign.organizationId,
          campaignId,
          status: { in: DISPATCH_START_ELIGIBLE_ITEM_STATUSES },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: START_ITEM_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (items.length === 0) break;

      for (const item of items) {
        itemsEligible += 1;
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
          // Nao interrompe o start por falha isolada de republicacao; o
          // reconcile-queue (09.3) e o proprio Worker cuidam de recuperar.
        }
      }

      cursor = items[items.length - 1]!.id;
      if (items.length < START_ITEM_BATCH_SIZE) break;
    }

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'DISPATCH_STARTED',
      entityType: 'Dispatch',
      entityId: dispatch.id,
      metadata: {
        dispatchId: dispatch.id,
        totalItems: dispatch.totalItems,
        queuedItems: dispatch.queuedItems,
        itemsEligible,
        jobsRepublished,
        startedAt: startedAt.toISOString(),
      },
    });

    return {
      dispatchId: dispatch.id,
      status: DispatchStatus.RUNNING,
      startedAt,
      totalItems: dispatch.totalItems,
      queuedItems: dispatch.queuedItems,
      itemsEligible,
      jobsRepublished,
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
