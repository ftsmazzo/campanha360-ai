import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  assertDispatchQueueAllowed,
  isDispatchEngineEnabled,
  isDispatchQueueEnabled,
  isDispatchSendEnabled,
} from './dispatch-feature-flags';

const FLAG_KEYS = [
  'DISPATCH_ENGINE_ENABLED',
  'DISPATCH_QUEUE_ENABLED',
  'DISPATCH_SEND_ENABLED',
] as const;

function clearFlags(): void {
  for (const key of FLAG_KEYS) delete process.env[key];
}

describe('dispatch-feature-flags', () => {
  afterEach(() => {
    clearFlags();
  });

  it('todas as flags tem default false quando env ausente', () => {
    clearFlags();
    assert.equal(isDispatchEngineEnabled(), false);
    assert.equal(isDispatchQueueEnabled(), false);
    assert.equal(isDispatchSendEnabled(), false);
  });

  it('DISPATCH_SEND_ENABLED nunca assume default true mesmo com engine/queue on', () => {
    clearFlags();
    process.env.DISPATCH_ENGINE_ENABLED = 'true';
    process.env.DISPATCH_QUEUE_ENABLED = 'true';
    assert.equal(isDispatchEngineEnabled(), true);
    assert.equal(isDispatchQueueEnabled(), true);
    assert.equal(isDispatchSendEnabled(), false);
  });

  it('aceita valores truthy comuns (1, true, yes, on)', () => {
    process.env.DISPATCH_SEND_ENABLED = '1';
    assert.equal(isDispatchSendEnabled(), true);
    process.env.DISPATCH_SEND_ENABLED = 'yes';
    assert.equal(isDispatchSendEnabled(), true);
    process.env.DISPATCH_SEND_ENABLED = 'false';
    assert.equal(isDispatchSendEnabled(), false);
  });

  it('assertDispatchQueueAllowed lanca erro por default (engine e queue off)', () => {
    clearFlags();
    assert.throws(() => assertDispatchQueueAllowed());
  });

  it('assertDispatchQueueAllowed lanca erro se so engine estiver on', () => {
    clearFlags();
    process.env.DISPATCH_ENGINE_ENABLED = 'true';
    assert.throws(() => assertDispatchQueueAllowed());
  });

  it('assertDispatchQueueAllowed passa quando engine e queue estao on', () => {
    clearFlags();
    process.env.DISPATCH_ENGINE_ENABLED = 'true';
    process.env.DISPATCH_QUEUE_ENABLED = 'true';
    assert.doesNotThrow(() => assertDispatchQueueAllowed());
  });
});
