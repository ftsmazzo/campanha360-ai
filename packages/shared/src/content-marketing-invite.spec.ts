import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_INVITE_INTENTION,
  buildInviteMarketingBriefFromCandidate,
  composeInviteOperatorInstructions,
  marketingBriefQualityHints,
} from './content-marketing.util';

describe('buildInviteMarketingBriefFromCandidate', () => {
  it('entrega contexto rico sem checklist mecanico de pautas', () => {
    const brief = buildInviteMarketingBriefFromCandidate(
      {
        name: 'Maria Silva',
        office: 'Vereadora',
        party: 'Partido X',
        bio: 'Defende saude e educacao',
        toneOfVoice: 'acolhedor',
        mainProposals: ['Saude na ponta', 'Escola em tempo integral'],
        restrictedTopics: ['promessas ilegais'],
      },
      undefined,
    );

    const hints = marketingBriefQualityHints(brief);
    assert.equal(hints.readyForGeneration, true);
    assert.match(brief.candidateCharacteristics ?? '', /Maria Silva/);
    assert.match(brief.differentiators ?? '', /1\. Saude na ponta/);
    assert.match(brief.additionalInstructions ?? '', /MATERIAL CONCRETO/);
    assert.match(brief.additionalInstructions ?? '', /Saude na ponta/);
    assert.doesNotMatch(brief.additionalInstructions ?? '', /PAUTAS OBRIGATORIAS/);
    assert.equal(brief.personalizationPlacement, 'GREETING');
    assert.match(
      brief.additionalInstructions ?? '',
      new RegExp(DEFAULT_INVITE_INTENTION.slice(0, 40)),
    );
    assert.ok((brief.forbiddenClaims ?? []).some((c) => /voto/i.test(c)));
    assert.ok(
      (brief.forbiddenClaims ?? []).some((c) => /generico sem ancoragem/i.test(c)),
    );
  });

  it('prioriza a intencao customizada do operador e mantem as pautas', () => {
    const brief = buildInviteMarketingBriefFromCandidate(
      { name: 'Ana', mainProposals: ['Protecao as mulheres'] },
      'Quero um tom mais emocional e proximo',
    );
    assert.match(brief.additionalInstructions ?? '', /tom mais emocional/);
    assert.match(brief.additionalInstructions ?? '', /Protecao as mulheres/);
    assert.ok(brief.objective);
  });
});

describe('composeInviteOperatorInstructions', () => {
  it('nunca devolve so a intencao quando ha pautas', () => {
    const text = composeInviteOperatorInstructions({
      intention: 'Faca convites persuasivos',
      proposals: ['Creche em tempo integral', 'Transporte para idosos'],
      bio: 'Assistente social',
      toneOfVoice: 'proximo',
    });
    assert.match(text, /PEDIDO DO OPERADOR/);
    assert.match(text, /MATERIAL CONCRETO/);
    assert.match(text, /Creche em tempo integral/);
    assert.match(text, /Assistente social/);
    assert.match(text, /proximo/);
    assert.match(text, /Proibido soar institucional/);
  });
});
