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

export function getDispatchItemErrorCategoryLabel(
  category: string | null | undefined,
): string {
  if (!category) return '—';
  switch (category) {
    case 'TRANSIENT_NETWORK':
      return 'Rede transitória';
    case 'PROVIDER_RATE_LIMIT':
      return 'Limite de taxa (429)';
    case 'PROVIDER_UNAVAILABLE':
      return 'Provider indisponível';
    case 'PROVIDER_TIMEOUT':
      return 'Timeout do provider';
    case 'CHANNEL_DISCONNECTED':
      return 'Canal desconectado';
    case 'AUTHENTICATION_ERROR':
      return 'Autenticação';
    case 'INVALID_DESTINATION':
      return 'Destino inválido';
    case 'CONTENT_REJECTED':
      return 'Conteúdo rejeitado';
    case 'CONTACT_OPT_OUT':
      return 'Opt-out';
    case 'CONTACT_BLOCKED':
      return 'Contato bloqueado';
    case 'CONTACT_DELETED':
      return 'Contato excluído';
    case 'UNKNOWN':
      return 'Desconhecido';
    default:
      return category;
  }
}

/** Aviso operacional para o painel de detalhes do item (diagnóstico seguro). */
export function getDispatchItemDiagnosticNote(status: string): string | null {
  switch (status) {
    case 'FAILED':
      return 'Este item falhou de forma definitiva. Não haverá retry automático.';
    case 'RETRY_SCHEDULED':
      return 'Há uma próxima tentativa agendada. Enquanto DISPATCH_SEND_ENABLED=false, o Worker não chamará a Evolution.';
    case 'UNKNOWN_PROVIDER_STATE':
      return 'Estado do provider é incerto. Não reenvie automaticamente — revise logs e o providerMessageId antes de qualquer ação manual.';
    default:
      return null;
  }
}

export type DispatchProgressStep = {
  id: 'creation' | 'preparation' | 'queue' | 'execution' | 'completion';
  label: string;
  state: 'done' | 'current' | 'pending';
};

const TERMINAL_DISPATCH_STATUSES = [
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
  'FAILED',
  'CANCELED',
  'EMERGENCY_STOPPED',
];

const PAST_QUEUE_STATUSES = [
  'RUNNING',
  'PAUSING',
  'PAUSED',
  ...TERMINAL_DISPATCH_STATUSES,
];

const EXECUTION_CURRENT_STATUSES = ['RUNNING', 'PAUSING', 'PAUSED'];

export function getDispatchProgressSteps(
  status: string,
): DispatchProgressStep[] {
  const creationDone = true;
  const preparationDone =
    status === 'READY' ||
    status === 'QUEUED' ||
    PAST_QUEUE_STATUSES.includes(status);
  const preparationCurrent = status === 'PREPARING';

  const queueDone =
    status === 'QUEUED' || PAST_QUEUE_STATUSES.includes(status);
  const queueCurrent = false;

  const executionDone = TERMINAL_DISPATCH_STATUSES.includes(status);
  const executionCurrent = EXECUTION_CURRENT_STATUSES.includes(status);

  const completionDone = TERMINAL_DISPATCH_STATUSES.includes(status);

  return [
    {
      id: 'creation',
      label: 'Criacao',
      state: creationDone ? 'done' : 'pending',
    },
    {
      id: 'preparation',
      label: 'Preparacao',
      state: preparationDone ? 'done' : preparationCurrent ? 'current' : 'pending',
    },
    {
      id: 'queue',
      label: 'Fila',
      state: queueDone ? 'done' : queueCurrent ? 'current' : 'pending',
    },
    {
      id: 'execution',
      label: 'Execucao',
      state: executionDone ? 'done' : executionCurrent ? 'current' : 'pending',
    },
    {
      id: 'completion',
      label: 'Conclusao',
      state: completionDone ? 'done' : 'pending',
    },
  ];
}
