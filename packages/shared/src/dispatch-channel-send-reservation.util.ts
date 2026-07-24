/**
 * Reserva atomica de slot de envio por ChannelAccount (09.6.1).
 *
 * A funcao pura calcula o proximo slot; a exclusao mutua vem de
 * SELECT FOR UPDATE / lock compartilhado no Worker.
 */

export type ChannelSendProtectionPolicy = {
  profile?: string;
  minDelaySeconds: number;
  maxDelaySeconds: number;
  batchSize: number;
  pauseBetweenBatchesSeconds: number;
  longPauseEveryMessages: number;
  longPauseMinutes: number;
  hourlyLimit: number;
  dailyLimitPerInstance: number;
  newAccountMaxPerDay: number;
  newAccountDays: number;
  warmupEnabled: boolean;
  warmupDays: number;
  warmupMaxPerDay: number;
  consecutiveErrorsBeforePause: number;
  errorPauseMinutes: number;
  rotateEveryMessages: number;
  rotationEnabled: boolean;
  pauseOn403: boolean;
  pauseOn429: boolean;
  validateWhatsAppNumber: boolean;
  optOutKeywords: string[];
  repetitionWarningPercentage: number;
};

export type ChannelSendGuardState = {
  nextAvailableAt: Date | null;
  lastReservedAt: Date | null;
  lastSentAt: Date | null;
  reservationToken: string | null;
  reservationExpiresAt: Date | null;
  lastSelectedDelaySeconds: number | null;
  sequenceNumber: number;
  dailyUsageDate: Date | null;
  dailySentCount: number;
  hourlyWindowStart: Date | null;
  hourlySentCount: number;
  protectionCooldownUntil: Date | null;
  violationCount: number;
};

export type ReserveChannelSendSlotInput = {
  now: Date;
  state: ChannelSendGuardState;
  policy: ChannelSendProtectionPolicy;
  effectiveDailyLimit: number;
  reservationToken: string;
  /** TTL da reserva imediata (crash safety). Default 90s. */
  reservationTtlMs?: number;
  random?: () => number;
};

export type ReserveChannelSendSlotResult = {
  decision: 'ALLOW_NOW' | 'DEFER' | 'BLOCKED_COOLDOWN';
  reservedSendAt: Date;
  nextState: ChannelSendGuardState;
  selectedDelaySeconds: number;
  sequenceNumber: number;
  batchNumber: number;
  batchPosition: number;
  pauseApplied: boolean;
  pauseReason: string | null;
  protectionReason: string;
  previousChannelSendAt: Date | null;
  hourlyUsageBefore: number;
  dailyUsageBefore: number;
  effectiveDailyLimit: number;
};

export const DEFAULT_CHANNEL_SEND_PROTECTION_POLICY: ChannelSendProtectionPolicy =
  {
    profile: 'MODERATE',
    minDelaySeconds: 20,
    maxDelaySeconds: 45,
    batchSize: 15,
    pauseBetweenBatchesSeconds: 600,
    longPauseEveryMessages: 50,
    longPauseMinutes: 15,
    hourlyLimit: 30,
    dailyLimitPerInstance: 200,
    newAccountMaxPerDay: 50,
    newAccountDays: 7,
    warmupEnabled: true,
    warmupDays: 7,
    warmupMaxPerDay: 20,
    consecutiveErrorsBeforePause: 3,
    errorPauseMinutes: 60,
    rotateEveryMessages: 100,
    rotationEnabled: true,
    pauseOn403: true,
    pauseOn429: true,
    validateWhatsAppNumber: false,
    optOutKeywords: [],
    repetitionWarningPercentage: 70,
  };

