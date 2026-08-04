export type TrunkStepId = 'campaign' | 'whatsapp' | 'base' | 'message' | 'send';

export type TrunkStepState = 'done' | 'current' | 'todo';

export type TrunkStepDefinition = {
  id: TrunkStepId;
  number: number;
  title: string;
  description: string;
  href: (campaignId: string) => string;
  actionLabel: string;
};

export const TRUNK_STEPS: TrunkStepDefinition[] = [
  {
    id: 'campaign',
    number: 1,
    title: 'Campanha',
    description: 'Nome, cargo e candidato — o minimo para comecar.',
    href: (campaignId) => `/dashboard/campaigns/${campaignId}/candidate`,
    actionLabel: 'Cadastrar candidato',
  },
  {
    id: 'whatsapp',
    number: 2,
    title: 'WhatsApp',
    description: 'Conecte o numero que vai enviar as mensagens.',
    href: (campaignId) => `/dashboard/campaigns/${campaignId}/channels`,
    actionLabel: 'Conectar WhatsApp',
  },
  {
    id: 'base',
    number: 3,
    title: 'Base',
    description: 'Importe um CSV ou cadastre os contatos da campanha.',
    href: (campaignId) => `/dashboard/campaigns/${campaignId}/contacts`,
    actionLabel: 'Abrir base',
  },
  {
    id: 'message',
    number: 4,
    title: 'Mensagem',
    description: 'Escreva o texto, revise e aprove antes de enviar.',
    href: (campaignId) => `/dashboard/campaigns/${campaignId}/content-compositions`,
    actionLabel: 'Preparar mensagem',
  },
  {
    id: 'send',
    number: 5,
    title: 'Enviar',
    description: 'Escolha para quem enviar, confira e dispare.',
    href: (campaignId) => `/dashboard/campaigns/${campaignId}/dispatch-plans`,
    actionLabel: 'Ir para envio',
  },
];

export type TrunkProgressInput = {
  hasCandidate: boolean;
  whatsappConnected: boolean;
  contactCount: number;
  hasApprovedMessage: boolean;
  hasMessageDraft: boolean;
  dispatchCount: number;
  planCount: number;
};

export type TrunkStepProgress = TrunkStepDefinition & {
  state: TrunkStepState;
  detail: string;
  complete: boolean;
};

export type TrunkProgress = {
  steps: TrunkStepProgress[];
  nextStep: TrunkStepProgress | null;
  completedCount: number;
  allReady: boolean;
};

function isStepComplete(id: TrunkStepId, input: TrunkProgressInput): boolean {
  switch (id) {
    case 'campaign':
      return input.hasCandidate;
    case 'whatsapp':
      return input.whatsappConnected;
    case 'base':
      return input.contactCount > 0;
    case 'message':
      return input.hasApprovedMessage;
    case 'send':
      return input.dispatchCount > 0;
    default:
      return false;
  }
}

function stepDetail(id: TrunkStepId, input: TrunkProgressInput, complete: boolean): string {
  switch (id) {
    case 'campaign':
      return complete ? 'Candidato cadastrado' : 'Falta cadastrar o candidato';
    case 'whatsapp':
      return complete ? 'Numero conectado' : 'WhatsApp ainda nao conectado';
    case 'base':
      return complete
        ? `${input.contactCount} contato${input.contactCount === 1 ? '' : 's'}`
        : 'Nenhum contato na base';
    case 'message':
      if (complete) return 'Mensagem aprovada';
      if (input.hasMessageDraft) return 'Ha rascunho — falta aprovar';
      return 'Nenhuma mensagem preparada';
    case 'send':
      if (complete) {
        return `${input.dispatchCount} disparo${input.dispatchCount === 1 ? '' : 's'}`;
      }
      if (input.planCount > 0) return 'Ha planejamento — falta disparar';
      return 'Nenhum envio ainda';
    default:
      return '';
  }
}

export function computeTrunkProgress(input: TrunkProgressInput): TrunkProgress {
  const completion = TRUNK_STEPS.map((step) => ({
    step,
    complete: isStepComplete(step.id, input),
  }));

  const firstIncompleteIndex = completion.findIndex((item) => !item.complete);

  const steps: TrunkStepProgress[] = completion.map((item, index) => {
    let state: TrunkStepState = 'todo';
    if (item.complete) state = 'done';
    else if (index === firstIncompleteIndex) state = 'current';

    return {
      ...item.step,
      state,
      complete: item.complete,
      detail: stepDetail(item.step.id, input, item.complete),
    };
  });

  const nextStep = firstIncompleteIndex >= 0 ? steps[firstIncompleteIndex] : null;
  const completedCount = steps.filter((step) => step.complete).length;

  return {
    steps,
    nextStep,
    completedCount,
    allReady: completedCount === steps.length,
  };
}

/** Navegacao principal (tronco) — o dia a dia apos configurar. */
export const TRUNK_NAV = [
  { id: 'hub', label: 'Inicio', href: (id: string) => `/dashboard/campaigns/${id}` },
  { id: 'whatsapp', label: 'WhatsApp', href: (id: string) => `/dashboard/campaigns/${id}/channels` },
  { id: 'base', label: 'Base', href: (id: string) => `/dashboard/campaigns/${id}/contacts` },
  {
    id: 'message',
    label: 'Mensagem',
    href: (id: string) => `/dashboard/campaigns/${id}/content-compositions`,
  },
  { id: 'send', label: 'Enviar', href: (id: string) => `/dashboard/campaigns/${id}/dispatch-plans` },
  { id: 'inbox', label: 'Atendimento', href: (id: string) => `/dashboard/campaigns/${id}/inbox` },
] as const;

/** Ferramentas extras — fora do caminho principal. */
export const ADVANCED_NAV = [
  { id: 'dispatches', label: 'Historico de disparos', href: (id: string) => `/dashboard/campaigns/${id}/dispatches` },
  { id: 'segments', label: 'Segmentos', href: (id: string) => `/dashboard/campaigns/${id}/segments` },
  { id: 'tags', label: 'Tags', href: (id: string) => `/dashboard/campaigns/${id}/tags` },
  { id: 'candidate', label: 'Candidato', href: (id: string) => `/dashboard/campaigns/${id}/candidate` },
] as const;
