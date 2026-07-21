import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ChannelAccountStatus,
  ChannelProvider,
  DispatchPlanStatus,
  MembershipRole,
} from '@prisma/client';
import {
  assertChannelReadyForApproval,
  buildApprovalSnapshot,
  canApproveDispatchPlanPreconditions,
  canApproveRole,
  hashDispatchPlanContent,
  isDispatchPlanImmutable,
  normalizeDecisionReason,
} from './dispatch-plan-approval.util';

describe('dispatch-plan-approval.util', () => {
  it('hash do conteudo e deterministico', () => {
    assert.equal(
      hashDispatchPlanContent('mensagem'),
      hashDispatchPlanContent('mensagem'),
    );
    assert.notEqual(
      hashDispatchPlanContent('mensagem'),
      hashDispatchPlanContent('outra'),
    );
    assert.match(hashDispatchPlanContent('mensagem'), /^[a-f0-9]{64}$/);
  });

  it('permite aprovar apenas OWNER e ADMIN', () => {
    assert.equal(canApproveRole(MembershipRole.OWNER), true);
    assert.equal(canApproveRole(MembershipRole.ADMIN), true);
    assert.equal(canApproveRole(MembershipRole.MANAGER), false);
    assert.equal(canApproveRole(MembershipRole.VIEWER), false);
  });

  it('marca APPROVED REJECTED e CANCELED como imutaveis', () => {
    assert.equal(isDispatchPlanImmutable(DispatchPlanStatus.APPROVED), true);
    assert.equal(isDispatchPlanImmutable(DispatchPlanStatus.REJECTED), true);
    assert.equal(isDispatchPlanImmutable(DispatchPlanStatus.CANCELED), true);
    assert.equal(isDispatchPlanImmutable(DispatchPlanStatus.VALIDATED), false);
  });

  it('valida motivo com limites', () => {
    assert.throws(() => normalizeDecisionReason('curto'));
    assert.throws(() => normalizeDecisionReason('x'.repeat(501)));
    assert.equal(
      normalizeDecisionReason('  Motivo adequado para rejeicao  '),
      'Motivo adequado para rejeicao',
    );
  });

  it('exige pre-condicoes de aprovacao', () => {
    const base = {
      status: DispatchPlanStatus.VALIDATED,
      snapshotCreatedAt: new Date(),
      totalEligible: 10,
      content: 'Oi',
      validationSnapshot: { passed: true },
      validatedAt: new Date(),
      validatedVersion: 2,
      planVersion: 2,
      simulationSnapshot: { estimates: {} },
      simulatedAt: new Date(),
      simulatedVersion: 2,
    };
    assert.equal(canApproveDispatchPlanPreconditions(base).ok, true);
    assert.equal(
      canApproveDispatchPlanPreconditions({
        ...base,
        status: DispatchPlanStatus.DRAFT,
      }).ok,
      false,
    );
    assert.equal(
      canApproveDispatchPlanPreconditions({
        ...base,
        simulationSnapshot: null,
      }).ok,
      false,
    );
  });

  it('exige canal conectado e Evolution', () => {
    assert.throws(() =>
      assertChannelReadyForApproval({
        channelExists: true,
        channelBelongsToCampaign: true,
        provider: ChannelProvider.EMAIL,
        status: ChannelAccountStatus.CONNECTED,
      }),
    );
    assert.doesNotThrow(() =>
      assertChannelReadyForApproval({
        channelExists: true,
        channelBelongsToCampaign: true,
        provider: ChannelProvider.WHATSAPP_EVOLUTION,
        status: ChannelAccountStatus.CONNECTED,
      }),
    );
  });

  it('monta approvalSnapshot com hash e conteudo', () => {
    const snapshot = buildApprovalSnapshot({
      approvedAt: new Date('2026-07-21T15:00:00.000Z'),
      approvedByUserId: 'user-1',
      channelProvider: 'WHATSAPP_EVOLUTION',
      plan: {
        id: 'plan-1',
        name: 'Plano',
        campaignId: 'campaign-1',
        segmentId: 'segment-1',
        channelAccountId: 'channel-1',
        channelType: 'WHATSAPP',
        version: 5,
        content: 'Texto aprovado',
        totalEvaluated: 10,
        totalEligible: 8,
        totalExcluded: 2,
        snapshotCreatedAt: new Date('2026-07-21T10:00:00.000Z'),
        validatedAt: new Date('2026-07-21T11:00:00.000Z'),
        validatedVersion: 5,
        validationSnapshot: {
          passed: true,
          summary: { errors: 0, warnings: 1 },
        },
        simulatedAt: new Date('2026-07-21T12:00:00.000Z'),
        simulatedVersion: 5,
        simulationSnapshot: {
          configuration: {
            requestedMessagesPerMinute: 4,
            timezone: 'America/Sao_Paulo',
          },
          estimates: {
            effectiveMessagesPerMinute: 4,
            totalBatches: 1,
            estimatedActiveDurationSeconds: 100,
            estimatedCalendarDurationSeconds: 100,
            estimatedStartAt: '2026-07-22T11:00:00.000Z',
            estimatedEndAt: '2026-07-22T11:10:00.000Z',
          },
        },
      },
    });

    assert.equal(snapshot.approvedVersion, 5);
    assert.equal(snapshot.content.body, 'Texto aprovado');
    assert.equal(snapshot.content.hash, hashDispatchPlanContent('Texto aprovado'));
    assert.equal(snapshot.validation.warningCount, 1);
    assert.equal(snapshot.simulation.timezone, 'America/Sao_Paulo');
  });
});
