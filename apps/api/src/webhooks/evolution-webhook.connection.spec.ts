import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractEvolutionConnectionMeta,
  extractEvolutionConnectionState,
  isConnectionUpdateEvent,
} from './evolution-webhook.normalizer';

describe('connection.update meta (2.3.7)', () => {
  it('detecta CONNECTION_UPDATE', () => {
    assert.equal(isConnectionUpdateEvent('CONNECTION_UPDATE'), true);
  });

  it('extrai state close + statusReason 401 + device_removed', () => {
    const meta = extractEvolutionConnectionMeta({
      event: 'connection.update',
      data: {
        state: 'close',
        statusReason: 401,
        error: { code: 401, type: 'device_removed' },
      },
    });
    assert.equal(meta.state, 'close');
    assert.equal(meta.statusReason, '401');
    assert.equal(meta.reasonType, 'device_removed');
  });

  it('HTTP-like 200 + close nao vira open', () => {
    assert.equal(
      extractEvolutionConnectionState({ data: { state: 'close', statusReason: 200 } }),
      'close',
    );
  });
});
