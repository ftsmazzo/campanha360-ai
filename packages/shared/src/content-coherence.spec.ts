import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assessEditorialQuality,
  validateAiSetsPayload,
  validateCompositionCoherence,
} from './content-coherence.util';
import {
  hashContentText,
  selectAndRenderComposition,
  type ContentCompositionSnapshotV1,
} from './content-selection.util';
import { renderContentTemplate } from './content-variables.util';

describe('09.7.2 coherence and sets', () => {
  it('geracao FULL_SETS valida greeting/body/closing', () => {
    const r = validateAiSetsPayload(
      {
        sets: [
          {
            greeting: { text: 'Ola, {{firstName}}!', requiresVariables: ['firstName'] },
            body: { text: 'Temos uma oportunidade alinhada ao seu perfil.' },
            closing: { text: 'Posso te enviar os detalhes?' },
            marketingAngle: 'relevancia',
            summaryOfChanges: 'conjunto completo',
            preservedFacts: true,
          },
        ],
      },
      { placement: 'GREETING', mode: 'FULL_SETS' },
    );
    assert.equal(r.ok, true);
  });

  it('GREETING placement rejeita nome no body', () => {
    const r = validateAiSetsPayload(
      {
        sets: [
          {
            greeting: { text: 'Ola, {{firstName}}!' },
            body: { text: '{{firstName}}, veja esta oferta.' },
            closing: { text: 'Responde quando puder.' },
            marketingAngle: 'x',
            summaryOfChanges: 'x',
            preservedFacts: true,
          },
        ],
      },
      { placement: 'GREETING', mode: 'FULL_SETS' },
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(
        r.errors.some(
          (e) =>
            e === 'NAME_IN_WRONG_BLOCK' ||
            e === 'DUPLICATE_NAME_PERSONALIZATION',
        ),
      );
    }
  });

  it('NONE placement nao aceita nome', () => {
    const r = validateAiSetsPayload(
      {
        sets: [
          {
            greeting: { text: 'Ola, {{firstName}}!' },
            body: { text: 'Mensagem.' },
            closing: { text: 'Ate breve.' },
            marketingAngle: 'x',
            summaryOfChanges: 'x',
            preservedFacts: true,
          },
        ],
      },
      { placement: 'NONE', mode: 'FULL_SETS' },
    );
    assert.equal(r.ok, false);
  });

  it('city resolve a partir do contato', () => {
    const r = renderContentTemplate('Voce em {{city}}', {
      name: 'Ana',
      city: 'Campinas',
    });
    assert.equal(r.valid, true);
    assert.equal(r.renderedText, 'Voce em Campinas');
  });

  it('LOCKED_SETS mantem blocos do mesmo generationSetId', () => {
    const snap: ContentCompositionSnapshotV1 = {
      schemaVersion: 1,
      compositionId: 'c1',
      compositionVersion: 1,
      name: 'Teste',
      blockSeparator: '\n\n',
      selectionAlgorithmVersion: 'v2-locked-sets-sha256-mod',
      approvedAt: new Date().toISOString(),
      approvedByUserId: 'u1',
      allowedVariables: ['firstName', 'fullName', 'companyName', 'city'],
      fallbacks: {},
      combinationMode: 'LOCKED_SETS',
      personalizationPlacement: 'GREETING',
      variants: [
        {
          id: 'g1',
          type: 'GREETING',
          source: 'AI_GENERATED',
          text: 'Ola, {{firstName}}!',
          normalizedTextHash: '1',
          enabled: true,
          order: 0,
          requiresVariables: ['firstName'],
          generationSetId: 'setA',
        },
        {
          id: 'b1',
          type: 'BODY',
          source: 'AI_GENERATED',
          text: 'Corpo do conjunto A.',
          normalizedTextHash: '2',
          enabled: true,
          order: 0,
          requiresVariables: [],
          generationSetId: 'setA',
        },
        {
          id: 'c1',
          type: 'CLOSING',
          source: 'AI_GENERATED',
          text: 'Posso te explicar?',
          normalizedTextHash: '3',
          enabled: true,
          order: 0,
          requiresVariables: [],
          generationSetId: 'setA',
        },
        {
          id: 'g2',
          type: 'GREETING',
          source: 'AI_GENERATED',
          text: 'Oi, {{firstName}}!',
          normalizedTextHash: '4',
          enabled: true,
          order: 1,
          requiresVariables: ['firstName'],
          generationSetId: 'setB',
        },
        {
          id: 'b2',
          type: 'BODY',
          source: 'AI_GENERATED',
          text: 'Corpo do conjunto B.',
          normalizedTextHash: '5',
          enabled: true,
          order: 1,
          requiresVariables: [],
          generationSetId: 'setB',
        },
        {
          id: 'c2',
          type: 'CLOSING',
          source: 'AI_GENERATED',
          text: 'Te espero!',
          normalizedTextHash: '6',
          enabled: true,
          order: 1,
          requiresVariables: [],
          generationSetId: 'setB',
        },
      ],
      compositionSnapshotHash: 'h',
    };

    const first = selectAndRenderComposition({
      snapshot: snap,
      dispatchId: 'd1',
      dispatchItemId: 'item-1',
      contactId: 'ct-1',
      contact: { name: 'Frederico Mazzo' },
    });
    const second = selectAndRenderComposition({
      snapshot: snap,
      dispatchId: 'd1',
      dispatchItemId: 'item-1',
      contactId: 'ct-1',
      contact: { name: 'Frederico Mazzo' },
    });
    assert.equal(first.valid, true);
    assert.ok(first.generationSetId);
    assert.equal(first.generationSetId, second.generationSetId);
    assert.equal(first.bodyVariantId, second.bodyVariantId);
    assert.equal(first.greetingVariantId, second.greetingVariantId);
    assert.equal(first.closingVariantId, second.closingVariantId);
    assert.equal(first.renderedTextHash, hashContentText(first.renderedText));
    // greeting e body do mesmo set
    const body = snap.variants.find((v) => v.id === first.bodyVariantId);
    const greeting = snap.variants.find((v) => v.id === first.greetingVariantId);
    assert.equal(body?.generationSetId, greeting?.generationSetId);
  });

  it('duplicata de saudacao no body e bloqueante', () => {
    const alerts = validateCompositionCoherence({
      greeting: 'Ola!',
      body: 'Ola! Quero falar sobre a vaga.',
      closing: 'Responde?',
    });
    assert.ok(alerts.some((a) => a.code === 'MULTIPLE_GREETING' && a.blocking));
  });

  it('qualidade editorial retorna scores', () => {
    const q = assessEditorialQuality({
      greeting: 'Ola!',
      body: 'Oferecemos mentoria pratica para quem busca crescer na carreira.',
      closing: 'Posso te enviar o material?',
      brief: {
        primaryBenefit: 'mentoria pratica',
        callToAction: 'enviar material',
      },
    });
    assert.ok(q.clarityScore >= 0 && q.clarityScore <= 100);
    assert.ok(Array.isArray(q.riskWarnings));
  });
});
