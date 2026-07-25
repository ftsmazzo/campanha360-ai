/**
 * Matriz de enforcement e auditoria de piloto (09.6.1).
 */

import type { ChannelSendProtectionPolicy } from './dispatch-channel-send-reservation.util';
import { detectProtectionIntervalViolation } from './dispatch-channel-send-reservation.util';

export type ProtectionEnforcementStatus =
  | 'APPLIED'
  | 'PARTIAL'
  | 'DECLARED_ONLY'
  | 'DISABLED'
  | 'NOT_IMPLEMENTED';

export type ProtectionEnforcementRow = {
  rule: string;
  approvedValue: string;
  valueOrigin: string;
  appliedInWorker: boolean;
  status: ProtectionEnforcementStatus;
  evidence: string;
  lastEvaluation: string | null;
  result: string;
  observation: string;
};

export type PilotIntervalAuditItem = {
  dispatchItemId: string;
  channelAccountId: string | null;
  providerRequestStartedAt: string | null;
  intervalFromPreviousSeconds: number | null;
  minDelaySeconds: number | null;
  selectedDelaySeconds: number | null;
  verdict: 'RESPEITADO' | 'VIOLADO' | 'NAO_COMPROVAVEL';
  reason: string;
};

export type PilotIntervalAuditResult = {
  dispatchId: string;
  channelAccountId: string | null;
  profile: string | null;
  minDelaySeconds: number | null;
  maxDelaySeconds: number | null;
  overallVerdict: 'RESPEITADO' | 'VIOLADO' | 'NAO_COMPROVAVEL';
  items: PilotIntervalAuditItem[];
  violationCount: number;
};

function firstNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function firstBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function firstString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function extractFullSendProtectionPolicy(
  approvalSnapshot: unknown,
): ChannelSendProtectionPolicy & { profile: string } {
  const snapshot = (approvalSnapshot ?? {}) as {
    protectionPolicy?: Record<string, unknown>;
    protectionProfile?: unknown;
  };
  const policy = snapshot.protectionPolicy ?? {};
  const defaults: ChannelSendProtectionPolicy & { profile: string } = {
    profile: firstString(snapshot.protectionProfile) ?? firstString(policy.profile) ?? 'MODERATE',
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
    validateWhatsAppNumber: true,
    optOutKeywords: [],
    repetitionWarningPercentage: 70,
  };

  const optOutKeywords = Array.isArray(policy.optOutKeywords)
    ? policy.optOutKeywords.filter((v): v is string => typeof v === 'string')
    : defaults.optOutKeywords;

  return {
    profile: firstString(policy.profile) ?? defaults.profile,
    minDelaySeconds: firstNumber(policy.minDelaySeconds) ?? defaults.minDelaySeconds,
    maxDelaySeconds: firstNumber(policy.maxDelaySeconds) ?? defaults.maxDelaySeconds,
    batchSize: firstNumber(policy.batchSize) ?? defaults.batchSize,
    pauseBetweenBatchesSeconds:
      firstNumber(policy.pauseBetweenBatchesSeconds) ??
      defaults.pauseBetweenBatchesSeconds,
    longPauseEveryMessages:
      firstNumber(policy.longPauseEveryMessages) ?? defaults.longPauseEveryMessages,
    longPauseMinutes: firstNumber(policy.longPauseMinutes) ?? defaults.longPauseMinutes,
    hourlyLimit: firstNumber(policy.hourlyLimit) ?? defaults.hourlyLimit,
    dailyLimitPerInstance:
      firstNumber(policy.dailyLimitPerInstance) ?? defaults.dailyLimitPerInstance,
    newAccountMaxPerDay:
      firstNumber(policy.newAccountMaxPerDay) ?? defaults.newAccountMaxPerDay,
    newAccountDays: firstNumber(policy.newAccountDays) ?? defaults.newAccountDays,
    warmupEnabled: firstBoolean(policy.warmupEnabled) ?? defaults.warmupEnabled,
    warmupDays: firstNumber(policy.warmupDays) ?? defaults.warmupDays,
    warmupMaxPerDay: firstNumber(policy.warmupMaxPerDay) ?? defaults.warmupMaxPerDay,
    consecutiveErrorsBeforePause:
      firstNumber(policy.consecutiveErrorsBeforePause) ??
      defaults.consecutiveErrorsBeforePause,
    errorPauseMinutes:
      firstNumber(policy.errorPauseMinutes) ?? defaults.errorPauseMinutes,
    rotateEveryMessages:
      firstNumber(policy.rotateEveryMessages) ?? defaults.rotateEveryMessages,
    rotationEnabled: firstBoolean(policy.rotationEnabled) ?? defaults.rotationEnabled,
    pauseOn403: firstBoolean(policy.pauseOn403) ?? defaults.pauseOn403,
    pauseOn429: firstBoolean(policy.pauseOn429) ?? defaults.pauseOn429,
    validateWhatsAppNumber:
      firstBoolean(policy.validateWhatsAppNumber) ?? defaults.validateWhatsAppNumber,
    optOutKeywords,
    repetitionWarningPercentage:
      firstNumber(policy.repetitionWarningPercentage) ??
      defaults.repetitionWarningPercentage,
  };
}

