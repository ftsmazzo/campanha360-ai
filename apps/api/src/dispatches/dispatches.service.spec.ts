import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  ChannelAccountStatus,
  ChannelProvider,
  ChannelType,
  DispatchPlanStatus,
  DispatchStatus,
  MembershipRole,
  Prisma,
} from '@prisma/client';
import { hashDispatchPlanContent } from '../dispatch-plans/dispatch-plan-approval.util';
import { DispatchesService } from './dispatches.service';

function approvalSnapshot(body = 'Mensagem aprovada') {
  return {
    approvedAt: '2026-07-21T15:00:00.000Z',
    approvedVersion: 5,
    approvedByUserId: 'user-1',
    plan: {
      dispatchPlanId: 'plan-1',
      name: 'Plano',
      campaignId: 'campaign-1',
      segmentId: 'segment-1',
      channelAccountId: 'channel-1',
      channelType: 'WHATSAPP',
      channelProvider: 'WHATSAPP_EVOLUTION',
    },
    audience: {
      totalEvaluated: 10,
      totalEligible: 8,
      totalExcluded: 2,
      snapshotCreatedAt: '2026-07-21T10:00:00.000Z',
    },
    validation: {
      validatedAt: '2026-07-21T11:00:00.000Z',
      validatedVersion: 5,
      passed: true,
      errorCount: 0,
      warningCount: 0,
    },
    simulation: {
      simulatedAt: '2026-07-21T12:00:00.000Z',
      simulatedVersion: 5,
      requestedMessagesPerMinute: 4,
      effectiveMessagesPerMinute: 4,
      totalBatches: 1,
      estimatedActiveDurationSeconds: 100,
      estimatedCalendarDurationSeconds: 100,
      estimatedStartAt: '2026-07-22T11:00:00.000Z',
      estimatedEndAt: '2026-07-22T11:05:00.000Z',
      timezone: 'America/Sao_Paulo',
    },
    content: {
      type: 'TEXT',
      body,
      hash: hashDispatchPlanContent(body),
      length: body.length,
    },
  };
}

function approvedPlan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan-1',
    organizationId: 'org-1',
    campaignId: 'campaign-1',
    segmentId: 'segment-1',
    channelAccountId: 'channel-1',
    name: 'Plano',
    description: 'Desc',
    channelType: ChannelType.WHATSAPP,
    content: 'Mensagem aprovada',
    status: DispatchPlanStatus.APPROVED,
    version: 5,
    totalEvaluated: 10,
    totalEligible: 8,
    totalExcluded: 2,
    snapshotCreatedAt: new Date(),
    validationSnapshot: { passed: true },
    validatedAt: new Date(),
    validatedVersion: 5,
    simulationSnapshot: {
      configuration: {
        requestedMessagesPerMinute: 4,
        minDelaySeconds: 10,
        maxDelaySeconds: 20,
        batchSize: 20,
        pauseBetweenBatchesSeconds: 120,
        timezone: 'America/Sao_Paulo',
        allowedStartTime: '08:00',
        allowedEndTime: '20:00',
        allowedDays: [1, 2, 3, 4, 5, 6],
        plannedStartAt: null,
      },
      estimates: {
        effectiveMessagesPerMinute: 4,
        totalBatches: 1,
        totalBatchPauses: 0,
        estimatedActiveDurationSeconds: 100,
        estimatedCalendarDurationSeconds: 100,
        estimatedStartAt: '2026-07-22T11:00:00.000Z',
        estimatedEndAt: '2026-07-22T11:05:00.000Z',
      },
    },
    simulatedAt: new Date(),
    simulatedVersion: 5,
    approvedAt: new Date(),
    approvedByUserId: 'user-1',
    approvalSnapshot: approvalSnapshot(),
    ...overrides,
  };
}

function createHarness(options: {
  plan?: ReturnType<typeof approvedPlan> | null;
  existingDispatch?: boolean;
  denyApprove?: boolean;
  channelMissing?: boolean;
  createThrowsUnique?: boolean;
} = {}) {
  const plan =
    options.plan === undefined ? approvedPlan() : options.plan;
  const auditEvents: Array<Record<string, unknown>> = [];
  let created: Record<string, unknown> | null = null;

  const prisma = {
    campaign: {
      findUnique: async () => ({ id: 'campaign-1', organizationId: 'org-1' }),
    },
    dispatchPlan: {
      findFirst: async () => plan,
    },
    dispatch: {
      findUnique: async () =>
        options.existingDispatch ? { id: 'dispatch-existing' } : null,
      findFirst: async () => created,
      findMany: async () => (created ? [created] : []),
      count: async () => (created ? 1 : 0),
      create: async (args: { data: Record<string, unknown>; select: unknown }) => {
        if (options.createThrowsUnique) {
          throw new Prisma.PrismaClientKnownRequestError('Unique', {
            code: 'P2002',
            clientVersion: 'test',
          });
        }
        created = {
          id: 'dispatch-1',
          organizationId: 'org-1',
          campaignId: 'campaign-1',
          dispatchPlanId: plan?.id,
          channelAccountId: plan?.channelAccountId,
          name: args.data.name,
          description: args.data.description,
          channelType: args.data.channelType,
          contentSnapshot: args.data.contentSnapshot,
          configurationSnapshot: args.data.configurationSnapshot,
          approvalSnapshot: args.data.approvalSnapshot,
          status: DispatchStatus.DRAFT,
          totalItems: 0,
          pendingItems: 0,
          queuedItems: 0,
          processingItems: 0,
          sentItems: 0,
          deliveredItems: 0,
          readItems: 0,
          failedItems: 0,
          skippedItems: 0,
          canceledItems: 0,
          createdByUserId: 'user-1',
          preparedAt: null,
          queuedAt: null,
          startedAt: null,
          pausingAt: null,
          pausedAt: null,
          resumedAt: null,
          completedAt: null,
          failedAt: null,
          canceledAt: null,
          emergencyStoppedAt: null,
          lastProgressAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          dispatchPlan: {
            id: plan?.id,
            name: plan?.name,
            status: plan?.status,
            version: plan?.version,
            totalEligible: plan?.totalEligible,
            totalEvaluated: plan?.totalEvaluated,
            totalExcluded: plan?.totalExcluded,
          },
          channelAccount: {
            id: 'channel-1',
            name: 'Evolution',
            provider: ChannelProvider.WHATSAPP_EVOLUTION,
            status: ChannelAccountStatus.CONNECTED,
          },
          createdBy: { id: 'user-1', name: 'Usuario' },
        };
        return created;
      },
    },
    channelAccount: {
      findFirst: async () =>
        options.channelMissing
          ? null
          : {
              id: 'channel-1',
              campaignId: 'campaign-1',
              provider: ChannelProvider.WHATSAPP_EVOLUTION,
              status: ChannelAccountStatus.CONNECTED,
            },
    },
  };

  const access = {
    requireApproveAccess: async () => {
      if (options.denyApprove) {
        throw new ForbiddenException('Permissao insuficiente');
      }
      return { role: MembershipRole.OWNER };
    },
    requireMembership: async () => ({ role: MembershipRole.OWNER }),
  };

  const audit = {
    log: async (event: Record<string, unknown>) => {
      auditEvents.push(event);
    },
  };

  return {
    service: new DispatchesService(
      prisma as never,
      access as never,
      audit as never,
    ),
    auditEvents,
    getCreated: () => created,
  };
}

