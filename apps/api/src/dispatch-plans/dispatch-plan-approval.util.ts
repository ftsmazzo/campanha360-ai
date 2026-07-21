import { createHash } from 'node:crypto';
import {
  ChannelAccountStatus,
  ChannelProvider,
  DispatchPlanStatus,
  MembershipRole,
} from '@prisma/client';
import {
  DISPATCH_PLAN_REASON_MAX_LENGTH,
  DISPATCH_PLAN_REASON_MIN_LENGTH,
} from './dispatch-plan-approval.constants';
import { isSimulationCurrent } from './dispatch-plan-simulation.util';
import { isValidationCurrent } from './dispatch-plan-validation.util';
import {
  isAllowedDispatchProvider,
  isArchivedChannelAccount,
} from './dispatch-plan.util';

export type ApprovalSnapshot = {
  approvedAt: string;
  approvedVersion: number;
  approvedByUserId: string;
  plan: {
    dispatchPlanId: string;
    name: string;
    campaignId: string;
    segmentId: string;
    channelAccountId: string;
    channelType: string;
    channelProvider: string;
  };
  audience: {
    totalEvaluated: number;
    totalEligible: number;
    totalExcluded: number;
    snapshotCreatedAt: string | null;
  };
  validation: {
    validatedAt: string | null;
    validatedVersion: number | null;
    passed: boolean;
    errorCount: number;
    warningCount: number;
  };
  simulation: {
    simulatedAt: string | null;
    simulatedVersion: number | null;
    requestedMessagesPerMinute: number | null;
    effectiveMessagesPerMinute: number | null;
    totalBatches: number | null;
    estimatedActiveDurationSeconds: number | null;
    estimatedCalendarDurationSeconds: number | null;
    estimatedStartAt: string | null;
    estimatedEndAt: string | null;
    timezone: string | null;
  };
  content: {
    type: 'TEXT';
    length: number;
    hash: string;
    body: string;
  };
};

export const APPROVE_ROLES: MembershipRole[] = [
  MembershipRole.OWNER,
  MembershipRole.ADMIN,
];

export function canApproveRole(role: MembershipRole | string): boolean {
  return (
    role === MembershipRole.OWNER ||
    role === 'OWNER' ||
    role === MembershipRole.ADMIN ||
    role === 'ADMIN'
  );
}

export function isDispatchPlanImmutable(
  status: DispatchPlanStatus | string,
): boolean {
  return (
    status === DispatchPlanStatus.APPROVED ||
    status === 'APPROVED' ||
    status === DispatchPlanStatus.REJECTED ||
    status === 'REJECTED' ||
    status === DispatchPlanStatus.CANCELED ||
    status === 'CANCELED' ||
    status === DispatchPlanStatus.EXPIRED ||
    status === 'EXPIRED'
  );
}

export function hashDispatchPlanContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function normalizeDecisionReason(reason: string | undefined | null): string {
  const trimmed = reason?.trim() ?? '';
  if (trimmed.length < DISPATCH_PLAN_REASON_MIN_LENGTH) {
    throw new Error(
      `Motivo deve ter ao menos ${DISPATCH_PLAN_REASON_MIN_LENGTH} caracteres`,
    );
  }
  if (trimmed.length > DISPATCH_PLAN_REASON_MAX_LENGTH) {
    throw new Error(
      `Motivo deve ter no maximo ${DISPATCH_PLAN_REASON_MAX_LENGTH} caracteres`,
    );
  }
  return trimmed;
}

export function canApproveDispatchPlanPreconditions(input: {
  status: string;
  snapshotCreatedAt: Date | string | null;
  totalEligible: number;
  content: string;
  validationSnapshot: unknown;
  validatedAt: Date | string | null;
  validatedVersion: number | null | undefined;
  planVersion: number;
  simulationSnapshot: unknown;
  simulatedAt: Date | string | null;
  simulatedVersion: number | null | undefined;
}): { ok: true } | { ok: false; message: string } {
  if (input.status !== DispatchPlanStatus.VALIDATED && input.status !== 'VALIDATED') {
    return { ok: false, message: 'Somente planos VALIDATED podem ser aprovados' };
  }
  if (!input.snapshotCreatedAt) {
    return { ok: false, message: 'Snapshot do publico e obrigatorio para aprovar' };
  }
  if (input.totalEligible <= 0) {
    return { ok: false, message: 'Publico elegivel deve ser maior que zero' };
  }
  if (!input.content?.trim()) {
    return { ok: false, message: 'Conteudo textual e obrigatorio para aprovar' };
  }

  const validationIsCurrent = isValidationCurrent({
    validationSnapshot: input.validationSnapshot,
    validatedVersion: input.validatedVersion,
    planVersion: input.planVersion,
  });
  if (!validationIsCurrent || !input.validatedAt) {
    return { ok: false, message: 'Validacao atual e obrigatoria para aprovar' };
  }

  const snapshot = input.validationSnapshot as { passed?: unknown } | null;
  if (!snapshot || snapshot.passed !== true) {
    return { ok: false, message: 'Blindagens precisam ter passado para aprovar' };
  }

  const simulationIsCurrent = isSimulationCurrent({
    simulationSnapshot: input.simulationSnapshot,
    simulatedVersion: input.simulatedVersion,
    validatedVersion: input.validatedVersion,
    planVersion: input.planVersion,
    status: input.status,
    validationIsCurrent,
  });
  if (!simulationIsCurrent || !input.simulatedAt) {
    return { ok: false, message: 'Simulacao atual e obrigatoria para aprovar' };
  }

  return { ok: true };
}

