import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildInviteMarketingBriefFromCandidate,
  marketingBriefQualityHints,
} from './content-marketing.util';

describe('buildInviteMarketingBriefFromCandidate', () => {
  it('preenche campos recomendados e numera as pautas', () => {
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
    assert.match(brief.primaryBenefit ?? '', /Saude na ponta/);
    assert.match(brief.differentiators ?? '', /1\. Saude na ponta/);
    assert.match(brief.differentiators ?? '', /2\. Escola em tempo integral/);
    assert.match(brief.additionalInstructions ?? '', /PAUTAS OBRIGATORIAS/);
    assert.match(brief.additionalInstructions ?? '', /isca|pauta concreta/i);
    assert.equal(brief.personalizationPlacement, 'GREETING');
    assert.ok((brief.forbiddenClaims ?? []).some((c) => /voto/i.test(c)));
    assert.ok((brief.forbiddenClaims ?? []).some((c) => /generica/i.test(c)));
  });

  it('aceita intencao customizada e preserva regra de pautas', () => {
    const brief = buildInviteMarketingBriefFromCandidate(
      { name: 'Ana', mainProposals: ['Protecao as mulheres'] },
      'Convite suave para pautas locais',
    );
    assert.match(brief.additionalInstructions ?? '', /Convite suave/);
    assert.match(brief.additionalInstructions ?? '', /Protecao as mulheres/);
    assert.ok(brief.objective);
    assert.ok(brief.callToAction);
  });
});
