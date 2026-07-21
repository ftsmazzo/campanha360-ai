import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getDispatchProgressSteps } from './dispatches';

function stateOf(status: string, id: string): string {
  return getDispatchProgressSteps(status).find((step) => step.id === id)?.state ?? 'missing';
}

describe('getDispatchProgressSteps', () => {
  it('DRAFT: apenas criacao concluida', () => {
    assert.equal(stateOf('DRAFT', 'creation'), 'done');
    assert.equal(stateOf('DRAFT', 'preparation'), 'pending');
    assert.equal(stateOf('DRAFT', 'queue'), 'pending');
    assert.equal(stateOf('DRAFT', 'execution'), 'pending');
    assert.equal(stateOf('DRAFT', 'completion'), 'pending');
  });

  it('PREPARING: preparacao current', () => {
    assert.equal(stateOf('PREPARING', 'preparation'), 'current');
    assert.equal(stateOf('PREPARING', 'queue'), 'pending');
  });

  it('READY: preparacao concluida, fila pendente', () => {
    assert.equal(stateOf('READY', 'preparation'), 'done');
    assert.equal(stateOf('READY', 'queue'), 'pending');
  });

  it('QUEUED: fila concluida, execucao pendente', () => {
    assert.equal(stateOf('QUEUED', 'preparation'), 'done');
    assert.equal(stateOf('QUEUED', 'queue'), 'done');
    assert.equal(stateOf('QUEUED', 'execution'), 'pending');
  });

  it('RUNNING: fila concluida, execucao current', () => {
    assert.equal(stateOf('RUNNING', 'queue'), 'done');
    assert.equal(stateOf('RUNNING', 'execution'), 'current');
    assert.equal(stateOf('RUNNING', 'completion'), 'pending');
  });

  it('PAUSED: execucao permanece current (em pausa, nao concluido)', () => {
    assert.equal(stateOf('PAUSED', 'execution'), 'current');
    assert.equal(stateOf('PAUSED', 'completion'), 'pending');
  });

  it('COMPLETED: todas as etapas concluidas', () => {
    for (const id of ['creation', 'preparation', 'queue', 'execution', 'completion']) {
      assert.equal(stateOf('COMPLETED', id), 'done');
    }
  });

  it('COMPLETED_WITH_ERRORS: todas as etapas concluidas', () => {
    assert.equal(stateOf('COMPLETED_WITH_ERRORS', 'execution'), 'done');
    assert.equal(stateOf('COMPLETED_WITH_ERRORS', 'completion'), 'done');
  });

  it('FAILED/CANCELED/EMERGENCY_STOPPED: execucao e conclusao marcadas como concluidas (terminal)', () => {
    for (const status of ['FAILED', 'CANCELED', 'EMERGENCY_STOPPED']) {
      assert.equal(stateOf(status, 'execution'), 'done');
      assert.equal(stateOf(status, 'completion'), 'done');
    }
  });
});
