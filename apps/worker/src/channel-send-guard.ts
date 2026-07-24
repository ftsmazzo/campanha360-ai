import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import {
  applyProtectionViolationCooldown,
  confirmChannelSendSuccess,
  emptyChannelSendGuardState,
  extractFullSendProtectionPolicy,
  reserveChannelSendSlot,
  resolveEffectiveDailyLimitForAccount,
  type ChannelSendGuardState,
  type ChannelSendProtectionPolicy,
  type ReserveChannelSendSlotResult,
} from '@campanha360/shared';

type GuardRow = {
  id: string;
  organizationId: string;
  campaignId: string;
  channelAccountId: string;
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
  lastViolationAt: Date | null;
  violationCount: number;
  version: number;
};

function rowToState(row: GuardRow | null): ChannelSendGuardState {
  if (!row) return emptyChannelSendGuardState();
  return {
    nextAvailableAt: row.nextAvailableAt,
    lastReservedAt: row.lastReservedAt,
    lastSentAt: row.lastSentAt,
    reservationToken: row.reservationToken,
    reservationExpiresAt: row.reservationExpiresAt,
    lastSelectedDelaySeconds: row.lastSelectedDelaySeconds,
    sequenceNumber: row.sequenceNumber,
    dailyUsageDate: row.dailyUsageDate,
    dailySentCount: row.dailySentCount,
    hourlyWindowStart: row.hourlyWindowStart,
    hourlySentCount: row.hourlySentCount,
    protectionCooldownUntil: row.protectionCooldownUntil,
    violationCount: row.violationCount,
  };
}

async function lockOrCreateGuard(
  tx: PrismaClient,
  input: {
    organizationId: string;
    campaignId: string;
    channelAccountId: string;
  },
): Promise<GuardRow> {
  const existing = await tx.$queryRaw<GuardRow[]>`
    SELECT *
    FROM "ChannelAccountSendGuard"
    WHERE "channelAccountId" = ${input.channelAccountId}
    FOR UPDATE
  `;

  if (existing[0]) {
    return existing[0];
  }

  const id = randomUUID().replace(/-/g, '').slice(0, 24);
  await tx.$executeRaw`
    INSERT INTO "ChannelAccountSendGuard" (
      "id", "organizationId", "campaignId", "channelAccountId",
      "sequenceNumber", "dailySentCount", "hourlySentCount",
      "violationCount", "version", "createdAt", "updatedAt"
    ) VALUES (
      ${id}, ${input.organizationId}, ${input.campaignId}, ${input.channelAccountId},
      0, 0, 0, 0, 0, NOW(), NOW()
    )
    ON CONFLICT ("channelAccountId") DO NOTHING
  `;

  const locked = await tx.$queryRaw<GuardRow[]>`
    SELECT *
    FROM "ChannelAccountSendGuard"
    WHERE "channelAccountId" = ${input.channelAccountId}
    FOR UPDATE
  `;

  if (!locked[0]) {
    throw new Error('CHANNEL_ACCOUNT_SEND_GUARD_CREATE_FAILED');
  }
  return locked[0];
}

async function persistGuardState(
  tx: PrismaClient,
  channelAccountId: string,
  state: ChannelSendGuardState,
  extra?: { lastViolationAt?: Date | null },
): Promise<void> {
  await tx.$executeRaw`
    UPDATE "ChannelAccountSendGuard"
    SET
      "nextAvailableAt" = ${state.nextAvailableAt},
      "lastReservedAt" = ${state.lastReservedAt},
      "lastSentAt" = ${state.lastSentAt},
      "reservationToken" = ${state.reservationToken},
      "reservationExpiresAt" = ${state.reservationExpiresAt},
      "lastSelectedDelaySeconds" = ${state.lastSelectedDelaySeconds},
      "sequenceNumber" = ${state.sequenceNumber},
      "dailyUsageDate" = ${state.dailyUsageDate},
      "dailySentCount" = ${state.dailySentCount},
      "hourlyWindowStart" = ${state.hourlyWindowStart},
      "hourlySentCount" = ${state.hourlySentCount},
      "protectionCooldownUntil" = ${state.protectionCooldownUntil},
      "lastViolationAt" = ${extra?.lastViolationAt ?? null},
      "violationCount" = ${state.violationCount},
      "version" = "version" + 1,
      "updatedAt" = NOW()
    WHERE "channelAccountId" = ${channelAccountId}
  `;
}

