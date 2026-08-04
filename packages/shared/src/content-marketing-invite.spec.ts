import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_INVITE_INTENTION,
  buildInviteMarketingBriefFromCandidate,
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
    assert.match(brief.additionalInstructions ?? '', /materia-prima|criterio|criatividade/i);
    assert.doesNotMatch(brief.additionalInstructions ?? '', /PAUTAS OBRIGATORIAS/);
    assert.equal(brief.personalizationPlacement, 'GREETING');
    assert.match(brief.additionalInstructions ?? '', new RegExp(DEFAULT_INVITE_INTENTION.slice(0, 40)));
    assert.ok((brief.forbiddenClaims ?? []).some((c) => /voto/i.test(c)));
    assert.equal(
      (brief.forbiddenClaims ?? []).some((c) => /uma por variacao|generica sem citar/i.test(c)),
      false,
    );
  });

  it('prioriza a intencao customizada do operador', () => {
    const brief = buildInviteMarketingBriefFromCandidate(
      { name: 'Ana', mainProposals: ['Protecao as mulheres'] },
      'Quero um tom mais emocional e proximo',
    );
    assert.match(brief.additionalInstructions ?? '', /tom mais emocional/);
    assert.match(brief.additionalInstructions ?? '', /Protecao as mulheres/);
    assert.ok(brief.objective);
  });
});