export function resolveEffectiveDailyLimitForAccount(input: {
  accountAgeDays: number | null;
  policy: Pick<
    ChannelSendProtectionPolicy,
    | 'dailyLimitPerInstance'
    | 'newAccountDays'
    | 'newAccountMaxPerDay'
    | 'warmupEnabled'
    | 'warmupDays'
    | 'warmupMaxPerDay'
  >;
  /** Sem data confiavel: assume conta nova (conservador). */
  assumeNewWhenAgeUnknown?: boolean;
}): { effectiveDailyLimit: number; accountAgeKnown: boolean; stage: string } {
  const assumeNew = input.assumeNewWhenAgeUnknown !== false;
  const ageKnown = input.accountAgeDays != null && Number.isFinite(input.accountAgeDays);
  const age = ageKnown
    ? Math.max(0, Math.floor(input.accountAgeDays as number))
    : assumeNew
      ? 0
      : Number.POSITIVE_INFINITY;

  let effective = input.policy.dailyLimitPerInstance;
  let stage = 'NORMAL';

  if (!ageKnown && assumeNew) {
    stage = 'AGE_UNKNOWN_ASSUME_NEW';
    effective = Math.min(effective, input.policy.newAccountMaxPerDay);
    if (input.policy.warmupEnabled) {
      effective = Math.min(effective, input.policy.warmupMaxPerDay);
    }
    return { effectiveDailyLimit: Math.max(0, effective), accountAgeKnown: false, stage };
  }

  if (age < input.policy.newAccountDays) {
    stage = 'NEW_ACCOUNT';
    effective = Math.min(effective, input.policy.newAccountMaxPerDay);
  } else if (input.policy.warmupEnabled && age < input.policy.warmupDays) {
    stage = 'WARMUP';
    effective = Math.min(effective, input.policy.warmupMaxPerDay);
  }

  return {
    effectiveDailyLimit: Math.max(0, effective),
    accountAgeKnown: ageKnown,
    stage,
  };
}

export function computeUsageDateKeyUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function computeHourlyWindowStartUtc(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), 0, 0, 0),
  );
}

export function pickProtectionDelaySeconds(
  policy: Pick<ChannelSendProtectionPolicy, 'minDelaySeconds' | 'maxDelaySeconds'>,
  random: () => number = Math.random,
): number {
  const min = Math.max(0, policy.minDelaySeconds);
  const max = Math.max(min, policy.maxDelaySeconds);
  if (max <= min) return min;
  const unit = Math.min(Math.max(random(), 0), 0.999999);
  return min + Math.floor(unit * (max - min + 1));
}

/**
 * Calcula pausas de lote/longa com base na quantidade JA enviada
 * (antes desta reserva). Item 11 apos batch 10; item 31 apos longPause 30.
 */
export function computeBatchPauseSeconds(
  policy: Pick<
    ChannelSendProtectionPolicy,
    | 'batchSize'
    | 'pauseBetweenBatchesSeconds'
    | 'longPauseEveryMessages'
    | 'longPauseMinutes'
  >,
  sentCountBefore: number,
): { pauseSeconds: number; pauseReason: string | null } {
  if (sentCountBefore <= 0) {
    return { pauseSeconds: 0, pauseReason: null };
  }

  let pauseSeconds = 0;
  let pauseReason: string | null = null;

  if (
    policy.longPauseEveryMessages > 0 &&
    sentCountBefore % policy.longPauseEveryMessages === 0
  ) {
    pauseSeconds = Math.max(pauseSeconds, policy.longPauseMinutes * 60);
    pauseReason = 'LONG_PAUSE';
  }

  if (policy.batchSize > 0 && sentCountBefore % policy.batchSize === 0) {
    const batchPause = policy.pauseBetweenBatchesSeconds;
    if (batchPause >= pauseSeconds) {
      pauseSeconds = batchPause;
      pauseReason = pauseReason === 'LONG_PAUSE' ? 'LONG_PAUSE_AND_BATCH' : 'BATCH_PAUSE';
    }
  }

  return { pauseSeconds, pauseReason };
}

export function emptyChannelSendGuardState(): ChannelSendGuardState {
  return {
    nextAvailableAt: null,
    lastReservedAt: null,
    lastSentAt: null,
    reservationToken: null,
    reservationExpiresAt: null,
    lastSelectedDelaySeconds: null,
    sequenceNumber: 0,
    dailyUsageDate: null,
    dailySentCount: 0,
    hourlyWindowStart: null,
    hourlySentCount: 0,
    protectionCooldownUntil: null,
    violationCount: 0,
  };
}

/**
 * Reserva o proximo slot. Dois callers serializados nunca recebem o mesmo slot.
 * O delay sorteado e persistido em nextState.lastSelectedDelaySeconds e
 * avanca nextAvailableAt = reservedSendAt + delay (+ pausas).
 */
