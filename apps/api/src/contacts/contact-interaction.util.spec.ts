import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContactInteractionMap } from './contact-interaction.util';

test('buildContactInteractionMap escolhe thread mais recente e soma mensagens', () => {
  const map = buildContactInteractionMap(
    [
      {
        id: 't1',
        contactId: 'c1',
        lastMessageAt: new Date('2026-01-01T10:00:00.000Z'),
        channel: 'WHATSAPP',
      },
      {
        id: 't2',
        contactId: 'c1',
        lastMessageAt: new Date('2026-01-02T10:00:00.000Z'),
        channel: 'WHATSAPP',
      },
      {
        id: 't3',
        contactId: 'c2',
        lastMessageAt: null,
        channel: 'EMAIL',
      },
    ],
    [
      { contactId: 'c1', count: 5 },
      { contactId: 'c2', count: 1 },
      { contactId: null, count: 9 },
    ],
  );

  assert.equal(map.get('c1')?.latestThreadId, 't2');
  assert.equal(map.get('c1')?.messageCount, 5);
  assert.equal(map.get('c1')?.lastInteractionAt, '2026-01-02T10:00:00.000Z');
  assert.equal(map.get('c1')?.latestChannel, 'WHATSAPP');
  assert.equal(map.get('c2')?.latestThreadId, 't3');
  assert.equal(map.get('c2')?.messageCount, 1);
  assert.equal(map.get('c2')?.lastInteractionAt, null);
});

test('buildContactInteractionMap funciona sem mensagens', () => {
  const map = buildContactInteractionMap(
    [
      {
        id: 't1',
        contactId: 'c1',
        lastMessageAt: new Date('2026-03-01T00:00:00.000Z'),
        channel: 'WHATSAPP',
      },
    ],
    [],
  );

  assert.equal(map.get('c1')?.messageCount, 0);
  assert.equal(map.get('c1')?.latestThreadId, 't1');
});
