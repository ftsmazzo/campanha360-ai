import { createHash } from 'node:crypto';
import {
  ChannelAccountStatus,
  ChannelProvider,
  DispatchPlanStatus,
} from '@prisma/client';
import { isAllowedDispatchProvider, isArchivedChannelAccount } from '../dispatch-plans/dispatch-plan.util';
import { hashDispatchPlanContent } from '../dispatch-plans/dispatch-plan-approval.util';

export type DispatchContentSnapshot = {
  type: 'TEXT';
  body: string;
  hash: string;
  length: number;
  approvedVersion: number;
};

export type DispatchConfigurationSnapshot = {
  requestedMessagesPerMinute: number | null;
  effectiveMessagesPerMinute: number | null;
  minDelaySeconds: number | null;
  maxDelaySeconds: number | null;
  batchSize: number | null;
  pauseBetweenBatchesSeconds: number | null;
  timezone: string | null;
  allowedStartTime: string | null;
  allowedEndTime: string | null;
  allowedDays: number[] | null;
  plannedStartAt: string | null;
  estimatedStartAt: string | null;
  estimatedEndAt: string | null;
  totalBatches: number | null;
  totalBatchPauses: number | null;
  estimatedActiveDurationSeconds: number | null;
  estimatedCalendarDurationSeconds: number | null;
};

export function canCreateDispatchFromPlan(input: {
  status: string;
  approvedAt: Date | string | null;
  approvedByUserId: string | null;
  approvalSnapshot: unknown;
  snapshotCreatedAt: Date | string | null;
  totalEligible: number;
  validationSnapshot: unknown;
  validatedVersion: number | null | undefined;
  planVersion: number;
  simulationSnapshot: unknown;
  simulatedVersion: number | null | undefined;
}): { ok: true } | { ok: false; message: string } {
  if (input.status !== DispatchPlanStatus.APPROVED && input.status !== 'APPROVED') {
    return { ok: false, message: 'Somente planos APPROVED podem gerar Dispatch' };
  }
  if (!input.approvedAt || !input.approvedByUserId) {
    return { ok: false, message: 'Plano aprovado incompleto' };
  }
  if (!input.approvalSnapshot || typeof input.approvalSnapshot !== 'object') {
    return { ok: false, message: 'approvalSnapshot e obrigatorio' };
  }
  if (!input.snapshotCreatedAt) {
    return { ok: false, message: 'Snapshot do publico e obrigatorio' };
  }
  if (input.totalEligible <= 0) {
    return { ok: false, message: 'Publico elegivel deve ser maior que zero' };
  }
  const validation = input.validationSnapshot as { passed?: unknown } | null;
  if (!validation || validation.passed !== true) {
    return { ok: false, message: 'Validacao aprovada e obrigatoria' };
  }
  if (input.validatedVersion == null || input.validatedVersion !== input.planVersion) {
    return { ok: false, message: 'Validacao nao corresponde a versao do Plano' };
  }
  if (!input.simulationSnapshot) {
    return { ok: false, message: 'Simulacao e obrigatoria' };
  }
  if (input.simulatedVersion == null || input.simulatedVersion !== input.planVersion) {
    return { ok: false, message: 'Simulacao nao corresponde a versao do Plano' };
  }
  return { ok: true };
}

export function assertChannelReadyForDispatchCreation(input: {
  channelExists: boolean;
  channelBelongsToCampaign: boolean;
  provider: ChannelProvider | string | null;
  status: ChannelAccountStatus | string | null;
}): void {
  if (!input.channelExists) {
    throw new Error('Canal vinculado nao encontrado');
  }
  if (!input.channelBelongsToCampaign) {
    throw new Error('Canal nao pertence a esta campanha');
  }
  if (!input.provider || !isAllowedDispatchProvider(input.provider)) {
    throw new Error('Provider do canal nao e suportado');
  }
  if (!input.status || isArchivedChannelAccount(input.status)) {
    throw new Error('Canal arquivado nao pode ser usado');
  }
  // Desconectado apos aprovacao: permitido na 09.1; revalidado na preparacao/envio.
}

