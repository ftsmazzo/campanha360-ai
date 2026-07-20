import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ContactStatus } from '@prisma/client';
import {
  buildDefaultContactStatusFilter,
  isContactRemoved,
  resolveContactRemovalMode,
} from './contact-removal.util';

describe('resolveContactRemovalMode', () => {
  it('remove contato sem historico com hard delete', () => {
    assert.equal(
      resolveContactRemovalMode({
        messageCount: 0,
        threadCount: 0,
        optOutCount: 0,
        status: ContactStatus.ACTIVE,
      }),
      'hard',
    );
  });

  it('arquiva contato com historico de mensagens', () => {
    assert.equal(
      resolveContactRemovalMode({
        messageCount: 2,
        threadCount: 1,
        optOutCount: 0,
        status: ContactStatus.ACTIVE,
      }),
      'soft',
    );
  });

  it('preserva opt-out usando soft delete', () => {
    assert.equal(
      resolveContactRemovalMode({
        messageCount: 0,
        threadCount: 0,
        optOutCount: 1,
        status: ContactStatus.BLOCKED,
      }),
      'soft',
    );
  });
});

describe('buildDefaultContactStatusFilter', () => {
  it('nao lista contato removido na listagem padrao', () => {
    assert.deepEqual(buildDefaultContactStatusFilter(undefined), {
      status: { not: ContactStatus.DELETED },
    });
  });

  it('permite filtrar explicitamente por DELETED', () => {
    assert.deepEqual(buildDefaultContactStatusFilter(ContactStatus.DELETED), {
      status: ContactStatus.DELETED,
    });
  });
});

describe('isContactRemoved', () => {
  it('identifica status DELETED', () => {
    assert.equal(isContactRemoved(ContactStatus.DELETED), true);
    assert.equal(isContactRemoved(ContactStatus.ACTIVE), false);
  });
});
