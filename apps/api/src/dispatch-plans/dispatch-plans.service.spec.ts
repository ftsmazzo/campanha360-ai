import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  CampaignStatus,
  ChannelAccountStatus,
  ChannelProvider,
  ChannelType,
  ContactOperationalStatus,
  ContactStatus,
  DispatchPlanRecipientEligibilityStatus,
  DispatchPlanStatus,
  MembershipRole,
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
    validatedAt: null,
    validatedVersion: null,
    simulationSnapshot: null,
    simulatedAt: null,
    simulatedVersion: null,
    approvedByUserId: null,
    approvedAt: null,
    approvalSnapshot: null,
    rejectedByUserId: null,
    rejectedAt: null,
    rejectionReason: null,
    canceledByUserId: null,
    canceledAt: null,
    cancellationReason: null,
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
    approvedBy: null,
    rejectedBy: null,
    canceledBy: null,
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


function mockEnabledPlanChannelRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "plan-channel-1",
    dispatchPlanId: "plan-1",
    channelAccountId: "channel-1",
    enabled: true,
    priority: 10,
    weight: 100,
    dailyLimit: 5000,
    hourlyLimit: 500,
    newAccountDailyLimit: 200,
    warmupDailyLimit: 1000,
    assignedRecipients: 0,
    assignedCapacity: 0,
    channelAccount: {
      id: "channel-1",
      name: "Evolution",
      provider: ChannelProvider.WHATSAPP_EVOLUTION,
      status: ChannelAccountStatus.CONNECTED,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    ...overrides,
  };
}

function mockEnabledPlanChannels() {
  return [mockEnabledPlanChannelRow()];
}

function mockDispatchPlanChannelModel() {
  return {
    findMany: async () => mockEnabledPlanChannels(),
    update: async () => mockEnabledPlanChannelRow(),
    deleteMany: async () => ({ count: 0 }),
    createMany: async () => ({ count: 1 }),
    updateMany: async () => ({ count: 1 }),
  };
}

