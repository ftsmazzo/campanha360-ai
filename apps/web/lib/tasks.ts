export const CONTACT_TASK_STATUSES = [
  { value: 'OPEN', label: 'Aberta' },
  { value: 'IN_PROGRESS', label: 'Em andamento' },
  { value: 'DONE', label: 'Concluida' },
  { value: 'CANCELED', label: 'Cancelada' },
] as const;

export function getTaskStatusLabel(status: string) {
  return CONTACT_TASK_STATUSES.find((item) => item.value === status)?.label ?? status;
}

export function isTaskOpen(status: string) {
  return status === 'OPEN' || status === 'IN_PROGRESS';
}
