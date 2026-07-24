import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MembershipRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HARD_RESET_CONFIRMATION } from './dto/hard-reset.dto';

const TRUTHY = new Set(['true', '1', 'yes', 'on']);

export type HardResetCounts = {
  organizations: number;
  campaigns: number;
  contacts: number;
  channelAccounts: number;
  conversationThreads: number;
  messages: number;
  dispatchPlans: number;
  dispatches: number;
  dispatchItems: number;
  segments: number;
  tags: number;
  auditLogs: number;
};

/**
 * Hard reset de homologacao: apaga organizacoes em que o usuario e OWNER
 * e todo o conteudo operacional (campanhas, contatos, inbox, canais,
 * planos, disparos). Mantem o User para permitir novo login limpo.
 *
 * Nao toca Evolution (instancias remotas). Nao reativa envio de Dispatch.
 */
@Injectable()
export class HardResetService {
  private readonly logger = new Logger(HardResetService.name);

  constructor(private readonly prisma: PrismaService) {}

  assertHardResetAllowed(): void {
    const raw = (process.env.HARD_RESET_ENABLED || '').trim().toLowerCase();
    const enabled =
      raw === ''
        ? process.env.NODE_ENV !== 'production'
        : TRUTHY.has(raw);

    if (!enabled) {
      throw new ServiceUnavailableException(
        'Hard reset desabilitado (defina HARD_RESET_ENABLED=true no ambiente)',
      );
    }
  }

  async hardResetOwnedData(userId: string, confirmation: string) {
    this.assertHardResetAllowed();

    if (confirmation.trim() !== HARD_RESET_CONFIRMATION) {
      throw new ForbiddenException(
        `Confirmacao invalida. Digite exatamente: ${HARD_RESET_CONFIRMATION}`,
      );
    }

    const owned = await this.prisma.membership.findMany({
      where: { userId, role: MembershipRole.OWNER },
      select: { organizationId: true },
    });

    const organizationIds = [...new Set(owned.map((row) => row.organizationId))];

    if (organizationIds.length === 0) {
      return {
        ok: true as const,
        confirmationRequired: HARD_RESET_CONFIRMATION,
        organizationsReset: 0,
        counts: emptyCounts(),
        message:
          'Nenhuma organizacao com papel OWNER para apagar. Conta de usuario preservada.',
      };
    }

    const counts = await this.prisma.$transaction(
      async (tx) => this.wipeOrganizations(tx, organizationIds),
      { timeout: 120_000 },
    );

    this.logger.warn(
      `HARD_RESET userId=${userId} orgs=${organizationIds.length} campaigns=${counts.campaigns} contacts=${counts.contacts} dispatches=${counts.dispatches}`,
    );

    return {
      ok: true as const,
      confirmationRequired: HARD_RESET_CONFIRMATION,
      organizationsReset: counts.organizations,
      organizationIds,
      counts,
      message:
        'Dados de teste apagados. Conta de usuario preservada. Crie uma nova organizacao para recomecar do zero.',
    };
  }

  private async wipeOrganizations(
    tx: Prisma.TransactionClient,
    organizationIds: string[],
  ): Promise<HardResetCounts> {
    const whereOrg = { organizationId: { in: organizationIds } };

    const [
      dispatchItems,
      usageDaily,
      dispatchChannels,
      dispatches,
      planRecipients,
      planChannels,
      dispatchPlans,
      messages,
      threads,
      contactNotes,
      contactTasks,
      contactChannels,
      consents,
      optOuts,
      contacts,
      tags,
      segments,
      channelAccounts,
      candidates,
      campaigns,
      auditLogs,
    ] = await Promise.all([
      tx.dispatchItem.count({ where: whereOrg }),
      tx.dispatchChannelUsageDaily.count({ where: whereOrg }),
      tx.dispatchChannel.count({ where: whereOrg }),
      tx.dispatch.count({ where: whereOrg }),
      tx.dispatchPlanRecipient.count({ where: whereOrg }),
      tx.dispatchPlanChannel.count({ where: whereOrg }),
      tx.dispatchPlan.count({ where: whereOrg }),
      tx.message.count({ where: whereOrg }),
      tx.conversationThread.count({ where: whereOrg }),
      tx.contactNote.count({ where: whereOrg }),
      tx.contactTask.count({ where: whereOrg }),
      tx.contactChannel.count({ where: whereOrg }),
      tx.consent.count({ where: whereOrg }),
      tx.optOut.count({ where: whereOrg }),
      tx.contact.count({ where: whereOrg }),
      tx.tag.count({ where: whereOrg }),
      tx.segment.count({ where: whereOrg }),
      tx.channelAccount.count({ where: whereOrg }),
      tx.candidate.count({ where: whereOrg }),
      tx.campaign.count({ where: { organizationId: { in: organizationIds } } }),
      tx.auditLog.count({ where: whereOrg }),
    ]);

    // Ordem respeita FKs (filhos antes dos pais).
    await tx.dispatchItem.deleteMany({ where: whereOrg });
    await tx.dispatchChannelUsageDaily.deleteMany({ where: whereOrg });
    await tx.dispatchChannel.deleteMany({ where: whereOrg });
    await tx.dispatch.deleteMany({ where: whereOrg });
    await tx.dispatchPlanRecipient.deleteMany({ where: whereOrg });
    await tx.dispatchPlanChannel.deleteMany({ where: whereOrg });
    await tx.dispatchPlan.deleteMany({ where: whereOrg });

    await tx.message.deleteMany({ where: whereOrg });
    await tx.conversationThread.deleteMany({ where: whereOrg });

    const contactIds = (
      await tx.contact.findMany({
        where: whereOrg,
        select: { id: true },
      })
    ).map((row) => row.id);

    if (contactIds.length > 0) {
      await tx.contactTag.deleteMany({
        where: { contactId: { in: contactIds } },
      });
    }

    await tx.contactNote.deleteMany({ where: whereOrg });
    await tx.contactTask.deleteMany({ where: whereOrg });
    await tx.contactChannel.deleteMany({ where: whereOrg });
    await tx.consent.deleteMany({ where: whereOrg });
    await tx.optOut.deleteMany({ where: whereOrg });
    await tx.contact.deleteMany({ where: whereOrg });
    await tx.tag.deleteMany({ where: whereOrg });
    await tx.segment.deleteMany({ where: whereOrg });
    await tx.channelAccount.deleteMany({ where: whereOrg });
    await tx.candidate.deleteMany({ where: whereOrg });
    await tx.campaign.deleteMany({
      where: { organizationId: { in: organizationIds } },
    });

    await tx.auditLog.deleteMany({ where: whereOrg });
    await tx.membership.deleteMany({
      where: { organizationId: { in: organizationIds } },
    });
    const deletedOrgs = await tx.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });

    return {
      organizations: deletedOrgs.count,
      campaigns,
      contacts,
      channelAccounts,
      conversationThreads: threads,
      messages,
      dispatchPlans,
      dispatches,
      dispatchItems,
      segments,
      tags,
      auditLogs,
    };
  }
}

function emptyCounts(): HardResetCounts {
  return {
    organizations: 0,
    campaigns: 0,
    contacts: 0,
    channelAccounts: 0,
    conversationThreads: 0,
    messages: 0,
    dispatchPlans: 0,
    dispatches: 0,
    dispatchItems: 0,
    segments: 0,
    tags: 0,
    auditLogs: 0,
  };
}
