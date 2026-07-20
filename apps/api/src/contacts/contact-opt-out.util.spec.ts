import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ContactStatus } from '@prisma/client';
import { resolveStatusAfterClearOptOut } from './contact-opt-out.util';

describe('resolveStatusAfterClearOptOut', () => {
  it('reativa contato bloqueado', () => {
    assert.equal(resolveStatusAfterClearOptOut(ContactStatus.BLOCKED), ContactStatus.ACTIVE);
  });

  it('nao altera status ativo ou invalido', () => {
    assert.equal(resolveStatusAfterClearOptOut(ContactStatus.ACTIVE), undefined);
    assert.equal(resolveStatusAfterClearOptOut(ContactStatus.INVALID), undefined);
  });
});
