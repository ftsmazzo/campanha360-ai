import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChannelAccountStatus,
  ChannelProvider,
  Prisma,
} from '@prisma/client';
import {
  classifyEvolutionRemoteState,
  isChannelOperationallyReady,
  isQrAllowedForRemoteState,
  mapRemoteStateToChannelAccountStatus,
  normalizePlatformRestrictionStatus,
  assertNoActivePlatformRestriction,
  sanitizePlatformRestrictionReason,
  sanitizeLogText,
  type EvolutionInstanceStateSnapshot,
  type EvolutionRemoteConnectionState,
  type EvolutionSessionState,
  type PlatformRestrictionSource,
  type PlatformRestrictionStatus,
} from '@campanha360/shared';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../common/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  EVOLUTION_INSTANCE_NOT_FOUND_MESSAGE,
  EvolutionAdapter,
} from './evolution.adapter';
import { EvolutionApiException } from './evolution.errors';
import { mapEvolutionConnectionStateToStatus } from './evolution-connection.util';

const channelAccountLifecycleSelect = {
  id: true,
  organizationId: true,
  campaignId: true,
  provider: true,
  name: true,
  status: true,
  externalAccountId: true,
  config: true,
  provisioningMode: true,
  evolutionInstanceId: true,
  evolutionInstanceName: true,
  linkedAt: true,
  lastRemoteVerificationAt: true,
  lastRemoteState: true,
  remoteConnectionState: true,
  sessionState: true,
  remoteOwnerHash: true,
  remoteOwnerLast4: true,
  statusReason: true,
  lastStateSource: true,
  lastStateEventAt: true,
  reconnectRequestedAt: true,
  reconnectFinishedAt: true,
  reconnectResult: true,
  reconnectErrorSafe: true,
  remoteStateBefore: true,
  remoteStateAfter: true,
  operationInProgress: true,
  restartAttemptCount: true,
  disconnectedAt: true,
  lastConnectionError: true,
  platformRestrictionStatus: true,
  platformRestrictedAt: true,
  platformRestrictedUntil: true,
  platformRestrictionSource: true,
  platformRestrictionReasonSafe: true,
  requiresManualReview: true,
  platformRestrictionClearedAt: true,
  platformRestrictionClearedByUserId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ChannelAccountSelect;

export type ChannelAccountLifecycleView = Prisma.ChannelAccountGetPayload<{
  select: typeof channelAccountLifecycleSelect;
}>;

@Injectable()
export class EvolutionLifecycleService {
  private readonly logger = new Logger(EvolutionLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationAccess: OrganizationAccessService,
    private readonly audit: AuditService,
    private readonly evolutionAdapter: EvolutionAdapter,
    private readonly config: ConfigService,
  ) {}

  async getInstanceState(
    userId: string,
    campaignId: string,
    channelAccountId: string,
  ) {
    const { campaign, account } = await this.getWritableAccount(
      userId,
      campaignId,
      channelAccountId,
    );
    const snapshot = await this.probeAndPersist(account, 'MANUAL', userId);
    const readiness = isChannelOperationallyReady({
      localStatus: snapshot.account.status,
      remoteConnectionState:
        (snapshot.account.remoteConnectionState as EvolutionRemoteConnectionState) ??
        null,
      sessionState: (snapshot.account.sessionState as EvolutionSessionState) ?? null,
      lastRemoteVerificationAt: snapshot.account.lastRemoteVerificationAt,
      operationInProgress: snapshot.account.operationInProgress,
      platformRestrictionStatus: snapshot.account.platformRestrictionStatus,
      platformRestrictedUntil: snapshot.account.platformRestrictedUntil,
      requiresManualReview: snapshot.account.requiresManualReview,
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'INSTANCE_STATE_SYNCED',
      entityType: 'ChannelAccount',
      entityId: account.id,
      metadata: {
        remoteConnectionState: snapshot.state.normalizedConnectionState,
        sessionState: snapshot.state.normalizedSessionState,
        source: snapshot.state.source,
        ready: readiness.ready,
        reason: readiness.reason,
      },
    });

    return {
      channelAccount: snapshot.account,
      evolution: snapshot.state,
      readiness,
      recommendedAction: snapshot.state.recommendedAction,
    };
  }

  /**
   * Modo A: criar nova. Falha se o nome ja existir na Evolution.
   */
  async createInstance(
    userId: string,
    campaignId: string,
    channelAccountId: string,
    input: { instanceName?: string; confirmCreate?: boolean } = {},
  ) {
    if (!input.confirmCreate) {
      throw new BadRequestException(
        'Confirmacao obrigatoria: confirmCreate=true para criar nova instancia.',
      );
    }

    const { campaign, account } = await this.getWritableAccount(
      userId,
      campaignId,
      channelAccountId,
    );
    this.assertNoPlatformRestrictionOrThrow(account, userId, 'create-instance');
    const instanceName = this.sanitizeInstanceName(
      input.instanceName || this.resolveInstanceName(account),
    );

    await this.assertInstanceNameAvailableForOrg(
      campaign.organizationId,
      instanceName,
      account.id,
    );

    const existing = await this.evolutionAdapter.findInstance(instanceName);
    if (existing) {
      throw new ConflictException(
        `A instancia "${instanceName}" ja existe na Evolution. Use o modo Vincular existente.`,
      );
    }

    const health = await this.evolutionAdapter.checkHealth();
    if (!health.ok) {
      throw new EvolutionApiException(health.message, HttpStatus.SERVICE_UNAVAILABLE);
    }

    const created = await this.evolutionAdapter.createInstance(instanceName);
    const owner = await this.evolutionAdapter.getInstanceOwnerHints(created.instanceName);
    const state = classifyEvolutionRemoteState({
      instanceExists: true,
      rawState: created.state ?? 'connecting',
      hasSessionEvidence: false,
      source: 'PREPARE',
      ...this.hashOwner(owner.ownerDigits ?? owner.ownerJid),
    });

    const nextStatus = this.toPrismaStatus(state.normalizedConnectionState);
    const updated = await this.prisma.channelAccount.update({
      where: { id: account.id },
      data: {
        externalAccountId: created.instanceName,
        evolutionInstanceName: created.instanceName,
        provisioningMode: 'CREATED',
        status: nextStatus,
        ...this.persistStateFields(state),
        linkedAt: null,
      },
      select: channelAccountLifecycleSelect,
    });

    await this.syncWebhook(created.instanceName, account.id, campaign, userId);

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'INSTANCE_CREATED',
      entityType: 'ChannelAccount',
      entityId: account.id,
      metadata: {
        instanceName: created.instanceName,
        remoteConnectionState: state.normalizedConnectionState,
        hasQrcode: Boolean(created.qrcode),
      },
    });

    if (state.normalizedConnectionState === 'QR_REQUIRED' || created.qrcode) {
      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'INSTANCE_QR_REQUIRED',
        entityType: 'ChannelAccount',
        entityId: account.id,
        metadata: { instanceName: created.instanceName },
      });
    }

    return {
      channelAccount: updated,
      evolution: {
        instanceName: created.instanceName,
        created: true,
        state: state.normalizedConnectionState,
        rawState: created.state ?? null,
        qrcode: created.qrcode
          ? {
              base64: created.qrcode.base64 ?? null,
              code: created.qrcode.code ?? null,
              pairingCode: created.qrcode.pairingCode ?? null,
            }
          : null,
        snapshot: state,
      },
    };
  }

  /**
   * Preview do modo B — nao vincula ainda.
   */
  async previewLink(
    userId: string,
    campaignId: string,
    channelAccountId: string,
    input: { instanceName: string },
  ) {
    const { campaign, account } = await this.getWritableAccount(
      userId,
      campaignId,
      channelAccountId,
    );
    const instanceName = this.sanitizeInstanceName(input.instanceName);
    await this.assertInstanceNameAvailableForOrg(
      campaign.organizationId,
      instanceName,
      account.id,
    );

    const existing = await this.evolutionAdapter.findInstance(instanceName);
    if (!existing) {
      throw new NotFoundException(
        `Instancia "${instanceName}" nao encontrada na Evolution.`,
      );
    }

    let rawState = existing.status ?? null;
    try {
      const connection = await this.evolutionAdapter.getConnectionState(
        existing.instanceName,
      );
      rawState = connection.state;
    } catch {
      // mantem status da listagem
    }

    const owner = await this.evolutionAdapter.getInstanceOwnerHints(
      existing.instanceName,
    );
    const state = classifyEvolutionRemoteState({
      instanceExists: true,
      rawState,
      hasSessionEvidence: true,
      source: 'MANUAL',
      ...this.hashOwner(owner.ownerDigits ?? owner.ownerJid),
    });

    return {
      channelAccountId: account.id,
      organizationId: campaign.organizationId,
      preview: {
        instanceName: existing.instanceName,
        remoteConnectionState: state.normalizedConnectionState,
        sessionState: state.normalizedSessionState,
        ownerLast4: state.ownerLast4,
        ownerHash: state.ownerHash,
        rawState: state.rawStateSafe,
        requiresConfirmation: true,
        willRequestQr: state.normalizedConnectionState !== 'CONNECTED',
      },
    };
  }

  /**
   * Modo B: vincular existente com confirmacao explicita.
   */
  async linkInstance(
    userId: string,
    campaignId: string,
    channelAccountId: string,
    input: { instanceName: string; confirmLink?: boolean },
  ) {
    if (!input.confirmLink) {
      throw new BadRequestException(
        'Confirmacao obrigatoria: confirmLink=true para vincular instancia existente.',
      );
    }

    const { campaign, account } = await this.getWritableAccount(
      userId,
      campaignId,
      channelAccountId,
    );
    this.assertNoPlatformRestrictionOrThrow(account, userId, 'link-instance');
    const instanceName = this.sanitizeInstanceName(input.instanceName);
    await this.assertInstanceNameAvailableForOrg(
      campaign.organizationId,
      instanceName,
      account.id,
    );

    const existing = await this.evolutionAdapter.findInstance(instanceName);
    if (!existing) {
      throw new NotFoundException(
        `Instancia "${instanceName}" nao encontrada na Evolution.`,
      );
    }

    let rawState = existing.status ?? null;
    try {
      const connection = await this.evolutionAdapter.getConnectionState(
        existing.instanceName,
      );
      rawState = connection.state;
    } catch {
      // listagem
    }

    const owner = await this.evolutionAdapter.getInstanceOwnerHints(
      existing.instanceName,
    );
    const state = classifyEvolutionRemoteState({
      instanceExists: true,
      rawState,
      hasSessionEvidence: true,
      source: 'PREPARE',
      ...this.hashOwner(owner.ownerDigits ?? owner.ownerJid),
    });

    const nextStatus = this.toPrismaStatus(state.normalizedConnectionState);
    const updated = await this.prisma.channelAccount.update({
      where: { id: account.id },
      data: {
        externalAccountId: existing.instanceName,
        evolutionInstanceName: existing.instanceName,
        provisioningMode: 'LINKED',
        linkedAt: new Date(),
        status: nextStatus,
        ...this.persistStateFields(state),
      },
      select: channelAccountLifecycleSelect,
    });

    await this.syncWebhook(existing.instanceName, account.id, campaign, userId);

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'INSTANCE_LINKED',
      entityType: 'ChannelAccount',
      entityId: account.id,
      metadata: {
        instanceName: existing.instanceName,
        remoteConnectionState: state.normalizedConnectionState,
        ownerLast4: state.ownerLast4,
      },
    });

    return {
      channelAccount: updated,
      evolution: {
        instanceName: existing.instanceName,
        created: false,
        linked: true,
        state: state.normalizedConnectionState,
        rawState: state.rawStateSafe,
        qrcode: null,
        snapshot: state,
      },
    };
  }

  async reconnect(
    userId: string,
    campaignId: string,
    channelAccountId: string,
  ) {
    const { campaign, account } = await this.getWritableAccount(
      userId,
      campaignId,
      channelAccountId,
    );
    this.assertNoPlatformRestrictionOrThrow(account, userId, 'reconnect');
    const instanceName = this.requireBoundInstanceName(account);
    const before = await this.probeRemote(instanceName);

    if (
      before.normalizedConnectionState === 'DEVICE_REMOVED' ||
      before.normalizedConnectionState === 'LOGGED_OUT' ||
      before.normalizedConnectionState === 'SESSION_INVALID' ||
      before.normalizedConnectionState === 'REMOVED' ||
      before.normalizedConnectionState === 'NOT_FOUND'
    ) {
      throw new BadRequestException(
        `Reconnect nao permitido no estado ${before.normalizedConnectionState}. Use reset/recriacao.`,
      );
    }

    await this.prisma.channelAccount.update({
      where: { id: account.id },
      data: {
        operationInProgress: 'RECONNECT',
        reconnectRequestedAt: new Date(),
        remoteStateBefore: before.normalizedConnectionState,
        reconnectErrorSafe: null,
      },
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'INSTANCE_RECONNECT_REQUESTED',
      entityType: 'ChannelAccount',
      entityId: account.id,
      metadata: {
        instanceName,
        remoteStateBefore: before.normalizedConnectionState,
      },
    });

    try {
      // Prefer restart quando DISCONNECTED_WITH_SESSION / RESTART_REQUIRED
      if (
        before.normalizedConnectionState === 'RESTART_REQUIRED' ||
        before.normalizedConnectionState === 'DISCONNECTED_WITH_SESSION'
      ) {
        await this.evolutionAdapter.restartInstance(instanceName);
      } else {
        await this.evolutionAdapter.reconnectInstance(instanceName);
      }

      await this.sleep(1500);
      const afterProbe = await this.probeAndPersist(account, 'POLLING', userId);
      const success =
        afterProbe.state.normalizedConnectionState === 'CONNECTED';

      await this.prisma.channelAccount.update({
        where: { id: account.id },
        data: {
          operationInProgress: null,
          reconnectFinishedAt: new Date(),
          reconnectResult: success ? 'SUCCESS' : 'FAILED',
          remoteStateAfter: afterProbe.state.normalizedConnectionState,
          reconnectErrorSafe: success
            ? null
            : `Estado apos reconnect: ${afterProbe.state.normalizedConnectionState}`,
        },
      });

      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: success ? 'INSTANCE_RECONNECTED' : 'INSTANCE_RECONNECT_FAILED',
        entityType: 'ChannelAccount',
        entityId: account.id,
        metadata: {
          instanceName,
          remoteStateAfter: afterProbe.state.normalizedConnectionState,
        },
      });

      const refreshed = await this.prisma.channelAccount.findUniqueOrThrow({
        where: { id: account.id },
        select: channelAccountLifecycleSelect,
      });

      return {
        channelAccount: refreshed,
        evolution: afterProbe.state,
        success,
        qrSuggested: false,
      };
    } catch (error) {
      const safe = sanitizeLogText(
        error instanceof Error ? error.message : 'reconnect_failed',
      );
      await this.prisma.channelAccount.update({
        where: { id: account.id },
        data: {
          operationInProgress: null,
          reconnectFinishedAt: new Date(),
          reconnectResult: 'FAILED',
          reconnectErrorSafe: safe,
        },
      });
      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'INSTANCE_RECONNECT_FAILED',
        entityType: 'ChannelAccount',
        entityId: account.id,
        metadata: { instanceName, error: safe },
      });
      throw error;
    }
  }

  async restart(
    userId: string,
    campaignId: string,
    channelAccountId: string,
  ) {
    const { campaign, account } = await this.getWritableAccount(
      userId,
      campaignId,
      channelAccountId,
    );
    this.assertNoPlatformRestrictionOrThrow(account, userId, 'restart');
    const instanceName = this.requireBoundInstanceName(account);

    if ((account.restartAttemptCount ?? 0) >= 1) {
      const remote = account.remoteConnectionState;
      if (remote === 'RESTART_REQUIRED') {
        throw new BadRequestException(
          'Restart ja tentado uma vez neste ciclo. Sincronize o estado ou use reset destrutivo.',
        );
      }
    }

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'INSTANCE_RESTART_REQUESTED',
      entityType: 'ChannelAccount',
      entityId: account.id,
      metadata: { instanceName },
    });

    await this.prisma.channelAccount.update({
      where: { id: account.id },
      data: {
        operationInProgress: 'RESTART',
        restartAttemptCount: { increment: 1 },
      },
    });

    try {
      await this.evolutionAdapter.restartInstance(instanceName);
      await this.sleep(1500);
      const probe = await this.probeAndPersist(account, 'POLLING', userId);
      await this.prisma.channelAccount.update({
        where: { id: account.id },
        data: { operationInProgress: null },
      });
      if (probe.state.normalizedConnectionState === 'CONNECTED') {
        await this.prisma.channelAccount.update({
          where: { id: account.id },
          data: { restartAttemptCount: 0 },
        });
      }
      const refreshed = await this.prisma.channelAccount.findUniqueOrThrow({
        where: { id: account.id },
        select: channelAccountLifecycleSelect,
      });
      return { channelAccount: refreshed, evolution: probe.state };
    } catch (error) {
      await this.prisma.channelAccount.update({
        where: { id: account.id },
        data: { operationInProgress: null },
      });
      throw error;
    }
  }

  async resetSession(
    userId: string,
    campaignId: string,
    channelAccountId: string,
    input: { confirmReset?: boolean } = {},
  ) {
    if (!input.confirmReset) {
      throw new BadRequestException(
        'Confirmacao forte obrigatoria: confirmReset=true. Isso apaga a sessao e exige novo QR.',
      );
    }

    const { campaign, account } = await this.getWritableAccount(
      userId,
      campaignId,
      channelAccountId,
    );
    this.assertNoPlatformRestrictionOrThrow(account, userId, 'reset-session');
    const instanceName = this.requireBoundInstanceName(account);

    await this.prisma.channelAccount.update({
      where: { id: account.id },
      data: {
        operationInProgress: 'RESET',
        status: ChannelAccountStatus.DISCONNECTED,
      },
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'INSTANCE_SESSION_RESET_REQUESTED',
      entityType: 'ChannelAccount',
      entityId: account.id,
      metadata: { instanceName },
    });

    try {
      try {
        await this.evolutionAdapter.logoutInstance(instanceName);
      } catch {
        // logout pode falhar se ja deslogado
      }
      await this.evolutionAdapter.deleteInstance(instanceName);
      const created = await this.evolutionAdapter.createInstance(instanceName);
      const state = classifyEvolutionRemoteState({
        instanceExists: true,
        rawState: created.state ?? 'qr',
        hasSessionEvidence: false,
        source: 'PREPARE',
      });

      const updated = await this.prisma.channelAccount.update({
        where: { id: account.id },
        data: {
          operationInProgress: null,
          status: ChannelAccountStatus.CONNECTING,
          provisioningMode: account.provisioningMode ?? 'CREATED',
          externalAccountId: created.instanceName,
          evolutionInstanceName: created.instanceName,
          restartAttemptCount: 0,
          ...this.persistStateFields({
            ...state,
            normalizedConnectionState: 'QR_REQUIRED',
            normalizedSessionState: 'ABSENT',
            recommendedAction: 'SHOW_QR',
            ownerHash: null,
            ownerLast4: null,
          }),
        },
        select: channelAccountLifecycleSelect,
      });

      await this.syncWebhook(created.instanceName, account.id, campaign, userId);

      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'INSTANCE_SESSION_RESET_COMPLETED',
        entityType: 'ChannelAccount',
        entityId: account.id,
        metadata: { instanceName: created.instanceName },
      });
      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'INSTANCE_QR_REQUIRED',
        entityType: 'ChannelAccount',
        entityId: account.id,
        metadata: { instanceName: created.instanceName },
      });

      return {
        channelAccount: updated,
        evolution: {
          instanceName: created.instanceName,
          state: 'QR_REQUIRED',
          qrcode: created.qrcode
            ? {
                base64: created.qrcode.base64 ?? null,
                code: created.qrcode.code ?? null,
                pairingCode: created.qrcode.pairingCode ?? null,
              }
            : null,
        },
      };
    } catch (error) {
      await this.prisma.channelAccount.update({
        where: { id: account.id },
        data: {
          operationInProgress: null,
          status: ChannelAccountStatus.ERROR,
        },
      });
      throw error;
    }
  }

  async requestQrCode(
    userId: string,
    campaignId: string,
    channelAccountId: string,
    opts: { destructiveResetConfirmed?: boolean } = {},
  ) {
    const { campaign, account } = await this.getWritableAccount(
      userId,
      campaignId,
      channelAccountId,
    );
    this.assertNoPlatformRestrictionOrThrow(account, userId, 'qrcode');
    const probe = await this.probeAndPersist(account, 'MANUAL', userId);
    const allowed = isQrAllowedForRemoteState(
      probe.state.normalizedConnectionState,
      opts,
    );

    if (!allowed) {
      throw new BadRequestException(
        `QR nao permitido no estado ${probe.state.normalizedConnectionState}. ` +
          (probe.state.normalizedConnectionState === 'DISCONNECTED_WITH_SESSION'
            ? 'Use Tentar reconectar. Reset destrutivo e acao secundaria.'
            : 'Sincronize o estado ou use a acao recomendada.'),
      );
    }

    if (
      probe.state.normalizedConnectionState === 'CONNECTED' &&
      !opts.destructiveResetConfirmed
    ) {
      throw new BadRequestException(
        'Instancia ja CONNECTED — QR nao e necessario.',
      );
    }

    const instanceName = this.requireBoundInstanceName(probe.account);
    const existing = await this.evolutionAdapter.findInstance(instanceName);
    if (!existing) {
      throw new EvolutionApiException(
        EVOLUTION_INSTANCE_NOT_FOUND_MESSAGE,
        HttpStatus.NOT_FOUND,
      );
    }

    const qrcode = await this.evolutionAdapter.getQrCode(existing.instanceName);
    const hasQr = Boolean(qrcode.base64 || qrcode.code || qrcode.pairingCode);

    if (!hasQr) {
      // Sessao persistida: connect nao devolveu QR — consultar estado real
      const after = await this.probeAndPersist(probe.account, 'MANUAL', userId);
      return {
        channelAccount: after.account,
        evolution: {
          instanceName,
          qrcode: null,
          message:
            after.state.normalizedConnectionState === 'CONNECTED'
              ? 'Sessao persistida: instancia ja conectada sem novo QR.'
              : 'Connect nao retornou QR. Estado remoto atualizado — use reconectar/restart ou reset.',
          snapshot: after.state,
        },
      };
    }

    const updated = await this.prisma.channelAccount.update({
      where: { id: account.id },
      data: {
        status: ChannelAccountStatus.CONNECTING,
        remoteConnectionState: 'QR_REQUIRED',
      },
      select: channelAccountLifecycleSelect,
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'INSTANCE_QR_REQUIRED',
      entityType: 'ChannelAccount',
      entityId: account.id,
      metadata: {
        instanceName,
        hasBase64: Boolean(qrcode.base64),
      },
    });

    return {
      channelAccount: updated,
      evolution: {
        instanceName,
        qrcode: {
          base64: qrcode.base64 ?? null,
          code: qrcode.code ?? null,
          pairingCode: qrcode.pairingCode ?? null,
        },
        snapshot: probe.state,
      },
    };
  }

  /** Usado pelo webhook com freshness. */
  async applyWebhookConnectionState(input: {
    accountId: string;
    rawState: string | null;
    statusReason: string | null;
    reasonCode: string | null;
    reasonType: string | null;
    eventAt: Date | null;
    receivedAt: Date;
    eventName: string | null;
  }) {
    const account = await this.prisma.channelAccount.findUnique({
      where: { id: input.accountId },
      select: channelAccountLifecycleSelect,
    });
    if (!account) return { applied: false, reason: 'not_found' };

    const { shouldApplyStateUpdate } = await import('@campanha360/shared');
    const apply = shouldApplyStateUpdate({
      incomingAt: input.eventAt,
      currentEventAt: account.lastStateEventAt,
      incomingReceivedAt: input.receivedAt,
      currentUpdatedAt: account.updatedAt,
    });
    if (!apply) {
      return { applied: false, reason: 'stale_event' };
    }

    const state = classifyEvolutionRemoteState({
      instanceExists: true,
      rawState: input.rawState,
      statusReason: input.statusReason,
      reasonCode: input.reasonCode,
      reasonType: input.reasonType,
      conflictType: input.reasonType,
      source: 'WEBHOOK',
      checkedAt: input.receivedAt,
      hasSessionEvidence:
        input.statusReason !== '401' &&
        input.reasonType !== 'device_removed',
    });

    const nextStatus = this.toPrismaStatus(state.normalizedConnectionState);
    await this.prisma.channelAccount.update({
      where: { id: account.id },
      data: {
        status: nextStatus,
        ...this.persistStateFields(state),
        lastStateEventAt: input.eventAt ?? input.receivedAt,
        lastStateSource: 'WEBHOOK',
        ...(nextStatus === ChannelAccountStatus.DISCONNECTED ||
        nextStatus === ChannelAccountStatus.ERROR
          ? {
              disconnectedAt: input.receivedAt,
              lastConnectionError:
                state.normalizedConnectionState || input.rawState || 'connection.update',
            }
          : nextStatus === ChannelAccountStatus.CONNECTED
            ? {
                disconnectedAt: null,
                lastConnectionError: null,
                restartAttemptCount: 0,
              }
            : {}),
      },
    });

    if (state.normalizedConnectionState === 'DEVICE_REMOVED') {
      await this.audit.log({
        organizationId: account.organizationId,
        campaignId: account.campaignId,
        action: 'INSTANCE_DEVICE_REMOVED',
        entityType: 'ChannelAccount',
        entityId: account.id,
        metadata: {
          statusReason: input.statusReason,
          reasonType: input.reasonType,
          event: input.eventName,
        },
      });
    }

    if (state.normalizedConnectionState === 'CONNECTED') {
      await this.audit.log({
        organizationId: account.organizationId,
        campaignId: account.campaignId,
        action: 'INSTANCE_QR_CONNECTED',
        entityType: 'ChannelAccount',
        entityId: account.id,
        metadata: { source: 'WEBHOOK' },
      });
    }

    return { applied: true, state };
  }

  private async probeAndPersist(
    account: ChannelAccountLifecycleView,
    source: 'MANUAL' | 'POLLING' | 'PREPARE',
    _actorUserId?: string,
  ) {
    const instanceName = this.resolveInstanceName(account);
    const state = await this.probeRemote(instanceName, source);
    const nextStatus = this.toPrismaStatus(state.normalizedConnectionState);
    const updated = await this.prisma.channelAccount.update({
      where: { id: account.id },
      data: {
        externalAccountId: state.instanceExists
          ? instanceName
          : account.externalAccountId,
        evolutionInstanceName: state.instanceExists
          ? instanceName
          : account.evolutionInstanceName,
        status:
          account.status === ChannelAccountStatus.ARCHIVED
            ? account.status
            : nextStatus,
        ...this.persistStateFields(state),
      },
      select: channelAccountLifecycleSelect,
    });
    return { account: updated, state };
  }

  private async probeRemote(
    instanceName: string,
    source: 'MANUAL' | 'POLLING' | 'PREPARE' | 'WEBHOOK' = 'MANUAL',
  ): Promise<EvolutionInstanceStateSnapshot> {
    const existing = await this.evolutionAdapter.findInstance(instanceName);
    if (!existing) {
      return classifyEvolutionRemoteState({
        instanceExists: false,
        source,
      });
    }

    let rawState = existing.status ?? null;
    try {
      const connection = await this.evolutionAdapter.getConnectionState(
        existing.instanceName,
      );
      rawState = connection.state;
    } catch (error) {
      if (
        error instanceof EvolutionApiException &&
        error.getStatus() === HttpStatus.NOT_FOUND
      ) {
        return classifyEvolutionRemoteState({
          instanceExists: false,
          source,
        });
      }
    }

    const owner = await this.evolutionAdapter.getInstanceOwnerHints(
      existing.instanceName,
    );

    return classifyEvolutionRemoteState({
      instanceExists: true,
      rawState,
      hasSessionEvidence: true,
      source,
      ...this.hashOwner(owner.ownerDigits ?? owner.ownerJid),
    });
  }

  private persistStateFields(state: EvolutionInstanceStateSnapshot) {
    return {
      lastRemoteVerificationAt: new Date(state.checkedAt),
      lastRemoteState: state.rawStateSafe,
      remoteConnectionState: state.normalizedConnectionState,
      sessionState: state.normalizedSessionState,
      statusReason: state.statusReason,
      lastStateSource: state.source,
      remoteOwnerHash: state.ownerHash,
      remoteOwnerLast4: state.ownerLast4,
    };
  }

  private toPrismaStatus(
    state: EvolutionRemoteConnectionState,
  ): ChannelAccountStatus {
    const mapped = mapRemoteStateToChannelAccountStatus(state);
    // Fallback legado
    return (
      mapEvolutionConnectionStateToStatus(
        state === 'CONNECTED'
          ? 'open'
          : state === 'CONNECTING' || state === 'QR_REQUIRED'
            ? 'connecting'
            : state === 'ERROR' || state === 'UNKNOWN'
              ? 'error'
              : 'close',
      ) ??
      (mapped as ChannelAccountStatus)
    );
  }

  private hashOwner(owner: string | null | undefined): {
    ownerHash: string | null;
    ownerLast4: string | null;
  } {
    if (!owner) return { ownerHash: null, ownerLast4: null };
    const digits = owner.replace(/\D/g, '') || owner;
    const hash = createHash('sha256').update(digits).digest('hex').slice(0, 16);
    const last4 = digits.slice(-4);
    return { ownerHash: hash, ownerLast4: last4 || null };
  }

  private async assertInstanceNameAvailableForOrg(
    organizationId: string,
    instanceName: string,
    excludeChannelAccountId: string,
  ) {
    const normalized = instanceName.trim().toLowerCase();
    const conflict = await this.prisma.channelAccount.findFirst({
      where: {
        id: { not: excludeChannelAccountId },
        OR: [
          { evolutionInstanceName: { equals: instanceName, mode: 'insensitive' } },
          { externalAccountId: { equals: instanceName, mode: 'insensitive' } },
        ],
        status: { not: ChannelAccountStatus.ARCHIVED },
      },
      select: { id: true, organizationId: true, campaignId: true },
    });

    if (!conflict) return;

    if (conflict.organizationId !== organizationId) {
      throw new ConflictException(
        'Esta instancia Evolution ja esta vinculada a outra organizacao.',
      );
    }

    throw new ConflictException(
      `O nome "${normalized}" ja esta em uso por outro ChannelAccount desta organizacao.`,
    );
  }

  async recordPlatformRestriction(
    userId: string,
    campaignId: string,
    channelAccountId: string,
    input: {
      status: PlatformRestrictionStatus;
      restrictedUntil?: string | null;
      reasonSafe?: string | null;
      confirm?: boolean;
      source?: PlatformRestrictionSource;
    },
  ) {
    if (!input.confirm) {
      throw new BadRequestException(
        'Confirmacao obrigatoria: confirm=true para registrar restricao da plataforma.',
      );
    }
    const status = normalizePlatformRestrictionStatus(input.status);
    if (status === 'NONE') {
      throw new BadRequestException(
        'Use clear-platform-restriction para remover restricao (status NONE invalido aqui).',
      );
    }

    const { campaign, account } = await this.getWritableAccount(
      userId,
      campaignId,
      channelAccountId,
    );

    const now = new Date();
    let until: Date | null = null;
    if (input.restrictedUntil) {
      until = new Date(input.restrictedUntil);
      if (Number.isNaN(until.getTime())) {
        throw new BadRequestException('restrictedUntil invalido');
      }
      if (until.getTime() < now.getTime()) {
        throw new BadRequestException(
          'restrictedUntil nao pode ser anterior ao momento do registro.',
        );
      }
    }

    const reasonSafe = sanitizePlatformRestrictionReason(input.reasonSafe);
    const source = input.source ?? 'MANUAL';
    const wasActive =
      normalizePlatformRestrictionStatus(account.platformRestrictionStatus) !==
      'NONE';

    const updated = await this.prisma.channelAccount.update({
      where: { id: account.id },
      data: {
        platformRestrictionStatus: status,
        platformRestrictedAt: account.platformRestrictedAt ?? now,
        platformRestrictedUntil: until,
        platformRestrictionSource: source,
        platformRestrictionReasonSafe: reasonSafe,
        requiresManualReview: true,
        platformRestrictionClearedAt: null,
        platformRestrictionClearedByUserId: null,
        // Retira do pool operacional do Dispatch (motor consome status CONNECTED).
        status: ChannelAccountStatus.DISCONNECTED,
        disconnectedAt: account.disconnectedAt ?? now,
        lastConnectionError:
          account.lastConnectionError ?? 'PLATFORM_RESTRICTION_ACTIVE',
      },
      select: channelAccountLifecycleSelect,
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: wasActive
        ? 'INSTANCE_PLATFORM_RESTRICTION_UPDATED'
        : 'INSTANCE_PLATFORM_RESTRICTION_RECORDED',
      entityType: 'ChannelAccount',
      entityId: account.id,
      metadata: {
        status,
        source,
        restrictedUntil: until?.toISOString() ?? null,
        hasReason: Boolean(reasonSafe),
      },
    });

    return {
      channelAccount: updated,
      message:
        'Restricao registrada. Nao tente reconectar ou gerar QR repetidamente. Aguarde o prazo e faca verificacao manual.',
    };
  }

  async clearPlatformRestriction(
    userId: string,
    campaignId: string,
    channelAccountId: string,
    input: {
      confirm?: boolean;
      adminOverrideDeadline?: boolean;
    } = {},
  ) {
    if (!input.confirm) {
      throw new BadRequestException(
        'Confirmacao obrigatoria: confirm=true para limpar restricao.',
      );
    }

    const { campaign, account } = await this.getWritableAccount(
      userId,
      campaignId,
      channelAccountId,
    );

    const status = normalizePlatformRestrictionStatus(
      account.platformRestrictionStatus,
    );
    if (status === 'NONE') {
      throw new BadRequestException('Nao ha restricao ativa nesta conta.');
    }

    const now = new Date();
    if (
      account.platformRestrictedUntil &&
      new Date(account.platformRestrictedUntil).getTime() > now.getTime() &&
      !input.adminOverrideDeadline
    ) {
      throw new BadRequestException(
        'O prazo informado ainda nao encerrou. Aguarde ou use adminOverrideDeadline=true com responsabilidade.',
      );
    }

    if (account.operationInProgress) {
      throw new BadRequestException(
        'Existe operacao em andamento. Aguarde concluir antes de limpar a restricao.',
      );
    }

    const probe = await this.probeAndPersist(account, 'MANUAL', userId);
    if (probe.state.normalizedConnectionState !== 'CONNECTED') {
      throw new BadRequestException(
        `Liberacao exige remoteConnectionState=CONNECTED (atual: ${probe.state.normalizedConnectionState}). Sincronize e verifique no aparelho.`,
      );
    }
    if (
      probe.state.normalizedSessionState === 'INVALID' ||
      probe.state.normalizedSessionState === 'REMOVED' ||
      probe.state.normalizedSessionState === 'ABSENT'
    ) {
      throw new BadRequestException(
        'Liberacao exige sessao utilizavel. Estado atual nao permite.',
      );
    }

    const updated = await this.prisma.channelAccount.update({
      where: { id: account.id },
      data: {
        platformRestrictionStatus: 'NONE',
        requiresManualReview: false,
        platformRestrictionClearedAt: now,
        platformRestrictionClearedByUserId: userId,
        // Nao forca CONNECTED: usa o estado remoto real do probe.
        status: this.toPrismaStatus(probe.state.normalizedConnectionState),
        lastConnectionError: null,
        disconnectedAt:
          probe.state.normalizedConnectionState === 'CONNECTED'
            ? null
            : account.disconnectedAt,
      },
      select: channelAccountLifecycleSelect,
    });

    const readiness = isChannelOperationallyReady({
      localStatus: updated.status,
      remoteConnectionState:
        (updated.remoteConnectionState as EvolutionRemoteConnectionState) ?? null,
      sessionState: (updated.sessionState as EvolutionSessionState) ?? null,
      lastRemoteVerificationAt: updated.lastRemoteVerificationAt,
      operationInProgress: updated.operationInProgress,
      platformRestrictionStatus: updated.platformRestrictionStatus,
      platformRestrictedUntil: updated.platformRestrictedUntil,
      requiresManualReview: updated.requiresManualReview,
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'INSTANCE_PLATFORM_RESTRICTION_CLEARED',
      entityType: 'ChannelAccount',
      entityId: account.id,
      metadata: {
        previousStatus: status,
        remoteConnectionState: probe.state.normalizedConnectionState,
        ready: readiness.ready,
        adminOverrideDeadline: Boolean(input.adminOverrideDeadline),
      },
    });

    return { channelAccount: updated, readiness };
  }

  private assertNoPlatformRestrictionOrThrow(
    account: ChannelAccountLifecycleView,
    actorUserId: string,
    action: string,
  ) {
    const guard = assertNoActivePlatformRestriction({
      platformRestrictionStatus: account.platformRestrictionStatus,
      platformRestrictedUntil: account.platformRestrictedUntil,
      requiresManualReview: account.requiresManualReview,
    });
    if (guard.ok) return;

    void this.audit
      .log({
        organizationId: account.organizationId,
        campaignId: account.campaignId,
        actorUserId,
        action: 'INSTANCE_ACTION_BLOCKED_BY_PLATFORM_RESTRICTION',
        entityType: 'ChannelAccount',
        entityId: account.id,
        metadata: {
          blockedAction: action,
          reason: guard.reason,
          status: account.platformRestrictionStatus,
        },
      })
      .catch(() => undefined);

    throw new BadRequestException(guard.message);
  }

  private async syncWebhook(
    instanceName: string,
    channelAccountId: string,
    campaign: { organizationId: string; id?: string },
    actorUserId: string,
  ) {
    const apiPublicUrl = (this.config.get<string>('API_PUBLIC_URL') || '')
      .trim()
      .replace(/\/+$/, '');
    const jwtKey = (this.config.get<string>('EVOLUTION_WEBHOOK_SECRET') || '').trim();
    if (!apiPublicUrl) return;
    try {
      await this.evolutionAdapter.setInstanceWebhook({
        instanceName,
        url: `${apiPublicUrl}/webhooks/evolution/${channelAccountId}`,
        jwtKey: jwtKey || undefined,
      });
      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId: campaign.id,
        actorUserId,
        action: 'CHANNEL_EVOLUTION_WEBHOOK_SYNCED',
        entityType: 'ChannelAccount',
        entityId: channelAccountId,
        metadata: { configured: true },
      });
    } catch (error) {
      this.logger.warn(
        sanitizeLogText(
          `Webhook sync falhou channel=${channelAccountId}: ${
            error instanceof Error ? error.message : 'error'
          }`,
        ),
      );
    }
  }

  private async getWritableAccount(
    userId: string,
    campaignId: string,
    channelAccountId: string,
  ) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, organizationId: true },
    });
    if (!campaign) throw new NotFoundException('Campanha nao encontrada');
    await this.organizationAccess.requireWriteAccess(userId, campaign.organizationId);

    const account = await this.prisma.channelAccount.findFirst({
      where: {
        id: channelAccountId,
        organizationId: campaign.organizationId,
        campaignId,
      },
      select: channelAccountLifecycleSelect,
    });
    if (!account) throw new NotFoundException('Conta de canal nao encontrada');
    if (account.provider !== ChannelProvider.WHATSAPP_EVOLUTION) {
      throw new BadRequestException(
        'Esta conta de canal nao usa o provider WHATSAPP_EVOLUTION',
      );
    }
    if (account.status === ChannelAccountStatus.ARCHIVED) {
      throw new BadRequestException('Conta de canal arquivada');
    }
    return { campaign, account };
  }

  private resolveInstanceName(account: {
    id: string;
    name: string;
    externalAccountId: string | null;
    evolutionInstanceName?: string | null;
    config: Prisma.JsonValue | null;
  }) {
    if (account.evolutionInstanceName?.trim()) {
      return this.sanitizeInstanceName(account.evolutionInstanceName);
    }
    if (account.externalAccountId?.trim()) {
      return this.sanitizeInstanceName(account.externalAccountId);
    }
    const config =
      account.config && typeof account.config === 'object' && !Array.isArray(account.config)
        ? (account.config as Record<string, unknown>)
        : null;
    const fromConfig =
      typeof config?.instanceName === 'string' ? config.instanceName.trim() : '';
    if (fromConfig) return this.sanitizeInstanceName(fromConfig);
    return this.sanitizeInstanceName(account.name || account.id);
  }

  private requireBoundInstanceName(account: {
    id: string;
    name: string;
    externalAccountId: string | null;
    evolutionInstanceName?: string | null;
    config: Prisma.JsonValue | null;
  }) {
    const name = this.resolveInstanceName(account);
    if (!name) {
      throw new BadRequestException('ChannelAccount sem instanceName vinculado');
    }
    return name;
  }

  private sanitizeInstanceName(value: string) {
    const sanitized = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    if (!sanitized) {
      throw new BadRequestException('Nome de instancia Evolution invalido');
    }
    return sanitized.slice(0, 60);
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
