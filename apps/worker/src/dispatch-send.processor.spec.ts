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

// ---------------------------------------------------------------------------
// Harness para o fluxo de envio real (subetapa 09.4)
// ---------------------------------------------------------------------------

function contactRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'contact-1',
    status: 'ACTIVE',
    optOuts: [] as Array<Record<string, unknown>>,
    ...overrides,
  };
}

function realSendDispatch(overrides: Record<string, unknown> = {}) {
  return baseDispatch({
    totalItems: 1,
    approvalSnapshot: {
      protectionPolicy: {
        timezone: 'America/Sao_Paulo',
        allowedStartTime: '09:00',
        allowedEndTime: '18:00',
        allowedDays: [1, 2, 3, 4, 5, 6, 7],
        minDelaySeconds: 0,
        maxDelaySeconds: 0,
        batchSize: 1000,
        pauseBetweenBatchesSeconds: 0,
        longPauseEveryMessages: 1000,
        longPauseMinutes: 0,
        rotateEveryMessages: 1000,
        pauseOn403: true,
        pauseOn429: true,
      },
    },
    ...overrides,
  });
}

function realSendItem(overrides: Record<string, unknown> = {}) {
  return baseItem({
    contactId: 'contact-1',
    normalizedDestination: '5511999999999',
    contentSnapshot: { body: 'Ola, teste' },
    attemptCount: 0,
    maxAttempts: 3,
    ...overrides,
  });
}

type OrClause = { lockExpiresAt?: null | { lt?: Date } };

function applyItemUpdateMany(
  item: Record<string, unknown> | null,
  args: { where: Record<string, unknown>; data: Record<string, unknown> },
): { count: number; item: Record<string, unknown> | null } {
  if (!item) return { count: 0, item };

  const statusFilter = args.where.status as { in?: string[] } | string | undefined;
  if (statusFilter && typeof statusFilter === 'object' && 'in' in statusFilter) {
    if (!statusFilter.in?.includes(String(item.status))) return { count: 0, item };
  } else if (typeof statusFilter === 'string') {
    if (item.status !== statusFilter) return { count: 0, item };
  }

  const orFilter = args.where.OR as OrClause[] | undefined;
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
        (ltClause.lockExpiresAt as { lt: Date }).lt.getTime() > currentLock.getTime(),
    );
    if (!matchesNullClause && !matchesLtClause) return { count: 0, item };
  }

  const updated = { ...item, ...args.data };
  return { count: 1, item: updated };
}

function usageKey(dispatchChannelId: string, usageDate: Date): string {
  return `${dispatchChannelId}::${usageDate.getTime()}`;
}

function createRealSendHarness(options: {
  dispatch?: Record<string, unknown>;
  item?: Record<string, unknown> | null;
  channels?: Array<Record<string, unknown>>;
  contact?: Record<string, unknown> | null;
} = {}) {
  let item: Record<string, unknown> | null =
    options.item === undefined ? realSendItem() : options.item;
  let dispatchRow: Record<string, unknown> = options.dispatch ?? realSendDispatch();
  const channels = options.channels ?? [channelRow()];
  const contact = options.contact === undefined ? contactRow() : options.contact;
  const usageDaily = new Map<string, Record<string, unknown>>();
  const dispatchChannelUpdates: Array<Record<string, unknown>> = [];

  const prisma = {
    dispatch: {
      findFirst: async () => ({ ...dispatchRow }),
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (args.where.status && dispatchRow.status !== args.where.status) {
          return { count: 0 };
        }
        dispatchRow = { ...dispatchRow, ...args.data };
        return { count: 1 };
      },
    },
    dispatchItem: {
      findFirst: async () => (item ? { ...item } : null),
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const result = applyItemUpdateMany(item, args);
        item = result.item;
        return { count: result.count };
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        item = { ...(item ?? {}), ...args.data };
        return { ...item };
      },
      groupBy: async () => {
        if (!item) return [];
        return [{ status: item.status, _count: { _all: 1 } }];
      },
    },
    dispatchChannel: {
      findMany: async () => channels.map((c) => ({ ...c })),
      updateMany: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = channels.findIndex((c) => c.id === args.where.id);
        if (idx < 0) return { count: 0 };
        channels[idx] = { ...channels[idx], ...args.data };
        dispatchChannelUpdates.push({ id: args.where.id, data: args.data });
        return { count: 1 };
      },
    },
    dispatchChannelUsageDaily: {
      findUnique: async (args: {
        where: { dispatchChannelId_usageDate: { dispatchChannelId: string; usageDate: Date } };
      }) => {
        const key = usageKey(
          args.where.dispatchChannelId_usageDate.dispatchChannelId,
          args.where.dispatchChannelId_usageDate.usageDate,
        );
        return usageDaily.get(key) ?? null;
      },
      upsert: async (args: {
        where: { dispatchChannelId_usageDate: { dispatchChannelId: string; usageDate: Date } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const key = usageKey(
          args.where.dispatchChannelId_usageDate.dispatchChannelId,
          args.where.dispatchChannelId_usageDate.usageDate,
        );
        const existing = usageDaily.get(key);
        if (existing) {
          const updated = {
            ...existing,
            sentCount: (existing.sentCount as number) + 1,
            lastSentAt: args.update.lastSentAt,
          };
          usageDaily.set(key, updated);
          return updated;
        }
        usageDaily.set(key, { ...args.create });
        return { ...args.create };
      },
    },
    channelAccount: {
      findUnique: async (args: { where: { id: string } }) => {
        const channel = channels.find((c) => c.channelAccountId === args.where.id);
        const account = channel?.channelAccount as { externalAccountId?: string } | undefined;
        return { externalAccountId: account?.externalAccountId ?? 'instance-1' };
      },
    },
    contact: {
      findFirst: async () => (contact ? { ...contact } : null),
    },
  };

  return {
    prisma: prisma as never,
    getItem: () => item,
    getDispatch: () => dispatchRow,
    getChannels: () => channels,
    getUsageDaily: () => usageDaily,
    getDispatchChannelUpdates: () => dispatchChannelUpdates,
  };
}

