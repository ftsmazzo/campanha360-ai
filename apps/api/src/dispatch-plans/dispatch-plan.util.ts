import {
  ChannelAccountStatus,
  ChannelProvider,
  ChannelType,
  DispatchPlanStatus,
} from '@prisma/client';

export const DISPATCH_PLAN_CANCELABLE_STATUSES: DispatchPlanStatus[] = [
  DispatchPlanStatus.DRAFT,
  DispatchPlanStatus.BLOCKED,
  DispatchPlanStatus.VALIDATED,
];

export function isDispatchPlanEditable(status: DispatchPlanStatus | string): boolean {
  return (
    status === DispatchPlanStatus.DRAFT ||
    status === 'DRAFT' ||
    status === DispatchPlanStatus.BLOCKED ||
    status === 'BLOCKED'
  );
}

export function canValidateDispatchPlan(
  status: DispatchPlanStatus | string,
): boolean {
  return status === DispatchPlanStatus.DRAFT || status === 'DRAFT';
}

export function canCancelDispatchPlan(status: DispatchPlanStatus | string): boolean {
  return DISPATCH_PLAN_CANCELABLE_STATUSES.includes(status as DispatchPlanStatus);
}

export function resolveDispatchChannelType(
  provider: ChannelProvider | string,
): ChannelType {
  if (
    provider === ChannelProvider.WHATSAPP_EVOLUTION ||
    provider === ChannelProvider.WHATSAPP_CLOUD_API ||
    provider === 'WHATSAPP_EVOLUTION' ||
    provider === 'WHATSAPP_CLOUD_API'
  ) {
    return ChannelType.WHATSAPP;
  }

  if (provider === ChannelProvider.EMAIL || provider === 'EMAIL') {
    return ChannelType.EMAIL;
  }

  if (provider === ChannelProvider.SMS || provider === 'SMS') {
    return ChannelType.SMS;
  }

  if (provider === ChannelProvider.TELEGRAM || provider === 'TELEGRAM') {
    return ChannelType.TELEGRAM;
  }

  if (provider === ChannelProvider.INSTAGRAM || provider === 'INSTAGRAM') {
    return ChannelType.INSTAGRAM;
  }

  return ChannelType.WHATSAPP;
}

export function isAllowedDispatchProvider(
  provider: ChannelProvider | string,
): boolean {
  return (
    provider === ChannelProvider.WHATSAPP_EVOLUTION ||
    provider === 'WHATSAPP_EVOLUTION'
  );
}

export function isArchivedChannelAccount(
  status: ChannelAccountStatus | string,
): boolean {
  return status === ChannelAccountStatus.ARCHIVED || status === 'ARCHIVED';
}

export function shouldBumpDispatchPlanVersion(changes: {
  segmentChanged: boolean;
  channelChanged: boolean;
  contentChanged: boolean;
}): boolean {
  return changes.segmentChanged || changes.channelChanged || changes.contentChanged;
}

export function buildDispatchPlanAuditMetadata(input: {
  dispatchPlanId: string;
  segmentId: string;
  channelAccountId: string;
  status: DispatchPlanStatus | string;
  version: number;
}) {
  return {
    dispatchPlanId: input.dispatchPlanId,
    segmentId: input.segmentId,
    channelAccountId: input.channelAccountId,
    status: input.status,
    version: input.version,
  };
}
