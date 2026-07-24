import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  auditPilotSendIntervals,
  buildProtectionEnforcementMatrix,
  extractFullSendProtectionPolicy,
} from '@campanha360/shared';
import { OrganizationAccessService } from '../common/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';

type GuardRow = {
  channelAccountId: string;
  nextAvailableAt: Date | null;
  lastSentAt: Date | null;
  lastReservedAt: Date | null;
  sequenceNumber: number;
  dailySentCount: number;
  hourlySentCount: number;
  protectionCooldownUntil: Date | null;
  violationCount: number;
  lastSelectedDelaySeconds: number | null;
};

@Injectable()
export class DispatchProtectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationAccess: OrganizationAccessService,
  ) {}

  async getProtections(
    userId: string,
    campaignId: string,
    dispatchId: string,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId);
    await this.organizationAccess.requireWriteAccess(
      userId,
      campaign.organizationId,
    );

    const dispatch = await this.prisma.dispatch.findFirst({
      where: {
        id: dispatchId,
        organizationId: campaign.organizationId,
        campaignId,
      },
      select: {
        id: true,
        status: true,
        approvalSnapshot: true,
        startedAt: true,
        channels: {
          select: {
            id: true,
            channelAccountId: true,
            effectiveDailyLimit: true,
            sentItems: true,
            consecutiveErrors: true,
            cooldownUntil: true,
            operationalStatus: true,
            channelAccount: {
              select: { id: true, name: true, createdAt: true },
            },
          },
        },
      },
    });

    if (!dispatch) {
      throw new NotFoundException('Dispatch nao encontrado');
    }

    const policy = extractFullSendProtectionPolicy(dispatch.approvalSnapshot);
    const channelAccountIds = [
      ...new Set(dispatch.channels.map((c) => c.channelAccountId)),
    ];

    const guardByAccount = new Map<string, GuardRow>();
    for (const id of channelAccountIds) {
      try {
        const found = await this.prisma.$queryRaw<GuardRow[]>`
          SELECT
            "channelAccountId",
            "nextAvailableAt",
            "lastSentAt",
            "lastReservedAt",
            "sequenceNumber",
            "dailySentCount",
            "hourlySentCount",
            "protectionCooldownUntil",
            "violationCount",
            "lastSelectedDelaySeconds"
          FROM "ChannelAccountSendGuard"
          WHERE "channelAccountId" = ${id}
        `;
        if (found[0]) guardByAccount.set(id, found[0]);
      } catch {
        // tabela ainda nao migrada no ambiente
      }
    }

    const primaryGuard = [...guardByAccount.values()][0] ?? null;

    const matrix = buildProtectionEnforcementMatrix({
      approvalSnapshot: dispatch.approvalSnapshot,
      hasAtomicReservation: true,
      guardSummary: primaryGuard
        ? {
            nextAvailableAt: primaryGuard.nextAvailableAt?.toISOString() ?? null,
            lastSentAt: primaryGuard.lastSentAt?.toISOString() ?? null,
            dailySentCount: primaryGuard.dailySentCount,
            hourlySentCount: primaryGuard.hourlySentCount,
            violationCount: primaryGuard.violationCount,
            protectionCooldownUntil:
              primaryGuard.protectionCooldownUntil?.toISOString() ?? null,
            sequenceNumber: primaryGuard.sequenceNumber,
          }
        : {
            dailySentCount: 0,
            hourlySentCount: 0,
            violationCount: 0,
            sequenceNumber: 0,
          },
    });

    const recentAttempts = await this.prisma.dispatchItemAttempt.findMany({
      where: { dispatchId: dispatch.id },
      orderBy: [{ startedAt: 'asc' }],
      take: 100,
      select: {
        id: true,
        dispatchItemId: true,
        attemptNumber: true,
        channelAccountId: true,
        startedAt: true,
        completedAt: true,
        outcome: true,
        reservedSendAt: true,
        actualProviderRequestStartedAt: true,
        intervalObservedSeconds: true,
        selectedDelaySeconds: true,
        sequenceNumber: true,
        batchPosition: true,
        pauseApplied: true,
        pauseReason: true,
        protectionDecision: true,
        protectionReason: true,
        hourlyUsageBefore: true,
        dailyUsageBefore: true,
        effectiveDailyLimit: true,
        minDelaySeconds: true,
        maxDelaySeconds: true,
      },
    });

    return {
      dispatchId: dispatch.id,
      status: dispatch.status,
      frozenProfile: policy.profile,
      policy: {
        minDelaySeconds: policy.minDelaySeconds,
        maxDelaySeconds: policy.maxDelaySeconds,
        batchSize: policy.batchSize,
        pauseBetweenBatchesSeconds: policy.pauseBetweenBatchesSeconds,
        longPauseEveryMessages: policy.longPauseEveryMessages,
        longPauseMinutes: policy.longPauseMinutes,
        hourlyLimit: policy.hourlyLimit,
        dailyLimitPerInstance: policy.dailyLimitPerInstance,
        newAccountMaxPerDay: policy.newAccountMaxPerDay,
        warmupMaxPerDay: policy.warmupMaxPerDay,
        rotateEveryMessages: policy.rotateEveryMessages,
        rotationEnabled: policy.rotationEnabled,
        consecutiveErrorsBeforePause: policy.consecutiveErrorsBeforePause,
        errorPauseMinutes: policy.errorPauseMinutes,
        pauseOn403: policy.pauseOn403,
        pauseOn429: policy.pauseOn429,
        validateWhatsAppNumber: policy.validateWhatsAppNumber,
        repetitionWarningPercentage: policy.repetitionWarningPercentage,
      },
      channels: dispatch.channels.map((ch) => {
        const guard = guardByAccount.get(ch.channelAccountId) ?? null;
        return {
          dispatchChannelId: ch.id,
          channelAccountId: ch.channelAccountId,
          channelAccountName: ch.channelAccount.name,
          effectiveDailyLimit: ch.effectiveDailyLimit,
          sentItems: ch.sentItems,
          consecutiveErrors: ch.consecutiveErrors,
          cooldownUntil: ch.cooldownUntil,
          operationalStatus: ch.operationalStatus,
          guard: guard
            ? {
                nextAvailableAt: guard.nextAvailableAt,
                lastSentAt: guard.lastSentAt,
                lastReservedAt: guard.lastReservedAt,
                sequenceNumber: guard.sequenceNumber,
                dailySentCount: guard.dailySentCount,
                hourlySentCount: guard.hourlySentCount,
                protectionCooldownUntil: guard.protectionCooldownUntil,
                violationCount: guard.violationCount,
                lastSelectedDelaySeconds: guard.lastSelectedDelaySeconds,
              }
            : null,
        };
      }),
      enforcementMatrix: matrix,
      recentAttempts: recentAttempts.map((a) => ({
        id: a.id,
        dispatchItemId: a.dispatchItemId,
        attemptNumber: a.attemptNumber,
        channelAccountId: a.channelAccountId,
        startedAt: a.startedAt,
        completedAt: a.completedAt,
        outcome: a.outcome,
        reservedSendAt: a.reservedSendAt,
        actualProviderRequestStartedAt: a.actualProviderRequestStartedAt,
        intervalObservedSeconds: a.intervalObservedSeconds,
        selectedDelaySeconds: a.selectedDelaySeconds,
        sequenceNumber: a.sequenceNumber,
        batchPosition: a.batchPosition,
        pauseApplied: a.pauseApplied,
        pauseReason: a.pauseReason,
        protectionDecision: a.protectionDecision,
        protectionReason: a.protectionReason,
        hourlyUsageBefore: a.hourlyUsageBefore,
        dailyUsageBefore: a.dailyUsageBefore,
        effectiveDailyLimit: a.effectiveDailyLimit,
        minDelaySeconds: a.minDelaySeconds,
        maxDelaySeconds: a.maxDelaySeconds,
      })),
      violationCountTotal: [...guardByAccount.values()].reduce(
        (acc, g) => acc + (g.violationCount ?? 0),
        0,
      ),
      atomicReservationStrategy: 'POSTGRES_SELECT_FOR_UPDATE',
      scope: 'ChannelAccount',
    };
  }

  async auditPilotIntervals(
    userId: string,
    campaignId: string,
    dispatchId: string,
  ) {
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
      select: { id: true, approvalSnapshot: true },
    });
    if (!dispatch) {
      throw new NotFoundException('Dispatch nao encontrado');
    }

    const policy = extractFullSendProtectionPolicy(dispatch.approvalSnapshot);
    const items = await this.prisma.dispatchItem.findMany({
      where: { dispatchId },
      select: {
        id: true,
        channelAccountId: true,
        providerRequestStartedAt: true,
        protectionDelaySeconds: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (items.length === 0) {
      throw new BadRequestException('Dispatch sem items para auditar');
    }

    return auditPilotSendIntervals({
      dispatchId: dispatch.id,
      profile: policy.profile,
      minDelaySeconds: policy.minDelaySeconds,
      maxDelaySeconds: policy.maxDelaySeconds,
      items: items.map((item) => ({
        dispatchItemId: item.id,
        channelAccountId: item.channelAccountId,
        providerRequestStartedAt: item.providerRequestStartedAt,
        selectedDelaySeconds: item.protectionDelaySeconds,
      })),
    });
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