export function extractApprovedContent(approvalSnapshot: unknown): {
  body: string;
  hash: string;
  length: number;
  approvedVersion: number;
} {
  const snapshot = approvalSnapshot as {
    approvedVersion?: number;
    content?: { body?: unknown; hash?: unknown; length?: unknown };
  };

  const body =
    typeof snapshot.content?.body === 'string' ? snapshot.content.body : '';
  const hash =
    typeof snapshot.content?.hash === 'string' ? snapshot.content.hash : '';
  const length =
    typeof snapshot.content?.length === 'number'
      ? snapshot.content.length
      : body.length;
  const approvedVersion =
    typeof snapshot.approvedVersion === 'number' ? snapshot.approvedVersion : 0;

  if (!body.trim()) {
    throw new Error('Conteudo aprovado ausente no approvalSnapshot');
  }
  if (!hash) {
    throw new Error('Hash do conteudo aprovado ausente');
  }

  const recalculated = hashDispatchPlanContent(body);
  if (recalculated !== hash) {
    throw new Error('Hash do conteudo aprovado diverge do approvalSnapshot');
  }

  return { body, hash, length, approvedVersion };
}

export function buildDispatchContentSnapshot(
  approvalSnapshot: unknown,
): DispatchContentSnapshot {
  const content = extractApprovedContent(approvalSnapshot);
  return {
    type: 'TEXT',
    body: content.body,
    hash: content.hash,
    length: content.length,
    approvedVersion: content.approvedVersion,
  };
}

export function buildDispatchConfigurationSnapshot(
  simulationSnapshot: unknown,
): DispatchConfigurationSnapshot {
  const simulation = (simulationSnapshot ?? {}) as {
    configuration?: Record<string, unknown>;
    estimates?: Record<string, unknown>;
  };
  const configuration = simulation.configuration ?? {};
  const estimates = simulation.estimates ?? {};

  return {
    requestedMessagesPerMinute:
      numberOrNull(configuration.requestedMessagesPerMinute),
    effectiveMessagesPerMinute:
      numberOrNull(estimates.effectiveMessagesPerMinute),
    minDelaySeconds: numberOrNull(configuration.minDelaySeconds),
    maxDelaySeconds: numberOrNull(configuration.maxDelaySeconds),
    batchSize: numberOrNull(configuration.batchSize),
    pauseBetweenBatchesSeconds: numberOrNull(
      configuration.pauseBetweenBatchesSeconds,
    ),
    timezone:
      typeof configuration.timezone === 'string'
        ? configuration.timezone
        : null,
    allowedStartTime:
      typeof configuration.allowedStartTime === 'string'
        ? configuration.allowedStartTime
        : null,
    allowedEndTime:
      typeof configuration.allowedEndTime === 'string'
        ? configuration.allowedEndTime
        : null,
    allowedDays: Array.isArray(configuration.allowedDays)
      ? (configuration.allowedDays as number[])
      : null,
    plannedStartAt:
      typeof configuration.plannedStartAt === 'string'
        ? configuration.plannedStartAt
        : null,
    estimatedStartAt:
      typeof estimates.estimatedStartAt === 'string'
        ? estimates.estimatedStartAt
        : null,
    estimatedEndAt:
      typeof estimates.estimatedEndAt === 'string'
        ? estimates.estimatedEndAt
        : null,
    totalBatches: numberOrNull(estimates.totalBatches),
    totalBatchPauses: numberOrNull(estimates.totalBatchPauses),
    estimatedActiveDurationSeconds: numberOrNull(
      estimates.estimatedActiveDurationSeconds,
    ),
    estimatedCalendarDurationSeconds: numberOrNull(
      estimates.estimatedCalendarDurationSeconds,
    ),
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function buildDispatchAllowedActions(input?: {
  role?: string | null;
  status?: string;
  totalItems?: number;
}) {
  const canApprove =
    input?.role === 'OWNER' || input?.role === 'ADMIN';
  const canPrepare =
    Boolean(canApprove) &&
    (input?.status === 'DRAFT' || !input?.status) &&
    (input?.totalItems ?? 0) === 0 &&
    Boolean(input);

  // Sem input (create response): canPrepare permanece false ate GET/prepare.
  return {
    canView: true,
    canPrepare: input ? canPrepare : false,
    canQueue: false,
    canStart: false,
    canPause: false,
    canResume: false,
    canCancel: false,
    canEmergencyStop: false,
    canReconcile: false,
    canRetryFailedItems: false,
  };
}

/** Reexport para testes de hash sem acoplar ao crypto interno. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