export type AtomicReserveResult = ReserveChannelSendSlotResult & {
  policy: ChannelSendProtectionPolicy & { profile: string };
  accountAgeKnown: boolean;
  accountStage: string;
  reservationToken: string;
};

/**
 * Reserva atomica do proximo horario de envio para a ChannelAccount.
 * Estrategia: transacao PostgreSQL + SELECT FOR UPDATE (multi-replica safe).
 */
export async function reserveChannelAccountSendSlotAtomic(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    campaignId: string;
    channelAccountId: string;
    channelAccountCreatedAt: Date | null;
    approvalSnapshot: unknown;
    /** Limite diario ja materializado no DispatchChannel (piso adicional). */
    dispatchChannelEffectiveDailyLimit?: number | null;
    now: Date;
    random?: () => number;
  },
): Promise<AtomicReserveResult> {
  const policy = extractFullSendProtectionPolicy(input.approvalSnapshot);
  const ageDays =
    input.channelAccountCreatedAt != null
      ? Math.max(
          0,
          Math.floor(
            (input.now.getTime() - input.channelAccountCreatedAt.getTime()) /
              (24 * 60 * 60 * 1000),
          ),
        )
      : null;

  const ageResolved = resolveEffectiveDailyLimitForAccount({
    accountAgeDays: ageDays,
    policy,
  });

  const effectiveDailyLimit = Math.min(
    ageResolved.effectiveDailyLimit,
    input.dispatchChannelEffectiveDailyLimit ?? ageResolved.effectiveDailyLimit,
  );

  const reservationToken = randomUUID();

  return prisma.$transaction(async (tx) => {
    const row = await lockOrCreateGuard(tx as unknown as PrismaClient, {
      organizationId: input.organizationId,
      campaignId: input.campaignId,
      channelAccountId: input.channelAccountId,
    });

    const result = reserveChannelSendSlot({
      now: input.now,
      state: rowToState(row),
      policy,
      effectiveDailyLimit,
      reservationToken,
      random: input.random,
    });

    await persistGuardState(tx as unknown as PrismaClient, input.channelAccountId, result.nextState, {
      lastViolationAt: row.lastViolationAt,
    });

    return {
      ...result,
      policy,
      accountAgeKnown: ageResolved.accountAgeKnown,
      accountStage: ageResolved.stage,
      reservationToken,
    };
  });
}

export async function confirmChannelAccountSendSuccessAtomic(
  prisma: PrismaClient,
  input: {
    channelAccountId: string;
    now: Date;
  },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<GuardRow[]>`
      SELECT *
      FROM "ChannelAccountSendGuard"
      WHERE "channelAccountId" = ${input.channelAccountId}
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) return;
    const next = confirmChannelSendSuccess(rowToState(row), input.now);
    await persistGuardState(tx as unknown as PrismaClient, input.channelAccountId, next, {
      lastViolationAt: row.lastViolationAt,
    });
  });
}

export async function registerChannelProtectionIntervalViolation(
  prisma: PrismaClient,
  input: {
    channelAccountId: string;
    now: Date;
    cooldownMinutes: number;
  },
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<GuardRow[]>`
      SELECT *
      FROM "ChannelAccountSendGuard"
      WHERE "channelAccountId" = ${input.channelAccountId}
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) return 0;
    const next = applyProtectionViolationCooldown(
      rowToState(row),
      input.now,
      input.cooldownMinutes,
    );
    await persistGuardState(tx as unknown as PrismaClient, input.channelAccountId, next, {
      lastViolationAt: input.now,
    });
    return next.violationCount;
  });
}

export async function loadChannelAccountSendGuard(
  prisma: PrismaClient,
  channelAccountId: string,
): Promise<GuardRow | null> {
  const rows = await prisma.$queryRaw<GuardRow[]>`
    SELECT *
    FROM "ChannelAccountSendGuard"
    WHERE "channelAccountId" = ${channelAccountId}
  `;
  return rows[0] ?? null;
}