describe('DispatchesService 09.1', () => {
  it('OWNER cria Dispatch DRAFT a partir de Plano APPROVED', async () => {
    const harness = createHarness();
    const result = await harness.service.create('user-1', 'campaign-1', {
      dispatchPlanId: 'plan-1',
    });
    assert.equal(result.status, DispatchStatus.DRAFT);
    assert.equal(result.totalItems, 0);
    assert.equal(
      (result.contentSnapshot as { hash: string }).hash,
      hashDispatchPlanContent('Mensagem aprovada'),
    );
    assert.equal(harness.auditEvents[0]?.action, 'DISPATCH_CREATED');
    const metadata = harness.auditEvents[0]?.metadata as Record<string, unknown>;
    assert.equal(typeof metadata.contentHash, 'string');
    assert.equal('content' in metadata, false);
  });

  it('MANAGER nao cria e estados nao APPROVED sao rejeitados', async () => {
    await assert.rejects(
      createHarness({ denyApprove: true }).service.create(
        'manager-1',
        'campaign-1',
        { dispatchPlanId: 'plan-1' },
      ),
      ForbiddenException,
    );
    await assert.rejects(
      createHarness({
        plan: approvedPlan({ status: DispatchPlanStatus.VALIDATED }),
      }).service.create('user-1', 'campaign-1', { dispatchPlanId: 'plan-1' }),
      BadRequestException,
    );
    await assert.rejects(
      createHarness({
        plan: approvedPlan({ status: DispatchPlanStatus.DRAFT }),
      }).service.create('user-1', 'campaign-1', { dispatchPlanId: 'plan-1' }),
      BadRequestException,
    );
  });

  it('unicidade e canal ausente bloqueiam', async () => {
    await assert.rejects(
      createHarness({ existingDispatch: true }).service.create(
        'user-1',
        'campaign-1',
        { dispatchPlanId: 'plan-1' },
      ),
      ConflictException,
    );
    await assert.rejects(
      createHarness({ createThrowsUnique: true }).service.create(
        'user-1',
        'campaign-1',
        { dispatchPlanId: 'plan-1' },
      ),
      ConflictException,
    );
    await assert.rejects(
      createHarness({ channelMissing: true }).service.create(
        'user-1',
        'campaign-1',
        { dispatchPlanId: 'plan-1' },
      ),
      BadRequestException,
    );
  });

  it('hash divergente nao cria', async () => {
    await assert.rejects(
      createHarness({
        plan: approvedPlan({
          approvalSnapshot: {
            ...approvalSnapshot(),
            content: {
              type: 'TEXT',
              body: 'Mensagem aprovada',
              hash: 'a'.repeat(64),
              length: 10,
            },
          },
        }),
      }).service.create('user-1', 'campaign-1', { dispatchPlanId: 'plan-1' }),
      BadRequestException,
    );
  });

  it('lista e detalhe respeitam campanha', async () => {
    const harness = createHarness();
    await harness.service.create('user-1', 'campaign-1', {
      dispatchPlanId: 'plan-1',
    });
    const listed = await harness.service.list('user-1', 'campaign-1', {
      page: 1,
      limit: 20,
    });
    assert.equal(listed.dispatches.length, 1);
    assert.equal(listed.dispatches[0]?.approvedAudience.totalEligible, 8);

    const detail = await harness.service.getById(
      'user-1',
      'campaign-1',
      'dispatch-1',
    );
    assert.equal(detail.allowedActions.canPrepare, false);
    assert.equal(detail.allowedActions.canView, true);
  });

  it('plano inexistente e rejeitado', async () => {
    await assert.rejects(
      createHarness({ plan: null }).service.create('user-1', 'campaign-1', {
        dispatchPlanId: 'missing',
      }),
      NotFoundException,
    );
  });
});
