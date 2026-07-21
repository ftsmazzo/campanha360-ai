import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CampaignStatus,
  ChannelAccountStatus,
  ChannelProvider,
  DispatchPlanStatus,
} from '@prisma/client';
import {
  DISPATCH_PLAN_CONTENT_MAX_LENGTH,
  DISPATCH_PLAN_INITIAL_ELIGIBLE_LIMIT,
} from './dispatch-plan.constants';
import {
  buildValidationChecks,
  buildValidationSnapshot,
  canReopenDispatchPlan,
  isValidationCurrent,
  resolveValidationFinalStatus,
  ValidationFacts,
} from './dispatch-plan-validation.util';

function facts(overrides: Partial<ValidationFacts> = {}): ValidationFacts {
  return {
    planStatus: DispatchPlanStatus.DRAFT,
    planVersion: 2,
    content: 'Mensagem valida',
    snapshotCreatedAt: new Date('2026-07-21T12:00:00.000Z'),
    totalEvaluated: 10,
    totalEligible: 8,
    totalExcluded: 2,
    segmentExists: true,
    segmentBelongsToCampaign: true,
    channelAccountId: 'channel-1',
    channelExists: true,
    channelBelongsToCampaign: true,
    channelProvider: ChannelProvider.WHATSAPP_EVOLUTION,
    channelStatus: ChannelAccountStatus.CONNECTED,
    campaignExists: true,
    campaignStatus: CampaignStatus.ACTIVE,
    userCanValidate: true,
    recipientCount: 10,
    eligibleCount: 8,
    excludedCount: 2,
    eligibleOptOutCount: 0,
    eligibleBlockedCount: 0,
    eligibleDeletedCount: 0,
    eligibleInvalidDestinationCount: 0,
    eligibleDuplicateDestinationCount: 0,
    unnamedContactCount: 0,
    ...overrides,
  };
}

function findCheck(code: string, input: ValidationFacts = facts()) {
  const check = buildValidationChecks(input).find((item) => item.code === code);
  assert.ok(check, `check ${code} nao encontrado`);
  return check;
}

