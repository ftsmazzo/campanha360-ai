import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  groupMessagesByChannelAccount,
  planConversationChannelRepair,
} from './inbox-conversation-integrity.util';

describe('inbox-conversation-integrity.util', () => {
  it('nao relocate quando todas as mensagens batem com a thread', () => {
    const plan = planConversationChannelRepair({
      id: 'thread-1',
      channelAccountId: 'channel-a',
      contactId: 'contact-1',
      messages: [
        {
          id: 'm1',
          channelAccountId: 'channel-a',
          createdAt: new Date('2026-07-01T10:00:00Z'),
        },
        {
          id: 'm2',
          channelAccountId: 'channel-a',
          createdAt: new Date('2026-07-01T11:00:00Z'),
        },
      ],
    });
    assert.equal(plan.relocate.length, 0);
    assert.equal(plan.backfill.length, 0);
  });

  it('separa mensagens de outro ChannelAccount sem apagar historico', () => {
    const plan = planConversationChannelRepair({
      id: 'thread-1',
      channelAccountId: 'channel-a',
      contactId: 'contact-1',
      messages: [
        {
          id: 'm1',
          channelAccountId: 'channel-a',
          createdAt: new Date('2026-07-01T10:00:00Z'),
        },
        {
          id: 'm2',
          channelAccountId: 'channel-b',
          createdAt: new Date('2026-07-01T11:00:00Z'),
        },
      ],
    });
    assert.deepEqual(plan.relocate, [
      { messageId: 'm2', targetChannelAccountId: 'channel-b' },
    ]);
  });

  it('preenche channelAccountId ausente a partir da thread', () => {
    const plan = planConversationChannelRepair({
      id: 'thread-1',
      channelAccountId: 'channel-a',
      contactId: 'contact-1',
      messages: [
        {
          id: 'm1',
          channelAccountId: null,
          createdAt: new Date('2026-07-01T10:00:00Z'),
        },
      ],
    });
    assert.deepEqual(plan.backfill, [
      { messageId: 'm1', channelAccountId: 'channel-a' },
    ]);
  });

  it('agrupa mensagens por channelAccountId', () => {
    const groups = groupMessagesByChannelAccount([
      {
        id: 'm1',
        channelAccountId: 'a',
        createdAt: new Date(),
      },
      {
        id: 'm2',
        channelAccountId: 'b',
        createdAt: new Date(),
      },
      {
        id: 'm3',
        channelAccountId: 'a',
        createdAt: new Date(),
      },
    ]);
    assert.equal(groups.get('a')?.length, 2);
    assert.equal(groups.get('b')?.length, 1);
  });
});
