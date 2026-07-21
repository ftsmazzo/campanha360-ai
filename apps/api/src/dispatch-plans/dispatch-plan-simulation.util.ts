import {
  DISPATCH_PLAN_INITIAL_ELIGIBLE_LIMIT,
} from './dispatch-plan.constants';
import {
  DISPATCH_SIMULATION_DEFAULTS,
  DISPATCH_SIMULATION_DEFAULT_TIMEZONE,
  DISPATCH_SIMULATION_HIGH_BATCH_COUNT,
  DISPATCH_SIMULATION_LIMITS,
  DISPATCH_SIMULATION_LONG_DURATION_SECONDS,
  DISPATCH_SIMULATION_NEAR_LIMIT_RATIO,
} from './dispatch-plan-simulation.constants';

export type SimulationLimitingFactor = 'RATE_LIMIT' | 'DELAY' | 'BOTH';

export type SimulationWarningCode =
  | 'CROSSES_MULTIPLE_WINDOWS'
  | 'CROSSES_MULTIPLE_DAYS'
  | 'RATE_REDUCED_BY_DELAY'
  | 'HIGH_BATCH_COUNT'
  | 'LONG_DURATION'
  | 'START_ADJUSTED_TO_WINDOW'
  | 'NEAR_OPERATIONAL_LIMIT';

export type SimulationWarning = {
  code: SimulationWarningCode;
  message: string;
};

export type SimulationConfigInput = {
  messagesPerMinute?: number;
  minDelaySeconds?: number;
  maxDelaySeconds?: number;
  batchSize?: number;
  pauseBetweenBatchesSeconds?: number;
  timezone?: string;
  allowedStartTime?: string;
  allowedEndTime?: string;
  allowedDays?: number[];
  plannedStartAt?: string | Date | null;
};

export type NormalizedSimulationConfig = {
  messagesPerMinute: number;
  minDelaySeconds: number;
  maxDelaySeconds: number;
  batchSize: number;
  pauseBetweenBatchesSeconds: number;
  timezone: string;
  allowedStartTime: string;
  allowedEndTime: string;
  allowedDays: number[];
  plannedStartAt: Date | null;
};

export type SimulationSnapshot = {
  simulatedAt: string;
  version: number;
  audience: {
    totalEligible: number;
  };
  configuration: {
    requestedMessagesPerMinute: number;
    minDelaySeconds: number;
    maxDelaySeconds: number;
    batchSize: number;
    pauseBetweenBatchesSeconds: number;
    timezone: string;
    allowedStartTime: string;
    allowedEndTime: string;
    allowedDays: number[];
    plannedStartAt: string | null;
  };
  estimates: {
    effectiveMessagesPerMinute: number;
    limitingFactor: SimulationLimitingFactor;
    totalBatches: number;
    totalBatchPauses: number;
    lastBatchSize: number;
    estimatedActiveDurationSeconds: number;
    estimatedCalendarDurationSeconds: number;
    estimatedMessagesPerHour: number;
    estimatedStartAt: string;
    estimatedEndAt: string;
  };
  warnings: SimulationWarning[];
};

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function parseHhMm(value: string): { hour: number; minute: number } {
  const match = TIME_RE.exec(value.trim());
  if (!match) {
    throw new Error(`Horario invalido: ${value}`);
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function timeToMinutes(value: string): number {
  const { hour, minute } = parseHhMm(value);
  return hour * 60 + minute;
}

export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const map = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );

  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: weekdayMap[map.weekday] ?? 1,
  };
}

/** Converte data/hora civil no timezone para instante UTC. */
export function zonedLocalToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): Date {
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 4; i += 1) {
    const parts = getZonedParts(new Date(utcMs), timeZone);
    const asLocalMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const desiredMs = Date.UTC(year, month - 1, day, hour, minute, second);
    utcMs += desiredMs - asLocalMs;
  }
  return new Date(utcMs);
}

