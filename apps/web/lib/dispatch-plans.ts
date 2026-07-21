export function getDispatchPlanStatusLabel(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'Rascunho';
    case 'VALIDATING':
      return 'Validando';
    case 'VALIDATED':
      return 'Validado';
    case 'BLOCKED':
      return 'Bloqueado';
    case 'APPROVED':
      return 'Aprovado';
    case 'REJECTED':
      return 'Rejeitado';
    case 'EXPIRED':
      return 'Expirado';
    case 'CANCELED':
      return 'Cancelado';
    default:
      return status;
  }
}

export function isDispatchPlanDraft(status: string): boolean {
  return status === 'DRAFT';
}

export function isDispatchPlanEditableStatus(status: string): boolean {
  return status === 'DRAFT' || status === 'BLOCKED';
}

export function canCancelDispatchPlanStatus(status: string): boolean {
  return status === 'DRAFT' || status === 'BLOCKED' || status === 'VALIDATED';
}

export function getValidationSeverityLabel(severity: string): string {
  switch (severity) {
    case 'ERROR':
      return 'Erro';
    case 'WARNING':
      return 'Aviso';
    case 'INFO':
      return 'Info';
    default:
      return severity;
  }
}

export function getWeekdayLabel(day: number): string {
  switch (day) {
    case 1:
      return 'Segunda';
    case 2:
      return 'Terca';
    case 3:
      return 'Quarta';
    case 4:
      return 'Quinta';
    case 5:
      return 'Sexta';
    case 6:
      return 'Sabado';
    case 7:
      return 'Domingo';
    default:
      return String(day);
  }
}

export function getLimitingFactorLabel(factor: string): string {
  switch (factor) {
    case 'RATE_LIMIT':
      return 'Limite de taxa';
    case 'DELAY':
      return 'Intervalo medio';
    case 'BOTH':
      return 'Taxa e intervalo';
    default:
      return factor;
  }
}

