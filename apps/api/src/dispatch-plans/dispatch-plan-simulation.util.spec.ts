import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  advanceToAllowedWindow,
  buildSimulationSnapshot,
  computeActiveDurationSeconds,
  computeBatchMetrics,
  getZonedParts,
  normalizeSimulationConfig,
  projectMessageSchedule,
  resolveEffectiveRate,
  resolveSimulationStart,
  zonedLocalToUtc,
} from './dispatch-plan-simulation.util';

describe('dispatch-plan-simulation.util', () => {
  it('calcula velocidade limitada por messagesPerMinute', () => {
    const rate = resolveEffectiveRate({
      messagesPerMinute: 4,
      minDelaySeconds: 5,
      maxDelaySeconds: 5,
    });
    assert.equal(rate.limitingFactor, 'RATE_LIMIT');
    assert.equal(rate.effectiveMessagesPerMinute, 4);
  });

  it('calcula velocidade limitada por delay', () => {
    const rate = resolveEffectiveRate({
      messagesPerMinute: 10,
      minDelaySeconds: 15,
      maxDelaySeconds: 15,
    });
    assert.equal(rate.limitingFactor, 'DELAY');
    assert.ok(Math.abs(rate.effectiveMessagesPerMinute - 4) < 1e-9);
  });

  it('marca BOTH quando rate e delay coincidem', () => {
    const rate = resolveEffectiveRate({
      messagesPerMinute: 4,
      minDelaySeconds: 15,
      maxDelaySeconds: 15,
    });
    assert.equal(rate.limitingFactor, 'BOTH');
  });

  it('calcula lotes e nao aplica pausa apos o ultimo', () => {
    assert.deepEqual(computeBatchMetrics(1, 20), {
      totalBatches: 1,
      totalBatchPauses: 0,
      lastBatchSize: 1,
    });
    assert.deepEqual(computeBatchMetrics(40, 20), {
      totalBatches: 2,
      totalBatchPauses: 1,
      lastBatchSize: 20,
    });
    assert.deepEqual(computeBatchMetrics(45, 20), {
      totalBatches: 3,
      totalBatchPauses: 2,
      lastBatchSize: 5,
    });
  });

  it('calcula duracao ativa com zero, um e multiplos destinatarios', () => {
    assert.equal(
      computeActiveDurationSeconds({
        totalEligible: 0,
        batchSize: 20,
        pauseBetweenBatchesSeconds: 120,
        effectiveMessagesPerMinute: 4,
      }),
      0,
    );
    assert.equal(
      computeActiveDurationSeconds({
        totalEligible: 1,
        batchSize: 20,
        pauseBetweenBatchesSeconds: 120,
        effectiveMessagesPerMinute: 4,
      }),
      0,
    );

    // 40 msgs, interval 15s, 1 pause 120s:
    // batch1: 19*15=285; batch2: 19*15=285; pause=120 => 690
    assert.equal(
      computeActiveDurationSeconds({
        totalEligible: 40,
        batchSize: 20,
        pauseBetweenBatchesSeconds: 120,
        effectiveMessagesPerMinute: 4,
      }),
      690,
    );
  });

  it('projeta inicio dentro da janela sem ajuste', () => {
    const config = normalizeSimulationConfig({
      timezone: 'America/Sao_Paulo',
      allowedStartTime: '08:00',
      allowedEndTime: '20:00',
      allowedDays: [1, 2, 3, 4, 5, 6],
    });
    // 2026-07-21 was Tuesday
    const planned = zonedLocalToUtc('America/Sao_Paulo', 2026, 7, 21, 10, 0, 0);
    const resolved = resolveSimulationStart({
      plannedStartAt: planned,
      now: planned,
      config,
    });
    assert.equal(resolved.adjusted, false);
    assert.equal(resolved.startAt.toISOString(), planned.toISOString());
  });

  it('avanca inicio antes da janela para a abertura do dia', () => {
    const config = normalizeSimulationConfig({
      timezone: 'America/Sao_Paulo',
      allowedStartTime: '08:00',
      allowedEndTime: '20:00',
      allowedDays: [1, 2, 3, 4, 5, 6],
    });
    const planned = zonedLocalToUtc('America/Sao_Paulo', 2026, 7, 21, 6, 0, 0);
    const resolved = resolveSimulationStart({
      plannedStartAt: planned,
      now: planned,
      config,
    });
    assert.equal(resolved.adjusted, true);
    const parts = getZonedParts(resolved.startAt, 'America/Sao_Paulo');
    assert.equal(parts.hour, 8);
    assert.equal(parts.minute, 0);
    assert.equal(parts.day, 21);
  });

  it('avanca inicio depois da janela para o proximo dia permitido', () => {
    const config = normalizeSimulationConfig({
      timezone: 'America/Sao_Paulo',
      allowedStartTime: '08:00',
      allowedEndTime: '20:00',
      allowedDays: [1, 2, 3, 4, 5, 6],
    });
    const planned = zonedLocalToUtc('America/Sao_Paulo', 2026, 7, 21, 21, 0, 0);
    const resolved = resolveSimulationStart({
      plannedStartAt: planned,
      now: planned,
      config,
    });
    assert.equal(resolved.adjusted, true);
    const parts = getZonedParts(resolved.startAt, 'America/Sao_Paulo');
    assert.equal(parts.day, 22);
    assert.equal(parts.hour, 8);
  });

  it('pula domingo quando nao permitido', () => {
    const config = normalizeSimulationConfig({
      timezone: 'America/Sao_Paulo',
      allowedStartTime: '08:00',
      allowedEndTime: '20:00',
      allowedDays: [1, 2, 3, 4, 5, 6],
    });
    // 2026-07-26 = Sunday
    const sunday = zonedLocalToUtc('America/Sao_Paulo', 2026, 7, 26, 10, 0, 0);
    const advanced = advanceToAllowedWindow(sunday, config);
    const parts = getZonedParts(advanced, 'America/Sao_Paulo');
    assert.equal(parts.weekday, 1);
    assert.equal(parts.day, 27);
    assert.equal(parts.hour, 8);
  });

  it('agenda multiplos lotes e respeita tamanho do ultimo lote', () => {
    const config = normalizeSimulationConfig({
      messagesPerMinute: 4,
      minDelaySeconds: 15,
      maxDelaySeconds: 15,
      batchSize: 20,
      pauseBetweenBatchesSeconds: 120,
      timezone: 'America/Sao_Paulo',
      allowedStartTime: '08:00',
      allowedEndTime: '20:00',
      allowedDays: [1, 2, 3, 4, 5, 6],
      plannedStartAt: zonedLocalToUtc('America/Sao_Paulo', 2026, 7, 21, 9, 0, 0),
    });
    const rate = resolveEffectiveRate(config);
    const schedule = projectMessageSchedule({
      totalEligible: 45,
      config,
      effectiveMessagesPerMinute: rate.effectiveMessagesPerMinute,
      startAt: config.plannedStartAt!,
    });
    assert.equal(schedule.messageAts.length, 45);
    const batches = computeBatchMetrics(45, 20);
    assert.equal(batches.lastBatchSize, 5);
  });

  it('atravessa janela quando a duracao excede o fim do dia', () => {
    const config = normalizeSimulationConfig({
      messagesPerMinute: 4,
      minDelaySeconds: 15,
      maxDelaySeconds: 15,
      batchSize: 100,
      pauseBetweenBatchesSeconds: 0,
      timezone: 'America/Sao_Paulo',
      allowedStartTime: '08:00',
      allowedEndTime: '08:05',
      allowedDays: [1, 2, 3, 4, 5, 6],
      plannedStartAt: zonedLocalToUtc('America/Sao_Paulo', 2026, 7, 21, 8, 0, 0),
    });
    const snapshot = buildSimulationSnapshot({
      simulatedAt: new Date('2026-07-21T12:00:00.000Z'),
      version: 4,
      totalEligible: 25,
      config,
      now: config.plannedStartAt!,
    });
    assert.ok(
      snapshot.estimates.estimatedCalendarDurationSeconds >=
        snapshot.estimates.estimatedActiveDurationSeconds,
    );
    assert.ok(
      snapshot.warnings.some((item) => item.code === 'CROSSES_MULTIPLE_DAYS') ||
        snapshot.warnings.some(
          (item) => item.code === 'CROSSES_MULTIPLE_WINDOWS',
        ),
    );
  });

  it('monta snapshot completo com timezone e warnings de delay', () => {
    const config = normalizeSimulationConfig({
      messagesPerMinute: 10,
      minDelaySeconds: 15,
      maxDelaySeconds: 15,
      batchSize: 20,
      pauseBetweenBatchesSeconds: 120,
      timezone: 'America/Sao_Paulo',
      allowedStartTime: '08:00',
      allowedEndTime: '20:00',
      allowedDays: [1, 2, 3, 4, 5, 6],
      plannedStartAt: zonedLocalToUtc('America/Sao_Paulo', 2026, 7, 21, 10, 0, 0),
    });
    const snapshot = buildSimulationSnapshot({
      simulatedAt: new Date('2026-07-21T12:00:00.000Z'),
      version: 4,
      totalEligible: 80,
      config,
    });
    assert.equal(snapshot.version, 4);
    assert.equal(snapshot.audience.totalEligible, 80);
    assert.equal(snapshot.estimates.limitingFactor, 'DELAY');
    assert.equal(snapshot.estimates.totalBatches, 4);
    assert.equal(snapshot.estimates.totalBatchPauses, 3);
    assert.ok(
      snapshot.warnings.some((item) => item.code === 'RATE_REDUCED_BY_DELAY'),
    );
    assert.equal(snapshot.configuration.timezone, 'America/Sao_Paulo');
  });

  it('rejeita configuracao invalida', () => {
    assert.throws(() =>
      normalizeSimulationConfig({
        messagesPerMinute: 100,
      }),
    );
    assert.throws(() =>
      normalizeSimulationConfig({
        minDelaySeconds: 20,
        maxDelaySeconds: 10,
      }),
    );
    assert.throws(() =>
      normalizeSimulationConfig({
        timezone: 'Invalid/Zone',
      }),
    );
    assert.throws(() =>
      normalizeSimulationConfig({
        allowedDays: [],
      }),
    );
  });
});