function attachPrismaTransaction(
  prisma: Record<string, unknown>,
  txOverrides: Record<string, unknown> = {},
) {
  prisma.$transaction = async (
    callback: (tx: Record<string, unknown>) => Promise<unknown>,
  ) => {
    const tx = {
      dispatchPlanChannel: mockDispatchPlanChannelModel(),
      dispatchPlan: prisma.dispatchPlan,
      ...txOverrides,
    };
    return callback(tx);
  };
  return prisma;
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
      findUnique: async () => ({
        id: 'campaign-1',
        organizationId: 'org-1',
        status: CampaignStatus.ACTIVE,
      }),
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

function createValidationHarness(options: {
  existingPlan?: ReturnType<typeof plan> | null;
  denyWrite?: boolean;
  channel?: {
    id: string;
    campaignId: string;
    provider: ChannelProvider;
    status: ChannelAccountStatus;
  } | null;
  segment?: { id: string; campaignId: string } | null;
  lockCount?: number;
  persistCount?: number;
  throwDuringFacts?: boolean;
  recipientCount?: number;
  eligibleCount?: number;
  eligibleOptOutCount?: number;
  eligibleBlockedCount?: number;
  eligibleDeletedCount?: number;
  eligibleInvalidDestinationCount?: number;
  duplicateGroups?: Array<{ normalizedDestination: string; _count: { _all: number } }>;
  campaignStatus?: CampaignStatus;
} = {}) {
  const currentPlan =
    options.existingPlan === undefined
      ? plan({
          snapshotCreatedAt: new Date('2026-07-21T10:00:00.000Z'),
          totalEvaluated: 2,
          totalEligible: 2,
          totalExcluded: 0,
          version: 2,
        })
      : options.existingPlan;

  let status: DispatchPlanStatus =
    (currentPlan?.status as DispatchPlanStatus | undefined) ??
    DispatchPlanStatus.DRAFT;
  let validationSnapshot: unknown = currentPlan?.validationSnapshot ?? null;
  let validatedAt: Date | null =
    (currentPlan?.validatedAt as Date | null | undefined) ?? null;
  let validatedVersion: number | null =
    (currentPlan?.validatedVersion as number | null | undefined) ?? null;
  const auditEvents: Array<Record<string, unknown>> = [];
  const updateManyCalls: Array<Record<string, unknown>> = [];
  let lockAttempts = 0;

  const channel =
    options.channel === undefined
      ? {
          id: 'channel-1',
          campaignId: 'campaign-1',
          provider: ChannelProvider.WHATSAPP_EVOLUTION,
          status: ChannelAccountStatus.CONNECTED,
        }
      : options.channel;
  const segment =
    options.segment === undefined
      ? { id: 'segment-1', campaignId: 'campaign-1' }
      : options.segment;

  const eligibleCount = options.eligibleCount ?? options.recipientCount ?? 2;
  const recipientCount = options.recipientCount ?? eligibleCount;

  const prisma = {
    campaign: {
      findUnique: async () => ({
        id: 'campaign-1',
        organizationId: 'org-1',
        status: options.campaignStatus ?? CampaignStatus.ACTIVE,
      }),
    },
    dispatchPlan: {
      findFirst: async () => {
        if (!currentPlan) return null;
        return {
          ...currentPlan,
          status,
          validationSnapshot,
          validatedAt,
          validatedVersion,
        };
      },
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        updateManyCalls.push(args);
        const nextStatus = args.data.status as DispatchPlanStatus | undefined;

        if (nextStatus === DispatchPlanStatus.VALIDATING) {
          lockAttempts += 1;
          const count = options.lockCount ?? (lockAttempts === 1 ? 1 : 0);
          if (count === 1) {
            status = DispatchPlanStatus.VALIDATING;
          }
          return { count };
        }

        if (
          nextStatus === DispatchPlanStatus.VALIDATED ||
          nextStatus === DispatchPlanStatus.BLOCKED
        ) {
          const count = options.persistCount ?? 1;
          if (count === 1) {
            status = nextStatus;
            validationSnapshot = args.data.validationSnapshot;
            validatedAt = (args.data.validatedAt as Date) ?? null;
            validatedVersion =
              (args.data.validatedVersion as number | null) ?? null;
          }
          return { count };
        }

        if (nextStatus === DispatchPlanStatus.DRAFT) {
          if (
            args.where.status === DispatchPlanStatus.VALIDATING ||
            (typeof args.where.status === 'object' &&
              args.where.status !== null)
          ) {
            if (status === DispatchPlanStatus.VALIDATING) {
              status = DispatchPlanStatus.DRAFT;
              return { count: 1 };
            }
            if (
              status === DispatchPlanStatus.VALIDATED ||
              status === DispatchPlanStatus.BLOCKED
            ) {
              status = DispatchPlanStatus.DRAFT;
              validationSnapshot = null;
              validatedAt = null;
              validatedVersion = null;
              return { count: 1 };
            }
          }
          if (status === DispatchPlanStatus.VALIDATING) {
            status = DispatchPlanStatus.DRAFT;
            return { count: 1 };
          }
          status = DispatchPlanStatus.DRAFT;
          validationSnapshot =
            args.data.validationSnapshot === undefined
              ? validationSnapshot
              : null;
          validatedAt =
            args.data.validatedAt === undefined
              ? validatedAt
              : (args.data.validatedAt as Date | null);
          validatedVersion =
            args.data.validatedVersion === undefined
              ? validatedVersion
              : (args.data.validatedVersion as number | null);
          return { count: 1 };
        }

        return { count: 1 };
      },
      update: async (args: { data: Record<string, unknown> }) => {
        if (args.data.status) status = args.data.status as DispatchPlanStatus;
        if ('validationSnapshot' in args.data) {
          validationSnapshot = null;
        }
        if ('validatedAt' in args.data) {
          validatedAt = null;
        }
        if ('validatedVersion' in args.data) {
          validatedVersion = null;
        }
        if (typeof args.data.version === 'number') {
          if (currentPlan) currentPlan.version = args.data.version;
        }
        if (typeof args.data.content === 'string' && currentPlan) {
          currentPlan.content = args.data.content;
        }
        return {
          ...currentPlan,
          status,
          validationSnapshot,
          validatedAt,
          validatedVersion,
          version: currentPlan?.version,
          content: currentPlan?.content,
          segmentId:
            (args.data.segmentId as string | undefined) ?? currentPlan?.segmentId,
          channelAccountId:
            (args.data.channelAccountId as string | undefined) ??
            currentPlan?.channelAccountId,
        };
      },
    },
    segment: {
      findFirst: async () => segment,
    },
    channelAccount: {
      findFirst: async () => channel,
    },
    dispatchPlanRecipient: {
      count: async (args: { where: Record<string, unknown> }) => {
        if (options.throwDuringFacts) {
          throw new Error('falha tecnica inesperada');
        }
        const where = args.where;
        if (where.optOutSnapshot) return options.eligibleOptOutCount ?? 0;
        if (
          where.contact &&
          typeof where.contact === 'object' &&
          (where.contact as { status?: string }).status === ContactStatus.BLOCKED
        ) {
          return options.eligibleBlockedCount ?? 0;
        }
        if (
          where.contact &&
          typeof where.contact === 'object' &&
          (where.contact as { status?: string }).status === ContactStatus.DELETED
        ) {
          return options.eligibleDeletedCount ?? 0;
        }
        if (where.OR) return options.eligibleInvalidDestinationCount ?? 0;
        return recipientCount;
      },
      groupBy: async (args: { by: string[] }) => {
        if (args.by.includes('normalizedDestination')) {
          return options.duplicateGroups ?? [];
        }
        return [
          {
            eligibilityStatus: DispatchPlanRecipientEligibilityStatus.ELIGIBLE,
            _count: { _all: eligibleCount },
          },
        ];
      },
    },
    dispatchPlanChannel: mockDispatchPlanChannelModel(),
  };

  attachPrismaTransaction(prisma as Record<string, unknown>);

  const access = {
    requireWriteAccess: async () => {
      if (options.denyWrite) {
        throw new ForbiddenException('Permissao insuficiente');
      }
      return { role: 'MANAGER' };
    },
    requireMembership: async () => ({ role: 'MANAGER' }),
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
    updateManyCalls,
    getStatus: () => status,
    getValidationSnapshot: () => validationSnapshot,
    getValidatedVersion: () => validatedVersion,
  };
}

