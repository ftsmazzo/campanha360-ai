import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildContactListAndClauses,
  buildTagAssociationFilter,
  normalizeTagName,
  resolveApplyContactTag,
  resolveRemoveContactTag,
} from './contact-tag.util';

describe('normalizeTagName', () => {
  it('cria nome de tag normalizado', () => {
    assert.equal(normalizeTagName('  Voluntarios  '), 'Voluntarios');
  });
});

describe('resolveApplyContactTag / resolveRemoveContactTag', () => {
  it('associa tag ao contato quando ainda nao vinculada', () => {
    assert.equal(resolveApplyContactTag(false), 'created');
    assert.equal(resolveApplyContactTag(true), 'unchanged');
  });

  it('remove tag do contato quando vinculada', () => {
    assert.equal(resolveRemoveContactTag(true), 'removed');
    assert.equal(resolveRemoveContactTag(false), 'unchanged');
  });
});

describe('buildContactListAndClauses', () => {
  it('filtra contatos por tag', () => {
    const clauses = buildContactListAndClauses({
      organizationId: 'org-1',
      campaignId: 'camp-1',
      tagId: 'tag-1',
    });

    assert.deepEqual(clauses[0], { organizationId: 'org-1' });
    assert.deepEqual(clauses[1], { campaignId: 'camp-1' });
    assert.ok(
      clauses.some(
        (clause) =>
          'status' in clause &&
          JSON.stringify(clause).includes('DELETED'),
      ),
    );
    assert.deepEqual(clauses.find((clause) => 'tags' in clause), buildTagAssociationFilter('tag-1'));
  });

  it('combina busca por nome/telefone com filtro por tag', () => {
    const clauses = buildContactListAndClauses({
      organizationId: 'org-1',
      campaignId: 'camp-1',
      q: '5511999',
      tagId: 'tag-1',
    });

    assert.equal(clauses.length, 5);
    assert.ok(clauses.some((clause) => 'OR' in clause));
    assert.ok(
      clauses.some(
        (clause) =>
          'tags' in clause &&
          (clause as { tags: { some: { tagId: string } } }).tags.some.tagId === 'tag-1',
      ),
    );
  });
});