describe('dispatch-plan-validation.util', () => {
  it('monta snapshot com summary e channelAccountId real', () => {
    const snapshot = buildValidationSnapshot({
      checkedAt: new Date('2026-07-21T15:00:00.000Z'),
      version: 3,
      facts: facts(),
    });

    assert.equal(snapshot.version, 3);
    assert.equal(snapshot.passed, true);
    assert.equal(snapshot.channel.channelAccountId, 'channel-1');
    assert.equal(snapshot.channel.provider, 'WHATSAPP_EVOLUTION');
    assert.equal(snapshot.summary.errors, 0);
    assert.ok(snapshot.checks.length > 10);
  });

  it('bloqueia sem snapshot e publico elegivel vazio', () => {
    assert.equal(findCheck('SNAPSHOT_EXISTS', facts({ snapshotCreatedAt: null })).passed, false);
    assert.equal(
      findCheck(
        'ELIGIBLE_AUDIENCE_NOT_EMPTY',
        facts({ totalEligible: 0, eligibleCount: 0 }),
      ).passed,
      false,
    );
  });

  it('bloqueia totais inconsistentes e recipients ausentes', () => {
    assert.equal(
      findCheck(
        'SNAPSHOT_TOTALS_CONSISTENT',
        facts({ totalEvaluated: 5, totalEligible: 2, totalExcluded: 1 }),
      ).passed,
      false,
    );
    assert.equal(
      findCheck('RECIPIENTS_EXIST', facts({ recipientCount: 0 })).passed,
      false,
    );
  });

  it('bloqueia destinos duplicados e condicoes proibidas em ELIGIBLE', () => {
    assert.equal(
      findCheck(
        'ELIGIBLE_DESTINATIONS_UNIQUE',
        facts({ eligibleDuplicateDestinationCount: 2 }),
      ).passed,
      false,
    );
    assert.equal(
      findCheck('NO_ELIGIBLE_OPT_OUT', facts({ eligibleOptOutCount: 1 })).passed,
      false,
    );
    assert.equal(
      findCheck('NO_ELIGIBLE_BLOCKED', facts({ eligibleBlockedCount: 1 })).passed,
      false,
    );
    assert.equal(
      findCheck('NO_ELIGIBLE_DELETED', facts({ eligibleDeletedCount: 1 })).passed,
      false,
    );
    assert.equal(
      findCheck(
        'NO_ELIGIBLE_INVALID_DESTINATION',
        facts({ eligibleInvalidDestinationCount: 1 }),
      ).passed,
      false,
    );
  });

  it('bloqueia canal invalido, arquivado, desconectado ou provider nao suportado', () => {
    assert.equal(findCheck('CHANNEL_EXISTS', facts({ channelExists: false })).passed, false);
    assert.equal(
      findCheck(
        'CHANNEL_BELONGS_TO_CAMPAIGN',
        facts({ channelBelongsToCampaign: false }),
      ).passed,
      false,
    );
    assert.equal(
      findCheck(
        'CHANNEL_NOT_ARCHIVED',
        facts({ channelStatus: ChannelAccountStatus.ARCHIVED }),
      ).passed,
      false,
    );
    assert.equal(
      findCheck(
        'CHANNEL_CONNECTED',
        facts({ channelStatus: ChannelAccountStatus.DISCONNECTED }),
      ).passed,
      false,
    );
    assert.equal(
      findCheck(
        'CHANNEL_PROVIDER_SUPPORTED',
        facts({ channelProvider: ChannelProvider.EMAIL }),
      ).passed,
      false,
    );
  });

  it('canal conectado e suportado passa', () => {
    assert.equal(findCheck('CHANNEL_CONNECTED').passed, true);
    assert.equal(findCheck('CHANNEL_PROVIDER_SUPPORTED').passed, true);
    assert.equal(findCheck('CHANNEL_NOT_ARCHIVED').passed, true);
  });

  it('bloqueia conteudo vazio ou acima do limite e aceita valido', () => {
    assert.equal(findCheck('CONTENT_NOT_EMPTY', facts({ content: '   ' })).passed, false);
    assert.equal(
      findCheck(
        'CONTENT_LENGTH_VALID',
        facts({ content: 'x'.repeat(DISPATCH_PLAN_CONTENT_MAX_LENGTH + 1) }),
      ).passed,
      false,
    );
    assert.equal(findCheck('CONTENT_LENGTH_VALID').passed, true);
  });

  it('bloqueia volume acima do limite inicial de 100', () => {
    assert.equal(
      findCheck(
        'VOLUME_WITHIN_INITIAL_LIMIT',
        facts({
          totalEligible: DISPATCH_PLAN_INITIAL_ELIGIBLE_LIMIT + 1,
          eligibleCount: DISPATCH_PLAN_INITIAL_ELIGIBLE_LIMIT + 1,
        }),
      ).passed,
      false,
    );
    assert.equal(
      findCheck(
        'VOLUME_WITHIN_INITIAL_LIMIT',
        facts({
          totalEligible: DISPATCH_PLAN_INITIAL_ELIGIBLE_LIMIT,
          eligibleCount: DISPATCH_PLAN_INITIAL_ELIGIBLE_LIMIT,
        }),
      ).passed,
      true,
    );
  });

  it('bloqueia campanha indisponivel e usuario sem permissao', () => {
    assert.equal(
      findCheck(
        'CAMPAIGN_AVAILABLE',
        facts({ campaignStatus: CampaignStatus.ARCHIVED }),
      ).passed,
      false,
    );
    assert.equal(
      findCheck('USER_CAN_VALIDATE', facts({ userCanValidate: false })).passed,
      false,
    );
  });

  it('resolve status final e reopen', () => {
    assert.equal(
      resolveValidationFinalStatus(true),
      DispatchPlanStatus.VALIDATED,
    );
    assert.equal(
      resolveValidationFinalStatus(false),
      DispatchPlanStatus.BLOCKED,
    );
    assert.equal(canReopenDispatchPlan(DispatchPlanStatus.VALIDATED), true);
    assert.equal(canReopenDispatchPlan(DispatchPlanStatus.BLOCKED), true);
    assert.equal(canReopenDispatchPlan(DispatchPlanStatus.APPROVED), false);
    assert.equal(canReopenDispatchPlan(DispatchPlanStatus.CANCELED), false);
  });

  it('detecta se validacao corresponde a versao atual', () => {
    assert.equal(
      isValidationCurrent({
        validationSnapshot: { passed: true },
        validatedVersion: 3,
        planVersion: 3,
      }),
      true,
    );
    assert.equal(
      isValidationCurrent({
        validationSnapshot: { passed: true },
        validatedVersion: 2,
        planVersion: 3,
      }),
      false,
    );
    assert.equal(
      isValidationCurrent({
        validationSnapshot: null,
        validatedVersion: null,
        planVersion: 1,
      }),
      false,
    );
  });

  it('gera ERROR no summary quando ha falha critica', () => {
    const snapshot = buildValidationSnapshot({
      checkedAt: new Date(),
      version: 1,
      facts: facts({ content: '' }),
    });
    assert.equal(snapshot.passed, false);
    assert.ok(snapshot.summary.errors >= 1);
  });
});