describe('DispatchPlansService validation 08.3', () => {
  it('DRAFT inicia validacao e passa para VALIDATED sem errors', async () => {
    const harness = createValidationHarness();
    const result = await harness.service.validate(
      'user-1',
      'campaign-1',
      'plan-1',
    );

    assert.equal(result.status, DispatchPlanStatus.VALIDATED);
    assert.equal(result.passed, true);
    assert.equal(result.validatedVersion, 2);
    assert.equal(harness.getStatus(), DispatchPlanStatus.VALIDATED);
    assert.equal(
      harness.auditEvents.some(
        (event) => event.action === 'DISPATCH_PLAN_VALIDATION_STARTED',
      ),
      true,
    );
    assert.equal(
      harness.auditEvents.some(
        (event) => event.action === 'DISPATCH_PLAN_VALIDATED',
      ),
      true,
    );
  });

  it('passa para BLOCKED quando ha errors criticos', async () => {
    const harness = createValidationHarness({
      existingPlan: plan({
        snapshotCreatedAt: null,
        totalEvaluated: 0,
        totalEligible: 0,
        totalExcluded: 0,
        version: 1,
      }),
      recipientCount: 0,
      eligibleCount: 0,
    });

    const result = await harness.service.validate(
      'user-1',
      'campaign-1',
      'plan-1',
    );

    assert.equal(result.status, DispatchPlanStatus.BLOCKED);
    assert.equal(result.passed, false);
    assert.equal(
      harness.auditEvents.some(
        (event) => event.action === 'DISPATCH_PLAN_BLOCKED',
      ),
      true,
    );
  });

  it('falha inesperada nao deixa VALIDATING', async () => {
    const harness = createValidationHarness({ throwDuringFacts: true });

    await assert.rejects(
      harness.service.validate('user-1', 'campaign-1', 'plan-1'),
      /falha tecnica inesperada/,
    );
    assert.equal(harness.getStatus(), DispatchPlanStatus.DRAFT);
  });

  it('CANCELED e VALIDATED nao validam diretamente', async () => {
    await assert.rejects(
      createValidationHarness({
        existingPlan: plan({ status: DispatchPlanStatus.CANCELED }),
      }).service.validate('user-1', 'campaign-1', 'plan-1'),
      BadRequestException,
    );
    await assert.rejects(
      createValidationHarness({
        existingPlan: plan({ status: DispatchPlanStatus.VALIDATED }),
      }).service.validate('user-1', 'campaign-1', 'plan-1'),
      BadRequestException,
    );
  });

  it('duas validacoes simultaneas sao bloqueadas', async () => {
    const harness = createValidationHarness({ lockCount: 0 });
    await assert.rejects(
      harness.service.validate('user-1', 'campaign-1', 'plan-1'),
      ConflictException,
    );
  });

  it('canal desconectado ou de outra campanha bloqueia', async () => {
    const disconnected = await createValidationHarness({
      channel: {
        id: 'channel-1',
        campaignId: 'campaign-1',
        provider: ChannelProvider.WHATSAPP_EVOLUTION,
        status: ChannelAccountStatus.DISCONNECTED,
      },
    }).service.validate('user-1', 'campaign-1', 'plan-1');
    assert.equal(disconnected.status, DispatchPlanStatus.BLOCKED);

    const otherCampaign = await createValidationHarness({
      channel: {
        id: 'channel-1',
        campaignId: 'other-campaign',
        provider: ChannelProvider.WHATSAPP_EVOLUTION,
        status: ChannelAccountStatus.CONNECTED,
      },
    }).service.validate('user-1', 'campaign-1', 'plan-1');
    assert.equal(otherCampaign.status, DispatchPlanStatus.BLOCKED);
  });

  it('conteudo vazio bloqueia e valido passa', async () => {
    const empty = await createValidationHarness({
      existingPlan: plan({
        content: '',
        snapshotCreatedAt: new Date(),
        totalEvaluated: 1,
        totalEligible: 1,
        totalExcluded: 0,
        version: 1,
      }),
      recipientCount: 1,
      eligibleCount: 1,
    }).service.validate('user-1', 'campaign-1', 'plan-1');
    assert.equal(empty.status, DispatchPlanStatus.BLOCKED);

    const ok = await createValidationHarness().service.validate(
      'user-1',
      'campaign-1',
      'plan-1',
    );
    assert.equal(ok.status, DispatchPlanStatus.VALIDATED);
  });

  it('VIEWER nao valida e plano de outra campanha e rejeitado', async () => {
    await assert.rejects(
      createValidationHarness({ denyWrite: true }).service.validate(
        'viewer-1',
        'campaign-1',
        'plan-1',
      ),
      ForbiddenException,
    );
    await assert.rejects(
      createValidationHarness({ existingPlan: null }).service.validate(
        'user-1',
        'campaign-1',
        'missing',
      ),
      NotFoundException,
    );
  });

  it('reabrir VALIDATED e BLOCKED volta para DRAFT e limpa validacao', async () => {
    const validated = createValidationHarness({
      existingPlan: plan({
        status: DispatchPlanStatus.VALIDATED,
        validationSnapshot: { passed: true },
        validatedAt: new Date(),
        validatedVersion: 2,
        version: 2,
      }),
    });
    const reopened = await validated.service.reopen(
      'user-1',
      'campaign-1',
      'plan-1',
    );
    assert.equal(reopened.status, DispatchPlanStatus.DRAFT);
    assert.equal(reopened.validationSnapshot, null);
    assert.equal(reopened.validatedAt, null);
    assert.equal(reopened.validatedVersion, null);
    assert.equal(
      validated.auditEvents.some(
        (event) => event.action === 'DISPATCH_PLAN_REOPENED',
      ),
      true,
    );

    const blocked = createValidationHarness({
      existingPlan: plan({
        status: DispatchPlanStatus.BLOCKED,
        validationSnapshot: { passed: false },
        validatedAt: new Date(),
        validatedVersion: 1,
      }),
    });
    const reopenedBlocked = await blocked.service.reopen(
      'user-1',
      'campaign-1',
      'plan-1',
    );
    assert.equal(reopenedBlocked.status, DispatchPlanStatus.DRAFT);
  });

  it('APPROVED e CANCELED nao reabrem', async () => {
    await assert.rejects(
      createValidationHarness({
        existingPlan: plan({ status: DispatchPlanStatus.APPROVED }),
      }).service.reopen('user-1', 'campaign-1', 'plan-1'),
      BadRequestException,
    );
    await assert.rejects(
      createValidationHarness({
        existingPlan: plan({ status: DispatchPlanStatus.CANCELED }),
      }).service.reopen('user-1', 'campaign-1', 'plan-1'),
      BadRequestException,
    );
  });

  it('metadata de audit nao contem conteudo ou telefones', async () => {
    const harness = createValidationHarness();
    await harness.service.validate('user-1', 'campaign-1', 'plan-1');
    const validatedEvent = harness.auditEvents.find(
      (event) => event.action === 'DISPATCH_PLAN_VALIDATED',
    );
    const metadata = validatedEvent?.metadata as Record<string, unknown>;
    assert.ok(metadata);
    assert.equal('content' in metadata, false);
    assert.equal('destination' in metadata, false);
    assert.equal('phoneNumber' in metadata, false);
    assert.equal(typeof metadata.errorCount, 'number');
    assert.equal(metadata.finalStatus, DispatchPlanStatus.VALIDATED);
  });

  it('opt-out ELIGIBLE e destino duplicado bloqueiam', async () => {
    const optOut = await createValidationHarness({
      eligibleOptOutCount: 1,
    }).service.validate('user-1', 'campaign-1', 'plan-1');
    assert.equal(optOut.status, DispatchPlanStatus.BLOCKED);

    const duplicates = await createValidationHarness({
      duplicateGroups: [
        { normalizedDestination: '5562999990001', _count: { _all: 2 } },
      ],
    }).service.validate('user-1', 'campaign-1', 'plan-1');
    assert.equal(duplicates.status, DispatchPlanStatus.BLOCKED);
  });

  it('editar BLOCKED limpa validacao e volta para DRAFT', async () => {
    const harness = createValidationHarness({
      existingPlan: plan({
        status: DispatchPlanStatus.BLOCKED,
        validationSnapshot: { passed: false },
        validatedAt: new Date(),
        validatedVersion: 2,
        version: 2,
        content: 'Antigo',
        snapshotCreatedAt: new Date(),
        totalEvaluated: 1,
        totalEligible: 1,
        totalExcluded: 0,
      }),
    });

    const updated = await harness.service.update(
      'user-1',
      'campaign-1',
      'plan-1',
      { content: 'Novo conteudo' },
    );

    assert.equal(updated.status, DispatchPlanStatus.DRAFT);
    assert.equal(updated.validationSnapshot, null);
    assert.equal(updated.validatedAt, null);
    assert.equal(updated.validatedVersion, null);
    assert.equal(updated.version, 3);
  });
});

