import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { ConfigService } from '@nestjs/config';
import { isDispatchSendEnabled } from '@campanha360/shared';
import {
  DISPATCH_SEND_JOB_OPTIONS,
  DISPATCH_SEND_QUEUE_NAME,
  assertDispatchSendJobPayload,
  buildDispatchSendJobId,
} from './dispatch-queue.constants';
import { DispatchSendProducer } from './dispatch-send.producer';

const FLAG_KEYS = [
  'DISPATCH_ENGINE_ENABLED',
  'DISPATCH_QUEUE_ENABLED',
  'DISPATCH_SEND_ENABLED',
] as const;

function clearFlags(): void {
  for (const key of FLAG_KEYS) delete process.env[key];
}

function fakeConfigService(env: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string) => env[key] ?? process.env[key],
  } as unknown as ConfigService;
}

describe('dispatch-send job contract (apps/api)', () => {
  afterEach(() => {
    clearFlags();
  });

  it('re-exporta as constantes do shared sem espalhar literais', () => {
    assert.equal(DISPATCH_SEND_QUEUE_NAME, 'dispatch-send');
    assert.equal(DISPATCH_SEND_JOB_OPTIONS.attempts, 3);
  });

  it('buildDispatchSendJobId gera jobId deterministico', () => {
    const jobId = buildDispatchSendJobId('dispatch-1', 'item-1');
    assert.equal(jobId, 'dispatch:dispatch-1:item:item-1');
    assert.equal(buildDispatchSendJobId('dispatch-1', 'item-1'), jobId);
  });

  it('aceita payload minimo (somente identificadores)', () => {
    const payload = assertDispatchSendJobPayload({
      dispatchId: 'dispatch-1',
      dispatchItemId: 'item-1',
      organizationId: 'org-1',
      campaignId: 'campaign-1',
    });
    assert.deepEqual(Object.keys(payload).sort(), [
      'campaignId',
      'dispatchId',
      'dispatchItemId',
      'organizationId',
    ]);
  });

  it('rejeita payload com destino/conteudo/token/telefone', () => {
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
      assertDispatchSendJobPayload({ ...base, content: 'Ola, mundo!' }),
    );
    assert.throws(() => assertDispatchSendJobPayload({ ...base, token: 'abc' }));
    assert.throws(() =>
      assertDispatchSendJobPayload({ ...base, telefone: '11999999999' }),
    );
    assert.throws(() =>
      assertDispatchSendJobPayload({ ...base, contactSnapshot: {} }),
    );
  });

  it('DISPATCH_SEND_ENABLED tem default false', () => {
    clearFlags();
    assert.equal(isDispatchSendEnabled(), false);
  });

  it('producer bloqueia enqueueItem quando engine/fila estao desabilitados (default)', async () => {
    clearFlags();
    const producer = new DispatchSendProducer(fakeConfigService());
    await assert.rejects(
      () =>
        producer.enqueueItem({
          dispatchId: 'dispatch-1',
          dispatchItemId: 'item-1',
          organizationId: 'org-1',
          campaignId: 'campaign-1',
        }),
      /desabilitad/i,
    );
  });

  it('producer bloqueia enqueueMany quando engine/fila estao desabilitados (default)', async () => {
    clearFlags();
    const producer = new DispatchSendProducer(fakeConfigService());
    await assert.rejects(() =>
      producer.enqueueMany([
        {
          dispatchId: 'dispatch-1',
          dispatchItemId: 'item-1',
          organizationId: 'org-1',
          campaignId: 'campaign-1',
        },
      ]),
    );
  });
});
