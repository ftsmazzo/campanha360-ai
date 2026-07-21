import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  ChannelAccountStatus,
  ChannelProvider,
  ChannelType,
  DispatchPlanStatus,
  DispatchStatus,
  MembershipRole,
  Prisma,
} from '@prisma/client';
import { hashDispatchPlanContent } from '../dispatch-plans/dispatch-plan-approval.util';
import { DispatchesService } from './dispatches.service';

function approvalSnapshot(body = 'Mensagem aprovada') {
  return {
    approvedAt: '2026-07-21T15:00:00.000Z',
    approvedVersion: 5,
    approvedByUserId: 'user-1',
    plan: {
      dispatchPlanId: 'plan-1',
      name: 'Plano',
      campaignId: 'campaign-1',
      segmentId: 'segment-1',
      channelAccountId: 'channel-1',
      channelType: 'WHATSAPP',
      channelProvider: 'WHATSAPP_EVOLUTION',
    },
    audience: {
      totalEvaluated: 10,
      totalEligible: 8,
      totalExcluded: 2,
      snapshotCreatedAt: '2026-07-21T10:00:00.000Z',
    },
    validation: {
      validatedAt: '2026-07-21T11:00:00.000Z',
      validatedVersion: 5,
      passed: true,
      errorCount: 0,
      warningCount: 0,
    },
    simulation: {
      simulatedAt: '2026-07-21T12:00:00.000Z',
      simulatedVersion: 5,
      requestedMessagesPerMinute: 4,
      effectiveMessagesPerMinute: 4,
      totalBatches: 1,
      estimatedActiveDurationSeconds: 100,
      estimatedCalendarDurationSeconds: 100,
      estimatedStartAt: '2026-07-22T11:00:00.000Z',
      estimatedEndAt: '2026-07-22T11:05:00.000Z',
      timezone: 'America/Sao_Paulo',
    },
    content: {
      type: 'TEXT',
      body,
      hash: hashDispatchPlanContent(body),
      length: body.length,
    },
  };
}

function approvedPlan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan-1',
    organizationId: 'org-1',
    campaignId: 'campaign-1',
    segmentId: 'segment-1',
    channelAccountId: 'channel-1',
    name: 'Plano',
    description: 'Desc',
    channelType: ChannelType.WHATSAPP,
    content: 'Mensagem aprovada',
    status: DispatchPlanStatus.APPROVED,
    version: 5,
    totalEvaluated: 10,
    totalEligible: 8,
    totalExcluded: 2,
    snapshotCreatedAt: new Date(),
    validationSnapshot: { passed: true },
    validatedAt: new Date(),
    validatedVersion: 5,
    simulationSnapshot: {
      configuration: {
        requestedMessagesPerMinute: 4,
        minDelaySeconds: 10,
        maxDelaySeconds: 20,
        batchSize: 20,
        pauseBetweenBatchesSeconds: 120,
        timezone: 'America/Sao_Paulo',
        allowedStartTime: '08:00',
        allowedEndTime: '20:00',
        allowedDays: [1, 2, 3, 4, 5, 6],
        plannedStartAt: null,
      },
      estimates: {
        effectiveMessagesPerMinute: 4,
        totalBatches: 1,
        totalBatchPauses: 0,
        estimatedActiveDurationSeconds: 100,
        estimatedCalendarDurationSeconds: 100,
        estimatedStartAt: '2026-07-22T11:00:00.000Z',
        estimatedEndAt: '2026-07-22T11:05:00.000Z',
      },
    },
    simulatedAt: new Date(),
    simulatedVersion: 5,
    approvedAt: new Date(),
    approvedByUserId: 'user-1',
    approvalSnapshot: approvalSnapshot(),
    ...overrides,
  };
}

function mockDispatchChannelRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dispatch-channel-1',
    channelAccountId: 'channel-1',
    dispatchPlanChannelId: 'plan-channel-1',
    enabled: true,
    priority: 10,
    weight: 100,
    effectiveDailyLimit: 5000,
    assignedItems: 0,
    processedItems: 0,
    sentItems: 0,
    failedItems: 0,
    consecutiveErrors: 0,
    cooldownUntil: null,
    operationalStatus: 'READY',
    channelAccount: {
      id: 'channel-1',
      name: 'Evolution',
      campaignId: 'campaign-1',
      provider: ChannelProvider.WHATSAPP_EVOLUTION,
      status: ChannelAccountStatus.CONNECTED,
    },
    ...overrides,
  };
}

