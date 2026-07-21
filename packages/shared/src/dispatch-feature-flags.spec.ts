import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  assertDispatchQueueAllowed,
  assertDispatchSendAllowed,
  getDispatchAllowedDestinations,
  getDispatchPilotMaxItems,
  isDispatchDestinationAllowed,
  isDispatchEngineEnabled,
  isDispatchPilotMode,
  isDispatchQueueEnabled,
  isDispatchSendEnabled,
} from './dispatch-feature-flags';

const FLAG_KEYS = [
  'DISPATCH_ENGINE_ENABLED',
  'DISPATCH_QUEUE_ENABLED',
  'DISPATCH_SEND_ENABLED',
  'DISPATCH_PILOT_MODE',
  'DISPATCH_PILOT_MAX_ITEMS',
  'DISPATCH_ALLOWED_DESTINATIONS',
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

  it('assertDispatchSendAllowed lanca erro por default (todas off)', () => {
    clearFlags();
    assert.throws(() => assertDispatchSendAllowed());
  });

  it('assertDispatchSendAllowed lanca erro se SEND estiver off mesmo com engine+queue on', () => {
    clearFlags();
    process.env.DISPATCH_ENGINE_ENABLED = 'true';
    process.env.DISPATCH_QUEUE_ENABLED = 'true';
    assert.throws(() => assertDispatchSendAllowed());
  });

  it('assertDispatchSendAllowed passa quando engine+queue+send estao on', () => {
    clearFlags();
    process.env.DISPATCH_ENGINE_ENABLED = 'true';
    process.env.DISPATCH_QUEUE_ENABLED = 'true';
    process.env.DISPATCH_SEND_ENABLED = 'true';
    assert.doesNotThrow(() => assertDispatchSendAllowed());
  });

  it('isDispatchPilotMode tem default true (conservador)', () => {
    clearFlags();
    assert.equal(isDispatchPilotMode(), true);
  });

  it('isDispatchPilotMode pode ser desligado explicitamente', () => {
    clearFlags();
    process.env.DISPATCH_PILOT_MODE = 'false';
    assert.equal(isDispatchPilotMode(), false);
  });

  it('getDispatchPilotMaxItems tem default 5', () => {
    clearFlags();
    assert.equal(getDispatchPilotMaxItems(), 5);
  });

  it('getDispatchPilotMaxItems respeita override valido', () => {
    clearFlags();
    process.env.DISPATCH_PILOT_MAX_ITEMS = '10';
    assert.equal(getDispatchPilotMaxItems(), 10);
  });

  it('getDispatchPilotMaxItems ignora valores invalidos (volta ao default)', () => {
    clearFlags();
    process.env.DISPATCH_PILOT_MAX_ITEMS = '-3';
    assert.equal(getDispatchPilotMaxItems(), 5);
    process.env.DISPATCH_PILOT_MAX_ITEMS = 'abc';
    assert.equal(getDispatchPilotMaxItems(), 5);
  });

  it('getDispatchAllowedDestinations vazio por default', () => {
    clearFlags();
    assert.deepEqual(getDispatchAllowedDestinations(), []);
  });

  it('getDispatchAllowedDestinations normaliza CSV para digitos', () => {
    clearFlags();
    process.env.DISPATCH_ALLOWED_DESTINATIONS =
      '+55 11 99999-0001, 5511999990002 ,, (11) 99999-0003';
    assert.deepEqual(getDispatchAllowedDestinations(), [
      '5511999990001',
      '5511999990002',
      '11999990003',
    ]);
  });

  it('isDispatchDestinationAllowed permite tudo quando allowlist vazia', () => {
    clearFlags();
    assert.equal(isDispatchDestinationAllowed('5511999990001'), true);
  });

  it('isDispatchDestinationAllowed bloqueia destino fora da allowlist', () => {
    clearFlags();
    process.env.DISPATCH_ALLOWED_DESTINATIONS = '5511999990001';
    assert.equal(isDispatchDestinationAllowed('5511999990001'), true);
    assert.equal(isDispatchDestinationAllowed('5511999990002'), false);
  });
});
