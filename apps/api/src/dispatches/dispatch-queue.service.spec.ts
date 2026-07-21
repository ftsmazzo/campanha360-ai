import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  ChannelAccountStatus,
  DispatchItemStatus,
  DispatchStatus,
  MembershipRole,
} from '@prisma/client';
import { DISPATCH_SEND_QUEUE_NAME } from './dispatch-queue.constants';
import { DispatchQueueService } from './dispatch-queue.service';

const FLAG_KEYS = [
  'DISPATCH_ENGINE_ENABLED',
  'DISPATCH_QUEUE_ENABLED',
  'DISPATCH_SEND_ENABLED',
] as const;

function enableQueueFlags(): void {
  process.env.DISPATCH_ENGINE_ENABLED = 'true';
  process.env.DISPATCH_QUEUE_ENABLED = 'true';
}

function clearFlags(): void {
  for (const key of FLAG_KEYS) delete process.env[key];
}

function approvalSnapshotWithProtection() {
  return {
    protectionPolicy: {
      timezone: 'America/Sao_Paulo',
      allowedStartTime: '00:00',
      allowedEndTime: '23:59',
      allowedDays: [1, 2, 3, 4, 5, 6, 7],
    },
    distributionStrategy: 'CAPACITY_WEIGHTED',
    multiInstance: { enabled: true },
  };
}

function channelRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dispatch-channel-1',
    channelAccountId: 'channel-1',
    enabled: true,
    priority: 10,
    weight: 100,
    effectiveDailyLimit: 5000,
    assignedItems: 0,
    sentItems: 0,
    consecutiveErrors: 0,
    cooldownUntil: null,
    operationalStatus: 'READY',
    channelAccount: {
      id: 'channel-1',
      status: ChannelAccountStatus.CONNECTED,
    },
    ...overrides,
  };
}

function itemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    dispatchChannelId: 'dispatch-channel-1',
    originalDispatchChannelId: 'dispatch-channel-1',
    channelAccountId: 'channel-1',
    reassignmentCount: 0,
    status: DispatchItemStatus.PENDING,
    ...overrides,
  };
}

type Harness = {
  service: DispatchQueueService;
  auditEvents: Array<Record<string, unknown>>;
  enqueueCalls: Array<Record<string, unknown>>;
  getItems: () => Array<Record<string, unknown>>;
  getDispatch: () => Record<string, unknown>;
};

