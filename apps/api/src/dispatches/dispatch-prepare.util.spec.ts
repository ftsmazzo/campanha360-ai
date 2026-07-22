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
  isDispatchStartWithinPilotLimit,
  maskDestination,
  maskProviderMessageId,
} from './dispatch-prepare.util';

const START_FLAG_KEYS = [
  'DISPATCH_ENGINE_ENABLED',
  'DISPATCH_QUEUE_ENABLED',
  'DISPATCH_SEND_ENABLED',
  'DISPATCH_PILOT_MODE',
  'DISPATCH_PILOT_MAX_ITEMS',
] as const;

function clearStartFlags(): void {
  for (const key of START_FLAG_KEYS) delete process.env[key];
}

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
    assert.equal(maskProviderMessageId(null), null);
    assert.equal(maskProviderMessageId('ABCDEF1234567890'), 'ABCDEF…7890');
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
    // canQueue (09.3) tambem exige DISPATCH_ENGINE_ENABLED/DISPATCH_QUEUE_ENABLED.
    assert.equal(
      buildDispatchAllowedActionsForPrepare({
        role: MembershipRole.OWNER,
        status: DispatchStatus.READY,
        totalItems: 10,
        requiringRedistribution: false,
      }).canQueue,
      false,
    );
    process.env.DISPATCH_ENGINE_ENABLED = 'true';
    process.env.DISPATCH_QUEUE_ENABLED = 'true';
    try {
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
      assert.equal(
        buildDispatchAllowedActionsForPrepare({
          role: MembershipRole.OWNER,
          status: DispatchStatus.QUEUED,
          totalItems: 10,
        }).canReconcile,
        true,
      );
      assert.equal(
        buildDispatchAllowedActionsForPrepare({
          role: MembershipRole.MANAGER,
          status: DispatchStatus.QUEUED,
          totalItems: 10,
        }).canReconcile,
        false,
      );
    } finally {
      delete process.env.DISPATCH_ENGINE_ENABLED;
      delete process.env.DISPATCH_QUEUE_ENABLED;
    }
  });

  it('isDispatchStartWithinPilotLimit respeita o teto do piloto (default true/5)', () => {
    clearStartFlags();
    assert.equal(isDispatchStartWithinPilotLimit(5), true);
    assert.equal(isDispatchStartWithinPilotLimit(6), false);
    process.env.DISPATCH_PILOT_MODE = 'false';
    assert.equal(isDispatchStartWithinPilotLimit(999), true);
    clearStartFlags();
  });

  it('canStart (09.4) exige OWNER/ADMIN, QUEUED, queuedItems>0, sem redistribuicao e ENGINE+QUEUE+SEND', () => {
    clearStartFlags();
    // Todas as flags off (default): canStart false mesmo com o resto correto.
    assert.equal(
      buildDispatchAllowedActionsForPrepare({
        role: MembershipRole.OWNER,
        status: DispatchStatus.QUEUED,
        totalItems: 3,
        queuedItems: 3,
        requiringRedistribution: false,
      }).canStart,
      false,
    );

    process.env.DISPATCH_ENGINE_ENABLED = 'true';
    process.env.DISPATCH_QUEUE_ENABLED = 'true';
    process.env.DISPATCH_SEND_ENABLED = 'true';
    try {
      assert.equal(
        buildDispatchAllowedActionsForPrepare({
          role: MembershipRole.OWNER,
          status: DispatchStatus.QUEUED,
          totalItems: 3,
          queuedItems: 3,
          requiringRedistribution: false,
        }).canStart,
        true,
      );
      assert.equal(
        buildDispatchAllowedActionsForPrepare({
          role: MembershipRole.MANAGER,
          status: DispatchStatus.QUEUED,
          totalItems: 3,
          queuedItems: 3,
          requiringRedistribution: false,
        }).canStart,
        false,
      );
      assert.equal(
        buildDispatchAllowedActionsForPrepare({
          role: MembershipRole.OWNER,
          status: DispatchStatus.READY,
          totalItems: 3,
          queuedItems: 0,
          requiringRedistribution: false,
        }).canStart,
        false,
      );
      assert.equal(
        buildDispatchAllowedActionsForPrepare({
          role: MembershipRole.OWNER,
          status: DispatchStatus.QUEUED,
          totalItems: 3,
          queuedItems: 0,
          requiringRedistribution: false,
        }).canStart,
        false,
      );
      assert.equal(
        buildDispatchAllowedActionsForPrepare({
          role: MembershipRole.OWNER,
          status: DispatchStatus.QUEUED,
          totalItems: 3,
          queuedItems: 3,
          requiringRedistribution: true,
        }).canStart,
        false,
      );
      // Pilot mode default true, teto default 5: 6 items bloqueia canStart.
      assert.equal(
        buildDispatchAllowedActionsForPrepare({
          role: MembershipRole.OWNER,
          status: DispatchStatus.QUEUED,
          totalItems: 6,
          queuedItems: 6,
          requiringRedistribution: false,
        }).canStart,
        false,
      );
    } finally {
      clearStartFlags();
    }
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
