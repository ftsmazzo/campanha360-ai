import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ChannelAccountStatus,
  ChannelProvider,
  DispatchPlanStatus,
} from '@prisma/client';
import { hashDispatchPlanContent } from '../dispatch-plans/dispatch-plan-approval.util';
import {
  assertChannelReadyForDispatchCreation,
  buildDispatchConfigurationSnapshot,
  buildDispatchContentSnapshot,
  canCreateDispatchFromPlan,
} from './dispatch.util';

describe('dispatch.util', () => {
  const approvalSnapshot = {
    approvedVersion: 5,
    content: {
      type: 'TEXT',
      body: 'Mensagem aprovada',
      hash: hashDispatchPlanContent('Mensagem aprovada'),
      length: 'Mensagem aprovada'.length,
    },
  };

  it('permite criar apenas a partir de Plano APPROVED completo', () => {
    const base = {
      status: DispatchPlanStatus.APPROVED,
      approvedAt: new Date(),
      approvedByUserId: 'user-1',
      approvalSnapshot,
      snapshotCreatedAt: new Date(),
      totalEligible: 10,
      validationSnapshot: { passed: true },
      validatedVersion: 5,
      planVersion: 5,
      simulationSnapshot: { estimates: {} },
      simulatedVersion: 5,
    };
    assert.equal(canCreateDispatchFromPlan(base).ok, true);
    assert.equal(
      canCreateDispatchFromPlan({
        ...base,
        status: DispatchPlanStatus.VALIDATED,
      }).ok,
      false,
    );
    assert.equal(
      canCreateDispatchFromPlan({ ...base, simulationSnapshot: null }).ok,
      false,
    );
  });

  it('monta contentSnapshot e rejeita hash divergente', () => {
    const content = buildDispatchContentSnapshot(approvalSnapshot);
    assert.equal(content.body, 'Mensagem aprovada');
    assert.equal(content.hash, approvalSnapshot.content.hash);
    assert.equal(content.approvedVersion, 5);

    assert.throws(() =>
      buildDispatchContentSnapshot({
        approvedVersion: 5,
        content: {
          body: 'Mensagem aprovada',
          hash: '0'.repeat(64),
          length: 10,
        },
      }),
    );
  });

  it('monta configurationSnapshot a partir da simulacao', () => {
    const config = buildDispatchConfigurationSnapshot({
      configuration: {
        requestedMessagesPerMinute: 4,
        minDelaySeconds: 10,
        maxDelaySeconds: 20,
        batchSize: 20,
        pauseBetweenBatchesSeconds: 120,
        timezone: 'America/Sao_Paulo',
        allowedStartTime: '08:00',
        allowedEndTime: '20:00',
        allowedDays: [1, 2, 3, 4, 5, 6],
        plannedStartAt: null,
      },
      estimates: {
        effectiveMessagesPerMinute: 4,
        totalBatches: 2,
        totalBatchPauses: 1,
        estimatedActiveDurationSeconds: 100,
        estimatedCalendarDurationSeconds: 120,
        estimatedStartAt: '2026-07-22T11:00:00.000Z',
        estimatedEndAt: '2026-07-22T11:10:00.000Z',
      },
    });
    assert.equal(config.batchSize, 20);
    assert.equal(config.timezone, 'America/Sao_Paulo');
    assert.equal(config.totalBatches, 2);
  });

  it('aceita canal Evolution mesmo desconectado na 09.1', () => {
    assert.doesNotThrow(() =>
      assertChannelReadyForDispatchCreation({
        channelExists: true,
        channelBelongsToCampaign: true,
        provider: ChannelProvider.WHATSAPP_EVOLUTION,
        status: ChannelAccountStatus.DISCONNECTED,
      }),
    );
    assert.throws(() =>
      assertChannelReadyForDispatchCreation({
        channelExists: true,
        channelBelongsToCampaign: true,
        provider: ChannelProvider.EMAIL,
        status: ChannelAccountStatus.CONNECTED,
      }),
    );
  });
});
