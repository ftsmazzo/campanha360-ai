export const CAMPAIGN_PHASES = [
  { value: 'PRE_CAMPAIGN', label: 'Pre-campanha' },
  { value: 'INTRA_PARTY', label: 'Intrapartidaria' },
  { value: 'OFFICIAL_CAMPAIGN', label: 'Campanha oficial' },
  { value: 'RUNOFF', label: 'Segundo turno' },
  { value: 'CLOSED', label: 'Encerrada' },
] as const;

export const CAMPAIGN_STATUSES = [
  { value: 'DRAFT', label: 'Rascunho' },
  { value: 'ACTIVE', label: 'Ativa' },
  { value: 'ARCHIVED', label: 'Arquivada' },
] as const;

export type CampaignPhase = (typeof CAMPAIGN_PHASES)[number]['value'];
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number]['value'];

export function getPhaseLabel(phase: string) {
  return CAMPAIGN_PHASES.find((item) => item.value === phase)?.label ?? phase;
}

export function getStatusLabel(status: string) {
  return CAMPAIGN_STATUSES.find((item) => item.value === status)?.label ?? status;
}