function validatedPlan(overrides: Record<string, unknown> = {}) {
  return plan({
    status: DispatchPlanStatus.VALIDATED,
    version: 3,
    snapshotCreatedAt: new Date('2026-07-21T10:00:00.000Z'),
    totalEvaluated: 40,
    totalEligible: 40,
    totalExcluded: 0,
    validationSnapshot: { passed: true, summary: { errors: 0 } },
    validatedAt: new Date('2026-07-21T11:00:00.000Z'),
    validatedVersion: 3,
    simulationSnapshot: null,
    simulatedAt: null,
    simulatedVersion: null,
    ...overrides,
  });
}

function createSimulationHarness(options: {
  existingPlan?: ReturnType<typeof plan> | null;
  denyWrite?: boolean;
  persistCount?: number;
  channelMissing?: boolean;
} = {}) {
  const currentPlan =
    options.existingPlan === undefined ? validatedPlan() : options.existingPlan;

  let status = (currentPlan?.status as DispatchPlanStatus) ?? DispatchPlanStatus.VALIDATED;
  let version = currentPlan?.version ?? 3;
  let simulationSnapshot: unknown = currentPlan?.simulationSnapshot ?? null;
  let simulatedAt: Date | null =
    (currentPlan?.simulatedAt as Date | null | undefined) ?? null;
  let simulatedVersion: number | null =
    (currentPlan?.simulatedVersion as number | null | undefined) ?? null;
  let validationSnapshot: unknown = currentPlan?.validationSnapshot ?? null;
  let validatedAt: Date | null =
    (currentPlan?.validatedAt as Date | null | undefined) ?? null;
  let validatedVersion: number | null =
    (currentPlan?.validatedVersion as number | null | undefined) ?? null;

  const auditEvents: Array<Record<string, unknown>> = [];

  const prisma = {
    campaign: {
      findUnique: async () => ({
        id: 'campaign-1',
        organizationId: 'org-1',
        status: CampaignStatus.ACTIVE,
      }),
    },
    dispatchPlan: {
      findFirst: async () => {
        if (!currentPlan) return null;
        return {
          ...currentPlan,
          status,
          version,
          simulationSnapshot,
          simulatedAt,
          simulatedVersion,
          validationSnapshot,
          validatedAt,
          validatedVersion,
        };
      },
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        if (args.data.status === DispatchPlanStatus.DRAFT) {
          status = DispatchPlanStatus.DRAFT;
          validationSnapshot = null;
          validatedAt = null;
          validatedVersion = null;
          simulationSnapshot = null;
          simulatedAt = null;
          simulatedVersion = null;
          return { count: 1 };
        }

        const count = options.persistCount ?? 1;
        if (count === 1) {
          simulationSnapshot = args.data.simulationSnapshot;
          simulatedAt = (args.data.simulatedAt as Date) ?? null;
          simulatedVersion =
            (args.data.simulatedVersion as number | null) ?? null;
        }
        return { count };
      },
      update: async (args: { data: Record<string, unknown> }) => {
        if (args.data.status) status = args.data.status as DispatchPlanStatus;
        if ('simulationSnapshot' in args.data) {
          simulationSnapshot = null;
          simulatedAt = null;
          simulatedVersion = null;
        }
        if ('validationSnapshot' in args.data) {
          validationSnapshot = null;
          validatedAt = null;
          validatedVersion = null;
        }
        if (typeof args.data.version === 'number') version = args.data.version;
        if (typeof args.data.content === 'string' && currentPlan) {
          currentPlan.content = args.data.content;
        }
        return {
          ...currentPlan,
          status,
          version,
          simulationSnapshot,
          simulatedAt,
          simulatedVersion,
          validationSnapshot,
          validatedAt,
          validatedVersion,
          content: currentPlan?.content,
        };
      },
    },
    channelAccount: {
      findFirst: async () =>
        options.channelMissing
          ? null
          : {
              id: 'channel-1',
              campaignId: 'campaign-1',
              provider: ChannelProvider.WHATSAPP_EVOLUTION,
              status: ChannelAccountStatus.CONNECTED,
            },
    },
    segment: {
      findFirst: async () => ({ id: 'segment-1', campaignId: 'campaign-1' }),
    },
    dispatchPlanRecipient: {
      count: async () => 0,
      groupBy: async () => [],
    },
    dispatchPlanChannel: mockDispatchPlanChannelModel(),
  };

  attachPrismaTransaction(prisma as Record<string, unknown>);

  const access = {
    requireWriteAccess: async () => {
      if (options.denyWrite) {
        throw new ForbiddenException('Permissao insuficiente');
      }
      return { role: 'MANAGER' };
    },
    requireMembership: async () => ({ role: 'MANAGER' }),
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
    getSimulationSnapshot: () => simulationSnapshot,
    getSimulatedVersion: () => simulatedVersion,
    getVersion: () => version,
    getStatus: () => status,
  };
}

