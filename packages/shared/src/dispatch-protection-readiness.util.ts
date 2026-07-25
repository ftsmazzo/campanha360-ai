/**
 * Protection readiness + matriz honesta (09.6.2).
 */

import type { ChannelSendProtectionPolicy } from './dispatch-channel-send-reservation.util';
import { extractFullSendProtectionPolicy } from './dispatch-protection-enforcement.util';
import { isRepetitionAcknowledged } from './dispatch-repetition.util';

export type ProtectionEnforcementKind =
  | 'ENFORCED_BLOCKING'
  | 'ENFORCED_NON_BLOCKING'
  | 'DIAGNOSTIC_ONLY'
  | 'DISABLED_BY_POLICY'
  | 'NOT_IMPLEMENTED'
  | 'NOT_APPLICABLE'
  | 'DEGRADED'
  | 'ERROR';

export type ProtectionReadinessStatus = 'READY' | 'READY_WITH_WARNINGS' | 'BLOCKED';

export type HonestProtectionRow = {
  rule: string;
  configured: boolean;
  applied: boolean;
  blocks: boolean;
  status: ProtectionEnforcementKind;
  approvedValue: string;
  applicationPoint: string;
  evidence: string;
  dependency: string | null;
  fallback: string | null;
  observation: string;
  lastEvaluation: string | null;
};

export type ProtectionReadinessResult = {
  status: ProtectionReadinessStatus;
  blockers: string[];
  warnings: string[];
  rows: HonestProtectionRow[];
};

