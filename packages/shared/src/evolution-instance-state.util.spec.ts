import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyEvolutionRemoteState,
  isChannelOperationallyReady,
  isQrAllowedForRemoteState,
  shouldApplyStateUpdate,
} from './evolution-instance-state.util';

describe('classifyEvolutionRemoteState', () => {
  it('open → CONNECTED', () => {
    const s = classifyEvolutionRemoteState({
      instanceExists: true,
      rawState: 'open',
    });
    assert.equal(s.normalizedConnectionState, 'CONNECTED');
  });

  it('close sem motivo definitivo → DISCONNECTED_WITH_SESSION', () => {
    const s = classifyEvolutionRemoteState({
      instanceExists: true,
      rawState: 'close',
      statusReason: '200',
      hasSessionEvidence: true,
    });
    assert.equal(s.normalizedConnectionState, 'DISCONNECTED_WITH_SESSION');
    assert.equal(s.recommendedAction, 'RECONNECT');
  });

  it('401 + device_removed → DEVICE_REMOVED', () => {
    const s = classifyEvolutionRemoteState({
      instanceExists: true,
      rawState: 'close',
      statusReason: '401',
      conflictType: 'device_removed',
      streamErrorCode: 401,
    });
    assert.equal(s.normalizedConnectionState, 'DEVICE_REMOVED');
    assert.equal(isQrAllowedForRemoteState(s.normalizedConnectionState), true);
  });

  it('515 → RESTART_REQUIRED', () => {
    const s = classifyEvolutionRemoteState({
      instanceExists: true,
      rawState: 'close',
      streamErrorCode: 515,
    });
    assert.equal(s.normalizedConnectionState, 'RESTART_REQUIRED');
    assert.equal(s.recommendedAction, 'RESTART');
  });

  it('logout → LOGGED_OUT', () => {
    const s = classifyEvolutionRemoteState({
      instanceExists: true,
      rawState: 'close',
      loggedOut: true,
    });
    assert.equal(s.normalizedConnectionState, 'LOGGED_OUT');
  });

  it('removed → REMOVED', () => {
    const s = classifyEvolutionRemoteState({
      instanceExists: false,
      removed: true,
    });
    assert.equal(s.normalizedConnectionState, 'REMOVED');
  });

  it('HTTP 200 + state=close nao vira CONNECTED', () => {
    const s = classifyEvolutionRemoteState({
      instanceExists: true,
      rawState: 'close',
      statusReason: '200',
    });
    assert.notEqual(s.normalizedConnectionState, 'CONNECTED');
  });

  it('ausente → NOT_FOUND', () => {
    const s = classifyEvolutionRemoteState({ instanceExists: false });
    assert.equal(s.normalizedConnectionState, 'NOT_FOUND');
  });
});

describe('freshness e readiness', () => {
  it('evento antigo nao sobrescreve', () => {
    assert.equal(
      shouldApplyStateUpdate({
        incomingAt: new Date('2026-07-13T10:00:00Z'),
        currentEventAt: new Date('2026-08-03T12:00:00Z'),
        incomingReceivedAt: new Date('2026-08-03T12:01:00Z'),
        currentUpdatedAt: new Date('2026-08-03T12:00:00Z'),
      }),
      false,
    );
  });

  it('readiness bloqueada se remoto close', () => {
    const r = isChannelOperationallyReady({
      localStatus: 'CONNECTED',
      remoteConnectionState: 'DISCONNECTED_WITH_SESSION',
      sessionState: 'POSSIBLY_PRESENT',
      lastRemoteVerificationAt: new Date(),
    });
    assert.equal(r.ready, false);
  });

  it('QR nao permitido em DISCONNECTED_WITH_SESSION', () => {
    assert.equal(isQrAllowedForRemoteState('DISCONNECTED_WITH_SESSION'), false);
  });
});