function createHarness(options: {
  dispatchStatus?: DispatchStatus;
  totalItems?: number;
  pendingItems?: number;
  requiringRedistribution?: boolean;
  approvalSnapshot?: unknown;
  denyApprove?: boolean;
  channels?: Array<Record<string, unknown>>;
  items?: Array<Record<string, unknown>>;
  enqueueResult?: (input: Record<string, unknown>) => { status: 'enqueued' | 'duplicate'; jobId: string };
  campaignMissing?: boolean;
  dispatchMissing?: boolean;
} = {}): Harness {
  const auditEvents: Array<Record<string, unknown>> = [];
  const enqueueCalls: Array<Record<string, unknown>> = [];

  let dispatch: Record<string, unknown> = {
    id: 'dispatch-1',
    organizationId: 'org-1',
    campaignId: 'campaign-1',
    status: options.dispatchStatus ?? DispatchStatus.READY,
    totalItems: options.totalItems ?? 2,
    pendingItems: options.pendingItems ?? 2,
    requiringRedistribution: options.requiringRedistribution ?? false,
    approvalSnapshot: options.approvalSnapshot ?? approvalSnapshotWithProtection(),
    configurationSnapshot: {},
    queuedAt: null,
  };

  const channels = options.channels ?? [channelRow()];
  let items = options.items ?? [itemRow({ id: 'item-1' }), itemRow({ id: 'item-2' })];

  const prisma = {
    campaign: {
      findUnique: async () =>
        options.campaignMissing
          ? null
          : { id: 'campaign-1', organizationId: 'org-1' },
    },
    dispatch: {
      findFirst: async () => (options.dispatchMissing ? null : { ...dispatch }),
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        if (args.data.status === DispatchStatus.QUEUED) {
          if (dispatch.status !== DispatchStatus.READY) {
            return { count: 0 };
          }
          dispatch = { ...dispatch, ...args.data };
          return { count: 1 };
        }
        if (args.data.status === DispatchStatus.READY) {
          if (dispatch.status !== DispatchStatus.QUEUED) {
            return { count: 0 };
          }
          dispatch = { ...dispatch, ...args.data };
          return { count: 1 };
        }
        return { count: 0 };
      },
      update: async (args: { data: Record<string, unknown> }) => {
        dispatch = { ...dispatch, ...args.data };
        return { ...dispatch };
      },
    },
    dispatchChannel: {
      findMany: async () => channels.map((c) => ({ ...c })),
    },
    dispatchItem: {
      findMany: async (args: {
        where: Record<string, unknown>;
        cursor?: { id: string };
        skip?: number;
        take: number;
      }) => {
        let pool = items.filter((item) => item.status === DispatchItemStatus.PENDING);
        pool = pool.sort((a, b) => String(a.id).localeCompare(String(b.id)));
        let startIndex = 0;
        if (args.cursor) {
          const cursorIndex = pool.findIndex((item) => item.id === args.cursor!.id);
          startIndex = cursorIndex >= 0 ? cursorIndex + (args.skip ?? 1) : pool.length;
        }
        return pool.slice(startIndex, startIndex + args.take).map((item) => ({ ...item }));
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        items = items.map((item) =>
          item.id === args.where.id ? { ...item, ...args.data } : item,
        );
        return items.find((item) => item.id === args.where.id)!;
      },
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const statusFilter = args.where.status as
          | string
          | { in?: string[] }
          | undefined;
        let matched = 0;
        items = items.map((item) => {
          let matches = true;
          if (statusFilter) {
            if (typeof statusFilter === 'string') {
              matches = item.status === statusFilter;
            } else if (Array.isArray(statusFilter.in)) {
              matches = statusFilter.in.includes(String(item.status));
            }
          }
          if (!matches) return item;
          matched += 1;
          return { ...item, ...args.data };
        });
        return { count: matched };
      },
      count: async (args: { where: Record<string, unknown> }) => {
        const status = args.where.status;
        if (typeof status === 'string') {
          return items.filter((item) => item.status === status).length;
        }
        if (status && typeof status === 'object' && Array.isArray((status as { in?: string[] }).in)) {
          const allowed = (status as { in: string[] }).in;
          return items.filter((item) => allowed.includes(String(item.status))).length;
        }
        return items.length;
      },
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

  const dispatchSendProducer = {
    enqueueItem: async (input: Record<string, unknown>) => {
      enqueueCalls.push(input);
      if (options.enqueueResult) {
        return options.enqueueResult(input);
      }
      return {
        status: 'enqueued' as const,
        jobId: `dispatch-send-${input.dispatchId}-${input.dispatchItemId}`,
      };
    },
  };

  return {
    service: new DispatchQueueService(
      prisma as never,
      audit as never,
      access as never,
      dispatchSendProducer as never,
    ),
    auditEvents,
    enqueueCalls,
    getItems: () => items,
    getDispatch: () => dispatch,
  };
}

