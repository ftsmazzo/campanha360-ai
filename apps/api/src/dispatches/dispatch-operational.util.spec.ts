import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { DispatchStatus } from '@prisma/client';
import {
  assertCanCancelDispatch,
  assertCanEmergencyStopDispatch,
  assertCanPauseDispatch,
  assertCanResumeDispatch,
  buildOperationalAllowedActions,
  computeDispatchCountersFromStatusMap,
  normalizeOperationalReason,
} from './dispatch-operational.util';

const FLAG_KEYS = [
  'DISPATCH_ENGINE_ENABLED',
  'DISPATCH_QUEUE_ENABLED',
  'DISPATCH_SEND_ENABLED',
  'DISPATCH_PILOT_MODE',
  'DISPATCH_PILOT_MAX_ITEMS',
] as const;

const saved: Record<string, string | undefined> = {};

describe('dispatch-operational.util (09.5)', () => {
  beforeEach(() => {
    for (const key of FLAG_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of FLAG_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('normalizeOperationalReason: pause opcional, cancel obrigatorio', () => {
    assert.equal(normalizeOperationalReason(undefined, { required: false }), null);
    assert.equal(
      normalizeOperationalReason('  Motivo valido da pausa  ', { required: false }),
      'Motivo valido da pausa',
    );
    assert.throws(() => normalizeOperationalReason('', { required: true }));
    assert.throws(() => normalizeOperationalReason('curto', { required: true }));
    assert.equal(
      normalizeOperationalReason('<b>Motivo suficiente</b>', { required: true }),
      'Motivo suficiente',
    );
  });

  it('transicoes: pause so RUNNING; resume so PAUSED', () => {
    assert.doesNotThrow(() => assertCanPauseDispatch(DispatchStatus.RUNNING));
    assert.throws(() => assertCanPauseDispatch(DispatchStatus.PAUSED));
    assert.throws(() =>
      assertCanResumeDispatch({
        status: DispatchStatus.RUNNING,
        requiringRedistribution: false,
      }),
    );

    process.env.DISPATCH_ENGINE_ENABLED = 'true';
    process.env.DISPATCH_QUEUE_ENABLED = 'true';
    process.env.DISPATCH_SEND_ENABLED = 'true';
    assert.doesNotThrow(() =>
      assertCanResumeDispatch({
        status: DispatchStatus.PAUSED,
        requiringRedistribution: false,
      }),
    );
    delete process.env.DISPATCH_SEND_ENABLED;
    assert.throws(() =>
      assertCanResumeDispatch({
        status: DispatchStatus.PAUSED,
        requiringRedistribution: false,
      }),
    );
  });

  it('cancel e emergency stop respeitam estados', () => {
    assert.doesNotThrow(() => assertCanCancelDispatch(DispatchStatus.DRAFT));
    assert.doesNotThrow(() => assertCanCancelDispatch(DispatchStatus.RUNNING));
    assert.throws(() => assertCanCancelDispatch(DispatchStatus.COMPLETED));
    assert.doesNotThrow(() =>
      assertCanEmergencyStopDispatch(DispatchStatus.QUEUED),
    );
    assert.throws(() =>
      assertCanEmergencyStopDispatch(DispatchStatus.DRAFT),
    );
  });

  it('allowedActions: OWNER/ADMIN vs MANAGER/VIEWER', () => {
    process.env.DISPATCH_ENGINE_ENABLED = 'true';
    process.env.DISPATCH_QUEUE_ENABLED = 'true';
    process.env.DISPATCH_SEND_ENABLED = 'true';

    const ownerRunning = buildOperationalAllowedActions({
      role: 'OWNER',
      status: DispatchStatus.RUNNING,
      totalItems: 2,
    });
    assert.equal(ownerRunning.canPause, true);
    assert.equal(ownerRunning.canCancel, true);
    assert.equal(ownerRunning.canEmergencyStop, true);
    assert.equal(ownerRunning.canResume, false);

    const managerRunning = buildOperationalAllowedActions({
      role: 'MANAGER',
      status: DispatchStatus.RUNNING,
      totalItems: 2,
    });
    assert.equal(managerRunning.canPause, false);
    assert.equal(managerRunning.canCancel, false);

    const adminPaused = buildOperationalAllowedActions({
      role: 'ADMIN',
      status: DispatchStatus.PAUSED,
      totalItems: 2,
    });
    assert.equal(adminPaused.canResume, true);
    assert.equal(adminPaused.canPause, false);
  });

  it('contadores: agrega SCHEDULED/RETRY; UNKNOWN separado de failed', () => {
    const counts = computeDispatchCountersFromStatusMap({
      PENDING: 1,
      QUEUED: 2,
      SCHEDULED: 1,
      RETRY_SCHEDULED: 1,
      PROCESSING: 1,
      SENT: 3,
      FAILED: 1,
      UNKNOWN_PROVIDER_STATE: 1,
      SKIPPED: 1,
      CANCELED: 2,
    });
    assert.equal(counts.pendingItems, 1);
    assert.equal(counts.queuedItems, 4);
    assert.equal(counts.processingItems, 1);
    assert.equal(counts.sentItems, 3);
    assert.equal(counts.failedItems, 1);
    assert.equal(counts.unknownItems, 1);
    assert.equal(counts.canceledItems, 2);
  });
});
