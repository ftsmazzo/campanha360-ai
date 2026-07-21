import {
  ChannelAccountStatus,
  ChannelProvider,
} from '@prisma/client';
import {
  ProtectionPolicySnapshot,
  buildProtectionPolicyFromProfile,
} from './dispatch-plan-protection.constants';
import {
  computeActiveDurationSeconds,
  computeBatchMetrics,
  normalizeSimulationConfig,
  resolveEffectiveRate,
  resolveSimulationStart,
  type NormalizedSimulationConfig,
  type SimulationWarning,
} from './dispatch-plan-simulation.util';

export type PlanChannelStage = 'NEW_ACCOUNT' | 'WARMUP' | 'NORMAL';

export type PlanChannelInput = {
  id: string;
  channelAccountId: string;
  enabled: boolean;
  priority: number;
  weight: number;
  provider: ChannelProvider | string;
  status: ChannelAccountStatus | string;
  accountAgeDays: number;
  assignedRecipients?: number;
  sentToday?: number;
  cooldownUntil?: Date | string | null;
  dailyLimit?: number | null;
  hourlyLimit?: number | null;
  newAccountDailyLimit?: number | null;
  warmupDailyLimit?: number | null;
};

export type ChannelLimitsOverride = {
  dailyLimit?: number | null;
  newAccountDailyLimit?: number | null;
  warmupDailyLimit?: number | null;
};

export type PlanChannelHealth = {
  channelId: string;
  channelAccountId: string;
  enabled: boolean;
  eligible: boolean;
  blocked: boolean;
  reasons: string[];
  effectiveDailyLimit: number;
  remainingCapacity: number;
  stage: PlanChannelStage;
  assignedRecipients: number;
};

export type MultiInstanceValidationConsolidated = {
  selectedInstances: number;
  eligibleInstances: number;
  blockedInstances: number;
  totalCapacity: number;
  totalEligibleAudience: number;
  capacityDeficit: number;
  unassignedRecipients: number;
  passed: boolean;
  channels: PlanChannelHealth[];
  distribution: Array<{ channelId: string; assignedRecipients: number }>;
};

export type MultiInstanceSimulationChannel = {
  channelId: string;
  channelAccountId: string;
  enabled: boolean;
  blocked: boolean;
  assignedRecipients: number;
  effectiveDailyLimit: number;
  remainingCapacity: number;
  effectiveMessagesPerMinute: number;
  totalBatches: number;
  totalBatchPauses: number;
  estimatedActiveDurationSeconds: number;
  estimatedStartAt: string | null;
  estimatedEndAt: string | null;
  warnings: SimulationWarning[];
};

export type MultiInstanceSimulationConsolidated = {
  totalAudience: number;
  totalCapacity: number;
  totalAssigned: number;
  totalUnassigned: number;
  combinedThroughput: number;
  estimatedOverallEndAt: string | null;
  activeInstances: number;
  blockedInstances: number;
  channels: MultiInstanceSimulationChannel[];
};

export function resolveEffectiveDailyLimit(input: {
  accountAgeDays: number;
  policy: Pick<
    ProtectionPolicySnapshot,
    | 'dailyLimitPerInstance'
    | 'newAccountDays'
    | 'newAccountMaxPerDay'
    | 'warmupEnabled'
    | 'warmupDays'
    | 'warmupMaxPerDay'
  >;
  channelLimits?: ChannelLimitsOverride;
}): number {
  const age = Math.max(0, input.accountAgeDays);
  const dailyLimit =
    input.channelLimits?.dailyLimit ?? input.policy.dailyLimitPerInstance;
  let effective = dailyLimit;

  if (age < input.policy.newAccountDays) {
    const newAccountLimit =
      input.channelLimits?.newAccountDailyLimit ??
      input.policy.newAccountMaxPerDay;
    effective = Math.min(effective, newAccountLimit);
  }

  if (input.policy.warmupEnabled && age < input.policy.warmupDays) {
    const warmupLimit =
      input.channelLimits?.warmupDailyLimit ?? input.policy.warmupMaxPerDay;
    effective = Math.min(effective, warmupLimit);
  }

  return Math.max(0, effective);
}

