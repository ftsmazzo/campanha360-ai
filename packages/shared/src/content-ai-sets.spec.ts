import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CONTENT_AI_ELECTORAL_SETS_EXAMPLE,
  formatAiSetStructureUserMessage,
  normalizeAiSetsPayload,
  parseAiSetsRawContent,
} from './content-ai-sets.util';
import { validateAiSetsPayload } from './content-coherence.util';

const baseSetMeta = {
  marketingAngle: 'escuta',
  summaryOfChanges: 'ok',
  preservedFacts: true,
};

function objectBlocksSet(overrides: Record<string, unknown> = {}) {
  return {
    greeting: { text: 'Ola, {{firstName}}!', requiresVariables: ['firstName'] },
    body: {
      text: 'Mensagem eleitoral sobre mobilidade urbana no municipio.',
      requiresVariables: [],
    },
    closing: {
      text: 'Qual tema e mais importante para voce?',
      requiresVariables: [],
    },
    ...baseSetMeta,
    ...overrides,
  };
}

describe('09.7.2 AI sets normalize and validate', () => {
  it('FULL_SETS com tres blocos objetos passa', () => {
    const r = validateAiSetsPayload(
      { sets: [objectBlocksSet()] },
      { placement: 'GREETING', mode: 'FULL_SETS' },
    );
    assert.equal(r.ok, true);
  });

  it('FULL_SETS com blocos strings e normalizado e passa', () => {
    const r = validateAiSetsPayload(
      {
        sets: [
          {
            greeting: 'Ola, {{firstName}}!',
            body: 'Proposta eleitoral para a regiao central.',
            closing: 'Posso contar com seu apoio na conversa?',
            marketingAngle: 'proximidade',
            summaryOfChanges: 'tom participativo',
            preservedFacts: true,
          },
        ],
      },
      { placement: 'GREETING', mode: 'FULL_SETS' },
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.sets[0].greeting.text, 'Ola, {{firstName}}!');
      assert.ok(r.sets[0].body.text.includes('eleitoral'));
    }
  });

  it('greeting ausente informa GREETING_MISSING', () => {
    const n = normalizeAiSetsPayload(
      {
        sets: [
          {
            body: { text: 'Corpo' },
            closing: { text: 'Fecha' },
            preservedFacts: true,
          },
        ],
      },
      'FULL_SETS',
    );
    assert.equal(n.ok, false);
    assert.ok(
      n.structureDiagnostics.some((d) => d.reason === 'GREETING_MISSING'),
    );
  });

  it('greeting vazio informa GREETING_TEXT_EMPTY', () => {
    const n = normalizeAiSetsPayload(
      {
        sets: [
          {
            greeting: { text: '   ' },
            body: { text: 'Corpo eleitoral' },
            closing: { text: 'CTA' },
            preservedFacts: true,
          },
        ],
      },
      'FULL_SETS',
    );
    assert.equal(n.ok, false);
    assert.ok(
      n.structureDiagnostics.some((d) => d.reason === 'GREETING_TEXT_EMPTY'),
    );
  });

  it('body ausente informa BODY_MISSING', () => {
    const n = normalizeAiSetsPayload(
      {
        sets: [
          {
            greeting: { text: 'Oi' },
            closing: { text: 'Ate' },
            preservedFacts: true,
          },
        ],
      },
      'FULL_SETS',
    );
    assert.equal(n.ok, false);
    assert.ok(n.structureDiagnostics.some((d) => d.reason === 'BODY_MISSING'));
  });

  it('closing ausente informa CLOSING_MISSING', () => {
    const n = normalizeAiSetsPayload(
      {
        sets: [
          {
            greeting: { text: 'Oi' },
            body: { text: 'Corpo' },
            preservedFacts: true,
          },
        ],
      },
      'FULL_SETS',
    );
    assert.equal(n.ok, false);
    assert.ok(
      n.structureDiagnostics.some((d) => d.reason === 'CLOSING_MISSING'),
    );
  });

  it('JSON em markdown e extraido', () => {
    const raw = `\`\`\`json
${JSON.stringify({ sets: [objectBlocksSet()] })}
\`\`\``;
    const parsed = parseAiSetsRawContent(raw);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.fromMarkdown, true);
      const r = validateAiSetsPayload(parsed.value, {
        placement: 'GREETING',
        mode: 'FULL_SETS',
      });
      assert.equal(r.ok, true);
    }
  });

  it('texto nao JSON informa RESPONSE_NOT_JSON', () => {
    const parsed = parseAiSetsRawContent('isto nao e json');
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.reason, 'RESPONSE_NOT_JSON');
  });

  it('sets ausente informa SETS_MISSING', () => {
    const n = normalizeAiSetsPayload({ variants: [] }, 'FULL_SETS');
    assert.equal(n.ok, false);
    assert.ok(n.structureDiagnostics.some((d) => d.reason === 'SETS_MISSING'));
  });

  it('array vazio informa SETS_EMPTY', () => {
    const n = normalizeAiSetsPayload({ sets: [] }, 'FULL_SETS');
    assert.equal(n.ok, false);
    assert.ok(n.structureDiagnostics.some((d) => d.reason === 'SETS_EMPTY'));
  });

  it('seis sets informa TOO_MANY_SETS', () => {
    const n = normalizeAiSetsPayload(
      {
        sets: [
          objectBlocksSet({ body: { text: 'a1' } }),
          objectBlocksSet({ body: { text: 'a2' } }),
          objectBlocksSet({ body: { text: 'a3' } }),
          objectBlocksSet({ body: { text: 'a4' } }),
          objectBlocksSet({ body: { text: 'a5' } }),
          objectBlocksSet({ body: { text: 'a6' } }),
        ],
      },
      'FULL_SETS',
    );
    assert.equal(n.ok, false);
    assert.ok(n.structureDiagnostics.some((d) => d.reason === 'TOO_MANY_SETS'));
  });

  it('BODY_ONLY nao exige greeting/closing', () => {
    const r = validateAiSetsPayload(
      {
        variants: [
          {
            text: 'Mensagem eleitoral apenas no corpo.',
            summaryOfChanges: 'foco no corpo',
            preservedFacts: true,
          },
        ],
      },
      { placement: 'NONE', mode: 'BODY_ONLY', baseBody: 'base' },
    );
    assert.equal(r.ok, true);
  });

  it('GREETING_ONLY nao exige body/closing', () => {
    const r = validateAiSetsPayload(
      {
        variants: [
          {
            text: 'Ola, {{firstName}}!',
            summaryOfChanges: 'saudacao',
            preservedFacts: true,
          },
        ],
      },
      { placement: 'GREETING', mode: 'GREETING_ONLY', baseBody: 'base' },
    );
    assert.equal(r.ok, true);
  });

  it('CLOSING_ONLY nao exige greeting/body', () => {
    const r = validateAiSetsPayload(
      {
        variants: [
          {
            text: 'Qual proposta e prioridade para voce?',
            summaryOfChanges: 'cta',
            preservedFacts: true,
          },
        ],
      },
      { placement: 'NONE', mode: 'CLOSING_ONLY', baseBody: 'base' },
    );
    assert.equal(r.ok, true);
  });

  it('erro da UI informa conjunto e bloco', () => {
    const msg = formatAiSetStructureUserMessage({
      code: 'AI_SET_BLOCK_INVALID',
      setIndex: 1,
      block: 'greeting',
      reason: 'GREETING_TEXT_EMPTY',
    });
    assert.ok(msg.includes('saudação'));
    assert.ok(msg.includes('mensagem 2'));
    assert.ok(msg.includes('Nenhuma versão foi salva'));
  });

  it('nenhum erro retorna apenas SET_BLOCKS_INVALID', () => {
    const r = validateAiSetsPayload(
      {
        sets: [
          {
            greeting: { text: '' },
            body: { text: 'x' },
            closing: { text: 'y' },
          },
        ],
      },
      { placement: 'NONE', mode: 'FULL_SETS' },
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(!r.errors.includes('SET_BLOCKS_INVALID'));
      assert.ok(
        r.structureDiagnostics.some((d) => d.reason === 'GREETING_TEXT_EMPTY'),
      );
    }
  });

  it('exemplo eleitoral usado no prompt helper', () => {
    const example = JSON.stringify(CONTENT_AI_ELECTORAL_SETS_EXAMPLE);
    assert.ok(example.includes('eleitoral') || example.includes('{{firstName}}'));
    assert.ok(!/recrutamento|vaga de emprego|segurança do trabalho/i.test(example));
  });

  it('payload formato B (strings) detectado', () => {
    const n = normalizeAiSetsPayload(
      {
        sets: [
          {
            greeting: 'Oi',
            body: 'Texto eleitoral',
            closing: 'Responde?',
            preservedFacts: true,
          },
        ],
      },
      'FULL_SETS',
    );
    assert.equal(n.ok, true);
    assert.equal(n.detectedFormat, 'B_STRING_BLOCKS');
  });
});
