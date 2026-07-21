import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  ChannelAccountStatus,
  ChannelProvider,
  ChannelType,
  ContactOperationalStatus,
  ContactStatus,
  DispatchPlanRecipientEligibilityStatus,
  DispatchPlanStatus,
} from '@prisma/client';
import { SnapshotContactInput } from './dispatch-plan-snapshot.util';
import { DispatchPlansService } from './dispatch-plans.service';

function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan-1',
    organizationId: 'org-1',
    campaignId: 'campaign-1',
    segmentId: 'segment-1',
    channelAccountId: 'channel-1',
    name: 'Plano',
    description: null,
    channelType: ChannelType.WHATSAPP,
    content: 'Mensagem',
    status: DispatchPlanStatus.DRAFT,
    version: 1,
    totalEvaluated: 0,
    totalEligible: 0,
    totalExcluded: 0,
    snapshotCreatedAt: null,
    filtersSnapshot: null,
    validationSnapshot: null,
    createdByUserId: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    segment: { id: 'segment-1', name: 'Segmento' },
    channelAccount: {
      id: 'channel-1',
      name: 'Evolution',
      provider: ChannelProvider.WHATSAPP_EVOLUTION,
      status: ChannelAccountStatus.CONNECTED,
    },
    createdBy: { id: 'user-1', name: 'Usuario', email: 'u@example.com' },
    ...overrides,
  };
}

function snapshotContact(id = 'contact-1'): SnapshotContactInput {
  return {
    id,
    name: 'Contato',
    phoneNumber: '62999990001',
    city: 'Goiania',
    neighborhood: 'Centro',
    metadata: { lastImportSource: 'csv' },
    status: ContactStatus.ACTIVE,
    operationalStatus: ContactOperationalStatus.NEW,
    assignedTo: null,
    channels: [{ channel: ChannelType.WHATSAPP, status: 'ACTIVE' }],
    consents: [],
    optOuts: [],
    tags: [],
  };
}

function createSnapshotHarness(options: {
  existingPlan?: ReturnType<typeof plan> | null;
  contacts?: ReturnType<typeof snapshotContact>[];
  failCreateMany?: boolean;
  denyWrite?: boolean;
  segmentFilters?: Record<string, unknown>;
} = {}) {
  const currentPlan =
    options.existingPlan === undefined ? plan() : options.existingPlan;
  let persistedRecipients: unknown[] = [{ id: 'old-recipient' }];
  const auditEvents: Array<Record<string, unknown>> = [];
  const transactionCalls: string[] = [];
  let updatedPlanData: Record<string, unknown> | null = null;
  const recipientQueries: Array<Record<string, unknown>> = [];
  let createdRecipientData: Array<Record<string, unknown>> = [];

  const tx = {
    dispatchPlan: {
      updateMany: async (args: { data: Record<string, unknown> }) => {
        transactionCalls.push('updatePlan');
        updatedPlanData = args.data;
        return { count: 1 };
      },
    },
    dispatchPlanRecipient: {
      deleteMany: async () => {
        transactionCalls.push('deleteRecipients');
        return { count: persistedRecipients.length };
      },
      createMany: async (args: { data: Array<Record<string, unknown>> }) => {
        transactionCalls.push('createRecipients');
        if (options.failCreateMany) throw new Error('createMany falhou');
        createdRecipientData = args.data;
        return { count: args.data.length };
      },
    },
  };

  const prisma = {
    campaign: {
      findUnique: async () => ({ id: 'campaign-1', organizationId: 'org-1' }),
    },
    dispatchPlan: {
      findFirst: async () => currentPlan,
    },
    segment: {
      findFirst: async () => ({
        id: 'segment-1',
        filters:
          options.segmentFilters ??
          {
            tagIds: ['tag-1'],
            includeOptOut: false,
            channel: 'WHATSAPP',
          },
      }),
    },
    channelAccount: {
      findFirst: async () => ({
        id: 'channel-1',
        provider: ChannelProvider.WHATSAPP_EVOLUTION,
        status: ChannelAccountStatus.CONNECTED,
      }),
    },
    contact: {
      findMany: async () => options.contacts ?? [snapshotContact()],
    },
    dispatchPlanRecipient: {
      findMany: async (args: Record<string, unknown>) => {
        recipientQueries.push(args);
        return [];
      },
      count: async () => 0,
      groupBy: async () => [],
    },
    $transaction: async (callback: (client: typeof tx) => Promise<void>) => {
      const previous = persistedRecipients;
      try {
        await callback(tx);
        persistedRecipients = options.failCreateMany
          ? previous
          : options.contacts ?? [snapshotContact()];
      } catch (error) {
        persistedRecipients = previous;
        throw error;
      }
    },
  };

  const access = {
    requireWriteAccess: async () => {
      if (options.denyWrite) {
        throw new ForbiddenException('Permissao insuficiente');
      }
      return {};
    },
    requireMembership: async () => ({}),
  };
  const audit = {
    log: async (event: Record<string, unknown>) => {
      auditEvents.push(event);
    },
  };

  return {
    service: new DispatchPlansService(
      prisma as never,
      access as never,
      audit as never,
    ),
    auditEvents,
    transactionCalls,
    recipientQueries,
    getUpdatedPlanData: () => updatedPlanData,
    getPersistedRecipients: () => persistedRecipients,
    getCreatedRecipientData: () => createdRecipientData,
  };
}

