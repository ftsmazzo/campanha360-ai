import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DispatchItemStatus, DispatchStatus, MembershipRole } from '@prisma/client';
import { DispatchStartService } from './dispatch-start.service';

const FLAG_KEYS = [
  'DISPATCH_ENGINE_ENABLED',
  'DISPATCH_QUEUE_ENABLED',
  'DISPATCH_SEND_ENABLED',
  'DISPATCH_PILOT_MODE',
  'DISPATCH_PILOT_MAX_ITEMS',
] as const;

function enableSendFlags(): void {
  process.env.DISPATCH_ENGINE_ENABLED = 'true';
  process.env.DISPATCH_QUEUE_ENABLED = 'true';
  process.env.DISPATCH_SEND_ENABLED = 'true';
}

function clearFlags(): void {
  for (const key of FLAG_KEYS) delete process.env[key];
}

function itemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    status: DispatchItemStatus.QUEUED,
    ...overrides,
  };
}

type Harness = {
  service: DispatchStartService;
  auditEvents: Array<Record<string, unknown>>;
  ensureJobCalls: Array<Record<string, unknown>>;
  getDispatch: () => Record<string, unknown>;
};

function createHarness(options: {
  dispatchStatus?: DispatchStatus;
  totalItems?: number;
  queuedItems?: number;
  requiringRedistribution?: boolean;
  denyApprove?: boolean;
  items?: Array<Record<string, unknown>>;
  ensureJobResult?: (input: Record<string, unknown>) => {
    status: 'enqueued' | 'duplicate';
    jobId: string;
    requeued: boolean;
  };
  campaignMissing?: boolean;
  dispatchMissing?: boolean;
} = {}): Harness {
  const auditEvents: Array<Record<string, unknown>> = [];
  const ensureJobCalls: Array<Record<string, unknown>> = [];

  let dispatch: Record<string, unknown> = {
    id: 'dispatch-1',
    organizationId: 'org-1',
    campaignId: 'campaign-1',
    status: options.dispatchStatus ?? DispatchStatus.QUEUED,
    totalItems: options.totalItems ?? 2,
    queuedItems: options.queuedItems ?? 2,
    requiringRedistribution: options.requiringRedistribution ?? false,
  };

  const items =
    options.items ?? [itemRow({ id: 'item-1' }), itemRow({ id: 'item-2' })];

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
        if (dispatch.status !== DispatchStatus.QUEUED) {
          return { count: 0 };
        }
        dispatch = { ...dispatch, ...args.data };
        return { count: 1 };
      },
    },
    dispatchItem: {
      findMany: async (args: { cursor?: { id: string }; skip?: number; take: number }) => {
        const pool = items.filter((item) =>
          ['QUEUED', 'RETRY_SCHEDULED', 'SCHEDULED'].includes(String(item.status)),
        );
        let startIndex = 0;
        if (args.cursor) {
          const cursorIndex = pool.findIndex((item) => item.id === args.cursor!.id);
          startIndex = cursorIndex >= 0 ? cursorIndex + (args.skip ?? 1) : pool.length;
        }
        return pool.slice(startIndex, startIndex + args.take).map((item) => ({ ...item }));
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
    ensureJob: async (input: Record<string, unknown>) => {
      ensureJobCalls.push(input);
      if (options.ensureJobResult) {
        return options.ensureJobResult(input);
      }
      return {
        status: 'enqueued' as const,
        jobId: `dispatch-send-${input.dispatchId}-${input.dispatchItemId}`,
        requeued: false,
      };
    },
  };

  return {
    service: new DispatchStartService(
      prisma as never,
      audit as never,
      access as never,
      dispatchSendProducer as never,
    ),
    auditEvents,
    ensureJobCalls,
    getDispatch: () => dispatch,
  };
}

