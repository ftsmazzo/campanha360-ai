import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyProtectionViolationCooldown,
  confirmChannelSendSuccess,
  computeBatchPauseSeconds,
  emptyChannelSendGuardState,
  pickProtectionDelaySeconds,
  reserveChannelSendSlot,
  resolveEffectiveDailyLimitForAccount,
  type ChannelSendProtectionPolicy,
} from './dispatch-channel-send-reservation.util';

const CONSERVATIVE: ChannelSendProtectionPolicy = {
  profile: 'CONSERVATIVE',
  minDelaySeconds: 30,
  maxDelaySeconds: 60,
  batchSize: 10,
  pauseBetweenBatchesSeconds: 900,
  longPauseEveryMessages: 30,
  longPauseMinutes: 20,
  hourlyLimit: 15,
  dailyLimitPerInstance: 80,
  newAccountMaxPerDay: 25,
  newAccountDays: 14,
  warmupEnabled: true,
  warmupDays: 14,
  warmupMaxPerDay: 15,
  consecutiveErrorsBeforePause: 3,
  errorPauseMinutes: 60,
  rotateEveryMessages: 50,
  rotationEnabled: true,
  pauseOn403: true,
  pauseOn429: true,
  validateWhatsAppNumber: false,
  optOutKeywords: [],
  repetitionWarningPercentage: 70,
};

describe('reserveChannelSendSlot', () => {
  it('primeira mensagem sai imediatamente e avanca nextAvailableAt', () => {
    const now = new Date('2026-07-24T12:00:00.000Z');
    const result = reserveChannelSendSlot({
      now,
      state: emptyChannelSendGuardState(),
      policy: CONSERVATIVE,
      effectiveDailyLimit: 80,
      reservationToken: 'tok-1',
      random: () => 0, // min delay = 30
    });

    assert.equal(result.decision, 'ALLOW_NOW');
    assert.equal(result.selectedDelaySeconds, 30);
    assert.equal(result.sequenceNumber, 1);
    assert.equal(
      result.nextState.nextAvailableAt?.toISOString(),
      '2026-07-24T12:00:30.000Z',
    );
  });

  it('tres reservas serializadas nunca compartilham o mesmo slot (Conservador)', () => {
    const now = new Date('2026-07-24T12:00:00.000Z');
    let state = emptyChannelSendGuardState();
    const delays = [0, 0.5, 1]; // 30, 45, 60
    const slots: Date[] = [];

    for (let i = 0; i < 3; i += 1) {
      const result = reserveChannelSendSlot({
        now,
        state,
        policy: CONSERVATIVE,
        effectiveDailyLimit: 80,
        reservationToken: `tok-${i}`,
        random: () => delays[i]!,
      });
      slots.push(result.reservedSendAt);
      state = result.nextState;
      if (i === 0) assert.equal(result.decision, 'ALLOW_NOW');
      else assert.equal(result.decision, 'DEFER');
    }

    assert.ok(slots[1]!.getTime() - slots[0]!.getTime() >= 30_000);
    assert.ok(slots[2]!.getTime() - slots[1]!.getTime() >= 30_000);
  });

  it('duas ChannelAccounts independentes podem reservar agora em paralelo (estado separado)', () => {
    const now = new Date('2026-07-24T12:00:00.000Z');
    const a = reserveChannelSendSlot({
      now,
      state: emptyChannelSendGuardState(),
      policy: CONSERVATIVE,
      effectiveDailyLimit: 80,
      reservationToken: 'a',
      random: () => 0,
    });
    const b = reserveChannelSendSlot({
      now,
      state: emptyChannelSendGuardState(),
      policy: CONSERVATIVE,
      effectiveDailyLimit: 80,
      reservationToken: 'b',
      random: () => 0,
    });
    assert.equal(a.decision, 'ALLOW_NOW');
    assert.equal(b.decision, 'ALLOW_NOW');
    assert.equal(a.reservedSendAt.getTime(), b.reservedSendAt.getTime());
  });

  it('batch 10 aplica pausa no 11o (apos 10 envios confirmados)', () => {
    const pause = computeBatchPauseSeconds(CONSERVATIVE, 10);
    assert.equal(pause.pauseSeconds, 900);
    assert.ok(pause.pauseReason?.includes('BATCH'));

    let state = emptyChannelSendGuardState();
    state = { ...state, dailySentCount: 10, dailyUsageDate: new Date('2026-07-24T00:00:00.000Z') };
    // simula next apos 10 envios
    state.nextAvailableAt = new Date('2026-07-24T12:00:00.000Z');
    const now = new Date('2026-07-24T12:00:00.000Z');
    const result = reserveChannelSendSlot({
      now,
      state,
      policy: CONSERVATIVE,
      effectiveDailyLimit: 80,
      reservationToken: 'batch',
      random: () => 0,
    });
    assert.equal(result.pauseApplied, true);
    assert.ok((result.nextState.nextAvailableAt!.getTime() - result.reservedSendAt.getTime()) >= 900_000);
  });

  it('long pause no item apos 30 envios', () => {
    const pause = computeBatchPauseSeconds(CONSERVATIVE, 30);
    assert.equal(pause.pauseSeconds, 20 * 60);
  });

  it('limite horario bloqueia o 16o na mesma hora', () => {
    const now = new Date('2026-07-24T12:30:00.000Z');
    const state = {
      ...emptyChannelSendGuardState(),
      hourlyWindowStart: new Date('2026-07-24T12:00:00.000Z'),
      hourlySentCount: 15,
      dailyUsageDate: new Date('2026-07-24T00:00:00.000Z'),
      dailySentCount: 15,
    };
    const result = reserveChannelSendSlot({
      now,
      state,
      policy: CONSERVATIVE,
      effectiveDailyLimit: 80,
      reservationToken: 'h',
      random: () => 0,
    });
    assert.equal(result.decision, 'DEFER');
    assert.equal(result.protectionReason, 'HOURLY_LIMIT_REACHED');
  });

  it('limite diario efetivo bloqueia acima do limite', () => {
    const now = new Date('2026-07-24T12:00:00.000Z');
    const state = {
      ...emptyChannelSendGuardState(),
      dailyUsageDate: new Date('2026-07-24T00:00:00.000Z'),
      dailySentCount: 15,
    };
    const result = reserveChannelSendSlot({
      now,
      state,
      policy: CONSERVATIVE,
      effectiveDailyLimit: 15,
      reservationToken: 'd',
      random: () => 0,
    });
    assert.equal(result.decision, 'DEFER');
    assert.equal(result.protectionReason, 'DAILY_LIMIT_REACHED');
  });

  it('cooldown bloqueia todos os workers (estado compartilhado)', () => {
    const now = new Date('2026-07-24T12:00:00.000Z');
    let state = emptyChannelSendGuardState();
    state = applyProtectionViolationCooldown(state, now, 20);
    const result = reserveChannelSendSlot({
      now: new Date('2026-07-24T12:05:00.000Z'),
      state,
      policy: CONSERVATIVE,
      effectiveDailyLimit: 80,
      reservationToken: 'c',
      random: () => 0,
    });
    assert.equal(result.decision, 'BLOCKED_COOLDOWN');
  });

  it('confirmChannelSendSuccess incrementa contadores sem antecipar nextAvailableAt', () => {
    const now = new Date('2026-07-24T12:00:00.000Z');
    const reserved = reserveChannelSendSlot({
      now,
      state: emptyChannelSendGuardState(),
      policy: CONSERVATIVE,
      effectiveDailyLimit: 80,
      reservationToken: 'x',
      random: () => 0,
    });
    const nextAt = reserved.nextState.nextAvailableAt;
    const confirmed = confirmChannelSendSuccess(reserved.nextState, now);
    assert.equal(confirmed.dailySentCount, 1);
    assert.equal(confirmed.hourlySentCount, 1);
    assert.equal(confirmed.nextAvailableAt?.getTime(), nextAt?.getTime());
    assert.equal(confirmed.lastSentAt?.toISOString(), now.toISOString());
  });
});