export function buildHonestProtectionMatrix(input: {
  approvalSnapshot: unknown;
  hasAtomicReservation: boolean;
  whatsappValidationImplemented: boolean;
  /** Endpoint Evolution /chat/whatsappNumbers configurado e cache disponivel. */
  whatsappValidationAvailable?: boolean;
  optOutKeywordsInboundImplemented: boolean;
  lastMileImplemented: boolean;
  accountAgeSource: 'CREATED_AT_ONLY' | 'OPERATIONAL_SINCE' | 'UNKNOWN';
  guardAvailable: boolean;
  evaluatedAt?: Date;
}): HonestProtectionRow[] {
  const policy = extractFullSendProtectionPolicy(input.approvalSnapshot);
  const at = (input.evaluatedAt ?? new Date()).toISOString();
  const atomic = input.hasAtomicReservation && input.guardAvailable;
  const whatsappAvailable = input.whatsappValidationAvailable !== false;

  const row = (
    partial: Omit<HonestProtectionRow, 'lastEvaluation'> & { lastEvaluation?: string | null },
  ): HonestProtectionRow => ({
    lastEvaluation: partial.lastEvaluation ?? at,
    ...partial,
  });

  return [
    row({
      rule: 'Intervalo por ChannelAccount',
      configured: true,
      applied: atomic,
      blocks: atomic,
      status: atomic ? 'ENFORCED_BLOCKING' : 'ERROR',
      approvedValue: `${policy.minDelaySeconds}–${policy.maxDelaySeconds}s`,
      applicationPoint: 'Worker antes da Evolution (reserva atomica)',
      evidence: 'ChannelAccountSendGuard.nextAvailableAt',
      dependency: 'PostgreSQL SELECT FOR UPDATE',
      fallback: null,
      observation: atomic ? '' : 'Guard indisponivel — fail closed',
    }),
    row({
      rule: 'Concorrencia por ChannelAccount',
      configured: true,
      applied: atomic,
      blocks: atomic,
      status: atomic ? 'ENFORCED_BLOCKING' : 'ERROR',
      approvedValue: 'serializacao por conta',
      applicationPoint: 'reserva atomica',
      evidence: 'slot unico por reserva',
      dependency: 'ChannelAccountSendGuard',
      fallback: null,
      observation: '',
    }),
    row({
      rule: 'Lote e pausa',
      configured: true,
      applied: atomic,
      blocks: atomic,
      status: atomic ? 'ENFORCED_BLOCKING' : 'ERROR',
      approvedValue: `batch=${policy.batchSize}; pause=${policy.pauseBetweenBatchesSeconds}s`,
      applicationPoint: 'reserva',
      evidence: 'dailySentCount + computeBatchPauseSeconds',
      dependency: null,
      fallback: null,
      observation: '',
    }),
    row({
      rule: 'Pausa longa',
      configured: true,
      applied: atomic,
      blocks: atomic,
      status: atomic ? 'ENFORCED_BLOCKING' : 'ERROR',
      approvedValue: `every=${policy.longPauseEveryMessages}; ${policy.longPauseMinutes}min`,
      applicationPoint: 'reserva',
      evidence: 'computeBatchPauseSeconds',
      dependency: null,
      fallback: null,
      observation: '',
    }),
    row({
      rule: 'Limite horario',
      configured: true,
      applied: atomic,
      blocks: atomic,
      status: atomic ? 'ENFORCED_BLOCKING' : 'ERROR',
      approvedValue: String(policy.hourlyLimit),
      applicationPoint: 'reserva',
      evidence: 'hourlySentCount',
      dependency: null,
      fallback: 'reagenda proxima hora',
      observation: '',
    }),
    row({
      rule: 'Limite diario',
      configured: true,
      applied: atomic,
      blocks: atomic,
      status: atomic ? 'ENFORCED_BLOCKING' : 'ERROR',
      approvedValue: String(policy.dailyLimitPerInstance),
      applicationPoint: 'reserva',
      evidence: 'dailySentCount + effectiveDailyLimit',
      dependency: null,
      fallback: 'reagenda proximo dia',
      observation: '',
    }),
    row({
      rule: 'Conta nova / aquecimento',
      configured: true,
      applied: atomic,
      blocks: atomic,
      status:
        input.accountAgeSource === 'OPERATIONAL_SINCE'
          ? 'ENFORCED_BLOCKING'
          : input.accountAgeSource === 'CREATED_AT_ONLY'
            ? 'DEGRADED'
            : 'DEGRADED',
      approvedValue: `new=${policy.newAccountMaxPerDay}; warmup=${policy.warmupMaxPerDay}`,
      applicationPoint: 'effectiveDailyLimit na reserva',
      evidence: 'resolveEffectiveDailyLimitForAccount',
      dependency: 'ChannelAccount.createdAt ou accountOperationalSince',
      fallback: 'assume conta nova quando idade desconhecida',
      observation:
        'Idade = data conhecida no Campanha360; nao e idade real da conta WhatsApp',
    }),
    row({
      rule: 'Rotacao',
      configured: policy.rotationEnabled,
      applied: policy.rotationEnabled,
      blocks: false,
      status: policy.rotationEnabled ? 'ENFORCED_NON_BLOCKING' : 'DISABLED_BY_POLICY',
      approvedValue: `every=${policy.rotateEveryMessages}`,
      applicationPoint: 'Worker selecao de canal',
      evidence: 'shouldRotateChannel',
      dependency: 'multiplas instancias aptas',
      fallback: 'mantem canal atual',
      observation: 'Nova instancia respeita propria reserva',
    }),
    row({
      rule: 'Janela operacional',
      configured: true,
      applied: true,
      blocks: true,
      status: 'ENFORCED_BLOCKING',
      approvedValue: 'snapshot timezone/dias/horario',
      applicationPoint: 'Worker antes da reserva',
      evidence: 'isWithinOperationalWindow',
      dependency: null,
      fallback: 'reagenda abertura',
      observation: '',
    }),
    row({
      rule: '403 / pauseOn403',
      configured: policy.pauseOn403,
      applied: policy.pauseOn403,
      blocks: policy.pauseOn403,
      status: policy.pauseOn403 ? 'ENFORCED_BLOCKING' : 'DISABLED_BY_POLICY',
      approvedValue: `pauseOn403=${policy.pauseOn403}; before=${policy.consecutiveErrorsBeforePause}; min=${policy.errorPauseMinutes}`,
      applicationPoint: 'Worker apos falha AUTHENTICATION_ERROR',
      evidence: 'consecutiveErrors + cooldownUntil + errorPauseMinutes',
      dependency: null,
      fallback: 'failover ou reagendar',
      observation: '',
    }),
    row({
      rule: '429 / pauseOn429',
      configured: policy.pauseOn429,
      applied: policy.pauseOn429,
      blocks: policy.pauseOn429,
      status: policy.pauseOn429 ? 'ENFORCED_BLOCKING' : 'DISABLED_BY_POLICY',
      approvedValue: `pauseOn429=${policy.pauseOn429}`,
      applicationPoint: 'Worker apos PROVIDER_RATE_LIMIT',
      evidence: 'cooldown com errorPauseMinutes',
      dependency: null,
      fallback: 'failover ou reagendar',
      observation: '',
    }),
    row({
      rule: 'Erros consecutivos',
      configured: true,
      applied: true,
      blocks: true,
      status: 'ENFORCED_BLOCKING',
      approvedValue: String(policy.consecutiveErrorsBeforePause),
      applicationPoint: 'Worker apos erro provider relevante',
      evidence: 'DispatchChannel.consecutiveErrors',
      dependency: null,
      fallback: 'cooldown + failover',
      observation: 'opt-out/blocked/invalid nao incrementam',
    }),
    row({
      rule: 'Validacao WhatsApp number',
      configured: policy.validateWhatsAppNumber,
      applied:
        policy.validateWhatsAppNumber &&
        input.whatsappValidationImplemented &&
        whatsappAvailable,
      blocks:
        policy.validateWhatsAppNumber &&
        input.whatsappValidationImplemented &&
        whatsappAvailable,
      status: !policy.validateWhatsAppNumber
        ? 'DISABLED_BY_POLICY'
        : !input.whatsappValidationImplemented
          ? 'NOT_IMPLEMENTED'
          : !whatsappAvailable
            ? 'ERROR'
            : 'ENFORCED_BLOCKING',
      approvedValue: String(policy.validateWhatsAppNumber),
      applicationPoint: 'Worker antes da reserva de slot',
      evidence: 'validateWhatsAppNumber + DestinationWhatsAppValidationCache',
      dependency: 'Evolution /chat/whatsappNumbers',
      fallback: 'fail closed se provider indisponivel',
      observation: !policy.validateWhatsAppNumber
        ? 'Desativada pelo operador — numeros invalidos podem chegar ao envio'
        : !whatsappAvailable
          ? 'Validador Evolution indisponivel — Start bloqueado'
          : 'Regex so e validacao estrutural inicial; existencia via Evolution',
    }),
    row({
      rule: 'Opt-out atual (last-mile)',
      configured: true,
      applied: input.lastMileImplemented,
      blocks: input.lastMileImplemented,
      status: input.lastMileImplemented ? 'ENFORCED_BLOCKING' : 'ERROR',
      approvedValue: 'Contact/OptOut/Consent atuais',
      applicationPoint: 'Worker last-mile antes da Evolution',
      evidence: 'SKIPPED_CONTACT_OPT_OUT',
      dependency: 'banco',
      fallback: 'fail closed se consulta falhar',
      observation: 'Estado atual vence snapshot',
    }),
    row({
      rule: 'Opt-out keywords (inbound)',
      configured: true,
      applied: input.optOutKeywordsInboundImplemented,
      blocks: input.optOutKeywordsInboundImplemented,
      status: input.optOutKeywordsInboundImplemented
        ? 'ENFORCED_BLOCKING'
        : 'NOT_IMPLEMENTED',
      approvedValue: `${policy.optOutKeywords.length || 'defaults'} keywords`,
      applicationPoint: 'Webhook inbound Evolution',
      evidence: 'matchOptOutKeyword + skip items pendentes',
      dependency: 'webhook Evolution',
      fallback: null,
      observation: 'NAO avaliado no Worker outbound',
    }),
    row({
      rule: 'BLOCKED / DELETED',
      configured: true,
      applied: input.lastMileImplemented,
      blocks: input.lastMileImplemented,
      status: input.lastMileImplemented ? 'ENFORCED_BLOCKING' : 'ERROR',
      approvedValue: 'ContactStatus',
      applicationPoint: 'last-mile',
      evidence: 'SKIPPED_CONTACT_BLOCKED/DELETED',
      dependency: 'banco',
      fallback: 'fail closed',
      observation: '',
    }),
    row({
      rule: 'Repeticao de conteudo',
      configured: true,
      applied: true,
      blocks: false,
      status: 'ENFORCED_NON_BLOCKING',
      approvedValue: `${policy.repetitionWarningPercentage}%`,
      applicationPoint: 'Aprovacao/preparacao do Plano (snapshot)',
      evidence: 'repetitionAssessment no approvalSnapshot',
      dependency: null,
      fallback: 'exige reconhecimento do operador se acima do limiar',
      observation: 'Nao e garantia anti-bloqueio da plataforma',
    }),
    row({
      rule: 'Pause / cancel / emergency',
      configured: true,
      applied: true,
      blocks: true,
      status: 'ENFORCED_BLOCKING',
      approvedValue: 'controle operacional 09.5',
      applicationPoint: 'API + Worker revalidacao',
      evidence: 'BLOCKED_DISPATCH_*',
      dependency: null,
      fallback: null,
      observation: '',
    }),
    row({
      rule: 'Idempotencia / SENT',
      configured: true,
      applied: true,
      blocks: true,
      status: 'ENFORCED_BLOCKING',
      approvedValue: 'providerMessageId/sentAt',
      applicationPoint: 'Worker claim',
      evidence: 'NOOP_ALREADY_SENT',
      dependency: null,
      fallback: null,
      observation: '',
    }),
    row({
      rule: 'UNKNOWN_PROVIDER_STATE',
      configured: true,
      applied: true,
      blocks: true,
      status: 'ENFORCED_BLOCKING',
      approvedValue: 'sem retry automatico',
      applicationPoint: 'Worker apos ambiguidade',
      evidence: 'status UNKNOWN + resolucao administrativa',
      dependency: null,
      fallback: 'revisao humana',
      observation: '',
    }),
  ];
}

