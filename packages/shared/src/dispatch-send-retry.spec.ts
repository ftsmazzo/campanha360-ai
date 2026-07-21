import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DISPATCH_SEND_RETRY_BACKOFF_MS,
  computeDispatchNextRetryAt,
  getDispatchRetryDelayMs,
  isDispatchRetryExhausted,
} from './dispatch-send-retry';

describe('dispatch-send-retry', () => {
  it('tabela de backoff e 1min/5min/15min', () => {
    assert.deepEqual(
      [...DISPATCH_SEND_RETRY_BACKOFF_MS],
      [60_000, 300_000, 900_000],
    );
  });

  it('getDispatchRetryDelayMs mapeia attemptCount 1/2/3 para 1/5/15 min', () => {
    assert.equal(getDispatchRetryDelayMs(1), 60_000);
    assert.equal(getDispatchRetryDelayMs(2), 300_000);
    assert.equal(getDispatchRetryDelayMs(3), 900_000);
  });

  it('getDispatchRetryDelayMs usa o ultimo backoff para attemptCount alem da tabela', () => {
    assert.equal(getDispatchRetryDelayMs(4), 900_000);
    assert.equal(getDispatchRetryDelayMs(10), 900_000);
  });

  it('getDispatchRetryDelayMs trata valores invalidos como 1 (1 min)', () => {
    assert.equal(getDispatchRetryDelayMs(0), 60_000);
    assert.equal(getDispatchRetryDelayMs(-1), 60_000);
    assert.equal(getDispatchRetryDelayMs(Number.NaN), 60_000);
  });

  it('computeDispatchNextRetryAt soma o backoff ao instante base', () => {
    const now = new Date('2026-07-21T12:00:00.000Z');
    const next = computeDispatchNextRetryAt(now, 1);
    assert.equal(next.getTime(), now.getTime() + 60_000);
  });

  it('isDispatchRetryExhausted compara attemptCount com maxAttempts', () => {
    assert.equal(isDispatchRetryExhausted(2, 3), false);
    assert.equal(isDispatchRetryExhausted(3, 3), true);
    assert.equal(isDispatchRetryExhausted(4, 3), true);
  });
});
