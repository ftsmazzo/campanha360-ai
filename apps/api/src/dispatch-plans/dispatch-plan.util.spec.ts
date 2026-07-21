import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ChannelAccountStatus,
  ChannelProvider,
  ChannelType,
  DispatchPlanStatus,
} from '@prisma/client';
import {
  buildDispatchPlanAuditMetadata,
  canCancelDispatchPlan,
  canValidateDispatchPlan,
  isAllowedDispatchProvider,
  isArchivedChannelAccount,
  isDispatchPlanEditable,
  resolveDispatchChannelType,
  shouldBumpDispatchPlanVersion,
} from './dispatch-plan.util';

describe('dispatch-plan.util', () => {
  it('permite editar DRAFT e BLOCKED', () => {
    assert.equal(isDispatchPlanEditable(DispatchPlanStatus.DRAFT), true);
    assert.equal(isDispatchPlanEditable(DispatchPlanStatus.BLOCKED), true);
    assert.equal(isDispatchPlanEditable(DispatchPlanStatus.VALIDATED), false);
    assert.equal(isDispatchPlanEditable(DispatchPlanStatus.CANCELED), false);
  });

  it('permite validar apenas DRAFT', () => {
    assert.equal(canValidateDispatchPlan(DispatchPlanStatus.DRAFT), true);
    assert.equal(canValidateDispatchPlan(DispatchPlanStatus.BLOCKED), false);
    assert.equal(canValidateDispatchPlan(DispatchPlanStatus.VALIDATED), false);
    assert.equal(canValidateDispatchPlan(DispatchPlanStatus.CANCELED), false);
  });

  it('permite cancelar DRAFT, BLOCKED e VALIDATED', () => {
    assert.equal(canCancelDispatchPlan(DispatchPlanStatus.DRAFT), true);
    assert.equal(canCancelDispatchPlan(DispatchPlanStatus.BLOCKED), true);
    assert.equal(canCancelDispatchPlan(DispatchPlanStatus.VALIDATED), true);
    assert.equal(canCancelDispatchPlan(DispatchPlanStatus.APPROVED), false);
    assert.equal(canCancelDispatchPlan(DispatchPlanStatus.REJECTED), false);
    assert.equal(canCancelDispatchPlan(DispatchPlanStatus.CANCELED), false);
  });

  it('aceita apenas WhatsApp Evolution como provider permitido', () => {
    assert.equal(
      isAllowedDispatchProvider(ChannelProvider.WHATSAPP_EVOLUTION),
      true,
    );
    assert.equal(
      isAllowedDispatchProvider(ChannelProvider.WHATSAPP_CLOUD_API),
      false,
    );
    assert.equal(isAllowedDispatchProvider(ChannelProvider.EMAIL), false);
  });

  it('rejeita canal arquivado', () => {
    assert.equal(
      isArchivedChannelAccount(ChannelAccountStatus.ARCHIVED),
      true,
    );
    assert.equal(
      isArchivedChannelAccount(ChannelAccountStatus.CONNECTED),
      false,
    );
  });

  it('resolve channelType a partir do provider', () => {
    assert.equal(
      resolveDispatchChannelType(ChannelProvider.WHATSAPP_EVOLUTION),
      ChannelType.WHATSAPP,
    );
    assert.equal(
      resolveDispatchChannelType(ChannelProvider.EMAIL),
      ChannelType.EMAIL,
    );
  });

  it('incrementa versao quando segmento, canal ou conteudo mudam', () => {
    assert.equal(
      shouldBumpDispatchPlanVersion({
        segmentChanged: true,
        channelChanged: false,
        contentChanged: false,
      }),
      true,
    );
    assert.equal(
      shouldBumpDispatchPlanVersion({
        segmentChanged: false,
        channelChanged: false,
        contentChanged: false,
      }),
      false,
    );
  });

  it('monta metadata de audit sem conteudo da mensagem', () => {
    const metadata = buildDispatchPlanAuditMetadata({
      dispatchPlanId: 'plan-1',
      segmentId: 'seg-1',
      channelAccountId: 'ch-1',
      status: DispatchPlanStatus.DRAFT,
      version: 2,
    });

    assert.deepEqual(metadata, {
      dispatchPlanId: 'plan-1',
      segmentId: 'seg-1',
      channelAccountId: 'ch-1',
      status: 'DRAFT',
      version: 2,
    });
    assert.equal('content' in metadata, false);
  });
});
