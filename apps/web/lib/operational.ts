export const CONTACT_OPERATIONAL_STATUSES = [
  { value: 'NEW', label: 'Novo' },
  { value: 'IN_PROGRESS', label: 'Em andamento' },
  { value: 'SUPPORTER', label: 'Apoiador' },
  { value: 'UNDECIDED', label: 'Indeciso' },
  { value: 'OPPOSED', label: 'Opositor' },
  { value: 'INVALID', label: 'Invalido' },
  { value: 'ARCHIVED', label: 'Arquivado' },
] as const;

export function getOperationalStatusLabel(status: string) {
  return (
    CONTACT_OPERATIONAL_STATUSES.find((item) => item.value === status)?.label ?? status
  );
}