describe('DispatchQueueService 09.3', () => {
  afterEach(() => {
    clearFlags();
  });

  it('OWNER enfileira Dispatch READY e cria jobs para todos os PENDING', async () => {
    enableQueueFlags();
    const harness = createHarness();
    const result = await harness.service.queue('user-1', 'campaign-1', 'dispatch-1');

    assert.equal(result.jobsCreated, 2);
    assert.equal(result.itemsReassigned, 0);
    assert.equal(result.itemsDeferred, 0);
    assert.equal(result.status, DispatchStatus.QUEUED);
    assert.equal(result.totalQueued, 2);
    assert.equal(result.queueName, DISPATCH_SEND_QUEUE_NAME);

    assert.equal(harness.getDispatch().status, DispatchStatus.QUEUED);
    assert.equal(
      harness.getItems().every((item) => item.status === DispatchItemStatus.QUEUED),
      true,
    );
    assert.equal(
      harness.getItems().every((item) => typeof item.queueJobId === 'string'),
      true,
    );

    assert.equal(
      harness.auditEvents.some((e) => e.action === 'DISPATCH_QUEUE_REQUESTED'),
      true,
    );
    assert.equal(
      harness.auditEvents.some((e) => e.action === 'DISPATCH_QUEUED'),
      true,
    );

    for (const call of harness.enqueueCalls) {
      assert.equal('destination' in call, false);
      assert.equal('content' in call, false);
      assert.equal(typeof call.dispatchItemId, 'string');
    }
  });

  it('MANAGER (sem approve access) e desabilitado por flags sao rejeitados', async () => {
    enableQueueFlags();
    await assert.rejects(
      createHarness({ denyApprove: true }).service.queue(
        'manager-1',
        'campaign-1',
        'dispatch-1',
      ),
      ForbiddenException,
    );

    clearFlags();
    await assert.rejects(
      createHarness().service.queue('user-1', 'campaign-1', 'dispatch-1'),
      BadRequestException,
    );
  });

  it('requiringRedistribution e status != READY bloqueiam', async () => {
    enableQueueFlags();
    await assert.rejects(
      createHarness({ requiringRedistribution: true }).service.queue(
        'user-1',
        'campaign-1',
        'dispatch-1',
      ),
      BadRequestException,
    );
    await assert.rejects(
      createHarness({ dispatchStatus: DispatchStatus.DRAFT }).service.queue(
        'user-1',
        'campaign-1',
        'dispatch-1',
      ),
      BadRequestException,
    );
    await assert.rejects(
      createHarness({ pendingItems: 0 }).service.queue(
        'user-1',
        'campaign-1',
        'dispatch-1',
      ),
      BadRequestException,
    );
  });

  it('approvalSnapshot sem protectionPolicy/distributionStrategy/multiInstance bloqueia', async () => {
    enableQueueFlags();
    await assert.rejects(
      createHarness({ approvalSnapshot: { foo: 'bar' } }).service.queue(
        'user-1',
        'campaign-1',
        'dispatch-1',
      ),
      BadRequestException,
    );
  });

  it('Dispatch inexistente gera NotFoundException', async () => {
    enableQueueFlags();
    await assert.rejects(
      createHarness({ dispatchMissing: true }).service.queue(
        'user-1',
        'campaign-1',
        'dispatch-missing',
      ),
      NotFoundException,
    );
  });

  it('failover reassocia item cujo canal esta desconectado', async () => {
    enableQueueFlags();
    const harness = createHarness({
      channels: [
        channelRow({
          id: 'dispatch-channel-1',
          channelAccountId: 'channel-1',
          channelAccount: { id: 'channel-1', status: ChannelAccountStatus.DISCONNECTED },
        }),
        channelRow({
          id: 'dispatch-channel-2',
          channelAccountId: 'channel-2',
          priority: 20,
          channelAccount: { id: 'channel-2', status: ChannelAccountStatus.CONNECTED },
        }),
      ],
      items: [itemRow({ id: 'item-1', dispatchChannelId: 'dispatch-channel-1' })],
      totalItems: 1,
      pendingItems: 1,
    });

    const result = await harness.service.queue('user-1', 'campaign-1', 'dispatch-1');

    assert.equal(result.itemsReassigned, 1);
    assert.equal(result.jobsCreated, 1);
    const item = harness.getItems()[0]!;
    assert.equal(item.dispatchChannelId, 'dispatch-channel-2');
    assert.equal(item.channelAccountId, 'channel-2');
    assert.equal(item.reassignmentCount, 1);
    assert.equal(item.status, DispatchItemStatus.QUEUED);
  });

  it('item sem dispatchChannelId (null) recebe canal via selecao antes de enfileirar', async () => {
    enableQueueFlags();
    const harness = createHarness({
      items: [
        itemRow({
          id: 'item-1',
          dispatchChannelId: null,
          originalDispatchChannelId: null,
        }),
      ],
      totalItems: 1,
      pendingItems: 1,
    });

    const result = await harness.service.queue('user-1', 'campaign-1', 'dispatch-1');

    assert.equal(result.jobsCreated, 1);
    assert.equal(result.itemsReassigned, 1);
    const item = harness.getItems()[0]!;
    assert.equal(item.dispatchChannelId, 'dispatch-channel-1');
    assert.equal(item.status, DispatchItemStatus.QUEUED);
  });

  it('sem canal elegivel: item e diferido (SCHEDULED) e Dispatch permanece QUEUED', async () => {
    enableQueueFlags();
    const harness = createHarness({
      channels: [
        channelRow({ channelAccount: { id: 'channel-1', status: ChannelAccountStatus.DISCONNECTED } }),
      ],
      items: [itemRow({ id: 'item-1' })],
      totalItems: 1,
      pendingItems: 1,
    });

    const result = await harness.service.queue('user-1', 'campaign-1', 'dispatch-1');

    assert.equal(result.jobsCreated, 0);
    assert.equal(result.itemsDeferred, 1);
    assert.equal(result.status, DispatchStatus.QUEUED);
    const item = harness.getItems()[0]!;
    assert.equal(item.status, DispatchItemStatus.SCHEDULED);
    assert.equal(item.lastQueueError, 'NO_ELIGIBLE_CHANNEL');
    assert.ok(item.scheduledAt instanceof Date);
  });

  it('job duplicado ainda conta como enfileirado (idempotente)', async () => {
    enableQueueFlags();
    const harness = createHarness({
      items: [itemRow({ id: 'item-1' })],
      totalItems: 1,
      pendingItems: 1,
      enqueueResult: () => ({
        status: 'duplicate' as const,
        jobId: 'dispatch-send-dispatch-1-item-1',
      }),
    });

    const result = await harness.service.queue('user-1', 'campaign-1', 'dispatch-1');
    assert.equal(result.jobsCreated, 1);
    assert.equal(harness.getItems()[0]?.status, DispatchItemStatus.QUEUED);
  });

  it('falha no primeiro job restaura Dispatch READY e items PENDING', async () => {
    enableQueueFlags();
    const harness = createHarness({
      items: [itemRow({ id: 'item-1' }), itemRow({ id: 'item-2' })],
      totalItems: 2,
      pendingItems: 2,
      enqueueResult: () => {
        throw new Error('Custom Id cannot contain :');
      },
    });

    await assert.rejects(
      () => harness.service.queue('user-1', 'campaign-1', 'dispatch-1'),
      /Nao foi possivel enfileirar/,
    );

    assert.equal(harness.getDispatch().status, DispatchStatus.READY);
    assert.equal(harness.getDispatch().queuedAt, null);
    for (const item of harness.getItems()) {
      assert.equal(item.status, DispatchItemStatus.PENDING);
      assert.equal(item.queueJobId ?? null, null);
    }
    assert.ok(
      harness.auditEvents.some((event) => event.action === 'DISPATCH_QUEUE_FAILED'),
    );
  });

  it('contadores do Dispatch sao atualizados apos o enfileiramento', async () => {
    enableQueueFlags();
    const harness = createHarness();
    await harness.service.queue('user-1', 'campaign-1', 'dispatch-1');
    assert.equal(harness.getDispatch().pendingItems, 0);
    assert.equal(harness.getDispatch().queuedItems, 2);
  });
});
