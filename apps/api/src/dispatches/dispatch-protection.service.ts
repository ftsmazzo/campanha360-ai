import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  buildHonestProtectionMatrix,
  evaluateProtectionReadiness,
  extractFullSendProtectionPolicy,
  auditPilotSendIntervals,
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
              select: {
                id: true,
                name: true,
                createdAt: true,
                accountOperationalSince: true,
                verifiedAccountAgeSource: true,
              },
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

    let guardAvailable = true;
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
        guardAvailable = false;
      }
    }

    const hasOperationalSince = dispatch.channels.some(
      (c) => c.channelAccount.accountOperationalSince != null,
    );
    const accountAgeSource = hasOperationalSince
      ? 'OPERATIONAL_SINCE'
      : 'CREATED_AT_ONLY';

    const honestRows = buildHonestProtectionMatrix({
      approvalSnapshot: dispatch.approvalSnapshot,
      hasAtomicReservation: true,
      whatsappValidationImplemented: true,
      optOutKeywordsInboundImplemented: true,
      lastMileImplemented: true,
      accountAgeSource,
      guardAvailable,
    });

    const readiness = evaluateProtectionReadiness({
      approvalSnapshot: dispatch.approvalSnapshot,
      rows: honestRows,
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
        lastMileEvidence: true,
      },
    });

    return {
      dispatchId: dispatch.id,
      status: dispatch.status,
      frozenProfile: policy.profile,
      protectionReadiness: readiness.status,
      readinessBlockers: readiness.blockers,
      readinessWarnings: readiness.warnings,
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
          accountAgeLabel: ch.channelAccount.accountOperationalSince
            ? 'accountOperationalSince'
            : 'idade conhecida no Campanha360 (createdAt)',
          verifiedAccountAgeSource: ch.channelAccount.verifiedAccountAgeSource,
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
      enforcementMatrix: honestRows.map((row) => ({
        rule: row.rule,
        approvedValue: row.approvedValue,
        valueOrigin: row.applicationPoint,
        appliedInWorker: row.applied,
        status: row.status,
        configured: row.configured,
        blocks: row.blocks,
        applicationPoint: row.applicationPoint,
        evidence: row.evidence,
        dependency: row.dependency,
        fallback: row.fallback,
        lastEvaluation: row.lastEvaluation,
        result: row.status,
        observation: row.observation,
      })),
      recentAttempts,
      violationCountTotal: [...guardByAccount.values()].reduce(
        (acc, g) => acc + (g.violationCount ?? 0),
        0,
      ),
      atomicReservationStrategy: 'POSTGRES_SELECT_FOR_UPDATE',
      scope: 'ChannelAccount',
      honestyNote:
        'Status usa ENFORCED_BLOCKING / ENFORCED_NON_BLOCKING / DIAGNOSTIC_ONLY / DISABLED_BY_POLICY / NOT_IMPLEMENTED / DEGRADED / ERROR. Nao ha garantia anti-ban da plataforma.',
    };
  }

  async getReadiness(userId: string, campaignId: string, dispatchId: string) {
    const panel = await this.getProtections(userId, campaignId, dispatchId);
    return {
      dispatchId: panel.dispatchId,
      protectionReadiness: panel.protectionReadiness,
      blockers: panel.readinessBlockers,
      warnings: panel.readinessWarnings,
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
