import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { processDispatchSendJob } from './dispatch-send.processor';

const FLAG_KEYS = [
  'DISPATCH_ENGINE_ENABLED',
  'DISPATCH_QUEUE_ENABLED',
  'DISPATCH_SEND_ENABLED',
] as const;

function enableFlags(): void {
  process.env.DISPATCH_ENGINE_ENABLED = 'true';
  process.env.DISPATCH_QUEUE_ENABLED = 'true';
}

function clearFlags(): void {
  for (const key of FLAG_KEYS) delete process.env[key];
}

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    dispatchId: 'dispatch-1',
    dispatchItemId: 'item-1',
    organizationId: 'org-1',
    campaignId: 'campaign-1',
    ...overrides,
  };
}

function baseDispatch(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dispatch-1',
    status: 'RUNNING',
    requiringRedistribution: false,
    approvalSnapshot: {
      protectionPolicy: {
        timezone: 'America/Sao_Paulo',
        allowedStartTime: '09:00',
        allowedEndTime: '18:00',
        allowedDays: [1, 2, 3, 4, 5, 6, 7],
      },
    },
    configurationSnapshot: {},
    ...overrides,
  };
}

function baseItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    dispatchId: 'dispatch-1',
    organizationId: 'org-1',
    campaignId: 'campaign-1',
    dispatchChannelId: 'dispatch-channel-1',
    originalDispatchChannelId: 'dispatch-channel-1',
    channelAccountId: 'channel-1',
    reassignmentCount: 0,
    status: 'QUEUED',
    providerMessageId: null,
    sentAt: null,
    lockExpiresAt: null,
    ...overrides,
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
    channelAccount: { id: 'channel-1', status: 'CONNECTED' },
    ...overrides,
  };
}

function createFakePrisma(options: {
  dispatch?: Record<string, unknown> | null;
  item?: Record<string, unknown> | null;
  channels?: Array<Record<string, unknown>>;
}) {
  let item: Record<string, unknown> | null =
    options.item === undefined ? baseItem() : options.item;
  const dispatch = options.dispatch === undefined ? baseDispatch() : options.dispatch;
  const channels = options.channels ?? [channelRow()];

  return {
    getItem: () => item,
    prisma: {
      dispatch: {
        findFirst: async () => dispatch,
      },
      dispatchItem: {
        findFirst: async () => (item ? { ...item } : null),
        updateMany: async (args: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          if (!item) return { count: 0 };
          const statusFilter = args.where.status as
            | { in?: string[] }
            | undefined;
          if (statusFilter?.in && !statusFilter.in.includes(String(item.status))) {
            return { count: 0 };
          }
          const orFilter = args.where.OR as
            | Array<{ lockExpiresAt?: null | { lt?: Date } }>
            | undefined;
          if (orFilter) {
            const currentLock = item.lockExpiresAt as Date | null;
            const matchesNullClause = orFilter.some(
              (clause) => clause.lockExpiresAt === null && currentLock == null,
            );
            const ltClause = orFilter.find(
              (clause) =>
                clause.lockExpiresAt &&
                typeof clause.lockExpiresAt === 'object' &&
                'lt' in clause.lockExpiresAt,
            );
            const matchesLtClause = Boolean(
              currentLock &&
                ltClause?.lockExpiresAt &&
                typeof ltClause.lockExpiresAt === 'object' &&
                (ltClause.lockExpiresAt as { lt: Date }).lt.getTime() >
                  currentLock.getTime(),
            );
            if (!matchesNullClause && !matchesLtClause) {
              return { count: 0 };
            }
          }
          item = { ...item, ...args.data };
          return { count: 1 };
        },
        update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          item = { ...item, ...args.data };
          return { ...item };
        },
      },
      dispatchChannel: {
        findMany: async () => channels.map((c) => ({ ...c })),
      },
    } as never,
  };
}

const INSIDE_WINDOW_NOW = new Date('2026-07-22T16:00:00.000Z');
const OUTSIDE_WINDOW_NOW = new Date('2026-07-22T23:30:00.000Z');

