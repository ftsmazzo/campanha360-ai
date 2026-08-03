import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertNoActivePlatformRestriction,
  isPlatformRestrictionActive,
  isPlatformRestrictionDeadlinePassed,
  platformRestrictionReadinessReason,
  sanitizePlatformRestrictionReason,
} from './platform-restriction.util';
import { isChannelOperationallyReady } from './evolution-instance-state.util';

describe('platform restriction', () => {
  const baseReady = {
    localStatus: 'CONNECTED',
    remoteConnectionState: 'CONNECTED' as const,
    sessionState: 'POSSIBLY_PRESENT' as const,
    lastRemoteVerificationAt: new Date(),
  };

  it('conta com restricao nao fica ready', () => {
    const r = isChannelOperationallyReady({
      ...baseReady,
      platformRestrictionStatus: 'DEVICE_LINKING_RESTRICTED',
      platformRestrictedUntil: new Date(Date.now() + 3600_000),
    });
    assert.equal(r.ready, false);
    assert.equal(r.reason, 'PLATFORM_RESTRICTION_ACTIVE');
  });

  it('remoto CONNECTED + restricao ativa continua bloqueado', () => {
    assert.equal(
      isPlatformRestrictionActive({
        platformRestrictionStatus: 'PLATFORM_RESTRICTED',
      }),
      true,
    );
    const guard = assertNoActivePlatformRestriction({
      platformRestrictionStatus: 'MANUAL_COOLDOWN_REQUIRED',
    });
    assert.equal(guard.ok, false);
  });

  it('prazo vencido nao libera sozinho', () => {
    const until = new Date(Date.now() - 60_000);
    assert.equal(
      isPlatformRestrictionDeadlinePassed({
        platformRestrictionStatus: 'DEVICE_LINKING_RESTRICTED',
        platformRestrictedUntil: until,
      }),
      true,
    );
    assert.equal(
      isPlatformRestrictionActive({
        platformRestrictionStatus: 'DEVICE_LINKING_RESTRICTED',
        platformRestrictedUntil: until,
      }),
      true,
    );
    const r = isChannelOperationallyReady({
      ...baseReady,
      platformRestrictionStatus: 'DEVICE_LINKING_RESTRICTED',
      platformRestrictedUntil: until,
      requiresManualReview: true,
    });
    assert.equal(r.ready, false);
    assert.equal(r.reason, 'PLATFORM_RESTRICTION_REVIEW_REQUIRED');
    assert.equal(
      platformRestrictionReadinessReason({
        platformRestrictionStatus: 'DEVICE_LINKING_RESTRICTED',
        platformRestrictedUntil: until,
      }),
      'PLATFORM_RESTRICTION_REVIEW_REQUIRED',
    );
  });

  it('NONE nao bloqueia', () => {
    assert.equal(
      assertNoActivePlatformRestriction({ platformRestrictionStatus: 'NONE' }).ok,
      true,
    );
    const r = isChannelOperationallyReady({
      ...baseReady,
      platformRestrictionStatus: 'NONE',
    });
    assert.equal(r.ready, true);
  });

  it('reasonSafe e sanitizado', () => {
    const safe = sanitizePlatformRestrictionReason(
      'suspeita spam apikey=secret-key-123 +5511999887766',
    );
    assert.ok(safe);
    assert.ok(!safe!.includes('secret-key'));
    assert.ok(!safe!.includes('5511999887766'));
  });

  it('outra conta sem campo nao herda restricao', () => {
    assert.equal(
      assertNoActivePlatformRestriction({
        platformRestrictionStatus: null,
      }).ok,
      true,
    );
  });
});
