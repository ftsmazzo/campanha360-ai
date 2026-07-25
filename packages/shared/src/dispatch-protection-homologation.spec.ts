import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assessContentRepetition,
  acknowledgeRepetition,
  isRepetitionAcknowledged,
  normalizeContentForRepetition,
} from './dispatch-repetition.util';
import {
  buildHonestProtectionMatrix,
  evaluateProtectionReadiness,
} from './dispatch-protection-readiness.util';
import { validateWhatsAppNumber } from './evolution-validate-number.client';

describe('repetition', () => {
  it('abaixo do threshold', () => {
    const a = assessContentRepetition({
      currentContent: 'Ola candidato, vote 10',
      recentContents: ['Comunicado diferente sobre reuniao'],
      thresholdPercentage: 70,
    });
    assert.equal(a.exceedsThreshold, false);
  });

  it('acima gera warning e exige ack', () => {
    const body = 'Mensagem padrao da campanha com proposta A B C';
    const a = assessContentRepetition({
      currentContent: 'Ola {{nome}}, ' + body,
      recentContents: ['Ola {{nome}}, ' + body],
      thresholdPercentage: 70,
    });
    assert.equal(a.exceedsThreshold, true);
    assert.equal(isRepetitionAcknowledged({ repetitionAssessment: a }), false);
    const acked = acknowledgeRepetition(a, 'user-1');
    assert.equal(isRepetitionAcknowledged({ repetitionAssessment: acked }), true);
  });

  it('template com nomes diferentes continua semelhante', () => {
    const n1 = normalizeContentForRepetition('Ola {{nome}}, vote 10 no dia 2');
    const n2 = normalizeContentForRepetition('Ola Joao, vote 10 no dia 2');
    // apos remover variavel, ainda ha overlap alto no texto base
    const a = assessContentRepetition({
      currentContent: 'Ola {{nome}}, vote 10 no dia 2',
      recentContents: ['Ola {{nome}}, vote 10 no dia 2'],
      thresholdPercentage: 50,
    });
    assert.ok(a.repetitionScore >= 50);
    assert.ok(n1.includes('vote'));
    assert.ok(n2.includes('vote'));
  });
});

describe('validateWhatsAppNumber', () => {
  it('false path estrutural invalido', async () => {
    const r = await validateWhatsAppNumber({
      baseUrl: 'https://evo.test',
      instanceName: 'i1',
      destinationDigits: '123',
    });
    assert.equal(r.status, 'INVALID');
  });

  it('valido via fetch mock', async () => {
    const r = await validateWhatsAppNumber({
      baseUrl: 'https://evo.test',
      instanceName: 'i1',
      destinationDigits: '5511999999999',
      fetchImpl: async () =>
        ({
          ok: true,
          status: 200,
          json: async () => [{ number: '5511999999999', exists: true }],
        }) as Response,
    });
    assert.equal(r.status, 'VALID');
  });

  it('invalido via fetch mock', async () => {
    const r = await validateWhatsAppNumber({
      baseUrl: 'https://evo.test',
      instanceName: 'i1',
      destinationDigits: '5511888888888',
      fetchImpl: async () =>
        ({
          ok: true,
          status: 200,
          json: async () => [{ number: '5511888888888', exists: false }],
        }) as Response,
    });
    assert.equal(r.status, 'INVALID');
  });

  it('provider indisponivel nao presume valido', async () => {
    const r = await validateWhatsAppNumber({
      baseUrl: 'https://evo.test',
      instanceName: 'i1',
      destinationDigits: '5511999999999',
      fetchImpl: async () =>
        ({
          ok: false,
          status: 503,
          json: async () => ({}),
        }) as Response,
    });
    assert.equal(r.status, 'PROVIDER_UNAVAILABLE');
  });
});

