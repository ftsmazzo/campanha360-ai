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