describe('DispatchPlansService simulation 08.4', () => {
  it('VALIDATED gera simulacao sem incrementar version', async () => {
    const harness = createSimulationHarness();
    const result = await harness.service.simulate(
      'user-1',
      'campaign-1',
      'plan-1',
      { messagesPerMinute: 4 },
    );

    assert.equal(result.version, 3);
    assert.equal(result.simulatedVersion, 3);
    assert.equal(result.recalculated, false);
    assert.ok(result.simulationSnapshot);
    assert.equal(
      harness.auditEvents[0]?.action,
      'DISPATCH_PLAN_SIMULATED',
    );
  });

  it('DRAFT, BLOCKED e CANCELED nao geram simulacao', async () => {
    await assert.rejects(
      createSimulationHarness({
        existingPlan: validatedPlan({ status: DispatchPlanStatus.DRAFT }),
      }).service.simulate('user-1', 'campaign-1', 'plan-1', {}),
      BadRequestException,
    );
    await assert.rejects(
      createSimulationHarness({
        existingPlan: validatedPlan({ status: DispatchPlanStatus.BLOCKED }),
      }).service.simulate('user-1', 'campaign-1', 'plan-1', {}),
      BadRequestException,
    );
    await assert.rejects(
      createSimulationHarness({
        existingPlan: validatedPlan({ status: DispatchPlanStatus.CANCELED }),
      }).service.simulate('user-1', 'campaign-1', 'plan-1', {}),
      BadRequestException,
    );
  });

  it('validacao desatualizada, snapshot ausente e elegivel zero nao geram', async () => {
    await assert.rejects(
      createSimulationHarness({
        existingPlan: validatedPlan({ validatedVersion: 2 }),
      }).service.simulate('user-1', 'campaign-1', 'plan-1', {}),
      BadRequestException,
    );
    await assert.rejects(
      createSimulationHarness({
        existingPlan: validatedPlan({ snapshotCreatedAt: null }),
      }).service.simulate('user-1', 'campaign-1', 'plan-1', {}),
      BadRequestException,
    );
    await assert.rejects(
      createSimulationHarness({
        existingPlan: validatedPlan({ totalEligible: 0 }),
      }).service.simulate('user-1', 'campaign-1', 'plan-1', {}),
      BadRequestException,
    );
  });

  it('VIEWER nao gera e plano de outra campanha e rejeitado', async () => {
    await assert.rejects(
      createSimulationHarness({ denyWrite: true }).service.simulate(
        'viewer-1',
        'campaign-1',
        'plan-1',
        {},
      ),
      ForbiddenException,
    );
    await assert.rejects(
      createSimulationHarness({ existingPlan: null }).service.simulate(
        'user-1',
        'campaign-1',
        'missing',
        {},
      ),
      NotFoundException,
    );
  });

  it('configuracao invalida e velocidade acima do maximo sao rejeitadas', async () => {
    await assert.rejects(
      createSimulationHarness().service.simulate('user-1', 'campaign-1', 'plan-1', {
        messagesPerMinute: 100,
      }),
      BadRequestException,
    );
    await assert.rejects(
      createSimulationHarness().service.simulate('user-1', 'campaign-1', 'plan-1', {
        minDelaySeconds: 30,
        maxDelaySeconds: 10,
      }),
      BadRequestException,
    );
  });

  it('recalcular substitui snapshot e registra evento especifico', async () => {
    const harness = createSimulationHarness({
      existingPlan: validatedPlan({
        simulationSnapshot: { version: 3, audience: { totalEligible: 40 } },
        simulatedAt: new Date('2026-07-20T00:00:00.000Z'),
        simulatedVersion: 3,
      }),
    });

    const result = await harness.service.simulate(
      'user-1',
      'campaign-1',
      'plan-1',
      { batchSize: 10 },
    );

    assert.equal(result.recalculated, true);
    assert.equal(result.version, 3);
    assert.equal(
      harness.auditEvents[0]?.action,
      'DISPATCH_PLAN_SIMULATION_RECALCULATED',
    );
    assert.equal(
      (harness.getSimulationSnapshot() as { estimates: { totalBatches: number } })
        .estimates.totalBatches,
      4,
    );
  });

  it('mudanca concorrente impede persistencia', async () => {
    await assert.rejects(
      createSimulationHarness({ persistCount: 0 }).service.simulate(
        'user-1',
        'campaign-1',
        'plan-1',
        {},
      ),
      ConflictException,
    );
  });

  it('reopen e edicao limpam simulacao', async () => {
    const reopenHarness = createSimulationHarness({
      existingPlan: validatedPlan({
        simulationSnapshot: { version: 3 },
        simulatedAt: new Date(),
        simulatedVersion: 3,
      }),
    });
    const reopened = await reopenHarness.service.reopen(
      'user-1',
      'campaign-1',
      'plan-1',
    );
    assert.equal(reopened.status, DispatchPlanStatus.DRAFT);
    assert.equal(reopened.simulationSnapshot, null);
    assert.equal(reopened.simulatedVersion, null);

    const editHarness = createSimulationHarness({
      existingPlan: validatedPlan({
        status: DispatchPlanStatus.BLOCKED,
        simulationSnapshot: { version: 3 },
        simulatedAt: new Date(),
        simulatedVersion: 3,
        validationSnapshot: { passed: false },
        validatedVersion: 3,
      }),
    });
    const updated = await editHarness.service.update(
      'user-1',
      'campaign-1',
      'plan-1',
      { content: 'Alterado' },
    );
    assert.equal(updated.simulationSnapshot, null);
    assert.equal(updated.simulatedVersion, null);
  });

  it('metadata de audit nao contem conteudo ou telefones', async () => {
    const harness = createSimulationHarness();
    await harness.service.simulate('user-1', 'campaign-1', 'plan-1', {});
    const metadata = harness.auditEvents[0]?.metadata as Record<string, unknown>;
    assert.equal('content' in metadata, false);
    assert.equal('phoneNumber' in metadata, false);
    assert.equal(typeof metadata.estimatedActiveDurationSeconds, 'number');
  });

  it('nao depende de Evolution, BullMQ, Dispatch ou envio', async () => {
    const harness = createSimulationHarness();
    const result = await harness.service.simulate(
      'user-1',
      'campaign-1',
      'plan-1',
      {},
    );
    assert.equal(result.simulationIsCurrent, true);
    assert.equal(result.status, DispatchPlanStatus.VALIDATED);
  });
});

