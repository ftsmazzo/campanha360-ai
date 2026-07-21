import { DistributionStrategy, ProtectionProfile } from '@prisma/client';

/** Snapshot imutavel da politica de blindagem congelada no Plano. */
export type ProtectionPolicySnapshot = {
  profile: ProtectionProfile;
  dailyLimitPerInstance: number;
  hourlyLimit: number;
  allowedStartTime: string;
  allowedEndTime: string;
  timezone: string;
  minDelaySeconds: number;
  maxDelaySeconds: number;
  batchSize: number;
  pauseBetweenBatchesSeconds: number;
  longPauseEveryMessages: number;
  longPauseMinutes: number;
  consecutiveErrorsBeforePause: number;
  errorPauseMinutes: number;
  newAccountMaxPerDay: number;
  newAccountDays: number;
  warmupEnabled: boolean;
  warmupDays: number;
  warmupMaxPerDay: number;
  rotationEnabled: boolean;
  rotateEveryMessages: number;
  pauseOn403: boolean;
  pauseOn429: boolean;
  validateWhatsAppNumber: boolean;
  optOutKeywords: string[];
  repetitionWarningPercentage: number;
  distributionStrategy: DistributionStrategy;
};

type ProfilePolicyInput = Omit<ProtectionPolicySnapshot, 'profile'>;

/** Defaults MassFlow emptyConfig / shielding.py (perfil Moderado). */
const MODERATE_POLICY: ProfilePolicyInput = {
  dailyLimitPerInstance: 200,
  hourlyLimit: 30,
  allowedStartTime: '09:00',
  allowedEndTime: '18:00',
  timezone: 'America/Sao_Paulo',
  minDelaySeconds: 20,
  maxDelaySeconds: 45,
  batchSize: 15,
  pauseBetweenBatchesSeconds: 600,
  longPauseEveryMessages: 50,
  longPauseMinutes: Math.round(900 / 60),
  consecutiveErrorsBeforePause: 3,
  errorPauseMinutes: Math.round(3600 / 60),
  newAccountMaxPerDay: 50,
  newAccountDays: 7,
  warmupEnabled: true,
  warmupDays: 7,
  warmupMaxPerDay: 20,
  rotationEnabled: true,
  rotateEveryMessages: 100,
  pauseOn403: true,
  pauseOn429: true,
  validateWhatsAppNumber: false,
  optOutKeywords: [
    'sair',
    'descadastrar',
    'stop',
    'parar',
    'remover',
    'cancelar',
  ],
  repetitionWarningPercentage: 70,
  distributionStrategy: DistributionStrategy.CAPACITY_WEIGHTED,
};

/** Preset Conservador (MassFlow Shielding.tsx). */
const CONSERVATIVE_POLICY: ProfilePolicyInput = {
  ...MODERATE_POLICY,
  minDelaySeconds: 30,
  maxDelaySeconds: 60,
  batchSize: 10,
  pauseBetweenBatchesSeconds: 900,
  longPauseEveryMessages: 30,
  longPauseMinutes: Math.round(1200 / 60),
  dailyLimitPerInstance: 80,
  hourlyLimit: 15,
  newAccountMaxPerDay: 25,
  newAccountDays: 14,
  warmupDays: 14,
  warmupMaxPerDay: 15,
  rotateEveryMessages: 50,
};

/** Preset Agressivo (MassFlow Shielding.tsx). */
const AGGRESSIVE_POLICY: ProfilePolicyInput = {
  ...MODERATE_POLICY,
  minDelaySeconds: 10,
  maxDelaySeconds: 25,
  batchSize: 25,
  pauseBetweenBatchesSeconds: 300,
  longPauseEveryMessages: 80,
  longPauseMinutes: Math.round(600 / 60),
  dailyLimitPerInstance: 400,
  hourlyLimit: 50,
  newAccountMaxPerDay: 100,
  newAccountDays: 3,
  warmupDays: 3,
  warmupMaxPerDay: 40,
  rotateEveryMessages: 150,
};

const PROFILE_POLICIES: Record<
  Exclude<ProtectionProfile, 'CUSTOM'>,
  ProfilePolicyInput
> = {
  [ProtectionProfile.CONSERVATIVE]: CONSERVATIVE_POLICY,
  [ProtectionProfile.MODERATE]: MODERATE_POLICY,
  [ProtectionProfile.AGGRESSIVE]: AGGRESSIVE_POLICY,
};

export function buildProtectionPolicyFromProfile(
  profile: ProtectionProfile,
): ProtectionPolicySnapshot {
  if (profile === ProtectionProfile.CUSTOM) {
    return {
      profile: ProtectionProfile.CUSTOM,
      ...MODERATE_POLICY,
    };
  }

  return {
    profile,
    ...PROFILE_POLICIES[profile],
  };
}

export const DISPATCH_PLAN_DEFAULT_PROTECTION_PROFILE = ProtectionProfile.MODERATE;

export const DISPATCH_PLAN_DEFAULT_PROTECTION_POLICY =
  buildProtectionPolicyFromProfile(DISPATCH_PLAN_DEFAULT_PROTECTION_PROFILE);