export function resolvePlanChannelStage(input: {
  accountAgeDays: number;
  policy: Pick<
    ProtectionPolicySnapshot,
    'newAccountDays' | 'warmupEnabled' | 'warmupDays'
  >;
}): PlanChannelStage {
  const age = Math.max(0, input.accountAgeDays);

  if (age < input.policy.newAccountDays) {
    return 'NEW_ACCOUNT';
  }

  if (input.policy.warmupEnabled && age < input.policy.warmupDays) {
    return 'WARMUP';
  }

  return 'NORMAL';
}

export function evaluatePlanChannelHealth(input: {
  channel: PlanChannelInput;
  policy: ProtectionPolicySnapshot;
  now: Date;
}): PlanChannelHealth {
  const reasons: string[] = [];
  const assignedRecipients = Math.max(0, input.channel.assignedRecipients ?? 0);
  const sentToday = Math.max(0, input.channel.sentToday ?? 0);
  const effectiveDailyLimit = resolveEffectiveDailyLimit({
    accountAgeDays: input.channel.accountAgeDays,
    policy: input.policy,
    channelLimits: {
      dailyLimit: input.channel.dailyLimit,
      newAccountDailyLimit: input.channel.newAccountDailyLimit,
      warmupDailyLimit: input.channel.warmupDailyLimit,
    },
  });
  const stage = resolvePlanChannelStage({
    accountAgeDays: input.channel.accountAgeDays,
    policy: input.policy,
  });

  if (!input.channel.enabled) {
    reasons.push('CANAL_DESABILITADO');
  }

  if (
    input.channel.status === ChannelAccountStatus.ARCHIVED ||
    input.channel.status === 'ARCHIVED'
  ) {
    reasons.push('CANAL_ARQUIVADO');
  }

  if (
    input.channel.status !== ChannelAccountStatus.CONNECTED &&
    input.channel.status !== 'CONNECTED'
  ) {
    reasons.push('CANAL_NAO_CONECTADO');
  }

  if (
    input.channel.provider !== ChannelProvider.WHATSAPP_EVOLUTION &&
    input.channel.provider !== 'WHATSAPP_EVOLUTION'
  ) {
    reasons.push('PROVIDER_NAO_SUPORTADO');
  }

  const cooldownUntil = parseDate(input.channel.cooldownUntil);
  if (cooldownUntil && cooldownUntil.getTime() > input.now.getTime()) {
    reasons.push('CANAL_EM_COOLDOWN');
  }

  const consumed = assignedRecipients + sentToday;
  if (effectiveDailyLimit <= 0) {
    reasons.push('LIMITE_DIARIO_ZERO');
  } else if (consumed >= effectiveDailyLimit) {
    reasons.push('CAPACIDADE_DIARIA_ESGOTADA');
  }

  const remainingCapacity = Math.max(0, effectiveDailyLimit - consumed);
  const blocked = reasons.length > 0;
  const eligible = input.channel.enabled && !blocked && remainingCapacity > 0;

  return {
    channelId: input.channel.id,
    channelAccountId: input.channel.channelAccountId,
    enabled: input.channel.enabled,
    eligible,
    blocked,
    reasons,
    effectiveDailyLimit,
    remainingCapacity,
    stage,
    assignedRecipients,
  };
}

