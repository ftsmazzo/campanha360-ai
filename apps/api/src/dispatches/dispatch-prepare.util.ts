import {
  ChannelAccountStatus,
  ChannelProvider,
  DispatchItemStatus,
  DispatchPlanRecipientEligibilityStatus,
  DispatchPlanStatus,
  DispatchStatus,
  MembershipRole,
} from '@prisma/client';
import {
  isAllowedDispatchProvider,
  isArchivedChannelAccount,
} from '../dispatch-plans/dispatch-plan.util';
import { hashDispatchPlanContent } from '../dispatch-plans/dispatch-plan-approval.util';
import {
  DISPATCH_ITEM_DEFAULT_MAX_ATTEMPTS,
  DISPATCH_PREPARE_MAX_ITEMS,
} from './dispatch.constants';
import type { DispatchContentSnapshot } from './dispatch.util';

export type EligibleRecipientForPrepare = {
  id: string;
  organizationId: string;
  campaignId: string;
  dispatchPlanId: string;
  contactId: string;
  destination: string;
  normalizedDestination: string;
  eligibilityStatus: DispatchPlanRecipientEligibilityStatus | string;
  contactSnapshot: unknown;
};

export type PreparedDispatchItemInput = {
  organizationId: string;
  campaignId: string;
  dispatchId: string;
  dispatchPlanId: string;
  dispatchPlanRecipientId: string;
  contactId: string;
  channelAccountId: string;
  destination: string;
  normalizedDestination: string;
  contactSnapshot: Record<string, unknown>;
  contentSnapshot: DispatchContentSnapshot;
  status: typeof DispatchItemStatus.PENDING;
  attemptCount: number;
  maxAttempts: number;
};

export function assertChannelReadyForPrepare(input: {
  channelExists: boolean;
  channelBelongsToCampaign: boolean;
  channelMatchesDispatch: boolean;
  provider: ChannelProvider | string | null;
  status: ChannelAccountStatus | string | null;
}): void {
  if (!input.channelExists) {
    throw new Error('Canal vinculado nao encontrado');
  }
  if (!input.channelBelongsToCampaign) {
    throw new Error('Canal nao pertence a esta campanha');
  }
  if (!input.channelMatchesDispatch) {
    throw new Error('Canal nao corresponde ao Dispatch');
  }
  if (!input.provider || !isAllowedDispatchProvider(input.provider)) {
    throw new Error('Provider do canal nao e suportado');
  }
  if (!input.status || isArchivedChannelAccount(input.status)) {
    throw new Error('Canal arquivado nao pode ser usado');
  }
  if (input.status !== ChannelAccountStatus.CONNECTED && input.status !== 'CONNECTED') {
    throw new Error('Canal deve estar CONNECTED para preparar destinatarios');
  }
}

export function assertDispatchContentSnapshotValid(
  contentSnapshot: unknown,
  approvalSnapshot?: unknown,
): DispatchContentSnapshot {
  const snapshot = contentSnapshot as Partial<DispatchContentSnapshot> | null;
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('contentSnapshot do Dispatch e obrigatorio');
  }
  if (snapshot.type !== 'TEXT') {
    throw new Error('contentSnapshot.type invalido');
  }
  if (typeof snapshot.body !== 'string' || !snapshot.body.trim()) {
    throw new Error('contentSnapshot.body ausente');
  }
  if (typeof snapshot.hash !== 'string' || !snapshot.hash) {
    throw new Error('contentSnapshot.hash ausente');
  }
  if (typeof snapshot.length !== 'number') {
    throw new Error('contentSnapshot.length ausente');
  }
  if (typeof snapshot.approvedVersion !== 'number') {
    throw new Error('contentSnapshot.approvedVersion ausente');
  }

  const recalculated = hashDispatchPlanContent(snapshot.body);
  if (recalculated !== snapshot.hash) {
    throw new Error('Hash do contentSnapshot diverge do conteudo');
  }

  if (approvalSnapshot && typeof approvalSnapshot === 'object') {
    const approval = approvalSnapshot as {
      content?: { hash?: unknown; body?: unknown };
      approvedVersion?: unknown;
    };
    if (
      typeof approval.content?.hash === 'string' &&
      approval.content.hash !== snapshot.hash
    ) {
      throw new Error('Hash do contentSnapshot diverge do approvalSnapshot');
    }
    if (
      typeof approval.content?.body === 'string' &&
      approval.content.body !== snapshot.body
    ) {
      throw new Error('Conteudo do Dispatch diverge do approvalSnapshot');
    }
    if (
      typeof approval.approvedVersion === 'number' &&
      approval.approvedVersion !== snapshot.approvedVersion
    ) {
      throw new Error('Versao aprovada diverge do approvalSnapshot');
    }
  }

  return {
    type: 'TEXT',
    body: snapshot.body,
    hash: snapshot.hash,
    length: snapshot.length,
    approvedVersion: snapshot.approvedVersion,
  };
}