export function reserveChannelSendSlot(
  input: ReserveChannelSendSlotInput,
): ReserveChannelSendSlotResult {
  const now = input.now;
  const random = input.random ?? Math.random;
  const ttlMs = input.reservationTtlMs ?? 90_000;
  const policy = input.policy;
  let state = { ...input.state };

  // Janelas diarias/horarias
  const usageDate = computeUsageDateKeyUtc(now);
  const hourlyWindow = computeHourlyWindowStartUtc(now);

  if (
    !state.dailyUsageDate ||
    state.dailyUsageDate.getTime() !== usageDate.getTime()
  ) {
    state = {
      ...state,
      dailyUsageDate: usageDate,
      dailySentCount: 0,
    };
  }

  if (
    !state.hourlyWindowStart ||
    state.hourlyWindowStart.getTime() !== hourlyWindow.getTime()
  ) {
    state = {
      ...state,
      hourlyWindowStart: hourlyWindow,
      hourlySentCount: 0,
    };
  }

  if (
    state.protectionCooldownUntil &&
    state.protectionCooldownUntil.getTime() > now.getTime()
  ) {
    const reservedSendAt = state.protectionCooldownUntil;
    return {
      decision: 'BLOCKED_COOLDOWN',
      reservedSendAt,
      nextState: state,
      selectedDelaySeconds: state.lastSelectedDelaySeconds ?? policy.minDelaySeconds,
      sequenceNumber: state.sequenceNumber,
      batchNumber: Math.floor(state.sequenceNumber / Math.max(1, policy.batchSize)) + 1,
      batchPosition: (state.sequenceNumber % Math.max(1, policy.batchSize)) + 1,
      pauseApplied: false,
      pauseReason: null,
      protectionReason: 'PROTECTION_COOLDOWN',
      previousChannelSendAt: state.lastSentAt,
      hourlyUsageBefore: state.hourlySentCount,
      dailyUsageBefore: state.dailySentCount,
      effectiveDailyLimit: input.effectiveDailyLimit,
    };
  }

  const dailyUsageBefore = state.dailySentCount;
  const hourlyUsageBefore = state.hourlySentCount;

  // Limite diario: reagendar para proximo dia UTC 00:00+epsilon (worker ajusta janela operacional)
  if (dailyUsageBefore >= input.effectiveDailyLimit) {
    const nextDay = new Date(usageDate.getTime() + 24 * 60 * 60 * 1000);
    return {
      decision: 'DEFER',
      reservedSendAt: nextDay,
      nextState: state,
      selectedDelaySeconds: 0,
      sequenceNumber: state.sequenceNumber,
      batchNumber: Math.floor(state.sequenceNumber / Math.max(1, policy.batchSize)) + 1,
      batchPosition: (state.sequenceNumber % Math.max(1, policy.batchSize)) + 1,
      pauseApplied: false,
      pauseReason: null,
      protectionReason: 'DAILY_LIMIT_REACHED',
      previousChannelSendAt: state.lastSentAt,
      hourlyUsageBefore,
      dailyUsageBefore,
      effectiveDailyLimit: input.effectiveDailyLimit,
    };
  }

  // Limite horario
  if (policy.hourlyLimit > 0 && hourlyUsageBefore >= policy.hourlyLimit) {
    const nextHour = new Date(hourlyWindow.getTime() + 60 * 60 * 1000);
    return {
      decision: 'DEFER',
      reservedSendAt: nextHour,
      nextState: state,
      selectedDelaySeconds: 0,
      sequenceNumber: state.sequenceNumber,
      batchNumber: Math.floor(state.sequenceNumber / Math.max(1, policy.batchSize)) + 1,
      batchPosition: (state.sequenceNumber % Math.max(1, policy.batchSize)) + 1,
      pauseApplied: false,
      pauseReason: null,
      protectionReason: 'HOURLY_LIMIT_REACHED',
      previousChannelSendAt: state.lastSentAt,
      hourlyUsageBefore,
      dailyUsageBefore,
      effectiveDailyLimit: input.effectiveDailyLimit,
    };
  }

  const selectedDelaySeconds = pickProtectionDelaySeconds(policy, random);
  const batchPause = computeBatchPauseSeconds(policy, dailyUsageBefore);
  const intervalSeconds = Math.max(selectedDelaySeconds, batchPause.pauseSeconds);
  const pauseApplied = batchPause.pauseSeconds > 0;
  const pauseReason = batchPause.pauseReason;

  const previousChannelSendAt = state.lastSentAt;
  const baseCandidate = Math.max(
    now.getTime(),
    state.nextAvailableAt?.getTime() ?? 0,
  );
  const reservedSendAt = new Date(baseCandidate);

  const sequenceNumber = state.sequenceNumber + 1;
  const batchSize = Math.max(1, policy.batchSize);
  const batchNumber = Math.floor((sequenceNumber - 1) / batchSize) + 1;
  const batchPosition = ((sequenceNumber - 1) % batchSize) + 1;

  // Avanca o proximo slot ANTES do envio — exclusao mutua entre jobs concorrentes.
  const nextAvailableAt = new Date(reservedSendAt.getTime() + intervalSeconds * 1000);
  const allowNow = reservedSendAt.getTime() <= now.getTime() + 50;

  const nextState: ChannelSendGuardState = {
    ...state,
    nextAvailableAt,
    lastReservedAt: now,
    lastSelectedDelaySeconds: selectedDelaySeconds,
    sequenceNumber,
    reservationToken: allowNow ? input.reservationToken : state.reservationToken,
    reservationExpiresAt: allowNow
      ? new Date(now.getTime() + ttlMs)
      : state.reservationExpiresAt,
  };

  return {
    decision: allowNow ? 'ALLOW_NOW' : 'DEFER',
    reservedSendAt,
    nextState,
    selectedDelaySeconds,
    sequenceNumber,
    batchNumber,
    batchPosition,
    pauseApplied,
    pauseReason,
    protectionReason: allowNow
      ? pauseApplied
        ? `ALLOW_NOW_${pauseReason}`
        : 'ALLOW_NOW'
      : pauseApplied
        ? `DEFER_SLOT_${pauseReason}`
        : 'DEFER_SLOT_INTERVAL',
    previousChannelSendAt,
    hourlyUsageBefore,
    dailyUsageBefore,
    effectiveDailyLimit: input.effectiveDailyLimit,
  };
}

