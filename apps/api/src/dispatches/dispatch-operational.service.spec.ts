import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  ChannelAccountStatus,
  DispatchChannelOperationalStatus,
  DispatchItemStatus,
  DispatchStatus,
  MembershipRole,
} from '@prisma/client';
import { DispatchOperationalService } from './dispatch-operational.service';

const FLAG_KEYS = [
  'DISPATCH_ENGINE_ENABLED',
  'DISPATCH_QUEUE_ENABLED',
  'DISPATCH_SEND_ENABLED',
  'DISPATCH_PILOT_MODE',
] as const;

function enableSendFlags(): void {
  process.env.DISPATCH_ENGINE_ENABLED = 'true';
  process.env.DISPATCH_QUEUE_ENABLED = 'true';
  process.env.DISPATCH_SEND_ENABLED = 'true';
}

function clearFlags(): void {
  for (const key of FLAG_KEYS) delete process.env[key];
}

type Harness = {
  service: DispatchOperationalService;
  auditEvents: Array<Record<string, unknown>>;
  getDispatch: () => Record<string, unknown>;
  getItems: () => Array<Record<string, unknown>>;
  ensureJobCalls: Array<Record<string, unknown>>;
  removeCalls: number;
};

function createHarness(options: {
  dispatchStatus?: DispatchStatus;
  denyApprove?: boolean;
  role?: MembershipRole;
  items?: Array<Record<string, unknown>>;
  channelConnected?: boolean;
} = {}): Harness {
  const auditEvents: Array<Record<string, unknown>> = [];
  const ensureJobCalls: Array<Record<string, unknown>> = [];
  let removeCalls = 0;

  let dispatch: Record<string, unknown> = {
    id: 'dispatch-1',
    organizationId: 'org-1',
    campaignId: 'campaign-1',
    status: options.dispatchStatus ?? DispatchStatus.RUNNING,
    totalItems: 2,
    queuedItems: 2,
    requiringRedistribution: false,
    cancelReason: null,
    emergencyStopReason: null,
    pauseReason: null,
    pausedByUserId: null,
  };

  const items =
    options.items ??
    [
      {
        id: 'item-1',
        status: DispatchItemStatus.QUEUED,
        providerRequestStartedAt: null,
      },
      {
        id: 'item-2',
        status: DispatchItemStatus.QUEUED,
        providerRequestStartedAt: null,
      },
    ];

  const prisma = {
    campaign: {
      findUnique: async () => ({ id: 'campaign-1', organizationId: 'org-1' }),
    },
    dispatch: {
      findFirst: async () => ({ ...dispatch }),
      findUnique: async () => ({ ...dispatch }),
      updateMany: async (args: {
        where: { status?: unknown };
        data: Record<string, unknown>;
      }) => {
        const whereStatus = args.where.status;
        if (typeof whereStatus === 'string' || typeof whereStatus === 'object') {
          if (
            typeof whereStatus === 'string' &&
            dispatch.status !== whereStatus
          ) {
            return { count: 0 };
          }
          if (
            whereStatus &&
            typeof whereStatus === 'object' &&
            'in' in (whereStatus as object)
          ) {
            const list = (whereStatus as { in: string[] }).in;
            if (!list.includes(String(dispatch.status))) {
              return { count: 0 };
            }
          }
        }
        dispatch = { ...dispatch, ...args.data };
        return { count: 1 };
      },
    },
    dispatchItem: {
      count: async (args: { where: { status?: string } }) =>
        items.filter((i) => i.status === args.where.status).length,
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const item of items) {
          const statusFilter = args.where.status;
          let match = true;
          if (typeof statusFilter === 'string') {
            match = item.status === statusFilter;
          } else if (
            statusFilter &&
            typeof statusFilter === 'object' &&
            'in' in (statusFilter as object)
          ) {
            match = (statusFilter as { in: string[] }).in.includes(
              String(item.status),
            );
          }
          if (args.where.providerRequestStartedAt === null) {
            match = match && item.providerRequestStartedAt == null;
          }
          if (match) {
            Object.assign(item, args.data);
            count += 1;
          }
        }
        return { count };
      },
      findMany: async (args?: { where?: Record<string, unknown> }) => {
        const statusFilter = args?.where?.status as
          | { in?: string[] }
          | string
          | undefined;
        return items
          .filter((i) => {
            if (!statusFilter) return true;
            if (typeof statusFilter === 'string') {
              return i.status === statusFilter;
            }
            if (statusFilter.in) {
              return statusFilter.in.includes(String(i.status));
            }
            return true;
          })
          .map((i) => ({ id: i.id }));
      },
      groupBy: async () => {
        const map = new Map<string, number>();
        for (const item of items) {
          map.set(String(item.status), (map.get(String(item.status)) ?? 0) + 1);
        }
        return [...map.entries()].map(([status, n]) => ({
          status,
          _count: { _all: n },
        }));
      },
    },
    dispatchChannel: {
      findMany: async () => [
        {
          enabled: true,
          operationalStatus: DispatchChannelOperationalStatus.READY,
          channelAccount: {
            status:
              options.channelConnected === false
                ? ChannelAccountStatus.DISCONNECTED
                : ChannelAccountStatus.CONNECTED,
          },
        },
      ],
    },
  };

  const organizationAccess = {
    requireMembership: async () => ({
      role: options.role ?? MembershipRole.OWNER,
    }),
    requireApproveAccess: async () => {
      if (options.denyApprove) {
        throw new ForbiddenException('Permissao insuficiente');
      }
      return { role: options.role ?? MembershipRole.OWNER };
    },
  };

  const audit = {
    log: async (event: Record<string, unknown>) => {
      auditEvents.push(event);
    },
  };

  const dispatchSendProducer = {
    ensureJob: async (input: Record<string, unknown>) => {
      ensureJobCalls.push(input);
      return {
        status: 'enqueued' as const,
        jobId: `job-${String(input.dispatchItemId)}`,
        requeued: false,
      };
    },
    removeWaitingOrDelayedJob: async () => {
      removeCalls += 1;
      return true;
    },
  };

  const service = new DispatchOperationalService(
    prisma as never,
    audit as never,
    organizationAccess as never,
    dispatchSendProducer as never,
  );

  return {
    service,
    auditEvents,
    getDispatch: () => dispatch,
    getItems: () => items,
    ensureJobCalls,
    get removeCalls() {
      return removeCalls;
    },
  };
}

