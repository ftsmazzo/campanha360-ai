import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DISPATCH_SEND_JOB_OPTIONS,
  DISPATCH_SEND_QUEUE_NAME,
  assertDispatchSendJobPayload,
  buildDispatchSendJobId,
} from './dispatch-queue.constants';

describe('dispatch-queue.constants', () => {
  it('DISPATCH_SEND_QUEUE_NAME e estavel', () => {
    assert.equal(DISPATCH_SEND_QUEUE_NAME, 'dispatch-send');
  });

  it('buildDispatchSendJobId gera id deterministico sem ":"', () => {
    assert.equal(
      buildDispatchSendJobId('dispatch-1', 'item-1'),
      'dispatch-send-dispatch-1-item-1',
    );
    assert.equal(
      buildDispatchSendJobId('dispatch-1', 'item-1').includes(':'),
      false,
    );
    assert.equal(
      buildDispatchSendJobId('dispatch-1', 'item-1'),
      buildDispatchSendJobId('dispatch-1', 'item-1'),
    );
  });

  it('buildDispatchSendJobId diferencia items e dispatches', () => {
    const a = buildDispatchSendJobId('dispatch-1', 'item-1');
    const b = buildDispatchSendJobId('dispatch-1', 'item-2');
    const c = buildDispatchSendJobId('dispatch-2', 'item-1');
    assert.notEqual(a, b);
    assert.notEqual(a, c);
    assert.ok(a.includes('dispatch-1'));
    assert.ok(a.includes('item-1'));
    assert.equal(a.includes(' '), false);
  });

  it('buildDispatchSendJobId exige dispatchId e dispatchItemId', () => {
    assert.throws(() => buildDispatchSendJobId('', 'item-1'));
    assert.throws(() => buildDispatchSendJobId('dispatch-1', ''));
  });

  it('assertDispatchSendJobPayload aceita payload minimo', () => {
    const payload = assertDispatchSendJobPayload({
      dispatchId: 'dispatch-1',
      dispatchItemId: 'item-1',
      organizationId: 'org-1',
      campaignId: 'campaign-1',
    });
    assert.deepEqual(payload, {
      dispatchId: 'dispatch-1',
      dispatchItemId: 'item-1',
      organizationId: 'org-1',
      campaignId: 'campaign-1',
    });
  });

  it('assertDispatchSendJobPayload rejeita campos nao permitidos (destination/content/token/telefone)', () => {
    const base = {
      dispatchId: 'dispatch-1',
      dispatchItemId: 'item-1',
      organizationId: 'org-1',
      campaignId: 'campaign-1',
    };
    assert.throws(() =>
      assertDispatchSendJobPayload({ ...base, destination: '+5511999999999' }),
    );
    assert.throws(() =>
      assertDispatchSendJobPayload({ ...base, content: 'Ola!' }),
    );
    assert.throws(() => assertDispatchSendJobPayload({ ...base, token: 'abc' }));
    assert.throws(() =>
      assertDispatchSendJobPayload({ ...base, telefone: '11999999999' }),
    );
  });

  it('assertDispatchSendJobPayload rejeita campos ausentes ou vazios', () => {
    assert.throws(() =>
      assertDispatchSendJobPayload({
        dispatchId: 'dispatch-1',
        dispatchItemId: '',
        organizationId: 'org-1',
        campaignId: 'campaign-1',
      }),
    );
    assert.throws(() => assertDispatchSendJobPayload({}));
    assert.throws(() => assertDispatchSendJobPayload(null));
    assert.throws(() => assertDispatchSendJobPayload('dispatch-1'));
  });

  it('DISPATCH_SEND_JOB_OPTIONS mantem retry conservador', () => {
    assert.equal(DISPATCH_SEND_JOB_OPTIONS.attempts, 3);
    assert.equal(DISPATCH_SEND_JOB_OPTIONS.backoff.type, 'exponential');
    assert.equal(DISPATCH_SEND_JOB_OPTIONS.backoff.delay, 2000);
  });
});