export function formatDurationSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}min`;
  }
  if (minutes > 0) {
    return `${minutes}min ${rest}s`;
  }
  return `${rest}s`;
}

export function formatZonedDateTime(
  iso: string | null | undefined,
  timeZone: string,
): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString('pt-BR');
  }
}

export function getDispatchPlanStatusBadgeClass(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'border-[#c9c8c0] bg-[#eee] text-[#24382b]';
    case 'VALIDATING':
      return 'border-[#c9d7ee] bg-[#eef4fc] text-[#1e3a5f]';
    case 'VALIDATED':
      return 'border-green-200 bg-green-50 text-green-800';
    case 'BLOCKED':
      return 'border-red-200 bg-red-50 text-red-800';
    case 'CANCELED':
      return 'border-[#ddd] bg-[#f5f5f5] text-[#65655f]';
    default:
      return 'border-[#c9c8c0] bg-white text-[#24382b]';
  }
}

export function getRecipientEligibilityLabel(status: string): string {
  switch (status) {
    case 'ELIGIBLE':
      return 'Elegivel';
    case 'EXCLUDED_OPT_OUT':
      return 'Opt-out';
    case 'EXCLUDED_BLOCKED':
      return 'Bloqueado';
    case 'EXCLUDED_DELETED':
      return 'Removido';
    case 'EXCLUDED_INVALID_DESTINATION':
      return 'Destino invalido';
    case 'EXCLUDED_DUPLICATE':
      return 'Duplicado';
    case 'EXCLUDED_NO_CHANNEL':
      return 'Sem canal';
    case 'EXCLUDED_POLICY':
      return 'Politica';
    case 'EXCLUDED_OTHER':
      return 'Outro';
    default:
      return status;
  }
}

export function getProtectionProfileLabel(profile: string): string {
  switch (profile) {
    case 'CONSERVATIVE':
      return 'Conservador';
    case 'MODERATE':
      return 'Moderado';
    case 'AGGRESSIVE':
      return 'Agressivo';
    case 'CUSTOM':
      return 'Personalizado';
    default:
      return profile;
  }
}

export function getDistributionStrategyLabel(strategy: string): string {
  switch (strategy) {
    case 'CAPACITY_WEIGHTED':
      return 'Capacidade ponderada';
    default:
      return strategy;
  }
}

export function getPlanChannelStageLabel(stage: string): string {
  switch (stage) {
    case 'NEW_ACCOUNT':
      return 'Conta nova';
    case 'WARMUP':
      return 'Aquecimento';
    case 'NORMAL':
      return 'Normal';
    default:
      return stage;
  }
}

export function getDispatchChannelOperationalStatusLabel(status: string): string {
  switch (status) {
    case 'READY':
      return 'Pronto';
    case 'PAUSED':
      return 'Pausado';
    case 'COOLDOWN':
      return 'Resfriamento';
    case 'BLOCKED':
      return 'Bloqueado';
    case 'DISABLED':
      return 'Desabilitado';
    default:
      return status;
  }
}

function isValidationMultiInstanceShape(
  value: unknown,
): value is {
  selectedInstances: number;
  eligibleInstances: number;
  blockedInstances: number;
  totalCapacity: number;
  totalEligibleAudience: number;
  capacityDeficit: number;
  unassignedRecipients: number;
  passed: boolean;
  channels?: unknown[];
  distribution?: unknown[];
} {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.totalCapacity === 'number' &&
    typeof row.totalEligibleAudience === 'number' &&
    typeof row.capacityDeficit === 'number' &&
    typeof row.eligibleInstances === 'number' &&
    typeof row.selectedInstances === 'number'
  );
}

function normalizeSimulationMultiInstance(
  value: unknown,
): {
  selectedInstances: number;
  eligibleInstances: number;
  blockedInstances: number;
  totalCapacity: number;
  totalEligibleAudience: number;
  capacityDeficit: number;
  unassignedRecipients: number;
  passed: boolean;
  channels: [];
  distribution: [];
} | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.totalCapacity !== 'number') return null;
  if (typeof row.totalAudience !== 'number') return null;

  const totalEligibleAudience = row.totalAudience;
  const totalCapacity = row.totalCapacity;
  const unassignedRecipients =
    typeof row.totalUnassigned === 'number'
      ? row.totalUnassigned
      : Math.max(0, totalEligibleAudience - totalCapacity);
  const capacityDeficit = Math.max(0, totalEligibleAudience - totalCapacity);
  const activeInstances =
    typeof row.activeInstances === 'number' ? row.activeInstances : 0;
  const blockedInstances =
    typeof row.blockedInstances === 'number' ? row.blockedInstances : 0;

  return {
    selectedInstances: activeInstances + blockedInstances,
    eligibleInstances: activeInstances,
    blockedInstances,
    totalCapacity,
    totalEligibleAudience,
    capacityDeficit,
    unassignedRecipients,
    passed: capacityDeficit === 0 && unassignedRecipients === 0,
    channels: [],
    distribution: [],
  };
}

/**
 * Resolve o consolidado multi-instancia a partir do shape real da API.
 * Prioridade: validationSnapshot.multiInstance → approval.capacity →
 * simulação normalizada → detalhes do check MULTI_INSTANCE_CAPACITY.
 */
export function resolveMultiInstanceConsolidated(plan: {
  validationSnapshot?: {
    multiInstance?: unknown;
    checks?: Array<{ code: string; details?: Record<string, unknown> }>;
  } | null;
  approvalSnapshot?: {
    multiInstance?: { capacity?: unknown } | null;
  } | null;
  simulationSnapshot?: {
    multiInstance?: unknown;
  } | null;
}): {
  selectedInstances: number;
  eligibleInstances: number;
  blockedInstances: number;
  totalCapacity: number;
  totalEligibleAudience: number;
  capacityDeficit: number;
  unassignedRecipients: number;
  passed: boolean;
  channels?: unknown[];
  distribution?: unknown[];
} | null {
  const fromValidation = plan.validationSnapshot?.multiInstance;
  if (isValidationMultiInstanceShape(fromValidation)) {
    return fromValidation;
  }

  const fromApproval = plan.approvalSnapshot?.multiInstance?.capacity;
  if (isValidationMultiInstanceShape(fromApproval)) {
    return fromApproval;
  }

  const fromSimulation = normalizeSimulationMultiInstance(
    plan.simulationSnapshot?.multiInstance,
  );
  if (fromSimulation) {
    return fromSimulation;
  }

  const capacityCheck = plan.validationSnapshot?.checks?.find(
    (check) => check.code === 'MULTI_INSTANCE_CAPACITY',
  );
  if (capacityCheck?.details) {
    const details = capacityCheck.details;
    if (
      typeof details.capacityDeficit === 'number' ||
      typeof details.totalCapacity === 'number'
    ) {
      const capacityDeficit =
        typeof details.capacityDeficit === 'number'
          ? details.capacityDeficit
          : 0;
      const unassignedRecipients =
        typeof details.unassignedRecipients === 'number'
          ? details.unassignedRecipients
          : capacityDeficit;
      const eligibleInstances =
        typeof details.eligibleInstances === 'number'
          ? details.eligibleInstances
          : 0;
      const blockedInstances =
        typeof details.blockedInstances === 'number'
          ? details.blockedInstances
          : 0;
      return {
        selectedInstances: eligibleInstances + blockedInstances,
        eligibleInstances,
        blockedInstances,
        totalCapacity:
          typeof details.totalCapacity === 'number' ? details.totalCapacity : 0,
        totalEligibleAudience:
          typeof details.totalEligibleAudience === 'number'
            ? details.totalEligibleAudience
            : 0,
        capacityDeficit,
        unassignedRecipients,
        passed: capacityDeficit === 0,
        channels: [],
        distribution: [],
      };
    }
  }

  return null;
}

export function hasMultiInstanceCapacityDeficit(
  capacityDeficit: unknown,
): boolean {
  return typeof capacityDeficit === 'number' && capacityDeficit > 0;
}

