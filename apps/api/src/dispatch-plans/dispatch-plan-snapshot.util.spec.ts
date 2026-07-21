import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ChannelType,
  ConsentStatus,
  ContactOperationalStatus,
  ContactStatus,
  DispatchPlanRecipientEligibilityStatus as Eligibility,
} from '@prisma/client';
import {
  SnapshotContactInput,
  buildDispatchPlanSnapshotRecipients,
  summarizeSnapshotRecipients,
} from './dispatch-plan-snapshot.util';

function contact(
  id: string,
  overrides: Partial<SnapshotContactInput> = {},
): SnapshotContactInput {
  return {
    id,
    name: `Contato ${id}`,
    phoneNumber: `6299999000${id}`,
    city: 'Goiania',
    neighborhood: 'Centro',
    metadata: { lastImportSource: 'csv' },
    status: ContactStatus.ACTIVE,
    operationalStatus: ContactOperationalStatus.NEW,
    assignedTo: { id: 'user-1', name: 'Responsavel' },
    channels: [{ channel: ChannelType.WHATSAPP, status: 'ACTIVE' }],
    consents: [
      {
        channel: ChannelType.WHATSAPP,
        status: ConsentStatus.GRANTED,
        source: 'manual',
        collectedAt: new Date('2026-01-01T00:00:00.000Z'),
        revokedAt: null,
      },
    ],
    optOuts: [],
    tags: [{ tag: { id: 'tag-1', name: 'Apoiador', color: '#123456' } }],
    ...overrides,
  };
}

describe('buildDispatchPlanSnapshotRecipients', () => {
  it('persiste elegiveis e excluidos com snapshots minimos', () => {
    const recipients = buildDispatchPlanSnapshotRecipients([
      contact('1'),
      contact('2', { phoneNumber: null }),
    ]);

    assert.equal(recipients.length, 2);
    assert.equal(recipients[0].eligibilityStatus, Eligibility.ELIGIBLE);
    assert.equal(
      recipients[1].eligibilityStatus,
      Eligibility.EXCLUDED_INVALID_DESTINATION,
    );
    assert.equal(recipients[0].contactSnapshot.name, 'Contato 1');
    assert.equal('email' in recipients[0].contactSnapshot, false);
  });

  it('exclui opt-out aplicavel ao WhatsApp', () => {
    const [recipient] = buildDispatchPlanSnapshotRecipients([
      contact('1', {
        optOuts: [
          {
            channel: ChannelType.WHATSAPP,
            reason: 'solicitado',
            source: 'manual',
            createdAt: new Date('2026-01-02T00:00:00.000Z'),
          },
        ],
      }),
    ]);

    assert.equal(recipient.eligibilityStatus, Eligibility.EXCLUDED_OPT_OUT);
    assert.deepEqual(recipient.optOutSnapshot, {
      exists: true,
      channel: 'WHATSAPP',
      createdAt: '2026-01-02T00:00:00.000Z',
      reason: 'solicitado',
      source: 'manual',
    });
  });

  it('exclui consentimento OPT_OUT de WhatsApp, mas nao opt-out apenas de e-mail', () => {
    const recipients = buildDispatchPlanSnapshotRecipients([
      contact('1', {
        consents: [
          {
            channel: ChannelType.WHATSAPP,
            status: ConsentStatus.OPT_OUT,
            source: 'manual',
            collectedAt: null,
            revokedAt: new Date('2026-01-03T00:00:00.000Z'),
          },
        ],
      }),
      contact('2', {
        optOuts: [
          {
            channel: ChannelType.EMAIL,
            reason: null,
            source: 'manual',
            createdAt: new Date(),
          },
        ],
      }),
    ]);

    assert.equal(recipients[0].eligibilityStatus, Eligibility.EXCLUDED_OPT_OUT);
    assert.equal(recipients[1].eligibilityStatus, Eligibility.ELIGIBLE);
  });

  it('exclui BLOCKED e DELETED com motivos distintos', () => {
    const recipients = buildDispatchPlanSnapshotRecipients([
      contact('1', { status: ContactStatus.BLOCKED }),
      contact('2', { status: ContactStatus.DELETED }),
    ]);

    assert.equal(recipients[0].eligibilityStatus, Eligibility.EXCLUDED_BLOCKED);
    assert.equal(recipients[1].eligibilityStatus, Eligibility.EXCLUDED_DELETED);
  });

  it('exclui telefone ausente, curto ou longo', () => {
    const recipients = buildDispatchPlanSnapshotRecipients([
      contact('1', { phoneNumber: null }),
      contact('2', { phoneNumber: '123' }),
      contact('3', { phoneNumber: '1234567890123456' }),
    ]);

    assert.ok(
      recipients.every(
        (item) =>
          item.eligibilityStatus ===
          Eligibility.EXCLUDED_INVALID_DESTINATION,
      ),
    );
  });

  it('mantem apenas o primeiro contato elegivel por destino normalizado', () => {
    const recipients = buildDispatchPlanSnapshotRecipients([
      contact('1', { phoneNumber: '(62) 99999-0001' }),
      contact('2', { phoneNumber: '62999990001' }),
      contact('3', { phoneNumber: '62999990003' }),
    ]);

    assert.equal(recipients[0].eligibilityStatus, Eligibility.ELIGIBLE);
    assert.equal(recipients[1].eligibilityStatus, Eligibility.EXCLUDED_DUPLICATE);
    assert.equal(recipients[2].eligibilityStatus, Eligibility.ELIGIBLE);
    assert.equal(
      recipients.filter((item) => item.eligibilityStatus === Eligibility.ELIGIBLE)
        .length,
      2,
    );
  });

  it('exclui contato sem canal WhatsApp ativo', () => {
    const [recipient] = buildDispatchPlanSnapshotRecipients([
      contact('1', {
        channels: [{ channel: ChannelType.WHATSAPP, status: 'INACTIVE' }],
      }),
    ]);

    assert.equal(recipient.eligibilityStatus, Eligibility.EXCLUDED_NO_CHANNEL);
  });

  it('congela os dados produzidos mesmo se o contato de origem mudar depois', () => {
    const source = contact('1', { name: 'Nome original' });
    const [recipient] = buildDispatchPlanSnapshotRecipients([source]);
    source.name = 'Nome alterado';
    source.tags[0].tag.name = 'Tag alterada';

    assert.equal(recipient.contactSnapshot.name, 'Nome original');
    assert.deepEqual(recipient.contactSnapshot.tags, [
      { id: 'tag-1', name: 'Apoiador', color: '#123456' },
    ]);
  });

  it('resume totais por elegibilidade', () => {
    const recipients = buildDispatchPlanSnapshotRecipients([
      contact('1'),
      contact('2', { status: ContactStatus.BLOCKED }),
      contact('3', { phoneNumber: null }),
    ]);
    const summary = summarizeSnapshotRecipients(recipients);

    assert.equal(summary.totalEvaluated, 3);
    assert.equal(summary.totalEligible, 1);
    assert.equal(summary.totalExcluded, 2);
    assert.equal(summary.byEligibilityStatus.EXCLUDED_BLOCKED, 1);
  });
});