export function assertChannelReadyForApproval(input: {
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
    throw new Error('Canal arquivado nao pode ser aprovado');
  }
  if (
    input.status !== ChannelAccountStatus.CONNECTED &&
    input.status !== 'CONNECTED'
  ) {
    throw new Error('Canal precisa estar CONNECTED para aprovar');
  }
}

export function buildApprovalSnapshot(input: {
  approvedAt: Date;
  approvedByUserId: string;
  plan: {
    id: string;
    name: string;
    campaignId: string;
    segmentId: string;
    channelAccountId: string;
    channelType: string;
    version: number;
    content: string;
    totalEvaluated: number;
    totalEligible: number;
    totalExcluded: number;
    snapshotCreatedAt: Date | string | null;
    validatedAt: Date | string | null;
    validatedVersion: number | null;
    validationSnapshot: unknown;
    simulatedAt: Date | string | null;
    simulatedVersion: number | null;
    simulationSnapshot: unknown;
  };
  channelProvider: string;
}): ApprovalSnapshot {
  const validation = (input.plan.validationSnapshot ?? {}) as {
    passed?: boolean;
    summary?: { errors?: number; warnings?: number };
  };
  const simulation = (input.plan.simulationSnapshot ?? {}) as {
    configuration?: {
      requestedMessagesPerMinute?: number;
      timezone?: string;
    };
    estimates?: {
      effectiveMessagesPerMinute?: number;
      totalBatches?: number;
      estimatedActiveDurationSeconds?: number;
      estimatedCalendarDurationSeconds?: number;
      estimatedStartAt?: string;
      estimatedEndAt?: string;
    };
  };

  const body = input.plan.content;
  return {
    approvedAt: input.approvedAt.toISOString(),
    approvedVersion: input.plan.version,
    approvedByUserId: input.approvedByUserId,
    plan: {
      dispatchPlanId: input.plan.id,
      name: input.plan.name,
      campaignId: input.plan.campaignId,
      segmentId: input.plan.segmentId,
      channelAccountId: input.plan.channelAccountId,
      channelType: input.plan.channelType,
      channelProvider: input.channelProvider,
    },
    audience: {
      totalEvaluated: input.plan.totalEvaluated,
      totalEligible: input.plan.totalEligible,
      totalExcluded: input.plan.totalExcluded,
      snapshotCreatedAt: input.plan.snapshotCreatedAt
        ? new Date(input.plan.snapshotCreatedAt).toISOString()
        : null,
    },
    validation: {
      validatedAt: input.plan.validatedAt
        ? new Date(input.plan.validatedAt).toISOString()
        : null,
      validatedVersion: input.plan.validatedVersion,
      passed: validation.passed === true,
      errorCount: validation.summary?.errors ?? 0,
      warningCount: validation.summary?.warnings ?? 0,
    },
    simulation: {
      simulatedAt: input.plan.simulatedAt
        ? new Date(input.plan.simulatedAt).toISOString()
        : null,
      simulatedVersion: input.plan.simulatedVersion,
      requestedMessagesPerMinute:
        simulation.configuration?.requestedMessagesPerMinute ?? null,
      effectiveMessagesPerMinute:
        simulation.estimates?.effectiveMessagesPerMinute ?? null,
      totalBatches: simulation.estimates?.totalBatches ?? null,
      estimatedActiveDurationSeconds:
        simulation.estimates?.estimatedActiveDurationSeconds ?? null,
      estimatedCalendarDurationSeconds:
        simulation.estimates?.estimatedCalendarDurationSeconds ?? null,
      estimatedStartAt: simulation.estimates?.estimatedStartAt ?? null,
      estimatedEndAt: simulation.estimates?.estimatedEndAt ?? null,
      timezone: simulation.configuration?.timezone ?? null,
    },
    content: {
      type: 'TEXT',
      length: body.length,
      hash: hashDispatchPlanContent(body),
      body,
    },
  };
}
