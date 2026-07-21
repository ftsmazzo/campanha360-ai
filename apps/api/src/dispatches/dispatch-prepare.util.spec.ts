import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ChannelAccountStatus,
  ChannelProvider,
  DispatchItemStatus,
  DispatchPlanRecipientEligibilityStatus,
  DispatchPlanStatus,
  DispatchStatus,
  MembershipRole,
} from '@prisma/client';
import { hashDispatchPlanContent } from '../dispatch-plans/dispatch-plan-approval.util';
import {
  assertChannelReadyForPrepare,
  assertDispatchContentSnapshotValid,
  assertEligibleRecipientsReadyForPrepare,
  buildDispatchAllowedActionsForPrepare,
  buildPreparedDispatchItems,
  canPrepareDispatch,
  maskDestination,
} from './dispatch-prepare.util';

describe('dispatch-prepare.util', () => {
  it('exige canal CONNECTED para preparar', () => {
    assert.throws(() =>
      assertChannelReadyForPrepare({
        channelExists: true,
        channelBelongsToCampaign: true,
        channelMatchesDispatch: true,
        provider: ChannelProvider.WHATSAPP_EVOLUTION,
        status: ChannelAccountStatus.DISCONNECTED,
      }),
    );
    assert.doesNotThrow(() =>
      assertChannelReadyForPrepare({
        channelExists: true,
        channelBelongsToCampaign: true,
        channelMatchesDispatch: true,
        provider: ChannelProvider.WHATSAPP_EVOLUTION,
        status: ChannelAccountStatus.CONNECTED,
      }),
    );
  });

  it('valida contentSnapshot e hash', () => {
    const body = 'Mensagem preparada';
    const hash = hashDispatchPlanContent(body);
    const content = assertDispatchContentSnapshotValid(
      {
        type: 'TEXT',
        body,
        hash,
        length: body.length,
        approvedVersion: 2,
      },
      {
        approvedVersion: 2,
        content: { body, hash },
      },
    );
    assert.equal(content.hash, hash);
    assert.throws(() =>
      assertDispatchContentSnapshotValid({
        type: 'TEXT',
        body,
        hash: 'a'.repeat(64),
        length: body.length,
        approvedVersion: 2,
      }),
    );
  });

  it('valida recipients elegiveis e monta items PENDING', () => {
    const body = 'Conteudo';
    const hash = hashDispatchPlanContent(body);
    const recipients = [
      {
        id: 'recipient-1',
        organizationId: 'org-1',
        campaignId: 'campaign-1',
        dispatchPlanId: 'plan-1',
        contactId: 'contact-1',
        destination: '11999990001',
        normalizedDestination: '5511999990001',
        eligibilityStatus: DispatchPlanRecipientEligibilityStatus.ELIGIBLE,
        contactSnapshot: { name: 'Ana', originalPhone: '11999990001' },
      },
    ];
    assert.doesNotThrow(() =>
      assertEligibleRecipientsReadyForPrepare({
        recipients,
        organizationId: 'org-1',
        campaignId: 'campaign-1',
        dispatchPlanId: 'plan-1',
        expectedEligible: 1,
      }),
    );
    const items = buildPreparedDispatchItems({
      recipients,
      dispatchId: 'dispatch-1',
      organizationId: 'org-1',
      campaignId: 'campaign-1',
      dispatchPlanId: 'plan-1',
      channelAccountId: 'channel-1',
      contentSnapshot: {
        type: 'TEXT',
        body,
        hash,
        length: body.length,
        approvedVersion: 1,
      },
    });
    assert.equal(items.length, 1);
    assert.equal(items[0]?.status, DispatchItemStatus.PENDING);
    assert.equal(items[0]?.attemptCount, 0);
    assert.equal(items[0]?.contentSnapshot.hash, hash);
  });

  it('mascara destination e controla canPrepare', () => {
    assert.match(maskDestination('5511999990001'), /\*{4,}0001$/);
    assert.equal(
      canPrepareDispatch({
        role: MembershipRole.OWNER,
        status: DispatchStatus.DRAFT,
        totalItems: 0,
      }),
      true,
    );
    assert.equal(
      buildDispatchAllowedActionsForPrepare({
        role: MembershipRole.MANAGER,
        status: DispatchStatus.DRAFT,
        totalItems: 0,
      }).canPrepare,
      false,
    );
    assert.equal(
      canPrepareDispatch({
        role: MembershipRole.OWNER,
        status: DispatchStatus.READY,
        totalItems: 10,
      }),
      false,
    );
    assert.equal(
      buildDispatchAllowedActionsForPrepare({
        role: MembershipRole.OWNER,
        status: DispatchStatus.READY,
        totalItems: 10,
        requiringRedistribution: false,
      }).canQueue,
      true,
    );
    assert.equal(
      buildDispatchAllowedActionsForPrepare({
        role: MembershipRole.OWNER,
        status: DispatchStatus.READY,
        totalItems: 10,
        requiringRedistribution: true,
      }).canQueue,
      false,
    );
  });

  it('rejeita plano nao APPROVED indiretamente via contagem divergente', () => {
    assert.throws(() =>
      assertEligibleRecipientsReadyForPrepare({
        recipients: [],
        organizationId: 'org-1',
        campaignId: 'campaign-1',
        dispatchPlanId: 'plan-1',
        expectedEligible: 1,
      }),
    );
  });
});