describe('processDispatchSendJob (worker 09.3)', () => {
  afterEach(() => {
    clearFlags();
  });

  it('flags desabilitadas: SKIPPED_FLAG_DISABLED sem tocar prisma', async () => {
    clearFlags();
    const { prisma } = createFakePrisma({});
    const result = await processDispatchSendJob(
      { data: basePayload() },
      { prisma, now: () => INSIDE_WINDOW_NOW },
    );
    assert.equal(result.action, 'SKIPPED_FLAG_DISABLED');
    assert.equal(result.send, false);
  });

  it('dispatch/item inexistente: NOOP_NOT_FOUND', async () => {
    enableFlags();
    const { prisma } = createFakePrisma({ dispatch: null, item: null });
    const result = await processDispatchSendJob(
      { data: basePayload() },
      { prisma, now: () => INSIDE_WINDOW_NOW },
    );
    assert.equal(result.action, 'NOOP_NOT_FOUND');
  });

  it('Dispatch em status terminal: NOOP_DISPATCH_NOT_ACTIVE, sem alterar item', async () => {
    enableFlags();
    const harness = createFakePrisma({ dispatch: baseDispatch({ status: 'PAUSED' }) });
    const result = await processDispatchSendJob(
      { data: basePayload() },
      { prisma: harness.prisma, now: () => INSIDE_WINDOW_NOW },
    );
    assert.equal(result.action, 'NOOP_DISPATCH_NOT_ACTIVE');
    assert.equal(harness.getItem()?.status, 'QUEUED');
  });

  it('item ja enviado: NOOP_ALREADY_SENT', async () => {
    enableFlags();
    const harness = createFakePrisma({ item: baseItem({ status: 'SENT', sentAt: new Date() }) });
    const result = await processDispatchSendJob(
      { data: basePayload() },
      { prisma: harness.prisma, now: () => INSIDE_WINDOW_NOW },
    );
    assert.equal(result.action, 'NOOP_ALREADY_SENT');
  });

  it('Dispatch requiringRedistribution: item vai para SCHEDULED (DEFERRED_REDISTRIBUTION)', async () => {
    enableFlags();
    const harness = createFakePrisma({
      dispatch: baseDispatch({ requiringRedistribution: true }),
    });
    const result = await processDispatchSendJob(
      { data: basePayload() },
      { prisma: harness.prisma, now: () => INSIDE_WINDOW_NOW },
    );
    assert.equal(result.action, 'DEFERRED_REDISTRIBUTION');
    assert.equal(harness.getItem()?.status, 'SCHEDULED');
  });

  it('claim perdido (item ja PROCESSING com lock ativo): SKIPPED_CLAIM_LOST', async () => {
    enableFlags();
    const harness = createFakePrisma({
      item: baseItem({
        status: 'PROCESSING',
        lockExpiresAt: new Date(INSIDE_WINDOW_NOW.getTime() + 60_000),
      }),
    });
    const result = await processDispatchSendJob(
      { data: basePayload() },
      { prisma: harness.prisma, now: () => INSIDE_WINDOW_NOW },
    );
    assert.equal(result.action, 'SKIPPED_CLAIM_LOST');
  });

  it('canal apto e dentro da janela: TECHNICAL_VALIDATED sem enviar', async () => {
    enableFlags();
    const harness = createFakePrisma({});
    const result = await processDispatchSendJob(
      { data: basePayload() },
      { prisma: harness.prisma, now: () => INSIDE_WINDOW_NOW },
    );
    assert.equal(result.action, 'TECHNICAL_VALIDATED');
    assert.equal(result.send, false);
    const item = harness.getItem()!;
    assert.equal(item.status, 'QUEUED');
    assert.ok(item.technicalValidatedAt instanceof Date);
    assert.equal(item.providerMessageId ?? null, null);
    assert.equal(item.sentAt ?? null, null);
  });

  it('DISPATCH_SEND_ENABLED=true ainda assim NAO envia (apenas log de aviso)', async () => {
    enableFlags();
    process.env.DISPATCH_SEND_ENABLED = 'true';
    const harness = createFakePrisma({});
    const result = await processDispatchSendJob(
      { data: basePayload() },
      { prisma: harness.prisma, now: () => INSIDE_WINDOW_NOW },
    );
    assert.equal(result.action, 'TECHNICAL_VALIDATED');
    assert.equal(result.send, false);
    assert.equal(harness.getItem()?.providerMessageId ?? null, null);
  });

  it('canal desconectado com failover disponivel: reassocia e valida tecnicamente', async () => {
    enableFlags();
    const harness = createFakePrisma({
      channels: [
        channelRow({
          id: 'dispatch-channel-1',
          channelAccountId: 'channel-1',
          channelAccount: { id: 'channel-1', status: 'DISCONNECTED' },
        }),
        channelRow({
          id: 'dispatch-channel-2',
          channelAccountId: 'channel-2',
          priority: 20,
          channelAccount: { id: 'channel-2', status: 'CONNECTED' },
        }),
      ],
    });
    const result = await processDispatchSendJob(
      { data: basePayload() },
      { prisma: harness.prisma, now: () => INSIDE_WINDOW_NOW },
    );
    assert.equal(result.action, 'TECHNICAL_VALIDATED');
    const item = harness.getItem()!;
    assert.equal(item.dispatchChannelId, 'dispatch-channel-2');
    assert.equal(item.channelAccountId, 'channel-2');
    assert.equal(item.reassignmentCount, 1);
  });

  it('sem canal elegivel: DEFERRED_NO_CHANNEL e item volta a SCHEDULED com lock liberado', async () => {
    enableFlags();
    const harness = createFakePrisma({
      channels: [
        channelRow({ channelAccount: { id: 'channel-1', status: 'DISCONNECTED' } }),
      ],
    });
    const result = await processDispatchSendJob(
      { data: basePayload() },
      { prisma: harness.prisma, now: () => INSIDE_WINDOW_NOW },
    );
    assert.equal(result.action, 'DEFERRED_NO_CHANNEL');
    const item = harness.getItem()!;
    assert.equal(item.status, 'SCHEDULED');
    assert.equal(item.lastQueueError, 'NO_ELIGIBLE_CHANNEL');
    assert.equal(item.lockToken, null);
  });

  it('fora da janela operacional: DEFERRED_OUTSIDE_WINDOW e reagenda scheduledAt', async () => {
    enableFlags();
    const harness = createFakePrisma({});
    const result = await processDispatchSendJob(
      { data: basePayload() },
      { prisma: harness.prisma, now: () => OUTSIDE_WINDOW_NOW },
    );
    assert.equal(result.action, 'DEFERRED_OUTSIDE_WINDOW');
    const item = harness.getItem()!;
    assert.equal(item.status, 'SCHEDULED');
    assert.ok(item.scheduledAt instanceof Date);
    assert.ok((item.scheduledAt as Date).getTime() > OUTSIDE_WINDOW_NOW.getTime());
  });

  it('payload invalido (com destination) e rejeitado', async () => {
    enableFlags();
    const harness = createFakePrisma({});
    await assert.rejects(
      processDispatchSendJob(
        { data: { ...basePayload(), destination: '+5511999999999' } },
        { prisma: harness.prisma, now: () => INSIDE_WINDOW_NOW },
      ),
    );
  });
});