export function resolveEffectiveRate(input: {
  messagesPerMinute: number;
  minDelaySeconds: number;
  maxDelaySeconds: number;
}): {
  averageDelaySeconds: number;
  delayLimitedMessagesPerMinute: number;
  effectiveMessagesPerMinute: number;
  limitingFactor: SimulationLimitingFactor;
} {
  const averageDelaySeconds =
    (input.minDelaySeconds + input.maxDelaySeconds) / 2;
  const delayLimitedMessagesPerMinute = 60 / averageDelaySeconds;
  const effectiveMessagesPerMinute = Math.min(
    input.messagesPerMinute,
    delayLimitedMessagesPerMinute,
  );

  const rateIsLimit =
    input.messagesPerMinute <= delayLimitedMessagesPerMinute + 1e-9;
  const delayIsLimit =
    delayLimitedMessagesPerMinute <= input.messagesPerMinute + 1e-9;

  let limitingFactor: SimulationLimitingFactor;
  if (rateIsLimit && delayIsLimit) {
    limitingFactor = 'BOTH';
  } else if (delayIsLimit) {
    limitingFactor = 'DELAY';
  } else {
    limitingFactor = 'RATE_LIMIT';
  }

  return {
    averageDelaySeconds,
    delayLimitedMessagesPerMinute,
    effectiveMessagesPerMinute,
    limitingFactor,
  };
}

export function computeBatchMetrics(totalEligible: number, batchSize: number) {
  const totalBatches =
    totalEligible <= 0 ? 0 : Math.ceil(totalEligible / batchSize);
  const totalBatchPauses = Math.max(totalBatches - 1, 0);
  const lastBatchSize =
    totalEligible <= 0
      ? 0
      : totalEligible % batchSize === 0
        ? batchSize
        : totalEligible % batchSize;

  return { totalBatches, totalBatchPauses, lastBatchSize };
}

export function computeActiveDurationSeconds(input: {
  totalEligible: number;
  batchSize: number;
  pauseBetweenBatchesSeconds: number;
  effectiveMessagesPerMinute: number;
}): number {
  if (input.totalEligible <= 0) return 0;
  if (input.totalEligible === 1) return 0;

  const intervalSeconds = 60 / input.effectiveMessagesPerMinute;
  const { totalBatches, totalBatchPauses, lastBatchSize } = computeBatchMetrics(
    input.totalEligible,
    input.batchSize,
  );

  let active = 0;
  for (let batch = 0; batch < totalBatches; batch += 1) {
    const size =
      batch === totalBatches - 1 ? lastBatchSize : input.batchSize;
    if (size > 1) {
      active += (size - 1) * intervalSeconds;
    }
  }

  active += totalBatchPauses * input.pauseBetweenBatchesSeconds;
  return Math.round(active);
}

function isAllowedDay(weekday: number, allowedDays: number[]): boolean {
  return allowedDays.includes(weekday);
}

function isWithinOpenWindow(
  parts: ZonedParts,
  allowedStartTime: string,
  allowedEndTime: string,
  allowedDays: number[],
): boolean {
  if (!isAllowedDay(parts.weekday, allowedDays)) return false;
  const minutes = parts.hour * 60 + parts.minute;
  const start = timeToMinutes(allowedStartTime);
  const end = timeToMinutes(allowedEndTime);
  return minutes >= start && minutes < end;
}

function atWindowStart(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  allowedStartTime: string,
): Date {
  const { hour, minute } = parseHhMm(allowedStartTime);
  return zonedLocalToUtc(timeZone, year, month, day, hour, minute, 0);
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  delta: number,
): { year: number; month: number; day: number } {
  const base = new Date(Date.UTC(year, month - 1, day + delta));
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
  };
}