describe('resolveEffectiveDailyLimitForAccount', () => {
  it('idade desconhecida assume conservador (new+warmup)', () => {
    const result = resolveEffectiveDailyLimitForAccount({
      accountAgeDays: null,
      policy: CONSERVATIVE,
    });
    assert.equal(result.effectiveDailyLimit, 15);
    assert.equal(result.accountAgeKnown, false);
  });

  it('conta nova usa newAccountMaxPerDay', () => {
    const result = resolveEffectiveDailyLimitForAccount({
      accountAgeDays: 2,
      policy: CONSERVATIVE,
    });
    assert.equal(result.effectiveDailyLimit, 25);
    assert.equal(result.stage, 'NEW_ACCOUNT');
  });
});

describe('pickProtectionDelaySeconds', () => {
  it('respeita min/max inclusivos', () => {
    assert.equal(pickProtectionDelaySeconds(CONSERVATIVE, () => 0), 30);
    assert.equal(pickProtectionDelaySeconds(CONSERVATIVE, () => 0.999), 60);
  });
});

describe('concorrencia simulada com lock em memoria', () => {
  it('tres jobs simultaneos: somente um ALLOW_NOW; slots >= 30s', async () => {
    let state = emptyChannelSendGuardState();
    let chain: Promise<void> = Promise.resolve();
    const withLock = async <T>(fn: () => T): Promise<T> => {
      const run = chain.then(() => fn());
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    };

    const now = new Date('2026-07-24T15:00:00.000Z');
    const results = await Promise.all(
      [0, 1, 2].map((i) =>
        withLock(() => {
          const result = reserveChannelSendSlot({
            now,
            state,
            policy: CONSERVATIVE,
            effectiveDailyLimit: 80,
            reservationToken: `p-${i}`,
            random: () => 0,
          });
          state = result.nextState;
          return result;
        }),
      ),
    );

    const allowNow = results.filter((r) => r.decision === 'ALLOW_NOW');
    assert.equal(allowNow.length, 1);
    assert.ok(results[1]!.reservedSendAt.getTime() - results[0]!.reservedSendAt.getTime() >= 30_000);
    assert.ok(results[2]!.reservedSendAt.getTime() - results[1]!.reservedSendAt.getTime() >= 30_000);
  });

  it('dois dispatches mesma ChannelAccount compartilham ritmo', async () => {
    let state = emptyChannelSendGuardState();
    const now = new Date('2026-07-24T15:00:00.000Z');
    const first = reserveChannelSendSlot({
      now,
      state,
      policy: CONSERVATIVE,
      effectiveDailyLimit: 80,
      reservationToken: 'd1',
      random: () => 0,
    });
    state = first.nextState;
    const second = reserveChannelSendSlot({
      now,
      state,
      policy: CONSERVATIVE,
      effectiveDailyLimit: 80,
      reservationToken: 'd2',
      random: () => 0,
    });
    assert.equal(first.decision, 'ALLOW_NOW');
    assert.equal(second.decision, 'DEFER');
    assert.ok(second.reservedSendAt.getTime() >= now.getTime() + 30_000);
  });
});