describe('processDispatchSendJob — envio real (worker 09.4)', () => {
  afterEach(() => {
    clearFlags();
  });

  function enableRealSendFlags(): void {
    enableFlags();
    process.env.DISPATCH_SEND_ENABLED = 'true';
  }

  it('sucesso: SENT atualiza item, canal e usage daily; nao reenvia em chamada duplicada', async () => {
    enableRealSendFlags();
    const harness = createRealSendHarness();
    let calls = 0;
    const result = await processDispatchSendJob(
      { data: basePayload() },
      {
        prisma: harness.prisma,
        now: () => INSIDE_WINDOW_NOW,
        sendText: async () => {
          calls += 1;
          return {
            success: true,
            providerMessageId: 'wamid-123',
            providerStatus: 'PENDING',
            httpStatus: 200,
          };
        },
      },
    );

    assert.equal(result.action, 'SENT');
    assert.equal(result.send, true);
    assert.equal(calls, 1);

    const item = harness.getItem()!;
    assert.equal(item.status, 'SENT');
    assert.equal(item.providerMessageId, 'wamid-123');
    assert.ok(item.sentAt instanceof Date);
    assert.equal(item.attemptCount, 1);

    const channel = harness.getChannels()[0]!;
    assert.equal(channel.sentItems, 1);
    assert.equal(channel.consecutiveErrors, 0);

    const [usage] = [...harness.getUsageDaily().values()];
    assert.equal(usage?.sentCount, 1);

    // Unico item do Dispatch resolvido: recomputo de progresso conclui o
    // Dispatch automaticamente (nenhum item pendente/enfileirado/em
    // processamento restante).
    assert.equal(harness.getDispatch().status, 'COMPLETED');

    // Segunda chamada (job duplicado) nao deve reenviar — o item ja esta
    // SENT (curto-circuito por NOOP_ALREADY_SENT/NOOP_DISPATCH_NOT_ACTIVE,
    // dependendo da ordem das validacoes), e em nenhum caso a Evolution e
    // chamada novamente.
    const secondResult = await processDispatchSendJob(
      { data: basePayload() },
      { prisma: harness.prisma, now: () => INSIDE_WINDOW_NOW, sendText: async () => {
        calls += 1;
        return { success: true, providerMessageId: 'wamid-999', providerStatus: null, httpStatus: 200 };
      } },
    );
    assert.ok(
      ['NOOP_ALREADY_SENT', 'NOOP_DISPATCH_NOT_ACTIVE'].includes(secondResult.action),
      `esperado NOOP_*, recebido ${secondResult.action}`,
    );
    assert.equal(calls, 1);
  });

  it('contato com opt-out: SKIPPED_CONTACT_OPT_OUT sem chamar Evolution', async () => {
    enableRealSendFlags();
    const harness = createRealSendHarness({
      contact: contactRow({ optOuts: [{ id: 'optout-1' }] }),
    });
    let called = false;
    const result = await processDispatchSendJob(
      { data: basePayload() },
      {
        prisma: harness.prisma,
        now: () => INSIDE_WINDOW_NOW,
        sendText: async () => {
          called = true;
          return { success: true, providerMessageId: null, providerStatus: null, httpStatus: 200 };
        },
      },
    );
    assert.equal(result.action, 'SKIPPED_CONTACT_OPT_OUT');
    assert.equal(called, false);
    assert.equal(harness.getItem()?.status, 'SKIPPED');
  });

  it('contato BLOCKED: SKIPPED_CONTACT_BLOCKED sem chamar Evolution', async () => {
    enableRealSendFlags();
    const harness = createRealSendHarness({ contact: contactRow({ status: 'BLOCKED' }) });
    const result = await processDispatchSendJob(
      { data: basePayload() },
      {
        prisma: harness.prisma,
        now: () => INSIDE_WINDOW_NOW,
        sendText: async () => {
          throw new Error('nao deveria ser chamado');
        },
      },
    );
    assert.equal(result.action, 'SKIPPED_CONTACT_BLOCKED');
  });

  it('destino fora da allowlist do piloto: SKIPPED_PILOT_DESTINATION_NOT_ALLOWED', async () => {
    enableRealSendFlags();
    process.env.DISPATCH_ALLOWED_DESTINATIONS = '5511000000000';
    const harness = createRealSendHarness();
    const result = await processDispatchSendJob(
      { data: basePayload() },
      {
        prisma: harness.prisma,
        now: () => INSIDE_WINDOW_NOW,
        sendText: async () => {
          throw new Error('nao deveria ser chamado');
        },
      },
    );
    delete process.env.DISPATCH_ALLOWED_DESTINATIONS;
    assert.equal(result.action, 'SKIPPED_PILOT_DESTINATION_NOT_ALLOWED');
  });

  it('falha 429 (rate limit): aplica cooldown no canal e faz failover para o proximo', async () => {
    enableRealSendFlags();
    const harness = createRealSendHarness({
      channels: [
        channelRow({ id: 'dispatch-channel-1', channelAccountId: 'channel-1', priority: 10 }),
        channelRow({ id: 'dispatch-channel-2', channelAccountId: 'channel-2', priority: 20 }),
      ],
    });
    const result = await processDispatchSendJob(
      { data: basePayload() },
      {
        prisma: harness.prisma,
        now: () => INSIDE_WINDOW_NOW,
        sendText: async () => ({
          success: false,
          category: 'PROVIDER_RATE_LIMIT' as const,
          errorCode: 'HTTP_429',
          errorMessage: 'Provider retornou limite de taxa (429)',
          httpStatus: 429,
          ambiguous: false,
        }),
      },
    );

    assert.equal(result.action, 'DEFERRED_CHANNEL_COOLDOWN');
    const channel1 = harness.getChannels().find((c) => c.id === 'dispatch-channel-1')!;
    assert.equal(channel1.operationalStatus, 'COOLDOWN');
    assert.equal(channel1.consecutiveErrors, 1);
    assert.ok(channel1.cooldownUntil instanceof Date);

    const item = harness.getItem()!;
    assert.equal(item.status, 'SCHEDULED');
    assert.equal(item.dispatchChannelId, 'dispatch-channel-2');
  });

  it('timeout/abort (ambiguo): UNKNOWN_PROVIDER_STATE sem retry automatico', async () => {
    enableRealSendFlags();
    const harness = createRealSendHarness();
    const result = await processDispatchSendJob(
      { data: basePayload() },
      {
        prisma: harness.prisma,
        now: () => INSIDE_WINDOW_NOW,
        sendText: async () => ({
          success: false,
          category: 'UNKNOWN_PROVIDER_STATE' as const,
          errorCode: 'TIMEOUT_OR_ABORT',
          errorMessage: 'Timeout/abort na chamada',
          httpStatus: null,
          ambiguous: true,
        }),
      },
    );

    assert.equal(result.action, 'UNKNOWN_PROVIDER_STATE');
    const item = harness.getItem()!;
    assert.equal(item.status, 'UNKNOWN_PROVIDER_STATE');
    assert.equal(item.nextRetryAt, null);
  });

  it('falha transiente: agenda RETRY_SCHEDULED com backoff ate esgotar tentativas', async () => {
    enableRealSendFlags();
    const harness = createRealSendHarness({ item: realSendItem({ attemptCount: 0, maxAttempts: 2 }) });
    const result = await processDispatchSendJob(
      { data: basePayload() },
      {
        prisma: harness.prisma,
        now: () => INSIDE_WINDOW_NOW,
        sendText: async () => ({
          success: false,
          category: 'TRANSIENT_NETWORK' as const,
          errorCode: 'NETWORK_ERROR',
          errorMessage: 'Falha de rede',
          httpStatus: null,
          ambiguous: false,
        }),
      },
    );
    assert.equal(result.action, 'RETRY_SCHEDULED');
    const item = harness.getItem()!;
    assert.equal(item.status, 'RETRY_SCHEDULED');
    assert.equal(item.attemptCount, 1);
    assert.ok(item.nextRetryAt instanceof Date);
  });

  it('falha transiente com tentativas esgotadas: FAILED', async () => {
    enableRealSendFlags();
    const harness = createRealSendHarness({ item: realSendItem({ attemptCount: 1, maxAttempts: 2 }) });
    const result = await processDispatchSendJob(
      { data: basePayload() },
      {
        prisma: harness.prisma,
        now: () => INSIDE_WINDOW_NOW,
        sendText: async () => ({
          success: false,
          category: 'TRANSIENT_NETWORK' as const,
          errorCode: 'NETWORK_ERROR',
          errorMessage: 'Falha de rede',
          httpStatus: null,
          ambiguous: false,
        }),
      },
    );
    assert.equal(result.action, 'FAILED');
    assert.equal(harness.getItem()?.status, 'FAILED');
  });

  it('destino invalido apos revalidacao last-mile: FAILED_INVALID_DESTINATION', async () => {
    enableRealSendFlags();
    const harness = createRealSendHarness({
      item: realSendItem({ normalizedDestination: '123' }),
    });
    const result = await processDispatchSendJob(
      { data: basePayload() },
      {
        prisma: harness.prisma,
        now: () => INSIDE_WINDOW_NOW,
        sendText: async () => {
          throw new Error('nao deveria ser chamado');
        },
      },
    );
    assert.equal(result.action, 'FAILED_INVALID_DESTINATION');
    assert.equal(harness.getItem()?.status, 'FAILED');
  });

  it('failover automatico de canal antes do envio (canal desconectado): ainda assim envia com sucesso', async () => {
    enableRealSendFlags();
    const harness = createRealSendHarness({
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
      {
        prisma: harness.prisma,
        now: () => INSIDE_WINDOW_NOW,
        sendText: async () => ({
          success: true,
          providerMessageId: 'wamid-456',
          providerStatus: null,
          httpStatus: 200,
        }),
      },
    );
    assert.equal(result.action, 'SENT');
    const item = harness.getItem()!;
    assert.equal(item.dispatchChannelId, 'dispatch-channel-2');
    assert.equal(item.channelAccountId, 'channel-2');
  });

  it('claim RETRY_SCHEDULED tambem e elegivel para envio real', async () => {
    enableRealSendFlags();
    const harness = createRealSendHarness({
      item: realSendItem({ status: 'RETRY_SCHEDULED', attemptCount: 1 }),
    });
    const result = await processDispatchSendJob(
      { data: basePayload() },
      {
        prisma: harness.prisma,
        now: () => INSIDE_WINDOW_NOW,
        sendText: async () => ({
          success: true,
          providerMessageId: 'wamid-789',
          providerStatus: null,
          httpStatus: 200,
        }),
      },
    );
    assert.equal(result.action, 'SENT');
  });
});

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

  it('DISPATCH_SEND_ENABLED=true mas Dispatch nao RUNNING: mantem path tecnico (nao envia)', async () => {
    enableFlags();
    process.env.DISPATCH_SEND_ENABLED = 'true';
    const harness = createFakePrisma({ dispatch: baseDispatch({ status: 'QUEUED' }) });
    const result = await processDispatchSendJob(
      { data: basePayload() },
      { prisma: harness.prisma, now: () => INSIDE_WINDOW_NOW },
    );
    assert.equal(result.action, 'TECHNICAL_VALIDATED');
    assert.equal(result.send, false);
    assert.equal(harness.getItem()?.providerMessageId ?? null, null);
  });

  it('Dispatch RUNNING mas DISPATCH_SEND_ENABLED=false: mantem path tecnico (nao envia)', async () => {
    enableFlags();
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