export function assertEligibleRecipientsReadyForPrepare(input: {
  recipients: EligibleRecipientForPrepare[];
  organizationId: string;
  campaignId: string;
  dispatchPlanId: string;
  expectedEligible: number;
}): void {
  if (input.recipients.length === 0) {
    throw new Error('Nenhum recipient elegivel encontrado');
  }
  if (input.recipients.length !== input.expectedEligible) {
    throw new Error(
      `Quantidade de elegiveis (${input.recipients.length}) diverge do totalEligible aprovado (${input.expectedEligible})`,
    );
  }
  if (input.recipients.length > DISPATCH_PREPARE_MAX_ITEMS) {
    throw new Error(
      `Quantidade de items ultrapassa o teto tecnico de ${DISPATCH_PREPARE_MAX_ITEMS}`,
    );
  }

  const destinations = new Set<string>();
  for (const recipient of input.recipients) {
    if (recipient.eligibilityStatus !== DispatchPlanRecipientEligibilityStatus.ELIGIBLE) {
      throw new Error('Somente recipients ELIGIBLE podem ser materializados');
    }
    if (
      recipient.organizationId !== input.organizationId ||
      recipient.campaignId !== input.campaignId ||
      recipient.dispatchPlanId !== input.dispatchPlanId
    ) {
      throw new Error('Recipient nao pertence ao Plano/campanha do Dispatch');
    }
    if (!recipient.contactId) {
      throw new Error('Recipient sem contactId');
    }
    if (!recipient.destination?.trim() || !recipient.normalizedDestination?.trim()) {
      throw new Error('Recipient sem destination/normalizedDestination');
    }
    if (destinations.has(recipient.normalizedDestination)) {
      throw new Error('Destinos normalizados duplicados entre elegiveis');
    }
    destinations.add(recipient.normalizedDestination);
    if (!recipient.contactSnapshot || typeof recipient.contactSnapshot !== 'object') {
      throw new Error('Recipient sem contactSnapshot');
    }
  }
}

export function buildDispatchItemContactSnapshot(
  contactSnapshot: unknown,
): Record<string, unknown> {
  const snapshot = (contactSnapshot ?? {}) as Record<string, unknown>;
  return {
    name: typeof snapshot.name === 'string' ? snapshot.name : null,
    originalPhone:
      typeof snapshot.originalPhone === 'string' ? snapshot.originalPhone : null,
    normalizedPhone:
      typeof snapshot.normalizedPhone === 'string'
        ? snapshot.normalizedPhone
        : null,
    city: typeof snapshot.city === 'string' ? snapshot.city : null,
    neighborhood:
      typeof snapshot.neighborhood === 'string' ? snapshot.neighborhood : null,
    operationalStatus:
      typeof snapshot.operationalStatus === 'string'
        ? snapshot.operationalStatus
        : null,
    source: typeof snapshot.source === 'string' ? snapshot.source : null,
    tags: Array.isArray(snapshot.tags) ? snapshot.tags : [],
    assignedTo:
      snapshot.assignedTo && typeof snapshot.assignedTo === 'object'
        ? snapshot.assignedTo
        : null,
  };
}

export function buildPreparedDispatchItems(input: {
  recipients: EligibleRecipientForPrepare[];
  dispatchId: string;
  organizationId: string;
  campaignId: string;
  dispatchPlanId: string;
  channelAccountId: string;
  contentSnapshot: DispatchContentSnapshot;
}): PreparedDispatchItemInput[] {
  return input.recipients.map((recipient) => ({
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    dispatchId: input.dispatchId,
    dispatchPlanId: input.dispatchPlanId,
    dispatchPlanRecipientId: recipient.id,
    contactId: recipient.contactId,
    channelAccountId: input.channelAccountId,
    destination: recipient.destination,
    normalizedDestination: recipient.normalizedDestination,
    contactSnapshot: buildDispatchItemContactSnapshot(recipient.contactSnapshot),
    contentSnapshot: { ...input.contentSnapshot },
    status: DispatchItemStatus.PENDING,
    attemptCount: 0,
    maxAttempts: DISPATCH_ITEM_DEFAULT_MAX_ATTEMPTS,
  }));
}

export function canPrepareDispatch(input: {
  role: MembershipRole | string | null | undefined;
  status: DispatchStatus | string;
  totalItems: number;
}): boolean {
  const canApprove =
    input.role === MembershipRole.OWNER ||
    input.role === MembershipRole.ADMIN ||
    input.role === 'OWNER' ||
    input.role === 'ADMIN';
  return (
    canApprove &&
    (input.status === DispatchStatus.DRAFT || input.status === 'DRAFT') &&
    input.totalItems === 0
  );
}

export function buildDispatchAllowedActionsForPrepare(input: {
  role: MembershipRole | string | null | undefined;
  status: DispatchStatus | string;
  totalItems: number;
}) {
  return {
    canView: true,
    canPrepare: canPrepareDispatch(input),
    canQueue: false,
    canStart: false,
    canPause: false,
    canResume: false,
    canCancel: false,
    canEmergencyStop: false,
    canReconcile: false,
    canRetryFailedItems: false,
  };
}

export function assertPlanApprovedForPrepare(input: {
  planExists: boolean;
  status: DispatchPlanStatus | string | null;
  approvalSnapshot: unknown;
}): void {
  if (!input.planExists) {
    throw new Error('Plano de origem nao encontrado');
  }
  if (input.status !== DispatchPlanStatus.APPROVED && input.status !== 'APPROVED') {
    throw new Error('Plano de origem deve permanecer APPROVED');
  }
  if (!input.approvalSnapshot || typeof input.approvalSnapshot !== 'object') {
    throw new Error('approvalSnapshot do Plano e obrigatorio');
  }
}

export function maskDestination(destination: string | null | undefined): string {
  const value = (destination ?? '').trim();
  if (!value) return '—';
  if (value.length <= 4) return '*'.repeat(value.length);
  const visible = value.slice(-4);
  return `${'*'.repeat(Math.max(4, value.length - 4))}${visible}`;
}

export function extractContactName(contactSnapshot: unknown): string | null {
  const snapshot = contactSnapshot as { name?: unknown } | null;
  return typeof snapshot?.name === 'string' && snapshot.name.trim()
    ? snapshot.name
    : null;
}

export function buildItemStatusSummary(
  grouped: Array<{ status: string; _count: { _all: number } }>,
): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const status of Object.values(DispatchItemStatus)) {
    summary[status] = 0;
  }
  for (const row of grouped) {
    summary[row.status] = row._count._all;
  }
  return summary;
}