/**
 * Matriz declarativa do que o Worker realmente aplica apos 09.6.1.
 */
export function buildProtectionEnforcementMatrix(input: {
  approvalSnapshot: unknown;
  hasAtomicReservation: boolean;
  guardSummary?: {
    nextAvailableAt?: string | null;
    lastSentAt?: string | null;
    dailySentCount?: number;
    hourlySentCount?: number;
    violationCount?: number;
    protectionCooldownUntil?: string | null;
    sequenceNumber?: number;
  } | null;
  evaluatedAt?: Date;
}): ProtectionEnforcementRow[] {
  const policy = extractFullSendProtectionPolicy(input.approvalSnapshot);
  const at = (input.evaluatedAt ?? new Date()).toISOString();
  const guard = input.guardSummary ?? null;
  const atomic = input.hasAtomicReservation;

  const row = (
    partial: Omit<ProtectionEnforcementRow, 'lastEvaluation'> & {
      lastEvaluation?: string | null;
    },
  ): ProtectionEnforcementRow => ({
    lastEvaluation: partial.lastEvaluation ?? at,
    ...partial,
  });

  return [
    row({
      rule: 'Delay por canal (ChannelAccount)',
      approvedValue: `${policy.minDelaySeconds}–${policy.maxDelaySeconds} s`,
      valueOrigin: 'approvalSnapshot.protectionPolicy',
      appliedInWorker: atomic,
      status: atomic ? 'APPLIED' : 'DECLARED_ONLY',
      evidence: atomic
        ? `ChannelAccountSendGuard.nextAvailableAt=${guard?.nextAvailableAt ?? 'n/a'}`
        : 'Leitura de lastSentAt sem exclusao mutua',
      result: atomic ? 'SERIALIZADO_POR_RESERVA' : 'SUJEITO_A_CORRIDA',
      observation: 'Reserva atomica SELECT FOR UPDATE por ChannelAccount',
    }),
    row({
      rule: 'Limite horario',
      approvedValue: String(policy.hourlyLimit),
      valueOrigin: 'approvalSnapshot.protectionPolicy.hourlyLimit',
      appliedInWorker: atomic,
      status: atomic ? 'APPLIED' : 'DECLARED_ONLY',
      evidence: `hourlySentCount=${guard?.hourlySentCount ?? 0}`,
      result: atomic ? 'CONTADOR_ATOMICO_HORARIO' : 'NAO_ENFORCED',
      observation: 'Ao atingir: reagenda proxima hora, nao FAILED',
    }),
    row({
      rule: 'Limite diario efetivo',
      approvedValue: String(policy.dailyLimitPerInstance),
      valueOrigin: 'approvalSnapshot + idade da conta',
      appliedInWorker: atomic,
      status: atomic ? 'APPLIED' : 'PARTIAL',
      evidence: `dailySentCount=${guard?.dailySentCount ?? 0}; sequence=${guard?.sequenceNumber ?? 0}`,
      result: atomic ? 'CONTADOR_ATOMICO_DIARIO_POR_ACCOUNT' : 'APENAS_DISPATCH_CHANNEL',
      observation: 'Menor entre daily/newAccount/warmup; age unknown => conservador',
    }),
    row({
      rule: 'Lote e pausa entre lotes',
      approvedValue: `batch=${policy.batchSize}; pause=${policy.pauseBetweenBatchesSeconds}s`,
      valueOrigin: 'approvalSnapshot.protectionPolicy',
      appliedInWorker: atomic,
      status: atomic ? 'APPLIED' : 'PARTIAL',
      evidence: 'sequenceNumber compartilhado no guard',
      result: atomic ? 'PAUSA_NO_ITEM_N_PLUS_1' : 'BASEADO_EM_sentItems_LOCAIS',
      observation: 'Pausa apos N envios confirmados do ChannelAccount',
    }),
    row({
      rule: 'Pausa longa',
      approvedValue: `a cada ${policy.longPauseEveryMessages} msgs / ${policy.longPauseMinutes} min`,
      valueOrigin: 'approvalSnapshot.protectionPolicy',
      appliedInWorker: atomic,
      status: atomic ? 'APPLIED' : 'PARTIAL',
      evidence: 'computeBatchPauseSeconds',
      result: atomic ? 'APLICADA_NA_RESERVA' : 'PARCIAL',
      observation: '',
    }),
    row({
      rule: 'Rotacao',
      approvedValue: policy.rotationEnabled
        ? `enabled; every=${policy.rotateEveryMessages}`
        : 'disabled',
      valueOrigin: 'approvalSnapshot.protectionPolicy',
      appliedInWorker: true,
      status: policy.rotationEnabled ? 'APPLIED' : 'DISABLED',
      evidence: 'shouldRotateChannel + selectNextEligible',
      result: 'NAO_VIOLA_INTERVALO_DA_NOVA_INSTANCIA',
      observation: 'Nova instância passa pela mesma reserva atomica',
    }),
    row({
      rule: 'Janela operacional',
      approvedValue: 'timezone/dias/horario do snapshot',
      valueOrigin: 'approvalSnapshot',
      appliedInWorker: true,
      status: 'APPLIED',
      evidence: 'isWithinOperationalWindow no Worker antes da reserva',
      result: 'REAGENDA_FORA_DA_JANELA',
      observation: '',
    }),
    row({
      rule: 'Cooldown 403/429',
      approvedValue: `pauseOn403=${policy.pauseOn403}; pauseOn429=${policy.pauseOn429}; beforePause=${policy.consecutiveErrorsBeforePause}; pauseMin=${policy.errorPauseMinutes}`,
      valueOrigin: 'approvalSnapshot.protectionPolicy',
      appliedInWorker: true,
      status: 'APPLIED',
      evidence: 'DispatchChannel.cooldownUntil + guard.protectionCooldownUntil em violacao',
      result: 'RESPEITADO_POR_WORKERS',
      observation: 'Cooldown persistido; failover nao ignora nextAvailableAt',
    }),
    row({
      rule: 'Validacao WhatsApp number',
      approvedValue: String(policy.validateWhatsAppNumber),
      valueOrigin: 'approvalSnapshot.protectionPolicy',
      appliedInWorker: policy.validateWhatsAppNumber,
      status: policy.validateWhatsAppNumber ? 'APPLIED' : 'DISABLED',
      evidence:
        'Worker consulta Evolution /chat/whatsappNumbers antes da reserva; cache DestinationWhatsAppValidationCache',
      result: policy.validateWhatsAppNumber
        ? 'BLOQUEANTE_ANTES_DO_ENVIO'
        : 'DESATIVADA_PELO_OPERADOR',
      observation: policy.validateWhatsAppNumber
        ? 'Fail closed em UNKNOWN; INVALID → SKIPPED'
        : 'Numeros invalidos podem chegar ao fluxo de envio',
    }),
    row({
      rule: 'Opt-out keywords',
      approvedValue: `${policy.optOutKeywords.length} keywords`,
      valueOrigin: 'approvalSnapshot.protectionPolicy',
      appliedInWorker: false,
      status: 'DECLARED_ONLY',
      evidence: 'keywords no snapshot; enforcement de opt-out usa ContactStatus/OptOut atual',
      result: 'PARCIAL_VIA_STATUS_CONTATO',
      observation: 'Keywords de inbound nao sao reavaliadas no Worker de disparo',
    }),
    row({
      rule: 'Opt-out / BLOCKED / DELETED atual',
      approvedValue: 'bloqueio last-mile',
      valueOrigin: 'Contact + OptOut',
      appliedInWorker: true,
      status: 'APPLIED',
      evidence: 'runRealSend last-mile checks',
      result: 'SKIPPED_CONTACT_*',
      observation: '',
    }),
    row({
      rule: 'Repetition warning',
      approvedValue: `${policy.repetitionWarningPercentage}%`,
      valueOrigin: 'approvalSnapshot.protectionPolicy',
      appliedInWorker: false,
      status: 'DECLARED_ONLY',
      evidence: 'somente aviso configurado; nao bloqueia envio',
      result: 'NAO_BLOQUEANTE',
      observation: '',
    }),
    row({
      rule: 'Detector de violacao de intervalo',
      approvedValue: `min=${policy.minDelaySeconds}s`,
      valueOrigin: 'approvalSnapshot + ChannelAccountSendGuard',
      appliedInWorker: atomic,
      status: atomic ? 'APPLIED' : 'NOT_IMPLEMENTED',
      evidence: `violationCount=${guard?.violationCount ?? 0}`,
      result: atomic ? 'PROTECTION_INTERVAL_VIOLATION' : 'SEM_DETECTOR',
      observation: 'Cooldown preventivo; nao reenvia',
    }),
  ];
}