function approvablePlan(overrides: Record<string, unknown> = {}) {
  return validatedPlan({
    simulationSnapshot: {
      configuration: {
        requestedMessagesPerMinute: 4,
        timezone: 'America/Sao_Paulo',
      },
      estimates: {
        effectiveMessagesPerMinute: 4,
        totalBatches: 2,
        estimatedActiveDurationSeconds: 300,
        estimatedCalendarDurationSeconds: 300,
        estimatedStartAt: '2026-07-22T11:00:00.000Z',
        estimatedEndAt: '2026-07-22T11:05:00.000Z',
      },
    },
    simulatedAt: new Date('2026-07-21T12:00:00.000Z'),
    simulatedVersion: 3,
    ...overrides,
  });
}

function createApprovalHarness(options: {
  existingPlan?: ReturnType<typeof plan> | null;
  denyWrite?: boolean;
  denyApprove?: boolean;
  persistCount?: number;
  channelStatus?: ChannelAccountStatus;
  channelProvider?: ChannelProvider;
  recipientCount?: number;
  eligibleCount?: number;
  eligibleOptOutCount?: number;
  duplicateEligible?: boolean;
} = {}) {
  const currentPlan =
    options.existingPlan === undefined ? approvablePlan() : options.existingPlan;
  let status =
    (currentPlan?.status as DispatchPlanStatus) ?? DispatchPlanStatus.VALIDATED;
  let version = currentPlan?.version ?? 3;
  let approvalSnapshot: unknown = currentPlan?.approvalSnapshot ?? null;
  let approvedAt: Date | null = null;
  let approvedByUserId: string | null = null;
  let rejectionReason: string | null = null;
  let rejectedAt: Date | null = null;
  let cancellationReason: string | null = null;
  let canceledAt: Date | null = null;
  const auditEvents: Array<Record<string, unknown>> = [];

  const recipientCount = options.recipientCount ?? currentPlan?.totalEvaluated ?? 40;
  const eligibleCount = options.eligibleCount ?? currentPlan?.totalEligible ?? 40;

  const prisma = {
    campaign: {
      findUnique: async () => ({
        id: 'campaign-1',
        organizationId: 'org-1',
        status: CampaignStatus.ACTIVE,
      }),
    },
    dispatchPlan: {
      findFirst: async () => {
        if (!currentPlan) return null;
        return {
          ...currentPlan,
          status,
          version,
          approvalSnapshot,
          approvedAt,
          approvedByUserId,
          rejectionReason,
          rejectedAt,
          cancellationReason,
          canceledAt,
          approvedBy: approvedByUserId
            ? { id: approvedByUserId, name: 'Aprovador' }
            : null,
          rejectedBy: null,
          canceledBy: null,
        };
      },
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const count = options.persistCount ?? 1;
        if (count !== 1) return { count };
        if (args.data.status === DispatchPlanStatus.APPROVED) {
          status = DispatchPlanStatus.APPROVED;
          approvalSnapshot = args.data.approvalSnapshot;
          approvedAt = args.data.approvedAt as Date;
          approvedByUserId = args.data.approvedByUserId as string;
        }
        if (args.data.status === DispatchPlanStatus.REJECTED) {
          status = DispatchPlanStatus.REJECTED;
          rejectionReason = args.data.rejectionReason as string;
          rejectedAt = args.data.rejectedAt as Date;
        }
        if (args.data.status === DispatchPlanStatus.CANCELED) {
          status = DispatchPlanStatus.CANCELED;
          cancellationReason = args.data.cancellationReason as string;
          canceledAt = args.data.canceledAt as Date;
        }
        if (args.data.status === DispatchPlanStatus.DRAFT) {
          status = DispatchPlanStatus.DRAFT;
        }
        return { count: 1 };
      },
      update: async () => ({ ...currentPlan, status }),
    },
    channelAccount: {
      findFirst: async () => ({
        id: 'channel-1',
        campaignId: 'campaign-1',
        provider: options.channelProvider ?? ChannelProvider.WHATSAPP_EVOLUTION,
        status: options.channelStatus ?? ChannelAccountStatus.CONNECTED,
      }),
    },
    dispatch: {
      findUnique: async () => null,
    },
    segment: {
      findFirst: async () => ({ id: 'segment-1', campaignId: 'campaign-1' }),
    },
    dispatchPlanRecipient: {
      count: async (args: { where: Record<string, unknown> }) => {
        if (args.where.optOutSnapshot) return options.eligibleOptOutCount ?? 0;
        if (args.where.contact) return 0;
        return recipientCount;
      },
      groupBy: async (args: { by: string[] }) => {
        if (args.by.includes('normalizedDestination')) {
          return options.duplicateEligible
            ? [{ normalizedDestination: '5562999990001', _count: { _all: 2 } }]
            : [];
        }
        return [
          {
            eligibilityStatus: DispatchPlanRecipientEligibilityStatus.ELIGIBLE,
            _count: { _all: eligibleCount },
          },
        ];
      },
    },
    dispatchPlanChannel: mockDispatchPlanChannelModel(),
  };

  attachPrismaTransaction(prisma as Record<string, unknown>);

  const access = {
    requireWriteAccess: async () => {
      if (options.denyWrite) throw new ForbiddenException('Permissao insuficiente');
      return { role: MembershipRole.MANAGER };
    },
    requireApproveAccess: async () => {
      if (options.denyApprove) {
        throw new ForbiddenException('Permissao insuficiente para aprovar');
      }
      return { role: MembershipRole.OWNER };
    },
    requireMembership: async () => ({
      role: options.denyApprove ? MembershipRole.MANAGER : MembershipRole.OWNER,
    }),
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
    getStatus: () => status,
    getApprovalSnapshot: () => approvalSnapshot,
  };
}

