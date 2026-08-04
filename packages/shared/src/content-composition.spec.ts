import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractContentVariableKeys,
  isAllowedContentVariable,
  isVariantEligibleForContact,
  renderContentTemplate,
  resolveFirstName,
} from './content-variables.util';
import {
  hashContentText,
  selectAndRenderComposition,
  selectDeterministicContentVariant,
  validateAiVariantsPayload,
  type ContentCompositionSnapshotV1,
} from './content-selection.util';

describe('content variables', () => {
  it('parser reconhece variaveis', () => {
    assert.deepEqual(extractContentVariableKeys('Ola {{firstName}}!'), ['firstName']);
    assert.equal(isAllowedContentVariable('firstName'), true);
    assert.equal(isAllowedContentVariable('evil'), false);
  });

  it('variavel desconhecida bloqueia', () => {
    const r = renderContentTemplate('Oi {{unknown}}', { name: 'Ana' });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => e.includes('DESCONHECIDA')));
  });

  it('nome valido resolve', () => {
    assert.equal(resolveFirstName('Frederico Mazzo'), 'Frederico');
    assert.equal(resolveFirstName('  Sheila   Silva '), 'Sheila');
    const r = renderContentTemplate('Ola, {{firstName}}!', { name: 'Frederico Mazzo' });
    assert.equal(r.valid, true);
    assert.equal(r.renderedText, 'Ola, Frederico!');
  });

  it('nome ausente torna variante inelegivel', () => {
    assert.equal(
      isVariantEligibleForContact({
        text: 'Ola, {{firstName}}!',
        contact: { name: null },
      }),
      false,
    );
    assert.equal(
      isVariantEligibleForContact({
        text: 'Ola!',
        contact: { name: null },
      }),
      true,
    );
  });

  it('nenhum placeholder fica no texto', () => {
    const r = renderContentTemplate('Oi {{firstName}}', { name: 'Ana' });
    assert.equal(r.valid, true);
    assert.equal(/\{\{/.test(r.renderedText), false);
  });

  it('fallback funciona', () => {
    const r = renderContentTemplate(
      'Empresa: {{companyName}}',
      { name: 'Ana' },
      { companyName: 'Campanha' },
    );
    assert.equal(r.valid, true);
    assert.equal(r.renderedText, 'Empresa: Campanha');
    assert.deepEqual(r.usedFallbacks, ['companyName']);
  });
});

describe('deterministic selection', () => {
  it('mesma seed retorna mesma combinacao', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const a = selectDeterministicContentVariant({
      dispatchId: 'd1',
      contactId: 'c1',
      contentSnapshotVersion: 1,
      eligibleVariantIds: ids,
      slot: 'BODY',
    });
    const b = selectDeterministicContentVariant({
      dispatchId: 'd1',
      contactId: 'c1',
      contentSnapshotVersion: 1,
      eligibleVariantIds: ids,
      slot: 'BODY',
    });
    assert.equal(a, b);
  });

  it('contatos diferentes distribuem variantes', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const set = new Set(
      ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'].map((contactId) =>
        selectDeterministicContentVariant({
          dispatchId: 'd1',
          contactId,
          contentSnapshotVersion: 1,
          eligibleVariantIds: ids,
          slot: 'BODY',
        }),
      ),
    );
    assert.ok(set.size >= 2);
  });

  it('retry preserva combinacao (mesmo item id)', () => {
    const snap: ContentCompositionSnapshotV1 = {
      schemaVersion: 1,
      compositionId: 'comp1',
      compositionVersion: 2,
      name: 'Teste',
      blockSeparator: '\n\n',
      selectionAlgorithmVersion: 'v1-sha256-mod',
      approvedAt: new Date().toISOString(),
      approvedByUserId: 'u1',
      allowedVariables: ['firstName'],
      fallbacks: {},
      variants: [
        {
          id: 'g1',
          type: 'GREETING',
          source: 'MANUAL',
          text: 'Ola, {{firstName}}!',
          normalizedTextHash: 'x',
          enabled: true,
          order: 0,
          requiresVariables: ['firstName'],
        },
        {
          id: 'g2',
          type: 'GREETING',
          source: 'MANUAL',
          text: 'Ola!',
          normalizedTextHash: 'y',
          enabled: true,
          order: 1,
          requiresVariables: [],
        },
        {
          id: 'b1',
          type: 'BODY',
          source: 'BASE',
          text: 'Mensagem importante.',
          normalizedTextHash: 'z',
          enabled: true,
          order: 0,
          requiresVariables: [],
        },
        {
          id: 'b2',
          type: 'BODY',
          source: 'MANUAL',
          text: 'Outra mensagem.',
          normalizedTextHash: 'w',
          enabled: true,
          order: 1,
          requiresVariables: [],
        },
      ],
      compositionSnapshotHash: 'h',
    };
    const first = selectAndRenderComposition({
      snapshot: snap,
      dispatchId: 'disp',
      dispatchItemId: 'item-1',
      contactId: 'ct-1',
      contact: { name: 'Frederico Mazzo' },
    });
    const second = selectAndRenderComposition({
      snapshot: snap,
      dispatchId: 'disp',
      dispatchItemId: 'item-1',
      contactId: 'ct-1',
      contact: { name: 'Frederico Mazzo' },
    });
    assert.equal(first.valid, true);
    assert.equal(first.bodyVariantId, second.bodyVariantId);
    assert.equal(first.greetingVariantId, second.greetingVariantId);
    assert.equal(first.renderedTextHash, second.renderedTextHash);
    assert.equal(first.renderedTextHash, hashContentText(first.renderedText));
  });

  it('hash muda quando texto muda', () => {
    assert.notEqual(hashContentText('a'), hashContentText('b'));
  });

  it('IA invalida nao passa', () => {
    const r = validateAiVariantsPayload(
      { variants: [{ text: 'igual', summaryOfChanges: 'x', preservedFacts: true }] },
      'igual',
    );
    assert.equal(r.ok, false);
  });

  it('IA schema valido', () => {
    const r = validateAiVariantsPayload(
      {
        variants: [
          {
            text: 'Versao alternativa A',
            summaryOfChanges: 'tom',
            preservedFacts: true,
          },
        ],
      },
      'Mensagem base original',
    );
    assert.equal(r.ok, true);
  });
});
