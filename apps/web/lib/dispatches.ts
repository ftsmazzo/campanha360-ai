export type DispatchStatus =
  | 'DRAFT'
  | 'PREPARING'
  | 'READY'
  | 'QUEUED'
  | 'RUNNING'
  | 'PAUSING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'COMPLETED_WITH_ERRORS'
  | 'FAILED'
  | 'CANCELED'
  | 'EMERGENCY_STOPPED';

export function getDispatchStatusLabel(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'Rascunho';
    case 'PREPARING':
      return 'Preparando';
    case 'READY':
      return 'Pronto';
    case 'QUEUED':
      return 'Enfileirado';
    case 'RUNNING':
      return 'Em execucao';
    case 'PAUSING':
      return 'Pausando';
    case 'PAUSED':
      return 'Pausado';
    case 'COMPLETED':
      return 'Concluido';
    case 'COMPLETED_WITH_ERRORS':
      return 'Concluido com erros';
    case 'FAILED':
      return 'Falhou';
    case 'CANCELED':
      return 'Cancelado';
    case 'EMERGENCY_STOPPED':
      return 'Interrompido emergencialmente';
    default:
      return status;
  }
}

export function getDispatchStatusBadgeClass(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'border-[#c9c8c0] bg-[#eee] text-[#24382b]';
    case 'RUNNING':
    case 'QUEUED':
    case 'PREPARING':
      return 'border-[#c9d7ee] bg-[#eef4fc] text-[#1e3a5f]';
    case 'COMPLETED':
    case 'READY':
      return 'border-green-200 bg-green-50 text-green-800';
    case 'FAILED':
    case 'EMERGENCY_STOPPED':
      return 'border-red-200 bg-red-50 text-red-800';
    case 'CANCELED':
      return 'border-[#ddd] bg-[#f5f5f5] text-[#65655f]';
    default:
      return 'border-[#c9c8c0] bg-white text-[#24382b]';
  }
}

export function getDispatchItemStatusLabel(status: string): string {
  switch (status) {
    case 'PENDING':
      return 'Pendente';
    case 'SCHEDULED':
      return 'Agendado';
    case 'QUEUED':
      return 'Enfileirado';
    case 'PROCESSING':
      return 'Processando';
    case 'SENT':
      return 'Enviado';
    case 'DELIVERED':
      return 'Entregue';
    case 'READ':
      return 'Lido';
    case 'RETRY_SCHEDULED':
      return 'Retry agendado';
    case 'FAILED':
      return 'Falhou';
    case 'SKIPPED':
      return 'Ignorado';
    case 'CANCELED':
      return 'Cancelado';
    case 'UNKNOWN_PROVIDER_STATE':
      return 'Estado desconhecido';
    default:
      return status;
  }
}

export type DispatchProgressStep = {
  id: 'creation' | 'preparation' | 'queue' | 'execution' | 'completion';
  label: string;
  state: 'done' | 'current' | 'pending';
};

export function getDispatchProgressSteps(
  status: string,
): DispatchProgressStep[] {
  const creationDone = true;
  const preparationDone = status === 'READY' || [
    'QUEUED',
    'RUNNING',
    'PAUSING',
    'PAUSED',
    'COMPLETED',
    'COMPLETED_WITH_ERRORS',
    'FAILED',
    'CANCELED',
    'EMERGENCY_STOPPED',
  ].includes(status);
  const preparationCurrent = status === 'PREPARING';
  const preparationPending = status === 'DRAFT';

  return [
    {
      id: 'creation',
      label: 'Criacao',
      state: creationDone ? 'done' : 'pending',
    },
    {
      id: 'preparation',
      label: 'Preparacao',
      state: preparationDone
        ? 'done'
        : preparationCurrent
          ? 'current'
          : preparationPending
            ? 'pending'
            : 'pending',
    },
    { id: 'queue', label: 'Fila', state: 'pending' },
    { id: 'execution', label: 'Execucao', state: 'pending' },
    { id: 'completion', label: 'Conclusao', state: 'pending' },
  ];
}