describe('DispatchPlansService approval 08.5', () => {
  it('OWNER aprova Plano VALIDATED completo', async () => {
    const harness = createApprovalHarness();
    const result = await harness.service.approve(
      'user-1',
      'campaign-1',
      'plan-1',
    );
    assert.equal(result.status, DispatchPlanStatus.APPROVED);
    assert.equal(harness.getStatus(), DispatchPlanStatus.APPROVED);
    assert.ok((harness.getApprovalSnapshot() as { content: { hash: string } }).content.hash);
    assert.equal(harness.auditEvents[0]?.action, 'DISPATCH_PLAN_APPROVED');
    const metadata = harness.auditEvents[0]?.metadata as Record<string, unknown>;
    assert.equal('content' in metadata, false);
    assert.equal(typeof metadata.contentHash, 'string');
  });

  it('MANAGER e estados invalidos nao aprovam', async () => {
    await assert.rejects(
      createApprovalHarness({ denyApprove: true }).service.approve(
        'manager-1',
        'campaign-1',
        'plan-1',
      ),
      ForbiddenException,
    );
    await assert.rejects(
      createApprovalHarness({
        existingPlan: approvablePlan({ status: DispatchPlanStatus.DRAFT }),
      }).service.approve('user-1', 'campaign-1', 'plan-1'),
      BadRequestException,
    );
    await assert.rejects(
      createApprovalHarness({
        existingPlan: approvablePlan({ simulationSnapshot: null, simulatedAt: null }),
      }).service.approve('user-1', 'campaign-1', 'plan-1'),
      BadRequestException,
    );
  });

  it('canal desconectado e recipients inconsistentes nao aprovam', async () => {
    await assert.rejects(
      createApprovalHarness({
        channelStatus: ChannelAccountStatus.DISCONNECTED,
      }).service.approve('user-1', 'campaign-1', 'plan-1'),
      BadRequestException,
    );
    await assert.rejects(
      createApprovalHarness({ recipientCount: 0, eligibleCount: 0 }).service.approve(
        'user-1',
        'campaign-1',
        'plan-1',
      ),
      BadRequestException,
    );
    await assert.rejects(
      createApprovalHarness({ duplicateEligible: true }).service.approve(
        'user-1',
        'campaign-1',
        'plan-1',
      ),
      BadRequestException,
    );
  });

  it('aprovacao concorrente gera conflito', async () => {
    await assert.rejects(
      createApprovalHarness({ persistCount: 0 }).service.approve(
        'user-1',
        'campaign-1',
        'plan-1',
      ),
      ConflictException,
    );
  });

  it('OWNER rejeita com motivo e torna imutavel', async () => {
    const harness = createApprovalHarness();
    const result = await harness.service.reject(
      'user-1',
      'campaign-1',
      'plan-1',
      { reason: 'Conteudo inadequado para disparo' },
    );
    assert.equal(result.status, DispatchPlanStatus.REJECTED);
    assert.equal(harness.auditEvents[0]?.action, 'DISPATCH_PLAN_REJECTED');
  });

  it('MANAGER nao rejeita e motivo curto falha', async () => {
    await assert.rejects(
      createApprovalHarness({ denyApprove: true }).service.reject(
        'manager-1',
        'campaign-1',
        'plan-1',
        { reason: 'Motivo adequado para rejeicao' },
      ),
      ForbiddenException,
    );
    await assert.rejects(
      createApprovalHarness().service.reject('user-1', 'campaign-1', 'plan-1', {
        reason: 'curto',
      }),
      BadRequestException,
    );
  });

  it('cancelamento exige motivo e preserva status final', async () => {
    const harness = createApprovalHarness({
      existingPlan: approvablePlan({ status: DispatchPlanStatus.DRAFT }),
    });
    const result = await harness.service.cancel(
      'user-1',
      'campaign-1',
      'plan-1',
      { reason: 'Plano cancelado pelo gestor' },
    );
    assert.equal(result.status, DispatchPlanStatus.CANCELED);
    assert.equal(harness.auditEvents[0]?.action, 'DISPATCH_PLAN_CANCELED');

    await assert.rejects(
      createApprovalHarness({
        existingPlan: approvablePlan({ status: DispatchPlanStatus.APPROVED }),
      }).service.cancel('user-1', 'campaign-1', 'plan-1', {
        reason: 'Tentativa invalida de cancelar',
      }),
      BadRequestException,
    );
  });

  it('APPROVED nao edita nem reabre', async () => {
    await assert.rejects(
      createApprovalHarness({
        existingPlan: approvablePlan({ status: DispatchPlanStatus.APPROVED }),
      }).service.update('user-1', 'campaign-1', 'plan-1', {
        content: 'novo',
      }),
      BadRequestException,
    );
    await assert.rejects(
      createApprovalHarness({
        existingPlan: approvablePlan({ status: DispatchPlanStatus.APPROVED }),
      }).service.reopen('user-1', 'campaign-1', 'plan-1'),
      BadRequestException,
    );
  });
});
