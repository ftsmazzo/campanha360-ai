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
