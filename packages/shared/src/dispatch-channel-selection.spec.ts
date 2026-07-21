import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildReassignmentUpdate,
  canReassignDispatchItem,
  selectNextEligibleDispatchChannel,
  type SelectableDispatchChannel,
} from './dispatch-channel-selection';

function channel(
  overrides: Partial<SelectableDispatchChannel> & { id: string },
): SelectableDispatchChannel {
  return {
    channelAccountId: `acc-${overrides.id}`,
    enabled: true,
    priority: 100,
    weight: 100,
    effectiveDailyLimit: 50,
    assignedItems: 0,
    sentItems: 0,
    operationalStatus: 'READY',
    connected: true,
    archived: false,
    ...overrides,
  };
}

describe('dispatch-channel-selection (shared)', () => {
  it('escolhe por prioridade e peso com capacidade', () => {
    const selected = selectNextEligibleDispatchChannel([
      channel({ id: 'b', priority: 20, weight: 10 }),
      channel({ id: 'a', priority: 10, weight: 50 }),
      channel({ id: 'c', priority: 10, weight: 80 }),
    ]);
    assert.equal(selected?.id, 'c');
  });

  it('ignora desconectado, arquivado, cooldown e sem capacidade', () => {
    const now = new Date('2026-07-21T12:00:00.000Z');
    const selected = selectNextEligibleDispatchChannel(
      [
        channel({ id: 'off', connected: false }),
        channel({ id: 'arch', archived: true }),
        channel({
          id: 'cool',
          cooldownUntil: new Date('2026-07-21T13:00:00.000Z'),
        }),
        channel({ id: 'full', assignedItems: 40, sentItems: 10 }),
        channel({ id: 'ok', priority: 50 }),
      ],
      { now },
    );
    assert.equal(selected?.id, 'ok');
  });

  it('nao realoca SENT DELIVERED READ UNKNOWN CANCELED', () => {
    assert.equal(canReassignDispatchItem('SENT'), false);
    assert.equal(canReassignDispatchItem('DELIVERED'), false);
    assert.equal(canReassignDispatchItem('READ'), false);
    assert.equal(canReassignDispatchItem('UNKNOWN_PROVIDER_STATE'), false);
    assert.equal(canReassignDispatchItem('CANCELED'), false);
    assert.equal(canReassignDispatchItem('PENDING'), true);
    assert.equal(canReassignDispatchItem('FAILED'), true);
  });

  it('buildReassignmentUpdate preserva original e incrementa contador', () => {
    const update = buildReassignmentUpdate(
      {
        dispatchChannelId: 'ch-1',
        originalDispatchChannelId: null,
        channelAccountId: 'acc-1',
        reassignmentCount: 0,
        status: 'PENDING',
      },
      { id: 'ch-2', channelAccountId: 'acc-2' },
      new Date('2026-07-21T12:00:00.000Z'),
    );
    assert.equal(update.dispatchChannelId, 'ch-2');
    assert.equal(update.originalDispatchChannelId, 'ch-1');
    assert.equal(update.reassignmentCount, 1);
  });

  it('falha ao realocar item SENT', () => {
    assert.throws(() =>
      buildReassignmentUpdate(
        {
          dispatchChannelId: 'ch-1',
          originalDispatchChannelId: null,
          channelAccountId: 'acc-1',
          reassignmentCount: 0,
          status: 'SENT',
        },
        { id: 'ch-2', channelAccountId: 'acc-2' },
      ),
    );
  });
});