export function evaluateProtectionReadiness(input: {
  approvalSnapshot: unknown;
  rows: HonestProtectionRow[];
}): ProtectionReadinessResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const snapshot = input.approvalSnapshot;
  if (!snapshot || typeof snapshot !== 'object') {
    blockers.push('SNAPSHOT_SEM_POLITICA');
  }

  for (const row of input.rows) {
    if (row.status === 'ERROR') {
      blockers.push(`${row.rule}:ERROR`);
    }
    if (row.status === 'NOT_IMPLEMENTED' && row.configured && row.blocks !== false) {
      // validateWhatsApp quando true sem integracao
      if (row.rule.includes('Validacao WhatsApp') && row.configured) {
        blockers.push(`${row.rule}:NOT_IMPLEMENTED`);
      }
    }
    if (row.status === 'NOT_IMPLEMENTED' && row.rule.includes('keywords')) {
      blockers.push(`${row.rule}:NOT_IMPLEMENTED`);
    }
    if (row.status === 'DEGRADED') {
      warnings.push(`${row.rule}:DEGRADED`);
    }
    if (row.status === 'ENFORCED_NON_BLOCKING') {
      warnings.push(`${row.rule}:NON_BLOCKING`);
    }
    if (
      row.status === 'DISABLED_BY_POLICY' &&
      row.rule.includes('Validacao WhatsApp')
    ) {
      warnings.push('VALIDATE_WHATSAPP_DISABLED_BY_POLICY');
    }
  }

  if (!isRepetitionAcknowledged(snapshot)) {
    blockers.push('REPETITION_WARNING_NAO_RECONHECIDO');
  }

  const policy = extractFullSendProtectionPolicy(snapshot) as ChannelSendProtectionPolicy & {
    profile: string;
  };
  if (policy.validateWhatsAppNumber) {
    const wa = input.rows.find((r) => r.rule.includes('Validacao WhatsApp'));
    if (wa && (wa.status === 'NOT_IMPLEMENTED' || wa.status === 'ERROR')) {
      if (!blockers.includes(`${wa.rule}:NOT_IMPLEMENTED`)) {
        blockers.push('VALIDATE_WHATSAPP_OBRIGATORIA_INDISPONIVEL');
      }
    }
  }

  const status: ProtectionReadinessStatus =
    blockers.length > 0
      ? 'BLOCKED'
      : warnings.length > 0
        ? 'READY_WITH_WARNINGS'
        : 'READY';

  return { status, blockers, warnings, rows: input.rows };
}
