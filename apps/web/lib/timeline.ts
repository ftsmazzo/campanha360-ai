export function getTimelineTypeLabel(type: string) {
  switch (type) {
    case 'contact.created':
      return 'Criacao do contato';
    case 'contact.updated':
      return 'Dados atualizados';
    case 'consent.created':
      return 'Consentimento';
    case 'consent.updated':
      return 'Consentimento';
    case 'opt_out.created':
      return 'Opt-out';
    case 'tag.applied':
      return 'Tag aplicada';
    case 'tag.removed':
      return 'Tag removida';
    case 'note.created':
      return 'Nota criada';
    case 'note.updated':
      return 'Nota editada';
    case 'task.created':
      return 'Tarefa criada';
    case 'task.updated':
      return 'Tarefa atualizada';
    case 'task.completed':
      return 'Tarefa concluida';
    case 'task.canceled':
      return 'Tarefa cancelada';
    case 'operations.assignee_updated':
      return 'Responsavel';
    case 'operations.status_updated':
      return 'Status operacional';
    default:
      return type;
  }
}

export function hasMeaningfulTimelineEvents(
  items: Array<{ type: string }>,
) {
  return items.some((item) => item.type !== 'contact.created');
}
