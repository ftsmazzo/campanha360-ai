import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { DispatchStatus } from '@prisma/client';
import {
  DISPATCH_START_ELIGIBLE_ITEM_STATUSES,
  assertDispatchStartPreconditions,
  assertDispatchStartWithinPilotLimit,
} from './dispatch-start.util';

const FLAG_KEYS = [
  'DISPATCH_PILOT_MODE',
  'DISPATCH_PILOT_MAX_ITEMS',
] as const;

function clearFlags(): void {
  for (const key of FLAG_KEYS) delete process.env[key];
}

function baseDispatch(overrides: Partial<{
  status: DispatchStatus | string;
  totalItems: number;
  queuedItems: number;
  requiringRedistribution: boolean;
}> = {}) {
  return {
    status: DispatchStatus.QUEUED,
    totalItems: 3,
    queuedItems: 3,
    requiringRedistribution: false,
    ...overrides,
  };
}

describe('dispatch-start.util', () => {
  afterEach(() => {
    clearFlags();
  });

  it('DISPATCH_START_ELIGIBLE_ITEM_STATUSES inclui QUEUED, RETRY_SCHEDULED e SCHEDULED', () => {
    assert.deepEqual(
      [...DISPATCH_START_ELIGIBLE_ITEM_STATUSES].sort(),
      ['QUEUED', 'RETRY_SCHEDULED', 'SCHEDULED'].sort(),
    );
  });

  it('aceita Dispatch QUEUED com queuedItems>0 e sem redistribuicao', () => {
    assert.doesNotThrow(() => assertDispatchStartPreconditions(baseDispatch()));
  });

  it('rejeita Dispatch fora de QUEUED', () => {
    assert.throws(() =>
      assertDispatchStartPreconditions(baseDispatch({ status: DispatchStatus.READY })),
    );
    assert.throws(() =>
      assertDispatchStartPreconditions(baseDispatch({ status: DispatchStatus.RUNNING })),
    );
  });

  it('rejeita Dispatch sem items QUEUED', () => {
    assert.throws(() =>
      assertDispatchStartPreconditions(baseDispatch({ queuedItems: 0 })),
    );
  });

  it('rejeita Dispatch exigindo redistribuicao', () => {
    assert.throws(() =>
      assertDispatchStartPreconditions(
        baseDispatch({ requiringRedistribution: true }),
      ),
    );
  });

  it('assertDispatchStartWithinPilotLimit passa dentro do teto default (5)', () => {
    clearFlags();
    assert.doesNotThrow(() => assertDispatchStartWithinPilotLimit(5));
  });

  it('assertDispatchStartWithinPilotLimit bloqueia acima do teto default (5)', () => {
    clearFlags();
    assert.throws(() => assertDispatchStartWithinPilotLimit(6), /piloto/i);
  });

  it('assertDispatchStartWithinPilotLimit nao bloqueia quando pilot mode esta off', () => {
    clearFlags();
    process.env.DISPATCH_PILOT_MODE = 'false';
    assert.doesNotThrow(() => assertDispatchStartWithinPilotLimit(999));
  });
});