/**
 * Confirma envio bem-sucedido: atualiza lastSentAt e contadores.
 * Nao altera nextAvailableAt (ja avancado na reserva).
 */
export function confirmChannelSendSuccess(
  state: ChannelSendGuardState,
  now: Date,
): ChannelSendGuardState {
  const usageDate = computeUsageDateKeyUtc(now);
  const hourlyWindow = computeHourlyWindowStartUtc(now);

  let dailySentCount = state.dailySentCount;
  let dailyUsageDate = state.dailyUsageDate;
  if (!dailyUsageDate || dailyUsageDate.getTime() !== usageDate.getTime()) {
    dailyUsageDate = usageDate;
    dailySentCount = 0;
  }

  let hourlySentCount = state.hourlySentCount;
  let hourlyWindowStart = state.hourlyWindowStart;
  if (!hourlyWindowStart || hourlyWindowStart.getTime() !== hourlyWindow.getTime()) {
    hourlyWindowStart = hourlyWindow;
    hourlySentCount = 0;
  }

  return {
    ...state,
    lastSentAt: now,
    dailyUsageDate,
    dailySentCount: dailySentCount + 1,
    hourlyWindowStart,
    hourlySentCount: hourlySentCount + 1,
    reservationToken: null,
    reservationExpiresAt: null,
  };
}

/**
 * Detecta violacao de intervalo minimo entre chamadas reais na mesma instância.
 */
export function detectProtectionIntervalViolation(input: {
  previousStartedAt: Date | null;
  actualStartedAt: Date;
  minDelaySeconds: number;
}): { violated: boolean; intervalObservedSeconds: number | null } {
  if (!input.previousStartedAt) {
    return { violated: false, intervalObservedSeconds: null };
  }
  const intervalObservedSeconds =
    (input.actualStartedAt.getTime() - input.previousStartedAt.getTime()) / 1000;
  return {
    violated: intervalObservedSeconds + 0.001 < input.minDelaySeconds,
    intervalObservedSeconds,
  };
}

export function applyProtectionViolationCooldown(
  state: ChannelSendGuardState,
  now: Date,
  cooldownMinutes: number,
): ChannelSendGuardState {
  const minutes = Math.max(1, cooldownMinutes);
  return {
    ...state,
    protectionCooldownUntil: new Date(now.getTime() + minutes * 60_000),
    violationCount: (state.violationCount ?? 0) + 1,
    reservationToken: null,
    reservationExpiresAt: null,
  };
}