describe('DispatchOperationalService (09.5)', () => {
  afterEach(() => clearFlags());

  it('OWNER pausa RUNNING → PAUSED quando sem PROCESSING', async () => {
    const harness = createHarness({ dispatchStatus: DispatchStatus.RUNNING });
    const result = await harness.service.pause('user-1', 'campaign-1', 'dispatch-1');
    assert.equal(result.status, DispatchStatus.PAUSED);
    assert.equal(harness.getDispatch().status, DispatchStatus.PAUSED);
    assert.ok(
      harness.auditEvents.some((e) => e.action === 'DISPATCH_PAUSE_REQUESTED'),
    );
    assert.ok(harness.auditEvents.some((e) => e.action === 'DISPATCH_PAUSED'));
  });

  it('MANAGER nao pode pausar', async () => {
    const harness = createHarness({ denyApprove: true });
    await assert.rejects(
      () => harness.service.pause('user-1', 'campaign-1', 'dispatch-1'),
      ForbiddenException,
    );
  });

  it('dois pause: segundo recebe erro de estado ou conflito', async () => {
    const harness = createHarness({ dispatchStatus: DispatchStatus.RUNNING });
    await harness.service.pause('user-1', 'campaign-1', 'dispatch-1');
    await assert.rejects(
      () => harness.service.pause('user-2', 'campaign-1', 'dispatch-1'),
      (err: unknown) =>
        err instanceof ConflictException || err instanceof BadRequestException,
    );
  });

  it('pause libera PROCESSING sem chamada externa para QUEUED', async () => {
    const harness = createHarness({
      items: [
        {
          id: 'item-p',
          status: DispatchItemStatus.PROCESSING,
          providerRequestStartedAt: null,
        },
        {
          id: 'item-q',
          status: DispatchItemStatus.QUEUED,
          providerRequestStartedAt: null,
        },
      ],
    });
    // Com PROCESSING restante, fica PAUSING
    const result = await harness.service.pause('user-1', 'campaign-1', 'dispatch-1');
    // item-p liberado → QUEUED, processing=0 → PAUSED
    assert.equal(harness.getItems()[0]!.status, DispatchItemStatus.QUEUED);
    assert.equal(result.status, DispatchStatus.PAUSED);
  });

  it('resume PAUSED → RUNNING republica QUEUED e nao SENT', async () => {
    enableSendFlags();
    const harness = createHarness({
      dispatchStatus: DispatchStatus.PAUSED,
      items: [
        { id: 'item-q', status: DispatchItemStatus.QUEUED, providerRequestStartedAt: null },
        { id: 'item-s', status: DispatchItemStatus.SENT, providerRequestStartedAt: null },
        {
          id: 'item-u',
          status: DispatchItemStatus.UNKNOWN_PROVIDER_STATE,
          providerRequestStartedAt: null,
        },
      ],
    });
    const result = await harness.service.resume('user-1', 'campaign-1', 'dispatch-1');
    assert.equal(result.status, DispatchStatus.RUNNING);
    assert.equal(harness.ensureJobCalls.length, 1);
    assert.equal(harness.ensureJobCalls[0]!.dispatchItemId, 'item-q');
    assert.ok(harness.auditEvents.some((e) => e.action === 'DISPATCH_RESUMED'));
  });

  it('resume com SEND=false bloqueia', async () => {
    process.env.DISPATCH_ENGINE_ENABLED = 'true';
    process.env.DISPATCH_QUEUE_ENABLED = 'true';
    delete process.env.DISPATCH_SEND_ENABLED;
    const harness = createHarness({ dispatchStatus: DispatchStatus.PAUSED });
    await assert.rejects(
      () => harness.service.resume('user-1', 'campaign-1', 'dispatch-1'),
      BadRequestException,
    );
  });

  it('cancel RUNNING: pendentes CANCELED, SENT preservado', async () => {
    const harness = createHarness({
      dispatchStatus: DispatchStatus.RUNNING,
      items: [
        { id: 'item-q', status: DispatchItemStatus.QUEUED, providerRequestStartedAt: null },
        { id: 'item-s', status: DispatchItemStatus.SENT, providerRequestStartedAt: null },
        { id: 'item-f', status: DispatchItemStatus.FAILED, providerRequestStartedAt: null },
      ],
    });
    const result = await harness.service.cancel(
      'user-1',
      'campaign-1',
      'dispatch-1',
      'Motivo valido de cancelamento',
    );
    assert.equal(result.status, DispatchStatus.CANCELED);
    assert.equal(harness.getItems()[0]!.status, DispatchItemStatus.CANCELED);
    assert.equal(harness.getItems()[1]!.status, DispatchItemStatus.SENT);
    assert.equal(harness.getItems()[2]!.status, DispatchItemStatus.FAILED);
    assert.ok(harness.auditEvents.some((e) => e.action === 'DISPATCH_CANCELED'));
  });

  it('cancel exige motivo', async () => {
    const harness = createHarness();
    await assert.rejects(
      () => harness.service.cancel('user-1', 'campaign-1', 'dispatch-1', 'curto'),
      BadRequestException,
    );
  });

  it('emergency stop RUNNING → EMERGENCY_STOPPED sem cancelar items', async () => {
    const harness = createHarness({
      dispatchStatus: DispatchStatus.RUNNING,
      items: [
        { id: 'item-q', status: DispatchItemStatus.QUEUED, providerRequestStartedAt: null },
      ],
    });
    const result = await harness.service.emergencyStop(
      'user-1',
      'campaign-1',
      'dispatch-1',
      'Incidente operacional grave',
    );
    assert.equal(result.status, DispatchStatus.EMERGENCY_STOPPED);
    assert.equal(harness.getItems()[0]!.status, DispatchItemStatus.QUEUED);
    assert.ok(
      harness.auditEvents.some((e) => e.action === 'DISPATCH_EMERGENCY_STOPPED'),
    );
  });
});
