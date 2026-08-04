import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  detectSensitiveContent,
  formatSensitiveAttributeError,
  formatSensitiveAttributeUserMessage,
  scanMarketingBriefForSensitive,
} from './content-marketing.util';
import { validateAiSetsPayload } from './content-coherence.util';

describe('09.7.2 sensitive attribute detection (no substring false positives)', () => {
  it('cargo / regiao / organizacao / urgente nao bloqueiam (falso positivo rg)', () => {
    for (const text of [
      'cargo de vereador',
      'região do município',
      'organização da campanha',
      'situação urgente',
      'medida urgente na região central',
    ]) {
      assert.equal(
        detectSensitiveContent(text),
        null,
        `nao deveria bloquear: ${text}`,
      );
    }
  });

  it('RG com contexto de documento bloqueia', () => {
    const withNumber = detectSensitiveContent('RG: 12.345.678-9');
    assert.ok(withNumber);
    assert.equal(withNumber?.matchedTerm, 'rg');
    assert.equal(withNumber?.category, 'PERSONAL_DOCUMENT');
    assert.ok(!withNumber?.safeExcerpt.includes('12.345.678'));

    const registro = detectSensitiveContent('registro geral do eleitor');
    assert.ok(registro);
    assert.equal(registro?.matchedTerm, 'rg');

    const useRg = detectSensitiveContent('use o RG individual do contato');
    assert.ok(useRg);
  });

  it('CPF bloqueia; numero eleitoral nao', () => {
    const cpf = detectSensitiveContent('CPF 123.456.789-00');
    assert.ok(cpf);
    assert.equal(cpf?.matchedTerm, 'cpf');

    assert.equal(
      detectSensitiveContent('número eleitoral 12345'),
      null,
    );
  });

  it('opiniao politica do publico-alvo nao e confundida com dado individual', () => {
    assert.equal(
      detectSensitiveContent(
        'opinião política do público-alvo da campanha',
      ),
      null,
    );
    const individual = detectSensitiveContent(
      'opinião política do contato sobre o candidato',
    );
    assert.ok(individual);
    assert.equal(individual?.matchedTerm, 'opiniao politica individual');
  });

  it('atributo sensivel real continua bloqueado', () => {
    const religiao = detectSensitiveContent('informar religião do eleitor');
    assert.ok(religiao);
    assert.equal(religiao?.category, 'SENSITIVE_ATTRIBUTE');
    assert.equal(religiao?.matchedTerm, 'religiao');
  });

  it('erro informa campo e termo; nunca so SENSITIVE_ATTRIBUTE', () => {
    const match = detectSensitiveContent('RG: 99.999.999-9', {
      field: 'candidateCharacteristics',
    });
    assert.ok(match);
    const err = formatSensitiveAttributeError(match!);
    assert.ok(err.startsWith('SENSITIVE_ATTRIBUTE:rg'));
    assert.ok(err.includes("campo 'candidateCharacteristics'"));
    assert.notEqual(err, 'SENSITIVE_ATTRIBUTE');

    const userMsg = formatSensitiveAttributeUserMessage(match!);
    assert.ok(userMsg.includes('Características relevantes'));
    assert.ok(userMsg.includes('RG'));
    assert.ok(userMsg.includes('Revise esse campo'));
  });

  it('scan do briefing aponta candidateCharacteristics', () => {
    const hit = scanMarketingBriefForSensitive({
      candidateCharacteristics: 'Incluir RG: 11.222.333-4 no perfil',
    });
    assert.ok(hit);
    assert.equal(hit?.field, 'candidateCharacteristics');
  });

  it('validateAiSetsPayload deduplica e nao emite SENSITIVE_ATTRIBUTE generico', () => {
    const r = validateAiSetsPayload(
      {
        sets: [
          {
            greeting: { text: 'Ola!' },
            body: {
              text: 'Envie o RG: 12.345.678-9 e confirme o RG: 12.345.678-9',
            },
            closing: { text: 'Obrigado.' },
            marketingAngle: 'x',
            summaryOfChanges: 'x',
            preservedFacts: true,
          },
          {
            greeting: { text: 'Oi!' },
            body: { text: 'Outro texto com RG: 98.765.432-1' },
            closing: { text: 'Ate.' },
            marketingAngle: 'y',
            summaryOfChanges: 'y',
            preservedFacts: true,
          },
        ],
      },
      { placement: 'NONE', mode: 'FULL_SETS' },
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.diagnostics.length >= 1);
      assert.ok(
        r.errors.every((e) => e !== 'SENSITIVE_ATTRIBUTE'),
        `erros genericos: ${r.errors.join(' | ')}`,
      );
      assert.ok(
        r.errors.every(
          (e) =>
            !e.startsWith('SENSITIVE_ATTRIBUTE') ||
            e.includes(':') && e.length > 'SENSITIVE_ATTRIBUTE'.length,
        ),
      );
      const sensitiveErrors = r.errors.filter((e) =>
        e.startsWith('SENSITIVE_ATTRIBUTE:'),
      );
      const unique = new Set(sensitiveErrors);
      assert.equal(unique.size, sensitiveErrors.length);
      assert.ok(
        sensitiveErrors.some((e) => e.includes("bloco 'body'")),
      );
    }
  });

  it('texto eleitoral permitido nao bloqueia sets', () => {
    const r = validateAiSetsPayload(
      {
        sets: [
          {
            greeting: { text: 'Ola, {{firstName}}!' },
            body: {
              text: 'Candidato a cargo de vereador na região do município. Organização da campanha em situação urgente. Número eleitoral 12345.',
            },
            closing: { text: 'Posso te ajudar?' },
            marketingAngle: 'relevancia',
            summaryOfChanges: 'ok',
            preservedFacts: true,
          },
        ],
      },
      { placement: 'GREETING', mode: 'FULL_SETS' },
    );
    assert.equal(r.ok, true);
  });
});
