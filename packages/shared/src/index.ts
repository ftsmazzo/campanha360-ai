export type CampaignPhase =
  | 'PRE_CAMPAIGN'
  | 'INTRA_PARTY'
  | 'OFFICIAL_CAMPAIGN'
  | 'RUNOFF'
  | 'CLOSED';

export type ChannelProvider =
  | 'WHATSAPP_EVOLUTION'
  | 'WHATSAPP_CLOUD_API'
  | 'INSTAGRAM'
  | 'EMAIL'
  | 'SMS'
  | 'TELEGRAM';

export * from './dispatch-queue.constants';
export * from './dispatch-feature-flags';
export * from './dispatch-channel-selection';
export * from './dispatch-window.util';
export * from './dispatch-send-retry';
export * from './dispatch-recovery.util';
export * from './dispatch-channel-send-reservation.util';
export * from './dispatch-protection-enforcement.util';
export * from './dispatch-protection-readiness.util';
export * from './dispatch-repetition.util';
export * from './opt-out-keywords.util';
export * from './evolution-validate-number.client';
export * from './whatsapp-validation.util';
export * from './evolution-error-classification.util';
export * from './evolution-connection-check.client';
export * from './dispatch-legacy-classification.util';
export * from './evolution-send.client';
export * from './whatsapp-jid.util';
export * from './log-sanitizer.util';
export * from './evolution-instance-state.util';
export * from './platform-restriction.util';
export * from './content-variables.util';
export * from './content-selection.util';
export * from './content-ai.util';
export * from './content-send-guard.util';
export * from './content-simulation.util';
export * from './content-marketing.util';
export * from './content-coherence.util';
