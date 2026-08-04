import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeTrunkProgress } from './campaign-trunk';

describe('computeTrunkProgress', () => {
  it('marca o primeiro passo incompleto como atual', () => {
    const progress = computeTrunkProgress({
      hasCandidate: true,
      whatsappConnected: false,
      contactCount: 0,
      hasApprovedMessage: false,
      hasMessageDraft: false,
      dispatchCount: 0,
      planCount: 0,
    });

    assert.equal(progress.completedCount, 1);
    assert.equal(progress.nextStep?.id, 'whatsapp');
    assert.equal(progress.steps[0].state, 'done');
    assert.equal(progress.steps[1].state, 'current');
    assert.equal(progress.steps[2].state, 'todo');
  });

  it('considera pronto quando todos os passos estao concluidos', () => {
    const progress = computeTrunkProgress({
      hasCandidate: true,
      whatsappConnected: true,
      contactCount: 10,
      hasApprovedMessage: true,
      hasMessageDraft: false,
      dispatchCount: 2,
      planCount: 1,
    });

    assert.equal(progress.allReady, true);
    assert.equal(progress.nextStep, null);
    assert.equal(progress.completedCount, 5);
  });
});
