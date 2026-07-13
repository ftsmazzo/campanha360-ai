import {
  BadRequestException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChannelAccountStatus,
  ChannelProvider,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../common/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  EVOLUTION_INSTANCE_NOT_FOUND_MESSAGE,
  EvolutionAdapter,
} from './evolution.adapter';
import { EvolutionApiException } from './evolution.errors';

const channelAccountSelect = {
  id: true,
  organizationId: true,
  campaignId: true,
  provider: true,
  name: true,
  status: true,
  externalAccountId: true,
  config: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ChannelAccountSelect;

const channelAccountPublicSelect = {
  id: true,
  organizationId: true,
  campaignId: true,
  provider: true,
  name: true,
  status: true,
  externalAccountId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ChannelAccountSelect;

@Injectable()
export class EvolutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationAccess: OrganizationAccessService,
    private readonly audit: AuditService,
    private readonly evolutionAdapter: EvolutionAdapter,
  ) {}

  async prepare(userId: string, campaignId: string, channelAccountId: string) {
    const { campaign, account } = await this.getWritableEvolutionAccount(
      userId,
      campaignId,
      channelAccountId,
    );

    const instanceName = this.resolveInstanceName(account);

    try {
      const health = await this.evolutionAdapter.checkHealth();
      if (!health.ok) {
        throw new EvolutionApiException(
          health.message,
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      // Se o ID externo existir mas nao estiver na Evolution, prepareInstance cria a instancia.
      const existing = await this.evolutionAdapter.findInstance(instanceName);
      const prepared = existing
        ? await this.evolutionAdapter.prepareInstance(existing.instanceName)
        : await this.evolutionAdapter.prepareInstance(instanceName);

      const nextStatus =
        this.mapEvolutionStateToStatus(prepared.state) ??
        ChannelAccountStatus.CONNECTING;

      const updated = await this.prisma.channelAccount.update({
        where: { id: account.id },
        data: {
          externalAccountId: prepared.instanceName,
          status: nextStatus,
        },
        select: channelAccountPublicSelect,
      });

      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'CHANNEL_EVOLUTION_PREPARED',
        entityType: 'ChannelAccount',
        entityId: account.id,
        metadata: {
          instanceName: prepared.instanceName,
          created: prepared.created,
          previouslyMissing: !existing,
          status: updated.status,
        },
      });

      return {
        channelAccount: updated,
        evolution: {
          instanceName: prepared.instanceName,
          created: prepared.created,
          state: prepared.state ?? null,
        },
      };
    } catch (error) {
      await this.markAccountError(account.id);
      throw error;
    }
  }

  async getStatus(userId: string, campaignId: string, channelAccountId: string) {
    const { campaign, account } = await this.getWritableEvolutionAccount(
      userId,
      campaignId,
      channelAccountId,
    );

    const instanceName = this.resolveInstanceName(account);

    try {
      const existing = await this.evolutionAdapter.findInstance(instanceName);
      if (!existing) {
        await this.markAccountDisconnected(account.id, account.externalAccountId);
        throw new EvolutionApiException(
          EVOLUTION_INSTANCE_NOT_FOUND_MESSAGE,
          HttpStatus.NOT_FOUND,
        );
      }

      const connection = await this.evolutionAdapter.getConnectionState(
        existing.instanceName,
      );
      const nextStatus =
        this.mapEvolutionStateToStatus(connection.state) ?? account.status;

      const updated = await this.prisma.channelAccount.update({
        where: { id: account.id },
        data: {
          externalAccountId: existing.instanceName,
          status: nextStatus,
        },
        select: channelAccountPublicSelect,
      });

      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'CHANNEL_EVOLUTION_STATUS_CHECKED',
        entityType: 'ChannelAccount',
        entityId: account.id,
        metadata: {
          instanceName: existing.instanceName,
          evolutionState: connection.state,
          status: updated.status,
        },
      });

      return {
        channelAccount: updated,
        evolution: {
          instanceName: existing.instanceName,
          state: connection.state,
        },
      };
    } catch (error) {
      if (this.isInstanceNotFoundError(error)) {
        await this.markAccountDisconnected(account.id, account.externalAccountId);
        throw new EvolutionApiException(
          EVOLUTION_INSTANCE_NOT_FOUND_MESSAGE,
          HttpStatus.NOT_FOUND,
        );
      }
      await this.markAccountError(account.id);
      throw error;
    }
  }

  async getQrCode(userId: string, campaignId: string, channelAccountId: string) {
    const { campaign, account } = await this.getWritableEvolutionAccount(
      userId,
      campaignId,
      channelAccountId,
    );

    const instanceName = this.resolveInstanceName(account);

    try {
      const existing = await this.evolutionAdapter.findInstance(instanceName);
      if (!existing) {
        await this.markAccountDisconnected(account.id, account.externalAccountId);
        throw new EvolutionApiException(
          EVOLUTION_INSTANCE_NOT_FOUND_MESSAGE,
          HttpStatus.NOT_FOUND,
        );
      }

      const qrcode = await this.evolutionAdapter.getQrCode(existing.instanceName);

      const updated = await this.prisma.channelAccount.update({
        where: { id: account.id },
        data: {
          externalAccountId: existing.instanceName,
          status:
            account.status === ChannelAccountStatus.CONNECTED
              ? ChannelAccountStatus.CONNECTED
              : ChannelAccountStatus.CONNECTING,
        },
        select: channelAccountPublicSelect,
      });

      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'CHANNEL_EVOLUTION_QRCODE_REQUESTED',
        entityType: 'ChannelAccount',
        entityId: account.id,
        metadata: {
          instanceName: existing.instanceName,
          hasBase64: Boolean(qrcode.base64),
          hasCode: Boolean(qrcode.code),
          hasPairingCode: Boolean(qrcode.pairingCode),
        },
      });

      return {
        channelAccount: updated,
        evolution: {
          instanceName: existing.instanceName,
          qrcode: {
            base64: qrcode.base64 ?? null,
            code: qrcode.code ?? null,
            pairingCode: qrcode.pairingCode ?? null,
          },
        },
      };
    } catch (error) {
      if (this.isInstanceNotFoundError(error)) {
        await this.markAccountDisconnected(account.id, account.externalAccountId);
        throw new EvolutionApiException(
          EVOLUTION_INSTANCE_NOT_FOUND_MESSAGE,
          HttpStatus.NOT_FOUND,
        );
      }
      await this.markAccountError(account.id);
      throw error;
    }
  }

  private async getWritableEvolutionAccount(
    userId: string,
    campaignId: string,
    channelAccountId: string,
  ) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, organizationId: true },
    });

    if (!campaign) {
      throw new NotFoundException('Campanha nao encontrada');
    }

    await this.organizationAccess.requireWriteAccess(userId, campaign.organizationId);

    const account = await this.prisma.channelAccount.findFirst({
      where: {
        id: channelAccountId,
        organizationId: campaign.organizationId,
        campaignId,
      },
      select: channelAccountSelect,
    });

    if (!account) {
      throw new NotFoundException('Conta de canal nao encontrada');
    }

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
    config: Prisma.JsonValue | null;
  }) {
    if (account.externalAccountId?.trim()) {
      return this.sanitizeInstanceName(account.externalAccountId);
    }

    const config = this.asRecord(account.config);
    const fromConfig =
      typeof config?.instanceName === 'string' ? config.instanceName.trim() : '';
    if (fromConfig) {
      return this.sanitizeInstanceName(fromConfig);
    }

    return this.sanitizeInstanceName(account.name || account.id);
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

  private mapEvolutionStateToStatus(state?: string | null): ChannelAccountStatus | null {
    if (!state) return null;
    const normalized = state.trim().toLowerCase();

    if (['open', 'connected', 'authenticated'].includes(normalized)) {
      return ChannelAccountStatus.CONNECTED;
    }

    if (['connecting', 'pairing', 'qr', 'qrcode', 'timeout'].includes(normalized)) {
      return ChannelAccountStatus.CONNECTING;
    }

    if (['close', 'closed', 'disconnected', 'logout'].includes(normalized)) {
      return ChannelAccountStatus.DISCONNECTED;
    }

    if (['error', 'failed', 'conflict'].includes(normalized)) {
      return ChannelAccountStatus.ERROR;
    }

    return null;
  }

  private async markAccountDisconnected(
    channelAccountId: string,
    externalAccountId: string | null,
  ) {
    try {
      await this.prisma.channelAccount.update({
        where: { id: channelAccountId },
        data: {
          status: ChannelAccountStatus.DISCONNECTED,
          // Preserva o ID para permitir "preparar novamente" com o mesmo nome.
          externalAccountId,
        },
      });
    } catch {
      // Nao mascara o erro original.
    }
  }

  private async markAccountError(channelAccountId: string) {
    try {
      await this.prisma.channelAccount.update({
        where: { id: channelAccountId },
        data: { status: ChannelAccountStatus.ERROR },
      });
    } catch {
      // Nao mascara o erro original da Evolution.
    }
  }

  private isInstanceNotFoundError(error: unknown) {
    if (!(error instanceof EvolutionApiException)) {
      return false;
    }

    if (error.getStatus() === HttpStatus.NOT_FOUND) {
      return true;
    }

    const payload = error.getResponse();
    const message =
      typeof payload === 'string'
        ? payload
        : typeof payload === 'object' && payload && 'message' in payload
          ? String((payload as { message?: unknown }).message ?? '')
          : error.message;

    return (
      message.includes(EVOLUTION_INSTANCE_NOT_FOUND_MESSAGE) ||
      /instancia evolution nao encontrada/i.test(message)
    );
  }

  private asRecord(value: Prisma.JsonValue | null): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }
}
