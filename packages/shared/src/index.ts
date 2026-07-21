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
export * from './evolution-send.client';
