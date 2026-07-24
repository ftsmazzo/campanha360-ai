import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  auditPilotSendIntervals,
  buildProtectionEnforcementMatrix,
  extractFullSendProtectionPolicy,
} from './dispatch-protection-enforcement.util';

describe('extractFullSendProtectionPolicy', () => {
  it('extrai Conservador do snapshot', () => {
    const policy = extractFullSendProtectionPolicy({
      protectionProfile: 'CONSERVATIVE',
      protectionPolicy: {
        minDelaySeconds: 30,
        maxDelaySeconds: 60,
        batchSize: 10,
        pauseBetweenBatchesSeconds: 900,
        longPauseEveryMessages: 30,
        longPauseMinutes: 20,
        hourlyLimit: 15,
        dailyLimitPerInstance: 80,
      },
    });
    assert.equal(policy.minDelaySeconds, 30);
    assert.equal(policy.maxDelaySeconds, 60);
    assert.equal(policy.hourlyLimit, 15);
    assert.equal(policy.batchSize, 10);
  });
});

describe('buildProtectionEnforcementMatrix', () => {
  it('marca delay como APPLIED quando ha reserva atomica', () => {
    const rows = buildProtectionEnforcementMatrix({
      approvalSnapshot: {
        protectionPolicy: { minDelaySeconds: 30, maxDelaySeconds: 60, hourlyLimit: 15 },
      },
      hasAtomicReservation: true,
      guardSummary: { dailySentCount: 2, hourlySentCount: 2, violationCount: 0 },
    });
    const delay = rows.find((r) => r.rule.includes('Delay'));
    assert.equal(delay?.status, 'APPLIED');
    assert.equal(delay?.appliedInWorker, true);

    const validate = rows.find((r) => r.rule.includes('Validacao WhatsApp'));
    assert.equal(validate?.status, 'DISABLED');
  });

  it('sem reserva atomica declara delay como DECLARED_ONLY', () => {
    const rows = buildProtectionEnforcementMatrix({
      approvalSnapshot: { protectionPolicy: { minDelaySeconds: 30 } },
      hasAtomicReservation: false,
    });
    const delay = rows.find((r) => r.rule.includes('Delay'));
    assert.equal(delay?.status, 'DECLARED_ONLY');
  });
});

describe('auditPilotSendIntervals', () => {
  it('detecta violacao quando intervalo < 30s', () => {
    const result = auditPilotSendIntervals({
      dispatchId: 'd1',
      profile: 'CONSERVATIVE',
      minDelaySeconds: 30,
      maxDelaySeconds: 60,
      items: [
        {
          dispatchItemId: 'i1',
          channelAccountId: 'ca1',
          providerRequestStartedAt: '2026-07-24T12:00:00.000Z',
        },
        {
          dispatchItemId: 'i2',
          channelAccountId: 'ca1',
          providerRequestStartedAt: '2026-07-24T12:00:05.000Z',
        },
        {
          dispatchItemId: 'i3',
          channelAccountId: 'ca1',
          providerRequestStartedAt: '2026-07-24T12:00:10.000Z',
        },
      ],
    });
    assert.equal(result.overallVerdict, 'VIOLADO');
    assert.equal(result.violationCount, 2);
  });

  it('respeitado quando intervalos >= 30s', () => {
    const result = auditPilotSendIntervals({
      dispatchId: 'd1',
      profile: 'CONSERVATIVE',
      minDelaySeconds: 30,
      maxDelaySeconds: 60,
      items: [
        {
          dispatchItemId: 'i1',
          channelAccountId: 'ca1',
          providerRequestStartedAt: '2026-07-24T12:00:00.000Z',
        },
        {
          dispatchItemId: 'i2',
          channelAccountId: 'ca1',
          providerRequestStartedAt: '2026-07-24T12:00:35.000Z',
        },
      ],
    });
    assert.equal(result.overallVerdict, 'RESPEITADO');
  });

  it('nao comprovavel sem timestamps', () => {
    const result = auditPilotSendIntervals({
      dispatchId: 'd1',
      profile: 'CONSERVATIVE',
      minDelaySeconds: 30,
      maxDelaySeconds: 60,
      items: [
        { dispatchItemId: 'i1', channelAccountId: 'ca1', providerRequestStartedAt: null },
      ],
    });
    assert.equal(result.overallVerdict, 'NAO_COMPROVAVEL');
  });
});
