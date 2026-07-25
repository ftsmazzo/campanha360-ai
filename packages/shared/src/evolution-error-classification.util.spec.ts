import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyEvolutionSendFailure,
  resolveProtectionThroughputDisplay,
} from './evolution-error-classification.util';
import { shouldMarkUnconfirmedLegacyContentRejected } from './dispatch-legacy-classification.util';
import { sendEvolutionText } from './evolution-send.client';

describe('classifyEvolutionSendFailure', () => {
  it('HTTP 400 com payload invalido explicito → CONTENT_REJECTED', () => {
    const r = classifyEvolutionSendFailure({
      httpStatus: 400,
      body: { message: 'Invalid payload: text is required' },
    });
    assert.equal(r.category, 'CONTENT_REJECTED');
    assert.equal(r.acceptanceState, 'NOT_ACCEPTED');
  });

  it('HTTP 400 com instance disconnected → CHANNEL_DISCONNECTED', () => {
    const r = classifyEvolutionSendFailure({
      httpStatus: 400,
      body: { message: 'Instance disconnected' },
    });
    assert.equal(r.category, 'CHANNEL_DISCONNECTED');
  });

  it('HTTP 400 generico → PROVIDER_BAD_REQUEST', () => {
    const r = classifyEvolutionSendFailure({
      httpStatus: 400,
      body: { message: 'Bad Request' },
    });
    assert.equal(r.category, 'PROVIDER_BAD_REQUEST');
    assert.notEqual(r.category, 'CONTENT_REJECTED');
    assert.equal(r.evidence.providerErrorMessageSafe, 'Bad Request');
  });

  it('HTTP 400 Evolution com response.message[] preserva texto sanitizado', () => {
    const r = classifyEvolutionSendFailure({
      httpStatus: 400,
      body: {
        status: 400,
        error: 'Bad Request',
        response: {
          message: ['Error: unable to send to +5511999887766'],
        },
      },
    });
    assert.equal(r.category, 'PROVIDER_BAD_REQUEST');
    assert.ok(r.evidence.providerErrorMessageSafe);
    assert.match(
      r.evidence.providerErrorMessageSafe!,
      /unable to send/i,
    );
    assert.doesNotMatch(
      r.evidence.providerErrorMessageSafe!,
      /5511999887766/,
    );
  });

  it('HTTP 400 com corpo JSON sem message usa rawText sanitizado', () => {
    const raw = JSON.stringify({
      status: 400,
      reason: 'exists=false for 5511888777666',
    });
    const r = classifyEvolutionSendFailure({
      httpStatus: 400,
      body: JSON.parse(raw),
      rawText: raw,
    });
    assert.equal(r.category, 'PROVIDER_BAD_REQUEST');
    assert.ok(r.evidence.providerErrorMessageSafe);
    assert.match(r.evidence.providerErrorMessageSafe!, /exists=false/);
    assert.doesNotMatch(r.evidence.providerErrorMessageSafe!, /5511888777666/);
  });

  it('Connection Closed → PROVIDER_CONNECTION_CLOSED', () => {
    const r = classifyEvolutionSendFailure({
      httpStatus: null,
      networkErrorMessage: 'Connection Closed',
    });
    assert.equal(r.category, 'PROVIDER_CONNECTION_CLOSED');
  });

  it('timeout/abort → UNKNOWN_PROVIDER_STATE ambiguous', () => {
    const r = classifyEvolutionSendFailure({
      httpStatus: null,
      aborted: true,
    });
    assert.equal(r.category, 'UNKNOWN_PROVIDER_STATE');
    assert.equal(r.ambiguous, true);
    assert.equal(r.acceptanceState, 'AMBIGUOUS');
  });
});

describe('sendEvolutionText classification', () => {
  function mockFetch(handler: (url: string, init: RequestInit) => Response) {
    return (async (url: string, init: RequestInit) =>
      handler(url, init)) as unknown as typeof fetch;
  }

  it('HTTP 400 generico nao e CONTENT_REJECTED', async () => {
    const result = await sendEvolutionText({
      baseUrl: 'https://evolution.example.com',
      apiKey: 'k',
      instanceName: 'wp02',
      destination: '5511999999999',
      text: 'Oi',
      fetchImpl: mockFetch(
        () =>
          new Response(JSON.stringify({ message: 'Bad Request' }), {
            status: 400,
          }),
      ),
    });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.category, 'PROVIDER_BAD_REQUEST');
    }
  });
});

describe('resolveProtectionThroughputDisplay', () => {
  it('Conservador 30-60s com 1 instancia nao mostra efetiva 4', () => {
    const t = resolveProtectionThroughputDisplay({
      requestedMessagesPerMinute: 4,
      minDelaySeconds: 30,
      maxDelaySeconds: 60,
      instanceCount: 1,
    });
    assert.equal(t.protectionCeilingMessagesPerMinute, 2);
    assert.ok(
      t.averageEstimateMessagesPerMinute != null &&
        Math.abs(t.averageEstimateMessagesPerMinute - 1.3333) < 0.01,
    );
    assert.ok(
      t.effectiveMessagesPerMinute != null && t.effectiveMessagesPerMinute < 2,
    );
    assert.notEqual(t.effectiveMessagesPerMinute, 4);
  });
});

describe('legacy CONTENT_REJECTED', () => {
  it('marca HTTP_400 sem evidencia', () => {
    assert.equal(
      shouldMarkUnconfirmedLegacyContentRejected({
        errorCategory: 'CONTENT_REJECTED',
        errorCode: 'HTTP_400',
      }),
      true,
    );
  });

  it('nao marca quando ha evidencia de payload', () => {
    assert.equal(
      shouldMarkUnconfirmedLegacyContentRejected({
        errorCategory: 'CONTENT_REJECTED',
        errorCode: 'HTTP_400',
        providerErrorMessageSafe: 'Invalid payload: missing required field',
      }),
      false,
    );
  });
});