function mockDispatchChannelModel() {
  return {
    findMany: async () => [mockDispatchChannelRow()],
    createMany: async () => ({ count: 1 }),
    update: async () => mockDispatchChannelRow(),
  };
}


function createHarness(options: {
  plan?: ReturnType<typeof approvedPlan> | null;
  existingDispatch?: boolean;
  denyApprove?: boolean;
  channelMissing?: boolean;
  createThrowsUnique?: boolean;
} = {}) {
  const plan =
    options.plan === undefined ? approvedPlan() : options.plan;
  const auditEvents: Array<Record<string, unknown>> = [];
  let created: Record<string, unknown> | null = null;

  const prisma = {
    campaign: {
      findUnique: async () => ({ id: 'campaign-1', organizationId: 'org-1' }),
    },
    dispatchPlan: {
      findFirst: async () => plan,
    },
    dispatch: {
      findUnique: async () =>
        options.existingDispatch ? { id: 'dispatch-existing' } : null,
      findFirst: async () => created,
      findMany: async () => (created ? [created] : []),
      count: async () => (created ? 1 : 0),
      create: async (args: { data: Record<string, unknown>; select: unknown }) => {
        if (options.createThrowsUnique) {
          throw new Prisma.PrismaClientKnownRequestError('Unique', {
            code: 'P2002',
            clientVersion: 'test',
          });
        }
        created = {
          id: 'dispatch-1',
          organizationId: 'org-1',
          campaignId: 'campaign-1',
          dispatchPlanId: plan?.id,
          channelAccountId: plan?.channelAccountId,
          name: args.data.name,
          description: args.data.description,
          channelType: args.data.channelType,
          contentSnapshot: args.data.contentSnapshot,
          configurationSnapshot: args.data.configurationSnapshot,
          approvalSnapshot: args.data.approvalSnapshot,
          status: DispatchStatus.DRAFT,
          totalItems: 0,
          pendingItems: 0,
          queuedItems: 0,
          processingItems: 0,
          sentItems: 0,
          deliveredItems: 0,
          readItems: 0,
          failedItems: 0,
          skippedItems: 0,
          canceledItems: 0,
          createdByUserId: 'user-1',
          preparedAt: null,
          queuedAt: null,
          startedAt: null,
          pausingAt: null,
          pausedAt: null,
          resumedAt: null,
          completedAt: null,
          failedAt: null,
          canceledAt: null,
          emergencyStoppedAt: null,
          lastProgressAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          dispatchPlan: {
            id: plan?.id,
            name: plan?.name,
            status: plan?.status,
            version: plan?.version,
            totalEligible: plan?.totalEligible,
            totalEvaluated: plan?.totalEvaluated,
            totalExcluded: plan?.totalExcluded,
          },
          channelAccount: {
            id: 'channel-1',
            name: 'Evolution',
            provider: ChannelProvider.WHATSAPP_EVOLUTION,
            status: ChannelAccountStatus.CONNECTED,
          },
          createdBy: { id: 'user-1', name: 'Usuario' },
        };
        return created;
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
    dispatchPlanChannel: {
      findMany: async () => [
        {
          id: 'plan-channel-1',
          channelAccountId: 'channel-1',
          enabled: true,
          priority: 10,
          weight: 100,
          dailyLimit: 5000,
          assignedCapacity: 0,
          configurationSnapshot: null,
        },
      ],
    },
    dispatchChannel: mockDispatchChannelModel(),
    dispatchItem: {
      groupBy: async () => [],
      findMany: async () => [],
      count: async () => 0,
      findFirst: async () => null,
      createMany: async () => ({ count: 0 }),
    },
    $transaction: async (
      callback: (tx: Record<string, unknown>) => Promise<unknown>,
    ) => callback(prisma as unknown as Record<string, unknown>),
  };

  const access = {
    requireApproveAccess: async () => {
      if (options.denyApprove) {
        throw new ForbiddenException('Permissao insuficiente');
      }
      return { role: MembershipRole.OWNER };
    },
    requireMembership: async () => ({ role: MembershipRole.OWNER }),
  };

  const audit = {
    log: async (event: Record<string, unknown>) => {
      auditEvents.push(event);
    },
  };

  return {
    service: new DispatchesService(
      prisma as never,
      access as never,
      audit as never,
    ),
    auditEvents,
    getCreated: () => created,
  };
}

describe('DispatchesService 09.1', () => {
  it('OWNER cria Dispatch DRAFT a partir de Plano APPROVED', async () => {
    const harness = createHarness();
    const result = await harness.service.create('user-1', 'campaign-1', {
      dispatchPlanId: 'plan-1',
    });
    assert.equal(result.status, DispatchStatus.DRAFT);
    assert.equal(result.totalItems, 0);
    assert.equal(
      (result.contentSnapshot as { hash: string }).hash,
      hashDispatchPlanContent('Mensagem aprovada'),
    );
    assert.equal(harness.auditEvents[0]?.action, 'DISPATCH_CREATED');
    const metadata = harness.auditEvents[0]?.metadata as Record<string, unknown>;
    assert.equal(typeof metadata.contentHash, 'string');
    assert.equal('content' in metadata, false);
  });

  it('MANAGER nao cria e estados nao APPROVED sao rejeitados', async () => {
    await assert.rejects(
      createHarness({ denyApprove: true }).service.create(
        'manager-1',
        'campaign-1',
        { dispatchPlanId: 'plan-1' },
      ),
      ForbiddenException,
    );
    await assert.rejects(
      createHarness({
        plan: approvedPlan({ status: DispatchPlanStatus.VALIDATED }),
      }).service.create('user-1', 'campaign-1', { dispatchPlanId: 'plan-1' }),
      BadRequestException,
    );
    await assert.rejects(
      createHarness({
        plan: approvedPlan({ status: DispatchPlanStatus.DRAFT }),
      }).service.create('user-1', 'campaign-1', { dispatchPlanId: 'plan-1' }),
      BadRequestException,
    );
  });

  it('unicidade e canal ausente bloqueiam', async () => {
    await assert.rejects(
      createHarness({ existingDispatch: true }).service.create(
        'user-1',
        'campaign-1',
        { dispatchPlanId: 'plan-1' },
      ),
      ConflictException,
    );
    await assert.rejects(
      createHarness({ createThrowsUnique: true }).service.create(
        'user-1',
        'campaign-1',
        { dispatchPlanId: 'plan-1' },
      ),
      ConflictException,
    );
    await assert.rejects(
      createHarness({ channelMissing: true }).service.create(
        'user-1',
        'campaign-1',
        { dispatchPlanId: 'plan-1' },
      ),
      BadRequestException,
    );
  });

  it('hash divergente nao cria', async () => {
    await assert.rejects(
      createHarness({
        plan: approvedPlan({
          approvalSnapshot: {
            ...approvalSnapshot(),
            content: {
              type: 'TEXT',
              body: 'Mensagem aprovada',
              hash: 'a'.repeat(64),
              length: 10,
            },
          },
        }),
      }).service.create('user-1', 'campaign-1', { dispatchPlanId: 'plan-1' }),
      BadRequestException,
    );
  });

  it('lista e detalhe respeitam campanha', async () => {
    const harness = createHarness();
    await harness.service.create('user-1', 'campaign-1', {
      dispatchPlanId: 'plan-1',
    });
    const listed = await harness.service.list('user-1', 'campaign-1', {
      page: 1,
      limit: 20,
    });
    assert.equal(listed.dispatches.length, 1);
    assert.equal(listed.dispatches[0]?.approvedAudience.totalEligible, 8);

    const detail = await harness.service.getById(
      'user-1',
      'campaign-1',
      'dispatch-1',
    );
    assert.equal(detail.allowedActions.canPrepare, true);
    assert.equal(detail.allowedActions.canView, true);
  });

  it('plano inexistente e rejeitado', async () => {
    await assert.rejects(
      createHarness({ plan: null }).service.create('user-1', 'campaign-1', {
        dispatchPlanId: 'missing',
      }),
      NotFoundException,
    );
  });
});

function eligibleRecipients(count = 2) {
  return Array.from({ length: count }, (_, index) => ({
    id: `recipient-${index + 1}`,
    organizationId: 'org-1',
    campaignId: 'campaign-1',
    dispatchPlanId: 'plan-1',
    contactId: `contact-${index + 1}`,
    destination: `1199999000${index + 1}`,
    normalizedDestination: `551199999000${index + 1}`,
    eligibilityStatus: 'ELIGIBLE',
    contactSnapshot: {
      name: `Contato ${index + 1}`,
      originalPhone: `1199999000${index + 1}`,
      normalizedPhone: `551199999000${index + 1}`,
      city: 'SP',
      neighborhood: null,
      operationalStatus: 'NEW',
      source: 'import',
      tags: [],
      assignedTo: null,
    },
  }));
}

function createPrepareHarness(options: {
  status?: DispatchStatus;
  totalItems?: number;
  denyApprove?: boolean;
  channelStatus?: ChannelAccountStatus;
  channelCampaignId?: string;
  planStatus?: DispatchPlanStatus;
  totalEligible?: number;
  recipients?: ReturnType<typeof eligibleRecipients>;
  failCreateMany?: boolean;
  claimFails?: boolean;
  requiringRedistribution?: boolean;
} = {}) {
  const body = 'Mensagem aprovada';
  const hash = hashDispatchPlanContent(body);
  const totalEligible = options.totalEligible ?? 2;
  const recipients = options.recipients ?? eligibleRecipients(totalEligible);
  const auditEvents: Array<Record<string, unknown>> = [];
  let status = options.status ?? DispatchStatus.DRAFT;
  let totalItems = options.totalItems ?? 0;
  let pendingItems = 0;
  let preparedAt: Date | null = null;
  let items: Array<Record<string, unknown>> = [];

  const dispatchRow = () => ({
    id: 'dispatch-1',
    organizationId: 'org-1',
    campaignId: 'campaign-1',
    dispatchPlanId: 'plan-1',
    channelAccountId: 'channel-1',
    name: 'Disparo',
    description: null,
    channelType: ChannelType.WHATSAPP,
    contentSnapshot: {
      type: 'TEXT',
      body,
      hash,
      length: body.length,
      approvedVersion: 5,
    },
    configurationSnapshot: {},
    approvalSnapshot: approvalSnapshot(body),
    status,
    requiringRedistribution: options.requiringRedistribution ?? false,
    totalItems,
    pendingItems,
    queuedItems: 0,
    processingItems: 0,
    sentItems: 0,
    deliveredItems: 0,
    readItems: 0,
    failedItems: 0,
    skippedItems: 0,
    canceledItems: 0,
    createdByUserId: 'user-1',
    preparedAt,
    queuedAt: null,
    startedAt: null,
    pausingAt: null,
    pausedAt: null,
    resumedAt: null,
    completedAt: null,
    failedAt: null,
    canceledAt: null,
    emergencyStoppedAt: null,
    lastProgressAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    dispatchPlan: {
      id: 'plan-1',
      name: 'Plano',
      status: options.planStatus ?? DispatchPlanStatus.APPROVED,
      version: 5,
      totalEligible,
      totalEvaluated: 10,
      totalExcluded: 8,
    },
    channelAccount: {
      id: 'channel-1',
      name: 'Evolution',
      provider: ChannelProvider.WHATSAPP_EVOLUTION,
      status: options.channelStatus ?? ChannelAccountStatus.CONNECTED,
    },
    createdBy: { id: 'user-1', name: 'Usuario' },
  });

  const prisma: Record<string, unknown> = {
    campaign: {
      findUnique: async () => ({ id: 'campaign-1', organizationId: 'org-1' }),
    },
    dispatch: {
      findFirst: async () => dispatchRow(),
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        if (options.claimFails && args.data.status === DispatchStatus.PREPARING) {
          return { count: 0 };
        }
        if (
          args.where.status === DispatchStatus.DRAFT &&
          args.data.status === DispatchStatus.PREPARING
        ) {
          if (status !== DispatchStatus.DRAFT || totalItems > 0) {
            return { count: 0 };
          }
          status = DispatchStatus.PREPARING;
          return { count: 1 };
        }
        if (
          args.where.status === DispatchStatus.PREPARING &&
          args.data.status === DispatchStatus.READY
        ) {
          status = DispatchStatus.READY;
          totalItems = args.data.totalItems as number;
          pendingItems = args.data.pendingItems as number;
          preparedAt = args.data.preparedAt as Date;
          return { count: 1 };
        }
        if (
          args.where.status === DispatchStatus.PREPARING &&
          args.data.status === DispatchStatus.DRAFT
        ) {
          status = DispatchStatus.DRAFT;
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    dispatchPlan: {
      findFirst: async () => ({
        id: 'plan-1',
        status: options.planStatus ?? DispatchPlanStatus.APPROVED,
        totalEligible,
        approvalSnapshot: approvalSnapshot(body),
        channelAccountId: 'channel-1',
      }),
    },
    channelAccount: {
      findFirst: async () => ({
        id: 'channel-1',
        campaignId: options.channelCampaignId ?? 'campaign-1',
        provider: ChannelProvider.WHATSAPP_EVOLUTION,
        status: options.channelStatus ?? ChannelAccountStatus.CONNECTED,
      }),
    },
    dispatchPlanRecipient: {
      findMany: async () => recipients,
    },
    dispatchChannel: mockDispatchChannelModel(),
    dispatchItem: {
      count: async () => items.length,
      createMany: async (args: { data: Array<Record<string, unknown>> }) => {
        if (options.failCreateMany) {
          throw new Error('createMany falhou');
        }
        items = args.data.map((row, index) => ({
          id: `item-${index + 1}`,
          ...row,
        }));
        return { count: items.length };
      },
      findMany: async () =>
        items.map((item) => ({
          id: item.id,
          contactId: item.contactId,
          destination: item.destination,
          contactSnapshot: item.contactSnapshot,
          contentSnapshot: item.contentSnapshot,
          status: item.status,
          attemptCount: item.attemptCount,
          maxAttempts: item.maxAttempts,
          scheduledAt: null,
          queuedAt: null,
          startedAt: null,
          sentAt: null,
          failedAt: null,
          skippedAt: null,
          errorCategory: null,
          errorCode: null,
          createdAt: new Date(),
        })),
      findFirst: async () =>
        items[0]
          ? {
              ...items[0],
              organizationId: 'org-1',
              campaignId: 'campaign-1',
              dispatchId: 'dispatch-1',
              lockedAt: null,
              deliveredAt: null,
              readAt: null,
              canceledAt: null,
              providerMessageId: null,
              providerStatus: null,
              errorMessage: null,
              lastAttemptAt: null,
              nextRetryAt: null,
              updatedAt: new Date(),
              createdAt: new Date(),
              dispatchPlanRecipient: {
                id: items[0].dispatchPlanRecipientId,
                eligibilityStatus: 'ELIGIBLE',
              },
            }
          : null,
      groupBy: async () =>
        items.length
          ? [{ status: 'PENDING', _count: { _all: items.length } }]
          : [],
    },
    $transaction: async (
      callback: (tx: Record<string, unknown>) => Promise<void>,
    ) => {
      await callback(prisma);
    },
  };

  const access = {
    requireApproveAccess: async () => {
      if (options.denyApprove) {
        throw new ForbiddenException('Permissao insuficiente');
      }
      return { role: MembershipRole.OWNER };
    },
    requireMembership: async () => ({ role: MembershipRole.OWNER }),
  };

  const audit = {
    log: async (event: Record<string, unknown>) => {
      auditEvents.push(event);
    },
  };

  return {
    service: new DispatchesService(
      prisma as never,
      access as never,
      audit as never,
    ),
    auditEvents,
    getStatus: () => status,
    getTotalItems: () => totalItems,
    getItems: () => items,
  };
}

describe('DispatchesService 09.2 prepare', () => {
  it('OWNER prepara Dispatch DRAFT e chega a READY', async () => {
    const harness = createPrepareHarness();
    const result = await harness.service.prepare(
      'user-1',
      'campaign-1',
      'dispatch-1',
    );
    assert.equal(result.status, DispatchStatus.READY);
    assert.equal(result.totalCreated, 2);
    assert.equal(result.pendingItems, 2);
    assert.equal(harness.getStatus(), DispatchStatus.READY);
    assert.equal(harness.getTotalItems(), 2);
    assert.equal(harness.getItems()[0]?.status, 'PENDING');
    assert.equal(
      harness.auditEvents.some((e) => e.action === 'DISPATCH_PREPARATION_STARTED'),
      true,
    );
    assert.equal(
      harness.auditEvents.some((e) => e.action === 'DISPATCH_PREPARED'),
      true,
    );
    const prepared = harness.auditEvents.find(
      (e) => e.action === 'DISPATCH_PREPARED',
    )?.metadata as Record<string, unknown>;
    assert.equal('destination' in prepared, false);
    assert.equal('content' in prepared, false);
  });

  it('MANAGER nao prepara e READY nao prepara novamente', async () => {
    await assert.rejects(
      createPrepareHarness({ denyApprove: true }).service.prepare(
        'manager-1',
        'campaign-1',
        'dispatch-1',
      ),
      ForbiddenException,
    );
    await assert.rejects(
      createPrepareHarness({
        status: DispatchStatus.READY,
        totalItems: 2,
      }).service.prepare('user-1', 'campaign-1', 'dispatch-1'),
      ConflictException,
    );
    await assert.rejects(
      createPrepareHarness({ status: DispatchStatus.PREPARING }).service.prepare(
        'user-1',
        'campaign-1',
        'dispatch-1',
      ),
      ConflictException,
    );
  });

  it('canal desconectado e plano nao APPROVED bloqueiam', async () => {
    await assert.rejects(
      createPrepareHarness({
        channelStatus: ChannelAccountStatus.DISCONNECTED,
      }).service.prepare('user-1', 'campaign-1', 'dispatch-1'),
      BadRequestException,
    );
    await assert.rejects(
      createPrepareHarness({
        planStatus: DispatchPlanStatus.VALIDATED,
      }).service.prepare('user-1', 'campaign-1', 'dispatch-1'),
      BadRequestException,
    );
    await assert.rejects(
      createPrepareHarness({
        channelCampaignId: 'other-campaign',
      }).service.prepare('user-1', 'campaign-1', 'dispatch-1'),
      BadRequestException,
    );
  });

  it('contagem divergente e falha voltam para DRAFT sem items', async () => {
    await assert.rejects(
      createPrepareHarness({
        totalEligible: 3,
        recipients: eligibleRecipients(2),
      }).service.prepare('user-1', 'campaign-1', 'dispatch-1'),
      BadRequestException,
    );

    const failing = createPrepareHarness({ failCreateMany: true });
    await assert.rejects(
      failing.service.prepare('user-1', 'campaign-1', 'dispatch-1'),
      Error,
    );
    assert.equal(failing.getStatus(), DispatchStatus.DRAFT);
    assert.equal(failing.getItems().length, 0);
    assert.equal(
      failing.auditEvents.some(
        (e) => e.action === 'DISPATCH_PREPARATION_FAILED',
      ),
      true,
    );
  });

  it('lista items com destination mascarado e sem body', async () => {
    const harness = createPrepareHarness();
    await harness.service.prepare('user-1', 'campaign-1', 'dispatch-1');
    const listed = await harness.service.listItems(
      'user-1',
      'campaign-1',
      'dispatch-1',
      { page: 1, limit: 20 },
    );
    assert.equal(listed.items.length, 2);
    assert.match(listed.items[0]?.destinationMasked ?? '', /\*/);
    assert.equal('destination' in listed.items[0]!, false);
    assert.equal('body' in listed.items[0]!, false);

    const detail = await harness.service.getById(
      'user-1',
      'campaign-1',
      'dispatch-1',
    );
    assert.equal(detail.allowedActions.canPrepare, false);
    assert.equal(detail.itemSummary.PENDING, 2);
    assert.equal(detail.allowedActions.canQueue, true);

    const legacy = createPrepareHarness({
      status: DispatchStatus.READY,
      totalItems: 2,
      requiringRedistribution: true,
    });
    const legacyDetail = await legacy.service.getById(
      'user-1',
      'campaign-1',
      'dispatch-1',
    );
    assert.equal(legacyDetail.allowedActions.canQueue, false);
  });

  it('requiringRedistribution bloqueia canQueue', async () => {
    const harness = createPrepareHarness({
      status: DispatchStatus.READY,
      totalItems: 2,
      requiringRedistribution: true,
    });
    const detail = await harness.service.getById(
      'user-1',
      'campaign-1',
      'dispatch-1',
    );
    assert.equal(detail.allowedActions.canQueue, false);
    assert.equal(detail.allowedActions.canRedistribute, true);
  });
});