export function distributeRecipientsCapacityWeighted(input: {
  totalEligible: number;
  channels: Array<{
    id: string;
    priority: number;
    weight: number;
    effectiveDailyLimit: number;
    enabled: boolean;
    assignedRecipients?: number;
  }>;
}): {
  assignments: Array<{ channelId: string; count: number }>;
  unassignedCount: number;
} {
  const totalEligible = Math.max(0, input.totalEligible);
  if (totalEligible === 0) {
    return { assignments: [], unassignedCount: 0 };
  }

  const sorted = [...input.channels].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.weight - a.weight;
  });

  type Slot = {
    id: string;
    priority: number;
    weight: number;
    capacity: number;
    assigned: number;
    fraction: number;
  };

  const slots: Slot[] = sorted
    .filter((channel) => channel.enabled && channel.weight > 0)
    .map((channel) => {
      const alreadyAssigned = Math.max(0, channel.assignedRecipients ?? 0);
      const capacity = Math.max(0, channel.effectiveDailyLimit - alreadyAssigned);
      return {
        id: channel.id,
        priority: channel.priority,
        weight: channel.weight,
        capacity,
        assigned: 0,
        fraction: 0,
      };
    })
    .filter((slot) => slot.capacity > 0);

  const totalWeight = slots.reduce((sum, slot) => sum + slot.weight, 0);
  if (totalWeight <= 0) {
    return { assignments: [], unassignedCount: totalEligible };
  }

  for (const slot of slots) {
    const exact = (totalEligible * slot.weight) / totalWeight;
    const base = Math.min(Math.floor(exact), slot.capacity);
    slot.assigned = base;
    slot.fraction = exact - base;
  }

  let assignedTotal = slots.reduce((sum, slot) => sum + slot.assigned, 0);
  let leftover = totalEligible - assignedTotal;

  while (leftover > 0) {
    const candidates = slots
      .filter((slot) => slot.assigned < slot.capacity)
      .sort((a, b) => {
        if (b.fraction !== a.fraction) return b.fraction - a.fraction;
        if (a.priority !== b.priority) return a.priority - b.priority;
        return b.weight - a.weight;
      });

    if (candidates.length === 0) break;

    const target = candidates[0];
    target.assigned += 1;
    target.fraction = 0;
    leftover -= 1;
    assignedTotal += 1;
  }

  const assignments = slots
    .filter((slot) => slot.assigned > 0)
    .map((slot) => ({
      channelId: slot.id,
      count: slot.assigned,
    }));

  return {
    assignments,
    unassignedCount: Math.max(0, totalEligible - assignedTotal),
  };
}

export function consolidateMultiInstanceValidation(input: {
  totalEligibleAudience: number;
  channels: PlanChannelInput[];
  policy: ProtectionPolicySnapshot;
  now: Date;
}): MultiInstanceValidationConsolidated {
  const healthRows = input.channels.map((channel) =>
    evaluatePlanChannelHealth({
      channel,
      policy: input.policy,
      now: input.now,
    }),
  );

  const eligibleRows = healthRows.filter((row) => row.eligible);
  const blockedRows = healthRows.filter((row) => row.blocked || !row.eligible);
  const totalCapacity = eligibleRows.reduce(
    (sum, row) => sum + row.remainingCapacity,
    0,
  );
  const capacityDeficit = Math.max(0, input.totalEligibleAudience - totalCapacity);

  const distributionInput = input.channels
    .map((channel, index) => ({
      id: channel.id,
      priority: channel.priority,
      weight: channel.weight,
      effectiveDailyLimit: healthRows[index].effectiveDailyLimit,
      enabled: channel.enabled,
      assignedRecipients: healthRows[index].assignedRecipients,
    }))
    .filter((_, index) => healthRows[index].eligible);

  const distributionResult = distributeRecipientsCapacityWeighted({
    totalEligible: input.totalEligibleAudience,
    channels: distributionInput,
  });

  const distribution = distributionResult.assignments.map((assignment) => ({
    channelId: assignment.channelId,
    assignedRecipients: assignment.count,
  }));

  for (const row of blockedRows) {
    if (distribution.some((item) => item.channelId === row.channelId)) {
      throw new Error('Instancia bloqueada nao pode receber recipients');
    }
  }

  for (const item of distribution) {
    const health = healthRows.find((row) => row.channelId === item.channelId);
    if (!health) continue;
    if (item.assignedRecipients > health.remainingCapacity) {
      throw new Error('Instancia excedeu capacidade efetiva');
    }
  }

  const passed =
    eligibleRows.length > 0 &&
    capacityDeficit === 0 &&
    distributionResult.unassignedCount === 0;

  return {
    selectedInstances: input.channels.length,
    eligibleInstances: eligibleRows.length,
    blockedInstances: blockedRows.length,
    totalCapacity,
    totalEligibleAudience: input.totalEligibleAudience,
    capacityDeficit,
    unassignedRecipients: distributionResult.unassignedCount,
    passed,
    channels: healthRows,
    distribution,
  };
}

