import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractEvolutionConnectionState,
  isConnectionUpdateEvent,
  normalizeEvolutionWebhookPayload,
} from './evolution-webhook.normalizer';

describe('evolution-webhook.normalizer connection.update', () => {
  it('detecta eventos connection.update', () => {
    assert.equal(isConnectionUpdateEvent('connection.update'), true);
    assert.equal(isConnectionUpdateEvent('CONNECTION_UPDATE'), true);
    assert.equal(isConnectionUpdateEvent('messages.upsert'), false);
  });

  it('extrai state de payload Evolution', () => {
    assert.equal(
      extractEvolutionConnectionState({
        event: 'connection.update',
        data: { state: 'close' },
      }),
      'close',
    );
    assert.equal(
      extractEvolutionConnectionState({
        event: 'connection.update',
        data: { status: 'open' },
      }),
      'open',
    );
  });

  it('connection.update nao gera inbound de mensagem', () => {
    const items = normalizeEvolutionWebhookPayload({
      event: 'connection.update',
      data: { state: 'close' },
    });
    assert.equal(items.length, 1);
    assert.equal(items[0]?.isInboundMessage, false);
    assert.equal(items[0]?.event, 'connection.update');
  });
});