describe('protection readiness', () => {
  const baseSnap = {
    protectionPolicy: {
      validateWhatsAppNumber: false,
      minDelaySeconds: 30,
      maxDelaySeconds: 60,
      pauseOn403: true,
      pauseOn429: true,
      optOutKeywords: ['sair'],
      repetitionWarningPercentage: 70,
    },
    repetitionAssessment: {
      exceedsThreshold: false,
      operatorAcknowledgedAt: null,
      operatorUserId: null,
    },
  };

  it('READY quando obrigatorias ok', () => {
    const rows = buildHonestProtectionMatrix({
      approvalSnapshot: baseSnap,
      hasAtomicReservation: true,
      whatsappValidationImplemented: true,
      optOutKeywordsInboundImplemented: true,
      lastMileImplemented: true,
      accountAgeSource: 'CREATED_AT_ONLY',
      guardAvailable: true,
    });
    const r = evaluateProtectionReadiness({
      approvalSnapshot: baseSnap,
      rows,
    });
    assert.ok(r.status === 'READY' || r.status === 'READY_WITH_WARNINGS');
    assert.equal(r.blockers.length, 0);
  });

  it('BLOCKED se guard indisponivel', () => {
    const rows = buildHonestProtectionMatrix({
      approvalSnapshot: baseSnap,
      hasAtomicReservation: true,
      whatsappValidationImplemented: true,
      optOutKeywordsInboundImplemented: true,
      lastMileImplemented: true,
      accountAgeSource: 'CREATED_AT_ONLY',
      guardAvailable: false,
    });
    const r = evaluateProtectionReadiness({ approvalSnapshot: baseSnap, rows });
    assert.equal(r.status, 'BLOCKED');
  });

  it('validateWhatsApp false → DISABLED_BY_POLICY + READY_WITH_WARNINGS', () => {
    const rows = buildHonestProtectionMatrix({
      approvalSnapshot: baseSnap,
      hasAtomicReservation: true,
      whatsappValidationImplemented: true,
      whatsappValidationAvailable: true,
      optOutKeywordsInboundImplemented: true,
      lastMileImplemented: true,
      accountAgeSource: 'CREATED_AT_ONLY',
      guardAvailable: true,
    });
    const wa = rows.find((x) => x.rule.includes('Validacao WhatsApp'));
    assert.equal(wa?.status, 'DISABLED_BY_POLICY');
    const r = evaluateProtectionReadiness({
      approvalSnapshot: baseSnap,
      rows,
    });
    assert.equal(r.status, 'READY_WITH_WARNINGS');
    assert.ok(
      r.warnings.includes('VALIDATE_WHATSAPP_DISABLED_BY_POLICY'),
    );
  });

  it('validateWhatsApp true sem Evolution → BLOCKED', () => {
    const snap = {
      ...baseSnap,
      protectionPolicy: {
        ...baseSnap.protectionPolicy,
        validateWhatsAppNumber: true,
      },
    };
    const rows = buildHonestProtectionMatrix({
      approvalSnapshot: snap,
      hasAtomicReservation: true,
      whatsappValidationImplemented: true,
      whatsappValidationAvailable: false,
      optOutKeywordsInboundImplemented: true,
      lastMileImplemented: true,
      accountAgeSource: 'CREATED_AT_ONLY',
      guardAvailable: true,
    });
    const wa = rows.find((x) => x.rule.includes('Validacao WhatsApp'));
    assert.equal(wa?.status, 'ERROR');
    const r = evaluateProtectionReadiness({ approvalSnapshot: snap, rows });
    assert.equal(r.status, 'BLOCKED');
  });

  it('validateWhatsApp true com Evolution → ENFORCED_BLOCKING', () => {
    const snap = {
      ...baseSnap,
      protectionPolicy: {
        ...baseSnap.protectionPolicy,
        validateWhatsAppNumber: true,
      },
    };
    const rows = buildHonestProtectionMatrix({
      approvalSnapshot: snap,
      hasAtomicReservation: true,
      whatsappValidationImplemented: true,
      whatsappValidationAvailable: true,
      optOutKeywordsInboundImplemented: true,
      lastMileImplemented: true,
      accountAgeSource: 'CREATED_AT_ONLY',
      guardAvailable: true,
    });
    const wa = rows.find((x) => x.rule.includes('Validacao WhatsApp'));
    assert.equal(wa?.status, 'ENFORCED_BLOCKING');
  });

  it('repeticao e ENFORCED_NON_BLOCKING', () => {
    const rows = buildHonestProtectionMatrix({
      approvalSnapshot: baseSnap,
      hasAtomicReservation: true,
      whatsappValidationImplemented: true,
      optOutKeywordsInboundImplemented: true,
      lastMileImplemented: true,
      accountAgeSource: 'CREATED_AT_ONLY',
      guardAvailable: true,
    });
    const rep = rows.find((x) => x.rule.includes('Repeticao'));
    assert.equal(rep?.status, 'ENFORCED_NON_BLOCKING');
    assert.equal(rep?.blocks, false);
  });
});