function buildChannelSimulationConfig(
  policy: ProtectionPolicySnapshot,
): NormalizedSimulationConfig {
  const averageDelaySeconds =
    (policy.minDelaySeconds + policy.maxDelaySeconds) / 2;
  const delayLimitedMessagesPerMinute = 60 / averageDelaySeconds;
  const hourlyLimitedMessagesPerMinute = policy.hourlyLimit / 60;

  return normalizeSimulationConfig({
    minDelaySeconds: policy.minDelaySeconds,
    maxDelaySeconds: policy.maxDelaySeconds,
    batchSize: policy.batchSize,
    pauseBetweenBatchesSeconds: policy.pauseBetweenBatchesSeconds,
    timezone: policy.timezone,
    allowedStartTime: policy.allowedStartTime,
    allowedEndTime: policy.allowedEndTime,
    allowedDays: [1, 2, 3, 4, 5, 6],
    messagesPerMinute: Math.max(
      1,
      Math.min(delayLimitedMessagesPerMinute, hourlyLimitedMessagesPerMinute),
    ),
  });
}

export function consolidateMultiInstanceSimulation(input: {
  totalEligibleAudience: number;
  channels: PlanChannelInput[];
  policy: ProtectionPolicySnapshot;
  now: Date;
  distribution?: Array<{ channelId: string; assignedRecipients: number }>;
}): MultiInstanceSimulationConsolidated {
  const validation = consolidateMultiInstanceValidation({
    totalEligibleAudience: input.totalEligibleAudience,
    channels: input.channels,
    policy: input.policy,
    now: input.now,
  });

  const distribution =
    input.distribution ??
    validation.distribution.map((item) => ({
      channelId: item.channelId,
      assignedRecipients: item.assignedRecipients,
    }));

  const config = buildChannelSimulationConfig(input.policy);
  const rate = resolveEffectiveRate(config);
  const channelSimulations: MultiInstanceSimulationChannel[] = [];
  let combinedThroughput = 0;
  let latestEndAt: Date | null = null;

  for (const assignment of distribution) {
    const channel = input.channels.find((item) => item.id === assignment.channelId);
    const health = validation.channels.find(
      (item) => item.channelId === assignment.channelId,
    );
    if (!channel || !health) continue;

    const batches = computeBatchMetrics(
      assignment.assignedRecipients,
      config.batchSize,
    );
    const estimatedActiveDurationSeconds = computeActiveDurationSeconds({
      totalEligible: assignment.assignedRecipients,
      batchSize: config.batchSize,
      pauseBetweenBatchesSeconds: config.pauseBetweenBatchesSeconds,
      effectiveMessagesPerMinute: rate.effectiveMessagesPerMinute,
    });
    const { startAt } = resolveSimulationStart({
      plannedStartAt: null,
      now: input.now,
      config,
    });
    const estimatedEndAt = new Date(
      startAt.getTime() + estimatedActiveDurationSeconds * 1000,
    );

    if (!latestEndAt || estimatedEndAt.getTime() > latestEndAt.getTime()) {
      latestEndAt = estimatedEndAt;
    }

    combinedThroughput += rate.effectiveMessagesPerMinute;

    channelSimulations.push({
      channelId: channel.id,
      channelAccountId: channel.channelAccountId,
      enabled: channel.enabled,
      blocked: health.blocked,
      assignedRecipients: assignment.assignedRecipients,
      effectiveDailyLimit: health.effectiveDailyLimit,
      remainingCapacity: Math.max(
        0,
        health.remainingCapacity - assignment.assignedRecipients,
      ),
      effectiveMessagesPerMinute: rate.effectiveMessagesPerMinute,
      totalBatches: batches.totalBatches,
      totalBatchPauses: batches.totalBatchPauses,
      estimatedActiveDurationSeconds,
      estimatedStartAt: startAt.toISOString(),
      estimatedEndAt: estimatedEndAt.toISOString(),
      warnings: [],
    });
  }

  const totalAssigned = distribution.reduce(
    (sum, item) => sum + item.assignedRecipients,
    0,
  );

  return {
    totalAudience: input.totalEligibleAudience,
    totalCapacity: validation.totalCapacity,
    totalAssigned,
    totalUnassigned: Math.max(0, input.totalEligibleAudience - totalAssigned),
    combinedThroughput: Number(combinedThroughput.toFixed(4)),
    estimatedOverallEndAt: latestEndAt?.toISOString() ?? null,
    activeInstances: channelSimulations.length,
    blockedInstances: validation.blockedInstances,
    channels: channelSimulations,
  };
}

function parseDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export {
  buildProtectionPolicyFromProfile,
  type ProtectionPolicySnapshot,
};
