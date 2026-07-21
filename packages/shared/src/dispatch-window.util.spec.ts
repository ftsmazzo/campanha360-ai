import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isWithinOperationalWindow,
  parseHhMm,
  resolveNextOperationalWindowStart,
} from './dispatch-window.util';

const CONFIG = {
  timezone: 'America/Sao_Paulo',
  allowedStartTime: '08:00',
  allowedEndTime: '20:00',
  allowedDays: [1, 2, 3, 4, 5, 6],
};

describe('dispatch-window.util', () => {
  it('parseHhMm valida formato HH:mm', () => {
    assert.deepEqual(parseHhMm('08:30'), { hour: 8, minute: 30 });
    assert.throws(() => parseHhMm('25:00'));
    assert.throws(() => parseHhMm('8:30'));
  });

  it('isWithinOperationalWindow: dentro do horario e dia permitido', () => {
    // 2026-07-21 e terca-feira (weekday=2); 12:00 America/Sao_Paulo = 15:00 UTC
    const now = new Date('2026-07-21T15:00:00.000Z');
    assert.equal(
      isWithinOperationalWindow({ now, ...CONFIG }),
      true,
    );
  });

  it('isWithinOperationalWindow: fora do horario', () => {
    // 22:00 America/Sao_Paulo = 01:00 UTC do dia seguinte
    const now = new Date('2026-07-22T01:00:00.000Z');
    assert.equal(
      isWithinOperationalWindow({ now, ...CONFIG }),
      false,
    );
  });

  it('isWithinOperationalWindow: domingo nao permitido (allowedDays 1-6)', () => {
    // 2026-07-19 e domingo (weekday=7); 12:00 local = 15:00 UTC
    const now = new Date('2026-07-19T15:00:00.000Z');
    assert.equal(
      isWithinOperationalWindow({ now, ...CONFIG }),
      false,
    );
  });

  it('resolveNextOperationalWindowStart: mantem instante se ja dentro da janela', () => {
    const now = new Date('2026-07-21T15:00:00.000Z');
    const start = resolveNextOperationalWindowStart(now, CONFIG);
    assert.equal(start.getTime(), now.getTime());
  });

  it('resolveNextOperationalWindowStart: avanca para abertura do mesmo dia', () => {
    // 06:00 America/Sao_Paulo = 09:00 UTC (antes da abertura 08:00 local)
    const now = new Date('2026-07-21T09:00:00.000Z');
    const start = resolveNextOperationalWindowStart(now, CONFIG);
    assert.equal(
      isWithinOperationalWindow({ now: start, ...CONFIG }),
      true,
    );
    assert.ok(start.getTime() > now.getTime());
  });

  it('resolveNextOperationalWindowStart: pula domingo (nao permitido)', () => {
    // Sabado 2026-07-18 as 21:00 local (apos janela) -> deve pular domingo e ir para segunda 08:00
    const now = new Date('2026-07-19T00:00:00.000Z');
    const start = resolveNextOperationalWindowStart(now, CONFIG);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: CONFIG.timezone,
      weekday: 'short',
    }).format(start);
    assert.notEqual(parts, 'Sun');
  });
});
