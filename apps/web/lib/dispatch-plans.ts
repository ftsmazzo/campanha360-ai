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
