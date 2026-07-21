import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ChannelAccountStatus,
  ChannelProvider,
  ProtectionProfile,
} from '@prisma/client';
import { buildProtectionPolicyFromProfile } from './dispatch-plan-protection.constants';
import {
  consolidateMultiInstanceSimulation,
  consolidateMultiInstanceValidation,
  distributeRecipientsCapacityWeighted,
  evaluatePlanChannelHealth,
  resolveEffectiveDailyLimit,
} from './dispatch-plan-multi-instance.util';

const policy = buildProtectionPolicyFromProfile(ProtectionProfile.MODERATE);
const now = new Date('2026-07-21T15:00:00.000Z');

function baseChannel(overrides: Partial<Parameters<typeof evaluatePlanChannelHealth>[0]['channel']> = {}) {
  return {
    id: 'plan-channel-1',
    channelAccountId: 'channel-account-1',
    enabled: true,
    priority: 100,
    weight: 100,
    provider: ChannelProvider.WHATSAPP_EVOLUTION,
    status: ChannelAccountStatus.CONNECTED,
    accountAgeDays: 30,
    assignedRecipients: 0,
    sentToday: 0,
    cooldownUntil: null,
    dailyLimit: null,
    hourlyLimit: null,
    newAccountDailyLimit: null,
    warmupDailyLimit: null,
    ...overrides,
  };
}

describe('dispatch-plan-multi-instance.util', () => {
  it('resolve limite efetivo para conta nova', () => {
    const effective = resolveEffectiveDailyLimit({
      accountAgeDays: 2,
      policy,
    });

    assert.equal(effective, 20);
  });

  it('resolve limite efetivo respeitando override diario do canal', () => {
    const effective = resolveEffectiveDailyLimit({
      accountAgeDays: 30,
      policy,
      channelLimits: { dailyLimit: 120 },
    });

    assert.equal(effective, 120);
  });

  it('marca instancia bloqueada quando desconectada ou arquivada', () => {
    const disconnected = evaluatePlanChannelHealth({
      channel: baseChannel({ status: ChannelAccountStatus.DISCONNECTED }),
      policy,
      now,
    });
    const archived = evaluatePlanChannelHealth({
      channel: baseChannel({ status: ChannelAccountStatus.ARCHIVED }),
      policy,
      now,
    });

    assert.equal(disconnected.eligible, false);
    assert.ok(disconnected.reasons.includes('CANAL_NAO_CONECTADO'));
    assert.equal(archived.eligible, false);
    assert.ok(archived.reasons.includes('CANAL_ARQUIVADO'));
  });

  it('identifica estagio NEW_ACCOUNT e WARMUP', () => {
    const newAccount = evaluatePlanChannelHealth({
      channel: baseChannel({ accountAgeDays: 2 }),
      policy,
      now,
    });
    const warmupPolicy = {
      ...policy,
      newAccountDays: 7,
      warmupDays: 14,
    };
    const warmup = evaluatePlanChannelHealth({
      channel: baseChannel({ accountAgeDays: 10 }),
      policy: warmupPolicy,
      now,
    });

    assert.equal(newAccount.stage, 'NEW_ACCOUNT');
    assert.equal(newAccount.effectiveDailyLimit, 20);
    assert.equal(warmup.stage, 'WARMUP');
    assert.equal(warmup.effectiveDailyLimit, 20);
  });

  it('distribui proporcionalmente sem exceder capacidade', () => {
    const result = distributeRecipientsCapacityWeighted({
      totalEligible: 100,
      channels: [
        {
          id: 'a',
          priority: 1,
          weight: 200,
          effectiveDailyLimit: 80,
          enabled: true,
        },
        {
          id: 'b',
          priority: 2,
          weight: 100,
          effectiveDailyLimit: 80,
          enabled: true,
        },
      ],
    });

    const assignedA = result.assignments.find((item) => item.channelId === 'a')?.count ?? 0;
    const assignedB = result.assignments.find((item) => item.channelId === 'b')?.count ?? 0;

    assert.equal(assignedA + assignedB, 100);
    assert.ok(assignedA > assignedB);
    assert.ok(assignedA <= 80);
    assert.ok(assignedB <= 80);
    assert.equal(result.unassignedCount, 0);
  });

  it('reporta capacidade insuficiente sem atribuir excedente', () => {
    const result = distributeRecipientsCapacityWeighted({
      totalEligible: 100,
      channels: [
        {
          id: 'a',
          priority: 1,
          weight: 100,
          effectiveDailyLimit: 30,
          enabled: true,
        },
        {
          id: 'b',
          priority: 2,
          weight: 100,
          effectiveDailyLimit: 40,
          enabled: true,
        },
      ],
    });

    const assignedTotal = result.assignments.reduce(
      (sum, item) => sum + item.count,
      0,
    );

    assert.equal(assignedTotal, 70);
    assert.equal(result.unassignedCount, 30);
  });

  it('consolida validacao multi-instancia com uma instancia apta', () => {
    const consolidated = consolidateMultiInstanceValidation({
      totalEligibleAudience: 50,
      channels: [baseChannel({ dailyLimit: 200 })],
      policy,
      now,
    });

    assert.equal(consolidated.selectedInstances, 1);
    assert.equal(consolidated.eligibleInstances, 1);
    assert.equal(consolidated.passed, true);
    assert.equal(consolidated.capacityDeficit, 0);
    assert.equal(consolidated.unassignedRecipients, 0);
    assert.equal(consolidated.distribution[0]?.assignedRecipients, 50);
  });

  it('bloqueia plano quando capacidade total e insuficiente', () => {
    const consolidated = consolidateMultiInstanceValidation({
      totalEligibleAudience: 500,
      channels: [
        baseChannel({ id: 'c1', channelAccountId: 'ca1', dailyLimit: 100 }),
        baseChannel({
          id: 'c2',
          channelAccountId: 'ca2',
          priority: 200,
          dailyLimit: 100,
        }),
      ],
      policy,
      now,
    });

    assert.equal(consolidated.passed, false);
    assert.ok(consolidated.capacityDeficit > 0);
    assert.ok(consolidated.unassignedRecipients > 0);
  });

  it('consolida simulacao multi-instancia para varias instancias', () => {
    const consolidated = consolidateMultiInstanceSimulation({
      totalEligibleAudience: 60,
      channels: [
        baseChannel({
          id: 'c1',
          channelAccountId: 'ca1',
          priority: 1,
          weight: 100,
          dailyLimit: 100,
        }),
        baseChannel({
          id: 'c2',
          channelAccountId: 'ca2',
          priority: 2,
          weight: 100,
          dailyLimit: 100,
        }),
      ],
      policy,
      now,
    });

    assert.equal(consolidated.totalAudience, 60);
    assert.equal(consolidated.totalAssigned, 60);
    assert.equal(consolidated.totalUnassigned, 0);
    assert.equal(consolidated.activeInstances, 2);
    assert.ok(consolidated.combinedThroughput > 0);
    assert.ok(consolidated.estimatedOverallEndAt);
    assert.equal(consolidated.channels.length, 2);
  });
});
