import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sendEvolutionText } from './evolution-send.client';

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    baseUrl: 'https://evolution.example.com',
    apiKey: 'secret-key',
    instanceName: 'campaign-instance',
    destination: '+55 11 99999-0001',
    text: 'Ola mundo',
    idempotencyKey: 'dispatch-1:item-1',
    ...overrides,
  };
}

function mockFetch(handler: (url: string, init: RequestInit) => Promise<Response> | Response) {
  return (async (url: string, init: RequestInit) => handler(url, init)) as unknown as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('sendEvolutionText', () => {
  it('sucesso: retorna providerMessageId a partir de key.id', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    const fetchImpl = mockFetch((url, init) => {
      capturedUrl = url;
      capturedHeaders = init.headers as Record<string, string>;
      return jsonResponse(200, { key: { id: 'MSG123' }, status: 'PENDING' });
    });

    const result = await sendEvolutionText(baseInput({ fetchImpl }));

    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.providerMessageId, 'MSG123');
      assert.equal(result.providerStatus, 'PENDING');
      assert.equal(result.httpStatus, 200);
    }
    assert.ok(capturedUrl.includes('/message/sendText/campaign-instance'));
    assert.equal(capturedHeaders.apikey, 'secret-key');
  });

  it('sucesso sem providerMessageId no corpo: ainda success=true com id null', async () => {
    const fetchImpl = mockFetch(() => jsonResponse(200, {}));
    const result = await sendEvolutionText(baseInput({ fetchImpl }));
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.providerMessageId, null);
    }
  });

  it('HTTP 429: PROVIDER_RATE_LIMIT', async () => {
    const fetchImpl = mockFetch(() => jsonResponse(429, { message: 'rate limited' }));
    const result = await sendEvolutionText(baseInput({ fetchImpl }));
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.category, 'PROVIDER_RATE_LIMIT');
      assert.equal(result.httpStatus, 429);
      assert.equal(result.ambiguous, false);
    }
  });

  it('HTTP 403: AUTHENTICATION_ERROR', async () => {
    const fetchImpl = mockFetch(() => jsonResponse(403, { message: 'forbidden' }));
    const result = await sendEvolutionText(baseInput({ fetchImpl }));
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.category, 'AUTHENTICATION_ERROR');
    }
  });

  it('HTTP 500+: PROVIDER_UNAVAILABLE', async () => {
    const fetchImpl = mockFetch(() => jsonResponse(503, { message: 'unavailable' }));
    const result = await sendEvolutionText(baseInput({ fetchImpl }));
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.category, 'PROVIDER_UNAVAILABLE');
    }
  });

  it('HTTP 404: INVALID_DESTINATION', async () => {
    const fetchImpl = mockFetch(() => jsonResponse(404, { message: 'not found' }));
    const result = await sendEvolutionText(baseInput({ fetchImpl }));
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.category, 'INVALID_DESTINATION');
    }
  });

  it('timeout/abort: UNKNOWN_PROVIDER_STATE ambiguous=true (sem retry automatico)', async () => {
    const fetchImpl = mockFetch(async (_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init.signal as AbortSignal;
        signal.addEventListener('abort', () => {
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });
    const result = await sendEvolutionText(baseInput({ fetchImpl, timeoutMs: 10 }));
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.category, 'UNKNOWN_PROVIDER_STATE');
      assert.equal(result.ambiguous, true);
    }
  });

  it('erro de rede (nao abort): TRANSIENT_NETWORK ambiguous=false', async () => {
    const fetchImpl = mockFetch(() => {
      throw new TypeError('fetch failed');
    });
    const result = await sendEvolutionText(baseInput({ fetchImpl }));
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.category, 'TRANSIENT_NETWORK');
      assert.equal(result.ambiguous, false);
    }
  });

  it('destino ausente: INVALID_DESTINATION sem chamar fetch', async () => {
    let called = false;
    const fetchImpl = mockFetch(() => {
      called = true;
      return jsonResponse(200, {});
    });
    const result = await sendEvolutionText(
      baseInput({ fetchImpl, destination: '' }),
    );
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.category, 'INVALID_DESTINATION');
    }
    assert.equal(called, false);
  });

  it('nunca inclui apiKey/destino/conteudo nas mensagens de erro', async () => {
    const fetchImpl = mockFetch(() => jsonResponse(400, { message: 'bad request with +5511999990001' }));
    const result = await sendEvolutionText(baseInput({ fetchImpl }));
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(!result.errorMessage.includes('5511999990001'));
      assert.ok(!result.errorMessage.includes('secret-key'));
    }
  });
});