describe('DispatchPlansService snapshot', () => {
  it('gera snapshot DRAFT, persiste recipients, filtros e totais', async () => {
    const harness = createSnapshotHarness({
      contacts: [
        snapshotContact('contact-1'),
        {
          ...snapshotContact('contact-2'),
          phoneNumber: null,
          channels: [],
        },
      ],
    });

    const result = await harness.service.generateSnapshot(
      'user-1',
      'campaign-1',
      'plan-1',
    );

    assert.equal(result.totalEvaluated, 2);
    assert.equal(result.totalEligible, 1);
    assert.equal(result.totalExcluded, 1);
    assert.equal(result.version, 2);
    assert.deepEqual(harness.transactionCalls, [
      'updatePlan',
      'deleteRecipients',
      'createRecipients',
    ]);
    assert.deepEqual(harness.getUpdatedPlanData()?.filtersSnapshot, {
      tagIds: ['tag-1'],
      status: null,
      includeOptOut: false,
      channel: 'WHATSAPP',
    });
    assert.equal(
      harness.auditEvents[0]?.action,
      'DISPATCH_PLAN_SNAPSHOT_CREATED',
    );
    assert.equal(
      harness.getCreatedRecipientData()[0]?.eligibilityStatus,
      DispatchPlanRecipientEligibilityStatus.ELIGIBLE,
    );
    assert.equal(
      harness.getCreatedRecipientData()[1]?.eligibilityStatus,
      DispatchPlanRecipientEligibilityStatus.EXCLUDED_INVALID_DESTINATION,
    );
  });

  it('filtersSnapshot nao muda quando o segmento e alterado depois', async () => {
    const savedFilters = {
      tagIds: ['tag-original'],
      includeOptOut: false,
      channel: 'WHATSAPP',
    };
    const harness = createSnapshotHarness({ segmentFilters: savedFilters });

    await harness.service.generateSnapshot(
      'user-1',
      'campaign-1',
      'plan-1',
    );
    savedFilters.tagIds = ['tag-alterada'];

    assert.deepEqual(harness.getUpdatedPlanData()?.filtersSnapshot, {
      tagIds: ['tag-original'],
      status: null,
      includeOptOut: false,
      channel: 'WHATSAPP',
    });
  });

  it('regenera em DRAFT, incrementa versao e registra evento especifico', async () => {
    const harness = createSnapshotHarness({
      existingPlan: plan({
        version: 3,
        snapshotCreatedAt: new Date('2026-07-20T00:00:00.000Z'),
      }),
    });

    const result = await harness.service.generateSnapshot(
      'user-1',
      'campaign-1',
      'plan-1',
    );

    assert.equal(result.version, 4);
    assert.equal(result.regenerated, true);
    assert.equal(
      harness.auditEvents[0]?.action,
      'DISPATCH_PLAN_SNAPSHOT_REGENERATED',
    );
  });

  it('mantem recipients anteriores quando a substituicao falha', async () => {
    const harness = createSnapshotHarness({ failCreateMany: true });
    const before = harness.getPersistedRecipients();

    await assert.rejects(
      harness.service.generateSnapshot('user-1', 'campaign-1', 'plan-1'),
      /createMany falhou/,
    );

    assert.deepEqual(harness.getPersistedRecipients(), before);
    assert.equal(harness.auditEvents.length, 0);
  });

  it('VIEWER nao gera snapshot', async () => {
    const harness = createSnapshotHarness({ denyWrite: true });
    await assert.rejects(
      harness.service.generateSnapshot('viewer-1', 'campaign-1', 'plan-1'),
      ForbiddenException,
    );
    assert.equal(harness.transactionCalls.length, 0);
  });

  it('plano CANCELED nao gera snapshot', async () => {
    const harness = createSnapshotHarness({
      existingPlan: plan({ status: DispatchPlanStatus.CANCELED }),
    });
    await assert.rejects(
      harness.service.generateSnapshot('user-1', 'campaign-1', 'plan-1'),
      BadRequestException,
    );
    assert.equal(harness.transactionCalls.length, 0);
  });

  it('plano fora da campanha e rejeitado', async () => {
    const harness = createSnapshotHarness({ existingPlan: null });
    await assert.rejects(
      harness.service.generateSnapshot('user-1', 'campaign-1', 'other-plan'),
      NotFoundException,
    );
  });

  it('lista recipients com paginacao e filtro de elegibilidade', async () => {
    const harness = createSnapshotHarness();
    const result = await harness.service.listRecipients(
      'user-1',
      'campaign-1',
      'plan-1',
      {
        page: 2,
        limit: 10,
        eligibilityStatus:
          DispatchPlanRecipientEligibilityStatus.EXCLUDED_OPT_OUT,
      },
    );

    assert.equal(result.pagination.page, 2);
    assert.equal(result.pagination.limit, 10);
    const query = harness.recipientQueries[0] as {
      skip: number;
      take: number;
      where: { eligibilityStatus: string };
    };
    assert.equal(query.skip, 10);
    assert.equal(query.take, 10);
    assert.equal(
      query.where.eligibilityStatus,
      DispatchPlanRecipientEligibilityStatus.EXCLUDED_OPT_OUT,
    );
  });

  it('nao depende de Evolution, BullMQ, Worker ou envio de mensagens', async () => {
    const harness = createSnapshotHarness();
    const result = await harness.service.generateSnapshot(
      'user-1',
      'campaign-1',
      'plan-1',
    );
    assert.equal(result.totalEvaluated, 1);
    assert.equal(result.totalEligible, 1);
  });
});
