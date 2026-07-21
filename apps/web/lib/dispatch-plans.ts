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

export function canCancelDispatchPlanStatus(status: string): boolean {
  return status === 'DRAFT' || status === 'BLOCKED' || status === 'VALIDATED';
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
