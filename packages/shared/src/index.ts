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
export * from './evolution-send.client';
