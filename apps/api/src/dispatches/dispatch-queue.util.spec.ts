import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DispatchStatus } from '@prisma/client';
import {
  assertDispatchQueuePreconditions,
  buildNoChannelDeferredScheduleAt,
  extractOperationalWindowForQueue,
  isDispatchChannelApta,
  resolveDispatchStatusAfterQueueRun,
} from './dispatch-queue.util';

function baseDispatch(overrides: Record<string, unknown> = {}) {
  return {
    status: DispatchStatus.READY,
    totalItems: 10,
    pendingItems: 10,
    requiringRedistribution: false,
    approvalSnapshot: { protectionPolicy: { timezone: 'America/Sao_Paulo' } },
    ...overrides,
  };
}

describe('dispatch-queue.util (09.3)', () => {
  it('assertDispatchQueuePreconditions aceita Dispatch READY valido', () => {
    assert.doesNotThrow(() => assertDispatchQueuePreconditions(baseDispatch()));
  });

  it('assertDispatchQueuePreconditions rejeita status != READY', () => {
    assert.throws(() =>
      assertDispatchQueuePreconditions(baseDispatch({ status: DispatchStatus.DRAFT })),
    );
  });

  it('assertDispatchQueuePreconditions rejeita totalItems/pendingItems <= 0', () => {
    assert.throws(() =>
      assertDispatchQueuePreconditions(baseDispatch({ totalItems: 0 })),
    );
    assert.throws(() =>
      assertDispatchQueuePreconditions(baseDispatch({ pendingItems: 0 })),
    );
  });

  it('assertDispatchQueuePreconditions rejeita requiringRedistribution', () => {
    assert.throws(() =>
      assertDispatchQueuePreconditions(
        baseDispatch({ requiringRedistribution: true }),
      ),
    );
  });

  it('assertDispatchQueuePreconditions exige protectionPolicy/distributionStrategy/multiInstance', () => {
    assert.throws(() =>
      assertDispatchQueuePreconditions(baseDispatch({ approvalSnapshot: {} })),
    );
    assert.throws(() =>
      assertDispatchQueuePreconditions(baseDispatch({ approvalSnapshot: null })),
    );
    assert.doesNotThrow(() =>
      assertDispatchQueuePreconditions(
        baseDispatch({ approvalSnapshot: { distributionStrategy: 'CAPACITY_WEIGHTED' } }),
      ),
    );
    assert.doesNotThrow(() =>
      assertDispatchQueuePreconditions(
        baseDispatch({ approvalSnapshot: { multiInstance: { enabled: true } } }),
      ),
    );
  });

  it('extractOperationalWindowForQueue usa protectionPolicy com fallback para defaults', () => {
    const withPolicy = extractOperationalWindowForQueue(
      {
        protectionPolicy: {
          timezone: 'America/Sao_Paulo',
          allowedStartTime: '08:00',
          allowedEndTime: '20:00',
          allowedDays: [1, 2, 3],
        },
      },
      {},
    );
    assert.deepEqual(withPolicy, {
      timezone: 'America/Sao_Paulo',
      allowedStartTime: '08:00',
      allowedEndTime: '20:00',
      allowedDays: [1, 2, 3],
    });

    const fallbackToDefaults = extractOperationalWindowForQueue(null, null);
    assert.equal(fallbackToDefaults.timezone, 'America/Sao_Paulo');
    assert.equal(fallbackToDefaults.allowedStartTime, '09:00');
    assert.equal(fallbackToDefaults.allowedEndTime, '18:00');
    assert.deepEqual(fallbackToDefaults.allowedDays, [1, 2, 3, 4, 5, 6]);
  });

  it('isDispatchChannelApta valida enabled/archived/connected/operationalStatus/cooldown/capacidade', () => {
    const now = new Date('2026-07-21T12:00:00.000Z');
    const baseChannel = {
      id: 'c1',
      channelAccountId: 'ca1',
      enabled: true,
      priority: 1,
      weight: 1,
      effectiveDailyLimit: 10,
      assignedItems: 0,
      sentItems: 0,
      operationalStatus: 'READY',
      connected: true,
      archived: false,
      cooldownUntil: null,
    };

    assert.equal(isDispatchChannelApta(baseChannel, now), true);
    assert.equal(isDispatchChannelApta({ ...baseChannel, enabled: false }, now), false);
    assert.equal(isDispatchChannelApta({ ...baseChannel, archived: true }, now), false);
    assert.equal(isDispatchChannelApta({ ...baseChannel, connected: false }, now), false);
    assert.equal(
      isDispatchChannelApta({ ...baseChannel, operationalStatus: 'COOLDOWN' }, now),
      false,
    );
    assert.equal(
      isDispatchChannelApta(
        { ...baseChannel, cooldownUntil: new Date('2026-07-21T13:00:00.000Z') },
        now,
      ),
      false,
    );
    assert.equal(
      isDispatchChannelApta({ ...baseChannel, assignedItems: 10 }, now),
      false,
    );
  });

  it('buildNoChannelDeferredScheduleAt agenda 5 minutos no futuro', () => {
    const now = new Date('2026-07-21T12:00:00.000Z');
    const result = buildNoChannelDeferredScheduleAt(now);
    assert.equal(result.getTime() - now.getTime(), 5 * 60_000);
  });

  it('resolveDispatchStatusAfterQueueRun mantem QUEUED se ha jobs ou deferidos', () => {
    assert.equal(
      resolveDispatchStatusAfterQueueRun({
        jobsCreated: 1,
        itemsReassigned: 0,
        itemsDeferred: 0,
        itemsBlocked: 0,
      }),
      DispatchStatus.QUEUED,
    );
    assert.equal(
      resolveDispatchStatusAfterQueueRun({
        jobsCreated: 0,
        itemsReassigned: 0,
        itemsDeferred: 3,
        itemsBlocked: 0,
      }),
      DispatchStatus.QUEUED,
    );
    assert.equal(
      resolveDispatchStatusAfterQueueRun({
        jobsCreated: 0,
        itemsReassigned: 0,
        itemsDeferred: 0,
        itemsBlocked: 0,
      }),
      DispatchStatus.READY,
    );
  });
});
