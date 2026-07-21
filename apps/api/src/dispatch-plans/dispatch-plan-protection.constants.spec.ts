import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DistributionStrategy,
  ProtectionProfile,
} from '@prisma/client';
import {
  DISPATCH_PLAN_DEFAULT_PROTECTION_POLICY,
  buildProtectionPolicyFromProfile,
} from './dispatch-plan-protection.constants';

describe('dispatch-plan-protection.constants', () => {
  it('usa defaults MassFlow Moderado no perfil padrao', () => {
    const policy = buildProtectionPolicyFromProfile(ProtectionProfile.MODERATE);

    assert.equal(policy.minDelaySeconds, 20);
    assert.equal(policy.maxDelaySeconds, 45);
    assert.equal(policy.batchSize, 15);
    assert.equal(policy.pauseBetweenBatchesSeconds, 600);
    assert.equal(policy.longPauseEveryMessages, 50);
    assert.equal(policy.longPauseMinutes, 15);
    assert.equal(policy.dailyLimitPerInstance, 200);
    assert.equal(policy.hourlyLimit, 30);
    assert.equal(policy.newAccountMaxPerDay, 50);
    assert.equal(policy.newAccountDays, 7);
    assert.equal(policy.warmupDays, 7);
    assert.equal(policy.warmupMaxPerDay, 20);
    assert.equal(policy.rotateEveryMessages, 100);
    assert.equal(policy.consecutiveErrorsBeforePause, 3);
    assert.equal(policy.errorPauseMinutes, 60);
    assert.equal(policy.pauseOn403, true);
    assert.equal(policy.pauseOn429, true);
    assert.equal(policy.validateWhatsAppNumber, false);
    assert.equal(policy.repetitionWarningPercentage, 70);
    assert.equal(policy.allowedStartTime, '09:00');
    assert.equal(policy.allowedEndTime, '18:00');
    assert.equal(policy.timezone, 'America/Sao_Paulo');
    assert.equal(
      policy.distributionStrategy,
      DistributionStrategy.CAPACITY_WEIGHTED,
    );
    assert.deepEqual(policy.optOutKeywords, [
      'sair',
      'descadastrar',
      'stop',
      'parar',
      'remover',
      'cancelar',
    ]);
  });

  it('aplica preset Conservador com batchSize size_min', () => {
    const policy = buildProtectionPolicyFromProfile(
      ProtectionProfile.CONSERVATIVE,
    );

    assert.equal(policy.batchSize, 10);
    assert.equal(policy.pauseBetweenBatchesSeconds, 900);
    assert.equal(policy.dailyLimitPerInstance, 80);
    assert.equal(policy.hourlyLimit, 15);
    assert.equal(policy.newAccountDays, 14);
    assert.equal(policy.newAccountMaxPerDay, 25);
    assert.equal(policy.warmupDays, 14);
    assert.equal(policy.warmupMaxPerDay, 15);
    assert.equal(policy.rotateEveryMessages, 50);
  });

  it('aplica preset Agressivo com batchSize size_min', () => {
    const policy = buildProtectionPolicyFromProfile(ProtectionProfile.AGGRESSIVE);

    assert.equal(policy.batchSize, 25);
    assert.equal(policy.pauseBetweenBatchesSeconds, 300);
    assert.equal(policy.dailyLimitPerInstance, 400);
    assert.equal(policy.hourlyLimit, 50);
    assert.equal(policy.newAccountDays, 3);
    assert.equal(policy.newAccountMaxPerDay, 100);
    assert.equal(policy.warmupDays, 3);
    assert.equal(policy.warmupMaxPerDay, 40);
    assert.equal(policy.rotateEveryMessages, 150);
  });

  it('exporta politica default alinhada ao Moderado', () => {
    assert.equal(
      DISPATCH_PLAN_DEFAULT_PROTECTION_POLICY.profile,
      ProtectionProfile.MODERATE,
    );
    assert.equal(
      DISPATCH_PLAN_DEFAULT_PROTECTION_POLICY.batchSize,
      buildProtectionPolicyFromProfile(ProtectionProfile.MODERATE).batchSize,
    );
  });
});
