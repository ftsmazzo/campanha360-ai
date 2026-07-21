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
  };

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
