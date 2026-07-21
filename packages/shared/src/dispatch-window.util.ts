/**
 * Funcoes puras para calculo de janela operacional de disparo, portadas
 * de apps/api/src/dispatch-plans/dispatch-plan-simulation.util.ts
 * (resolveSimulationStart/advanceToAllowedWindow) para reuso pelo
 * worker/fila (subetapa 09.3). Sem dependencias externas — usa apenas
 * Intl para resolucao de timezone.
 *
 * Convencao de dia da semana (estilo ISO/MassFlow): 1 = segunda ... 7 = domingo.
 */

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

export type OperationalWindowConfig = {
  timezone: string;
  allowedStartTime: string;
  allowedEndTime: string;
  allowedDays: number[];
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

/** Parseia horario no formato HH:mm (24h). */
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
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
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

function isAllowedDay(weekday: number, allowedDays: number[]): boolean {
  return allowedDays.includes(weekday);
}

/** Verifica se o instante `now` esta dentro da janela operacional configurada. */
export function isWithinOperationalWindow(input: {
  now: Date;
  timezone: string;
  allowedStartTime: string;
  allowedEndTime: string;
  allowedDays: number[];
}): boolean {
  const parts = getZonedParts(input.now, input.timezone);
  if (!isAllowedDay(parts.weekday, input.allowedDays)) return false;
  const minutes = parts.hour * 60 + parts.minute;
  const start = timeToMinutes(input.allowedStartTime);
  const end = timeToMinutes(input.allowedEndTime);
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

/**
 * Resolve o proximo instante dentro da janela operacional a partir de
 * `from`. Se `from` ja estiver dentro da janela, retorna o proprio
 * `from`. Caso contrario, avanca para a abertura da janela no mesmo dia
 * (se ainda nao passou) ou no proximo dia permitido.
 */
export function resolveNextOperationalWindowStart(
  from: Date,
  config: OperationalWindowConfig,
): Date {
  let cursor = new Date(from.getTime());

  for (let guard = 0; guard < 400; guard += 1) {
    const parts = getZonedParts(cursor, config.timezone);
    if (
      isWithinOperationalWindow({
        now: cursor,
        timezone: config.timezone,
        allowedStartTime: config.allowedStartTime,
        allowedEndTime: config.allowedEndTime,
        allowedDays: config.allowedDays,
      })
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