export function auditPilotSendIntervals(input: {
  dispatchId: string;
  profile: string | null;
  minDelaySeconds: number | null;
  maxDelaySeconds: number | null;
  items: Array<{
    dispatchItemId: string;
    channelAccountId: string | null;
    providerRequestStartedAt: Date | string | null;
    selectedDelaySeconds?: number | null;
  }>;
}): PilotIntervalAuditResult {
  const byChannel = new Map<string, typeof input.items>();
  for (const item of input.items) {
    const key = item.channelAccountId ?? '__none__';
    const list = byChannel.get(key) ?? [];
    list.push(item);
    byChannel.set(key, list);
  }

  const audited: PilotIntervalAuditItem[] = [];
  let violationCount = 0;
  let anyComprovavel = false;
  let anyViolado = false;

  for (const [channelKey, channelItems] of byChannel) {
    const sorted = [...channelItems].sort((a, b) => {
      const ta = a.providerRequestStartedAt
        ? new Date(a.providerRequestStartedAt).getTime()
        : Number.POSITIVE_INFINITY;
      const tb = b.providerRequestStartedAt
        ? new Date(b.providerRequestStartedAt).getTime()
        : Number.POSITIVE_INFINITY;
      return ta - tb;
    });

    let previousStarted: Date | null = null;
    for (const item of sorted) {
      const started = item.providerRequestStartedAt
        ? new Date(item.providerRequestStartedAt)
        : null;

      if (!started || Number.isNaN(started.getTime())) {
        audited.push({
          dispatchItemId: item.dispatchItemId,
          channelAccountId: item.channelAccountId,
          providerRequestStartedAt: null,
          intervalFromPreviousSeconds: null,
          minDelaySeconds: input.minDelaySeconds,
          selectedDelaySeconds: item.selectedDelaySeconds ?? null,
          verdict: 'NAO_COMPROVAVEL',
          reason: 'SEM_providerRequestStartedAt',
        });
        continue;
      }

      anyComprovavel = true;
      if (!previousStarted) {
        audited.push({
          dispatchItemId: item.dispatchItemId,
          channelAccountId: item.channelAccountId,
          providerRequestStartedAt: started.toISOString(),
          intervalFromPreviousSeconds: null,
          minDelaySeconds: input.minDelaySeconds,
          selectedDelaySeconds: item.selectedDelaySeconds ?? null,
          verdict: 'RESPEITADO',
          reason: 'PRIMEIRA_MENSAGEM_DO_CANAL',
        });
        previousStarted = started;
        continue;
      }

      const minDelay = input.minDelaySeconds ?? 0;
      const detection = detectProtectionIntervalViolation({
        previousStartedAt: previousStarted,
        actualStartedAt: started,
        minDelaySeconds: minDelay,
      });

      if (detection.violated) {
        anyViolado = true;
        violationCount += 1;
        audited.push({
          dispatchItemId: item.dispatchItemId,
          channelAccountId: item.channelAccountId,
          providerRequestStartedAt: started.toISOString(),
          intervalFromPreviousSeconds: detection.intervalObservedSeconds,
          minDelaySeconds: input.minDelaySeconds,
          selectedDelaySeconds: item.selectedDelaySeconds ?? null,
          verdict: 'VIOLADO',
          reason: `INTERVALo ${detection.intervalObservedSeconds?.toFixed(2)}s < min ${minDelay}s (${channelKey})`,
        });
      } else {
        audited.push({
          dispatchItemId: item.dispatchItemId,
          channelAccountId: item.channelAccountId,
          providerRequestStartedAt: started.toISOString(),
          intervalFromPreviousSeconds: detection.intervalObservedSeconds,
          minDelaySeconds: input.minDelaySeconds,
          selectedDelaySeconds: item.selectedDelaySeconds ?? null,
          verdict: 'RESPEITADO',
          reason: `Intervalo ${detection.intervalObservedSeconds?.toFixed(2)}s >= min ${minDelay}s`,
        });
      }
      previousStarted = started;
    }
  }

  const overallVerdict: PilotIntervalAuditResult['overallVerdict'] = anyViolado
    ? 'VIOLADO'
    : anyComprovavel
      ? 'RESPEITADO'
      : 'NAO_COMPROVAVEL';

  const primaryChannel =
    input.items.find((i) => i.channelAccountId)?.channelAccountId ?? null;

  return {
    dispatchId: input.dispatchId,
    channelAccountId: primaryChannel,
    profile: input.profile,
    minDelaySeconds: input.minDelaySeconds,
    maxDelaySeconds: input.maxDelaySeconds,
    overallVerdict,
    items: audited,
    violationCount,
  };
}
