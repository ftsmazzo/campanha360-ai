import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyDispatchItemRecovery,
  evaluateManualRetryEligibility,
} from './dispatch-recovery.util';

const now = new Date('2026-07-24T15:00:00.000Z');

describe('classifyDispatchItemRecovery (09.6)', () => {
  it('QUEUED sem job → SAFE_REQUEUE', () => {
    const r = classifyDispatchItemRecovery(
      { status: 'QUEUED', queueJobId: null, hasMissingJob: true },
      now,
    );
    assert.equal(r.classification, 'SAFE_REQUEUE');
  });

  it('RETRY_SCHEDULED vencido → SAFE_RETRY', () => {
    const r = classifyDispatchItemRecovery(
      {
        status: 'RETRY_SCHEDULED',
        nextRetryAt: new Date('2026-07-24T14:00:00.000Z'),
        queueJobId: 'job-1',
      },
      now,
    );
    assert.equal(r.classification, 'SAFE_RETRY');
  });

  it('PROCESSING lock valido → WAIT_LOCK', () => {
    const r = classifyDispatchItemRecovery(
      {
        status: 'PROCESSING',
        lockExpiresAt: new Date('2026-07-24T15:30:00.000Z'),
      },
      now,
    );
    assert.equal(r.classification, 'WAIT_LOCK');
  });

  it('PROCESSING lock expirado sem request → SAFE_REQUEUE', () => {
    const r = classifyDispatchItemRecovery(
      {
        status: 'PROCESSING',
        lockExpiresAt: new Date('2026-07-24T14:00:00.000Z'),
        providerRequestStartedAt: null,
      },
      now,
    );
    assert.equal(r.classification, 'SAFE_REQUEUE');
  });

  it('PROCESSING lock expirado com request sem completion → MARK_UNKNOWN', () => {
    const r = classifyDispatchItemRecovery(
      {
        status: 'PROCESSING',
        lockExpiresAt: new Date('2026-07-24T14:00:00.000Z'),
        providerRequestStartedAt: new Date('2026-07-24T13:59:00.000Z'),
        providerRequestCompletedAt: null,
      },
      now,
    );
    assert.equal(r.classification, 'MARK_UNKNOWN');
  });

  it('SENT → TERMINAL_NO_ACTION', () => {
    const r = classifyDispatchItemRecovery({ status: 'SENT', sentAt: now }, now);
    assert.equal(r.classification, 'TERMINAL_NO_ACTION');
  });

  it('UNKNOWN → MANUAL_REVIEW', () => {
    const r = classifyDispatchItemRecovery(
      { status: 'UNKNOWN_PROVIDER_STATE' },
      now,
    );
    assert.equal(r.classification, 'MANUAL_REVIEW');
  });

  it('providerMessageId em item nao terminal → MANUAL_REVIEW', () => {
    const r = classifyDispatchItemRecovery(
      { status: 'QUEUED', providerMessageId: 'wamid.x' },
      now,
    );
    assert.equal(r.classification, 'MANUAL_REVIEW');
  });
});

describe('evaluateManualRetryEligibility (09.6)', () => {
  it('FAILED transitório elegível', () => {
    const r = evaluateManualRetryEligibility({
      status: 'FAILED',
      errorCategory: 'TRANSIENT_NETWORK',
      attemptCount: 1,
      maxAttempts: 3,
    });
    assert.equal(r.allowed, true);
  });

  it('UNKNOWN bloqueado', () => {
    const r = evaluateManualRetryEligibility({
      status: 'UNKNOWN_PROVIDER_STATE',
      errorCategory: 'TRANSIENT_NETWORK',
    });
    assert.equal(r.allowed, false);
  });

  it('providerMessageId bloqueia', () => {
    const r = evaluateManualRetryEligibility({
      status: 'FAILED',
      errorCategory: 'TRANSIENT_NETWORK',
      providerMessageId: 'wamid.x',
    });
    assert.equal(r.allowed, false);
  });

  it('opt-out bloqueia', () => {
    const r = evaluateManualRetryEligibility({
      status: 'FAILED',
      errorCategory: 'CONTACT_OPT_OUT',
    });
    assert.equal(r.allowed, false);
  });
});