/** Avança o instante para o próximo horário permitido na janela. */
export function advanceToAllowedWindow(
  instant: Date,
  config: Pick<
    NormalizedSimulationConfig,
    'timezone' | 'allowedStartTime' | 'allowedEndTime' | 'allowedDays'
  >,
): Date {
  let cursor = new Date(instant.getTime());

  for (let guard = 0; guard < 400; guard += 1) {
    const parts = getZonedParts(cursor, config.timezone);
    if (
      isWithinOpenWindow(
        parts,
        config.allowedStartTime,
        config.allowedEndTime,
        config.allowedDays,
      )
    ) {
      return cursor;
    }

    const minutes = parts.hour * 60 + parts.minute;
    const start = timeToMinutes(config.allowedStartTime);

    if (isAllowedDay(parts.weekday, config.allowedDays) && minutes < start) {
      return atWindowStart(
        config.timezone,
        parts.year,
        parts.month,
        parts.day,
        config.allowedStartTime,
      );
    }

    let next = addCalendarDays(parts.year, parts.month, parts.day, 1);
    for (let i = 0; i < 14; i += 1) {
      const probe = atWindowStart(
        config.timezone,
        next.year,
        next.month,
        next.day,
        config.allowedStartTime,
      );
      const probeParts = getZonedParts(probe, config.timezone);
      if (isAllowedDay(probeParts.weekday, config.allowedDays)) {
        return probe;
      }
      next = addCalendarDays(next.year, next.month, next.day, 1);
    }

    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  throw new Error('Nao foi possivel resolver janela operacional');
}

export function resolveSimulationStart(input: {
  plannedStartAt: Date | null;
  now: Date;
  config: NormalizedSimulationConfig;
}): { startAt: Date; adjusted: boolean } {
  const requested = input.plannedStartAt ?? input.now;
  const startAt = advanceToAllowedWindow(requested, input.config);
  const adjusted = startAt.getTime() !== requested.getTime();
  return { startAt, adjusted };
}

/**
 * Agenda cada mensagem respeitando intervalo efetivo, pausas de lote e janela.
 */
export function projectMessageSchedule(input: {
  totalEligible: number;
  config: NormalizedSimulationConfig;
  effectiveMessagesPerMinute: number;
  startAt: Date;
}): {
  messageAts: Date[];
  windowsUsed: number;
  daysUsed: number;
} {
  const { totalEligible, config, effectiveMessagesPerMinute, startAt } = input;
  if (totalEligible <= 0) {
    return { messageAts: [], windowsUsed: 0, daysUsed: 0 };
  }

  const intervalSeconds = 60 / effectiveMessagesPerMinute;
  const messageAts: Date[] = [];
  let cursor = advanceToAllowedWindow(startAt, config);
  let inBatchCount = 0;
  const dayKeys = new Set<string>();
  const windowKeys = new Set<string>();

  for (let i = 0; i < totalEligible; i += 1) {
    cursor = advanceToAllowedWindow(cursor, config);
    messageAts.push(new Date(cursor.getTime()));

    const parts = getZonedParts(cursor, config.timezone);
    dayKeys.add(`${parts.year}-${parts.month}-${parts.day}`);
    windowKeys.add(`${parts.year}-${parts.month}-${parts.day}`);

    inBatchCount += 1;
    if (i === totalEligible - 1) break;

    const completesBatch =
      inBatchCount >= config.batchSize && i < totalEligible - 1;
    if (completesBatch) {
      cursor = new Date(
        cursor.getTime() + config.pauseBetweenBatchesSeconds * 1000,
      );
      inBatchCount = 0;
    } else {
      cursor = new Date(cursor.getTime() + intervalSeconds * 1000);
    }
  }

  return {
    messageAts,
    windowsUsed: windowKeys.size,
    daysUsed: dayKeys.size,
  };
}

export function normalizeSimulationConfig(
  input: SimulationConfigInput,
  fallbackTimezone = DISPATCH_SIMULATION_DEFAULT_TIMEZONE,
): NormalizedSimulationConfig {
  const messagesPerMinute =
    input.messagesPerMinute ?? DISPATCH_SIMULATION_DEFAULTS.messagesPerMinute;
  const minDelaySeconds =
    input.minDelaySeconds ?? DISPATCH_SIMULATION_DEFAULTS.minDelaySeconds;
  const maxDelaySeconds =
    input.maxDelaySeconds ?? DISPATCH_SIMULATION_DEFAULTS.maxDelaySeconds;
  const batchSize = input.batchSize ?? DISPATCH_SIMULATION_DEFAULTS.batchSize;
  const pauseBetweenBatchesSeconds =
    input.pauseBetweenBatchesSeconds ??
    DISPATCH_SIMULATION_DEFAULTS.pauseBetweenBatchesSeconds;
  const timezone = (input.timezone ?? fallbackTimezone).trim();
  const allowedStartTime =
    input.allowedStartTime ?? DISPATCH_SIMULATION_DEFAULTS.allowedStartTime;
  const allowedEndTime =
    input.allowedEndTime ?? DISPATCH_SIMULATION_DEFAULTS.allowedEndTime;
  const allowedDays = [
    ...(input.allowedDays ?? DISPATCH_SIMULATION_DEFAULTS.allowedDays),
  ].sort((a, b) => a - b);

  const errors: string[] = [];

  if (
    !Number.isFinite(messagesPerMinute) ||
    messagesPerMinute < DISPATCH_SIMULATION_LIMITS.messagesPerMinute.min ||
    messagesPerMinute > DISPATCH_SIMULATION_LIMITS.messagesPerMinute.max
  ) {
    errors.push(
      `messagesPerMinute deve estar entre ${DISPATCH_SIMULATION_LIMITS.messagesPerMinute.min} e ${DISPATCH_SIMULATION_LIMITS.messagesPerMinute.max}`,
    );
  }

  if (
    !Number.isFinite(minDelaySeconds) ||
    minDelaySeconds < DISPATCH_SIMULATION_LIMITS.minDelaySeconds.min ||
    minDelaySeconds > DISPATCH_SIMULATION_LIMITS.minDelaySeconds.max
  ) {
    errors.push(
      `minDelaySeconds deve estar entre ${DISPATCH_SIMULATION_LIMITS.minDelaySeconds.min} e ${DISPATCH_SIMULATION_LIMITS.minDelaySeconds.max}`,
    );
  }

  if (
    !Number.isFinite(maxDelaySeconds) ||
    maxDelaySeconds < DISPATCH_SIMULATION_LIMITS.maxDelaySeconds.min ||
    maxDelaySeconds > DISPATCH_SIMULATION_LIMITS.maxDelaySeconds.max
  ) {
    errors.push(
      `maxDelaySeconds deve estar entre ${DISPATCH_SIMULATION_LIMITS.maxDelaySeconds.min} e ${DISPATCH_SIMULATION_LIMITS.maxDelaySeconds.max}`,
    );
  }

  if (maxDelaySeconds < minDelaySeconds) {
    errors.push('maxDelaySeconds deve ser maior ou igual a minDelaySeconds');
  }

  if (
    !Number.isFinite(batchSize) ||
    batchSize < DISPATCH_SIMULATION_LIMITS.batchSize.min ||
    batchSize > DISPATCH_SIMULATION_LIMITS.batchSize.max
  ) {
    errors.push(
      `batchSize deve estar entre ${DISPATCH_SIMULATION_LIMITS.batchSize.min} e ${DISPATCH_SIMULATION_LIMITS.batchSize.max}`,
    );
  }

  if (
    !Number.isFinite(pauseBetweenBatchesSeconds) ||
    pauseBetweenBatchesSeconds <
      DISPATCH_SIMULATION_LIMITS.pauseBetweenBatchesSeconds.min ||
    pauseBetweenBatchesSeconds >
      DISPATCH_SIMULATION_LIMITS.pauseBetweenBatchesSeconds.max
  ) {
    errors.push(
      `pauseBetweenBatchesSeconds deve estar entre ${DISPATCH_SIMULATION_LIMITS.pauseBetweenBatchesSeconds.min} e ${DISPATCH_SIMULATION_LIMITS.pauseBetweenBatchesSeconds.max}`,
    );
  }

  if (!timezone || !isValidIanaTimeZone(timezone)) {
    errors.push('timezone invalida');
  }

  try {
    parseHhMm(allowedStartTime);
    parseHhMm(allowedEndTime);
  } catch {
    errors.push('allowedStartTime/allowedEndTime devem estar no formato HH:mm');
  }

  if (
    TIME_RE.test(allowedStartTime) &&
    TIME_RE.test(allowedEndTime) &&
    timeToMinutes(allowedStartTime) >= timeToMinutes(allowedEndTime)
  ) {
    errors.push('allowedStartTime deve ser anterior a allowedEndTime');
  }

  if (!allowedDays.length) {
    errors.push('allowedDays nao pode ser vazio');
  }

  for (const day of allowedDays) {
    if (!Number.isInteger(day) || day < 1 || day > 7) {
      errors.push('allowedDays deve conter inteiros de 1 (segunda) a 7 (domingo)');
      break;
    }
  }

  let plannedStartAt: Date | null = null;
  if (input.plannedStartAt != null && input.plannedStartAt !== '') {
    const parsed =
      input.plannedStartAt instanceof Date
        ? input.plannedStartAt
        : new Date(input.plannedStartAt);
    if (Number.isNaN(parsed.getTime())) {
      errors.push('plannedStartAt invalido');
    } else {
      plannedStartAt = parsed;
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }

  return {
    messagesPerMinute,
    minDelaySeconds,
    maxDelaySeconds,
    batchSize,
    pauseBetweenBatchesSeconds,
    timezone,
    allowedStartTime,
    allowedEndTime,
    allowedDays,
    plannedStartAt,
  };
}

export function buildSimulationWarnings(input: {
  limitingFactor: SimulationLimitingFactor;
  requestedMessagesPerMinute: number;
  effectiveMessagesPerMinute: number;
  totalBatches: number;
  estimatedCalendarDurationSeconds: number;
  windowsUsed: number;
  daysUsed: number;
  startAdjusted: boolean;
  totalEligible: number;
}): SimulationWarning[] {
  const warnings: SimulationWarning[] = [];

  if (input.windowsUsed > 1) {
    warnings.push({
      code: 'CROSSES_MULTIPLE_WINDOWS',
      message: `A execucao estimada atravessa ${input.windowsUsed} janelas operacionais.`,
    });
  }

  if (input.daysUsed > 1) {
    warnings.push({
      code: 'CROSSES_MULTIPLE_DAYS',
      message: `A execucao estimada atravessa ${input.daysUsed} dias.`,
    });
  }

  if (
    input.limitingFactor === 'DELAY' ||
    (input.limitingFactor === 'BOTH' &&
      input.effectiveMessagesPerMinute + 1e-9 <
        input.requestedMessagesPerMinute)
  ) {
    if (
      input.effectiveMessagesPerMinute + 1e-9 <
      input.requestedMessagesPerMinute
    ) {
      warnings.push({
        code: 'RATE_REDUCED_BY_DELAY',
        message: `Velocidade efetiva reduzida de ${input.requestedMessagesPerMinute} para ${Number(input.effectiveMessagesPerMinute.toFixed(2))} msg/min pelo intervalo medio.`,
      });
    }
  } else if (
    input.effectiveMessagesPerMinute + 1e-9 <
    input.requestedMessagesPerMinute
  ) {
    warnings.push({
      code: 'RATE_REDUCED_BY_DELAY',
      message: `Velocidade efetiva reduzida de ${input.requestedMessagesPerMinute} para ${Number(input.effectiveMessagesPerMinute.toFixed(2))} msg/min pelo intervalo medio.`,
    });
  }

  if (input.totalBatches > DISPATCH_SIMULATION_HIGH_BATCH_COUNT) {
    warnings.push({
      code: 'HIGH_BATCH_COUNT',
      message: `Quantidade elevada de lotes (${input.totalBatches}).`,
    });
  }

  if (
    input.estimatedCalendarDurationSeconds >
    DISPATCH_SIMULATION_LONG_DURATION_SECONDS
  ) {
    warnings.push({
      code: 'LONG_DURATION',
      message: 'Duracao estimada de calendario elevada.',
    });
  }

  if (input.startAdjusted) {
    warnings.push({
      code: 'START_ADJUSTED_TO_WINDOW',
      message:
        'O inicio planejado foi ajustado para a proxima abertura da janela operacional.',
    });
  }

  if (
    input.totalEligible >=
    DISPATCH_PLAN_INITIAL_ELIGIBLE_LIMIT * DISPATCH_SIMULATION_NEAR_LIMIT_RATIO
  ) {
    warnings.push({
      code: 'NEAR_OPERATIONAL_LIMIT',
      message: `Publico elegivel (${input.totalEligible}) esta proximo do limite operacional de ${DISPATCH_PLAN_INITIAL_ELIGIBLE_LIMIT}.`,
    });
  }

  return warnings;
}

export function buildSimulationSnapshot(input: {
  simulatedAt: Date;
  version: number;
  totalEligible: number;
  config: NormalizedSimulationConfig;
  now?: Date;
}): SimulationSnapshot {
  const rate = resolveEffectiveRate(input.config);
  const batches = computeBatchMetrics(
    input.totalEligible,
    input.config.batchSize,
  );
  const estimatedActiveDurationSeconds = computeActiveDurationSeconds({
    totalEligible: input.totalEligible,
    batchSize: input.config.batchSize,
    pauseBetweenBatchesSeconds: input.config.pauseBetweenBatchesSeconds,
    effectiveMessagesPerMinute: rate.effectiveMessagesPerMinute,
  });

  const { startAt, adjusted } = resolveSimulationStart({
    plannedStartAt: input.config.plannedStartAt,
    now: input.now ?? input.simulatedAt,
    config: input.config,
  });

  const schedule = projectMessageSchedule({
    totalEligible: input.totalEligible,
    config: input.config,
    effectiveMessagesPerMinute: rate.effectiveMessagesPerMinute,
    startAt,
  });

  const estimatedStartAt = schedule.messageAts[0] ?? startAt;
  const estimatedEndAt =
    schedule.messageAts[schedule.messageAts.length - 1] ?? startAt;
  const estimatedCalendarDurationSeconds = Math.max(
    0,
    Math.round(
      (estimatedEndAt.getTime() - estimatedStartAt.getTime()) / 1000,
    ),
  );

  const warnings = buildSimulationWarnings({
    limitingFactor: rate.limitingFactor,
    requestedMessagesPerMinute: input.config.messagesPerMinute,
    effectiveMessagesPerMinute: rate.effectiveMessagesPerMinute,
    totalBatches: batches.totalBatches,
    estimatedCalendarDurationSeconds,
    windowsUsed: schedule.windowsUsed,
    daysUsed: schedule.daysUsed,
    startAdjusted: adjusted,
    totalEligible: input.totalEligible,
  });

  return {
    simulatedAt: input.simulatedAt.toISOString(),
    version: input.version,
    audience: {
      totalEligible: input.totalEligible,
    },
    configuration: {
      requestedMessagesPerMinute: input.config.messagesPerMinute,
      minDelaySeconds: input.config.minDelaySeconds,
      maxDelaySeconds: input.config.maxDelaySeconds,
      batchSize: input.config.batchSize,
      pauseBetweenBatchesSeconds: input.config.pauseBetweenBatchesSeconds,
      timezone: input.config.timezone,
      allowedStartTime: input.config.allowedStartTime,
      allowedEndTime: input.config.allowedEndTime,
      allowedDays: input.config.allowedDays,
      plannedStartAt: input.config.plannedStartAt
        ? input.config.plannedStartAt.toISOString()
        : null,
    },
    estimates: {
      effectiveMessagesPerMinute: Number(
        rate.effectiveMessagesPerMinute.toFixed(4),
      ),
      limitingFactor: rate.limitingFactor,
      totalBatches: batches.totalBatches,
      totalBatchPauses: batches.totalBatchPauses,
      lastBatchSize: batches.lastBatchSize,
      estimatedActiveDurationSeconds,
      estimatedCalendarDurationSeconds,
      estimatedMessagesPerHour: Number(
        (rate.effectiveMessagesPerMinute * 60).toFixed(2),
      ),
      estimatedStartAt: estimatedStartAt.toISOString(),
      estimatedEndAt: estimatedEndAt.toISOString(),
    },
    warnings,
  };
}

export function isSimulationCurrent(input: {
  simulationSnapshot: unknown;
  simulatedVersion: number | null | undefined;
  validatedVersion: number | null | undefined;
  planVersion: number;
  status: string;
  validationIsCurrent: boolean;
}): boolean {
  if (!input.simulationSnapshot || input.simulatedVersion == null) return false;
  if (input.status !== 'VALIDATED') return false;
  if (!input.validationIsCurrent) return false;
  if (input.validatedVersion == null) return false;
  return (
    input.simulatedVersion === input.planVersion &&
    input.validatedVersion === input.planVersion
  );
}

export function canSimulateDispatchPlan(input: {
  status: string;
  snapshotCreatedAt: Date | string | null;
  totalEligible: number;
  validationSnapshot: unknown;
  validatedVersion: number | null | undefined;
  planVersion: number;
}): boolean {
  if (input.status !== 'VALIDATED') return false;
  if (!input.snapshotCreatedAt) return false;
  if (input.totalEligible <= 0) return false;
  if (!input.validationSnapshot || typeof input.validationSnapshot !== 'object') {
    return false;
  }
  const snapshot = input.validationSnapshot as { passed?: unknown };
  if (snapshot.passed !== true) return false;
  if (input.validatedVersion == null) return false;
  return input.validatedVersion === input.planVersion;
}

export { DISPATCH_SIMULATION_DEFAULT_TIMEZONE };
