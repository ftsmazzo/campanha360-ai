import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_INVITE_INTENTION,
  buildInviteMarketingBriefFromCandidate,
  marketingBriefQualityHints,
} from './content-marketing.util';

describe('buildInviteMarketingBriefFromCandidate', () => {
  it('preenche campos recomendados a partir do candidato', () => {
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
    assert.equal(brief.personalizationPlacement, 'GREETING');
    assert.equal(brief.additionalInstructions, DEFAULT_INVITE_INTENTION);
    assert.ok((brief.forbiddenClaims ?? []).some((c) => /voto/i.test(c)));
  });

  it('aceita intencao customizada', () => {
    const brief = buildInviteMarketingBriefFromCandidate(null, 'Convite suave para pautas locais');
    assert.equal(brief.additionalInstructions, 'Convite suave para pautas locais');
    assert.ok(brief.objective);
    assert.ok(brief.callToAction);
  });
});