describe('DispatchStartService 09.4', () => {
  afterEach(() => {
    clearFlags();
  });

  it('OWNER inicia Dispatch QUEUED e republica jobs dos items elegiveis', async () => {
    enableSendFlags();
    const harness = createHarness();
    const result = await harness.service.start('user-1', 'campaign-1', 'dispatch-1');

    assert.equal(result.status, DispatchStatus.RUNNING);
    assert.equal(result.itemsEligible, 2);
    assert.equal(result.jobsRepublished, 2);
    assert.equal(harness.getDispatch().status, DispatchStatus.RUNNING);
    assert.ok(harness.getDispatch().startedAt instanceof Date);
    assert.ok(
      harness.auditEvents.some((event) => event.action === 'DISPATCH_STARTED'),
    );

    for (const call of harness.ensureJobCalls) {
      assert.equal('destination' in call, false);
      assert.equal('content' in call, false);
    }
  });

  it('MANAGER (sem approve access) e rejeitado', async () => {
    enableSendFlags();
    await assert.rejects(
      createHarness({ denyApprove: true }).service.start(
        'manager-1',
        'campaign-1',
        'dispatch-1',
      ),
      ForbiddenException,
    );
  });

  it('DISPATCH_SEND_ENABLED=false bloqueia start mesmo com engine+queue on', async () => {
    clearFlags();
    process.env.DISPATCH_ENGINE_ENABLED = 'true';
    process.env.DISPATCH_QUEUE_ENABLED = 'true';
    await assert.rejects(
      createHarness().service.start('user-1', 'campaign-1', 'dispatch-1'),
      BadRequestException,
    );
  });

  it('todas as flags off (default) bloqueia start', async () => {
    clearFlags();
    await assert.rejects(
      createHarness().service.start('user-1', 'campaign-1', 'dispatch-1'),
      BadRequestException,
    );
  });

  it('Dispatch fora de QUEUED, sem queuedItems, ou requiringRedistribution bloqueia', async () => {
    enableSendFlags();
    await assert.rejects(
      createHarness({ dispatchStatus: DispatchStatus.READY }).service.start(
        'user-1',
        'campaign-1',
        'dispatch-1',
      ),
      BadRequestException,
    );
    await assert.rejects(
      createHarness({ queuedItems: 0 }).service.start(
        'user-1',
        'campaign-1',
        'dispatch-1',
      ),
      BadRequestException,
    );
    await assert.rejects(
      createHarness({ requiringRedistribution: true }).service.start(
        'user-1',
        'campaign-1',
        'dispatch-1',
      ),
      BadRequestException,
    );
  });

  it('limite do piloto (default 5) bloqueia Dispatch acima do teto', async () => {
    enableSendFlags();
    await assert.rejects(
      createHarness({ totalItems: 6, queuedItems: 6 }).service.start(
        'user-1',
        'campaign-1',
        'dispatch-1',
      ),
      /piloto/i,
    );
  });

  it('limite do piloto pode ser desligado explicitamente (DISPATCH_PILOT_MODE=false)', async () => {
    enableSendFlags();
    process.env.DISPATCH_PILOT_MODE = 'false';
    const harness = createHarness({ totalItems: 999, queuedItems: 2 });
    const result = await harness.service.start('user-1', 'campaign-1', 'dispatch-1');
    assert.equal(result.status, DispatchStatus.RUNNING);
  });

  it('Dispatch inexistente gera NotFoundException', async () => {
    enableSendFlags();
    await assert.rejects(
      createHarness({ dispatchMissing: true }).service.start(
        'user-1',
        'campaign-1',
        'dispatch-missing',
      ),
      NotFoundException,
    );
  });

  it('start duplo (sequencial): segunda chamada e bloqueada pela precondicao (Dispatch ja RUNNING)', async () => {
    enableSendFlags();
    const harness = createHarness();
    await harness.service.start('user-1', 'campaign-1', 'dispatch-1');
    await assert.rejects(
      () => harness.service.start('user-1', 'campaign-1', 'dispatch-1'),
      BadRequestException,
    );
  });

  it('claim concorrente perdido (race real): ConflictException', async () => {
    enableSendFlags();
    const harness = createHarness();
    const originalUpdateMany = (harness.service as unknown as {
      prisma: { dispatch: { updateMany: (...args: unknown[]) => Promise<{ count: number }> } };
    });
    // Simula outra requisicao ganhando a corrida entre a leitura das
    // precondicoes e o claim (updateMany por id+status=QUEUED retorna 0).
    (
      originalUpdateMany.prisma.dispatch as { updateMany: () => Promise<{ count: number }> }
    ).updateMany = async () => ({ count: 0 });

    await assert.rejects(
      () => harness.service.start('user-1', 'campaign-1', 'dispatch-1'),
      ConflictException,
    );
  });

  it('republica jobs tambem para RETRY_SCHEDULED e SCHEDULED', async () => {
    enableSendFlags();
    const harness = createHarness({
      items: [
        itemRow({ id: 'item-1', status: DispatchItemStatus.QUEUED }),
        itemRow({ id: 'item-2', status: DispatchItemStatus.RETRY_SCHEDULED }),
        itemRow({ id: 'item-3', status: DispatchItemStatus.SCHEDULED }),
        itemRow({ id: 'item-4', status: DispatchItemStatus.SENT }),
      ],
    });
    const result = await harness.service.start('user-1', 'campaign-1', 'dispatch-1');
    assert.equal(result.itemsEligible, 3);
    assert.equal(harness.ensureJobCalls.length, 3);
  });
});
