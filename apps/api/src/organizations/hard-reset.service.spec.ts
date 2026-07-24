import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import { HARD_RESET_CONFIRMATION } from './dto/hard-reset.dto';
import { HardResetService } from './hard-reset.service';

const ENV_KEYS = ['HARD_RESET_ENABLED', 'NODE_ENV'] as const;

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

function createFakePrisma(options: {
  ownedOrgIds?: string[];
  counts?: Partial<Record<string, number>>;
}) {
  const ownedOrgIds = options.ownedOrgIds ?? ['org-1'];
  const deleted: string[] = [];
  const counts = options.counts ?? {};

  const tx = {
    dispatchItem: {
      count: async () => counts.dispatchItem ?? 0,
      deleteMany: async () => {
        deleted.push('dispatchItem');
        return { count: counts.dispatchItem ?? 0 };
      },
    },
    dispatchChannelUsageDaily: {
      count: async () => 0,
      deleteMany: async () => {
        deleted.push('usageDaily');
        return { count: 0 };
      },
    },
    dispatchChannel: {
      count: async () => 0,
      deleteMany: async () => {
        deleted.push('dispatchChannel');
        return { count: 0 };
      },
    },
    dispatch: {
      count: async () => counts.dispatch ?? 0,
      deleteMany: async () => {
        deleted.push('dispatch');
        return { count: counts.dispatch ?? 0 };
      },
    },
    dispatchPlanRecipient: {
      count: async () => 0,
      deleteMany: async () => {
        deleted.push('planRecipient');
        return { count: 0 };
      },
    },
    dispatchPlanChannel: {
      count: async () => 0,
      deleteMany: async () => {
        deleted.push('planChannel');
        return { count: 0 };
      },
    },
    dispatchPlan: {
      count: async () => counts.dispatchPlan ?? 0,
      deleteMany: async () => {
        deleted.push('dispatchPlan');
        return { count: 0 };
      },
    },
    message: {
      count: async () => counts.message ?? 0,
      deleteMany: async () => {
        deleted.push('message');
        return { count: 0 };
      },
    },
    conversationThread: {
      count: async () => counts.thread ?? 0,
      deleteMany: async () => {
        deleted.push('thread');
        return { count: 0 };
      },
    },
    contact: {
      count: async () => counts.contact ?? 2,
      findMany: async () => [{ id: 'c1' }, { id: 'c2' }],
      deleteMany: async () => {
        deleted.push('contact');
        return { count: 2 };
      },
    },
    contactTag: {
      deleteMany: async () => {
        deleted.push('contactTag');
        return { count: 0 };
      },
    },
    contactNote: {
      count: async () => 0,
      deleteMany: async () => {
        deleted.push('contactNote');
        return { count: 0 };
      },
    },
    contactTask: {
      count: async () => 0,
      deleteMany: async () => {
        deleted.push('contactTask');
        return { count: 0 };
      },
    },
    contactChannel: {
      count: async () => 0,
      deleteMany: async () => {
        deleted.push('contactChannel');
        return { count: 0 };
      },
    },
    consent: {
      count: async () => 0,
      deleteMany: async () => {
        deleted.push('consent');
        return { count: 0 };
      },
    },
    optOut: {
      count: async () => 0,
      deleteMany: async () => {
        deleted.push('optOut');
        return { count: 0 };
      },
    },
    tag: {
      count: async () => 0,
      deleteMany: async () => {
        deleted.push('tag');
        return { count: 0 };
      },
    },
    segment: {
      count: async () => 0,
      deleteMany: async () => {
        deleted.push('segment');
        return { count: 0 };
      },
    },
    channelAccount: {
      count: async () => counts.channelAccount ?? 1,
      deleteMany: async () => {
        deleted.push('channelAccount');
        return { count: 1 };
      },
    },
    candidate: {
      count: async () => 0,
      deleteMany: async () => {
        deleted.push('candidate');
        return { count: 0 };
      },
    },
    campaign: {
      count: async () => counts.campaign ?? 1,
      deleteMany: async () => {
        deleted.push('campaign');
        return { count: 1 };
      },
    },
    auditLog: {
      count: async () => 0,
      deleteMany: async () => {
        deleted.push('auditLog');
        return { count: 0 };
      },
    },
    membership: {
      deleteMany: async () => {
        deleted.push('membership');
        return { count: ownedOrgIds.length };
      },
    },
    organization: {
      deleteMany: async () => {
        deleted.push('organization');
        return { count: ownedOrgIds.length };
      },
    },
  };

  return {
    deleted,
    prisma: {
      membership: {
        findMany: async () =>
          ownedOrgIds.map((organizationId) => ({ organizationId })),
      },
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) =>
        fn(tx),
    },
  };
}

describe('HardResetService', () => {
  afterEach(() => clearEnv());

  it('bloqueia quando HARD_RESET_ENABLED=false', async () => {
    process.env.HARD_RESET_ENABLED = 'false';
    process.env.NODE_ENV = 'development';
    const harness = createFakePrisma({});
    const service = new HardResetService(harness.prisma as never);
    await assert.rejects(
      () => service.hardResetOwnedData('user-1', HARD_RESET_CONFIRMATION),
      /HARD_RESET_ENABLED/,
    );
  });

  it('bloqueia confirmacao incorreta', async () => {
    process.env.HARD_RESET_ENABLED = 'true';
    const harness = createFakePrisma({});
    const service = new HardResetService(harness.prisma as never);
    await assert.rejects(
      () => service.hardResetOwnedData('user-1', 'apagar'),
      /Confirmacao invalida/,
    );
  });

  it('OWNER apaga organizacoes e conteudo na ordem segura', async () => {
    process.env.HARD_RESET_ENABLED = 'true';
    const harness = createFakePrisma({
      ownedOrgIds: ['org-1'],
      counts: { contact: 2, campaign: 1, dispatch: 1, message: 3 },
    });
    const service = new HardResetService(harness.prisma as never);
    const result = await service.hardResetOwnedData(
      'user-1',
      HARD_RESET_CONFIRMATION,
    );

    assert.equal(result.ok, true);
    assert.equal(result.organizationsReset, 1);
    assert.equal(result.counts.contacts, 2);
    assert.ok(harness.deleted.indexOf('dispatchItem') < harness.deleted.indexOf('dispatch'));
    assert.ok(harness.deleted.indexOf('dispatch') < harness.deleted.indexOf('dispatchPlan'));
    assert.ok(harness.deleted.indexOf('contact') < harness.deleted.indexOf('campaign'));
    assert.ok(harness.deleted.includes('organization'));
    assert.equal(
      harness.deleted[harness.deleted.length - 1],
      'organization',
    );
  });

  it('sem org OWNER: nao apaga nada e preserva conta', async () => {
    process.env.HARD_RESET_ENABLED = 'true';
    const harness = createFakePrisma({ ownedOrgIds: [] });
    const service = new HardResetService(harness.prisma as never);
    const result = await service.hardResetOwnedData(
      'user-1',
      HARD_RESET_CONFIRMATION,
    );
    assert.equal(result.organizationsReset, 0);
    assert.equal(harness.deleted.length, 0);
  });
});
