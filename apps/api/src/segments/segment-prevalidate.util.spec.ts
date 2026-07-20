import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChannelType, ContactStatus } from '@prisma/client';
import {
  PROVISIONAL_DISPATCH_SOFT_LIMIT,
  analyzeSegmentDispatchReadiness,
} from './segment-prevalidate.util';

describe('analyzeSegmentDispatchReadiness', () => {
  it('conta contatos elegiveis no segmento', () => {
    const summary = analyzeSegmentDispatchReadiness({
      whatsappChannelConnected: true,
      filters: { tagIds: ['tag-1'], includeOptOut: false },
      contacts: [
        {
          id: '1',
          status: ContactStatus.ACTIVE,
          phoneNumber: '11988887771',
          channels: [{ channel: ChannelType.WHATSAPP, status: 'ACTIVE' }],
        },
        {
          id: '2',
          status: ContactStatus.ACTIVE,
          phoneNumber: '11988887772',
          channels: [{ channel: ChannelType.WHATSAPP, status: 'ACTIVE' }],
        },
      ],
    });

    assert.equal(summary.totalGross, 2);
    assert.equal(summary.eligible, 2);
    assert.equal(summary.canDispatch, false);
  });

  it('exclui opt-out/BLOCKED dos elegiveis', () => {
    const summary = analyzeSegmentDispatchReadiness({
      whatsappChannelConnected: true,
      filters: { includeOptOut: true },
      contacts: [
        {
          id: '1',
          status: ContactStatus.BLOCKED,
          phoneNumber: '11988887771',
          optOutCount: 1,
          channels: [{ channel: ChannelType.WHATSAPP, status: 'ACTIVE' }],
        },
        {
          id: '2',
          status: ContactStatus.ACTIVE,
          phoneNumber: '11988887772',
          hasOptOutConsent: true,
          channels: [{ channel: ChannelType.WHATSAPP, status: 'ACTIVE' }],
        },
        {
          id: '3',
          status: ContactStatus.ACTIVE,
          phoneNumber: '11988887773',
          channels: [{ channel: ChannelType.WHATSAPP, status: 'ACTIVE' }],
        },
      ],
    });

    assert.equal(summary.optOutOrBlocked, 2);
    assert.equal(summary.eligible, 1);
    assert.ok(summary.alerts.some((alert) => alert.code === 'HAS_OPT_OUT'));
  });

  it('exclui ContactStatus.DELETED dos elegiveis', () => {
    const summary = analyzeSegmentDispatchReadiness({
      whatsappChannelConnected: true,
      filters: {},
      contacts: [
        {
          id: '1',
          status: ContactStatus.DELETED,
          phoneNumber: '11988887771',
          channels: [{ channel: ChannelType.WHATSAPP, status: 'ACTIVE' }],
        },
        {
          id: '2',
          status: ContactStatus.ACTIVE,
          phoneNumber: '11988887772',
          channels: [{ channel: ChannelType.WHATSAPP, status: 'ACTIVE' }],
        },
      ],
    });

    assert.equal(summary.deleted, 1);
    assert.equal(summary.eligible, 1);
    assert.ok(summary.alerts.some((alert) => alert.code === 'HAS_DELETED'));
  });

  it('conta telefone invalido como risco', () => {
    const summary = analyzeSegmentDispatchReadiness({
      whatsappChannelConnected: true,
      filters: {},
      contacts: [
        {
          id: '1',
          status: ContactStatus.ACTIVE,
          phoneNumber: '123',
          channels: [{ channel: ChannelType.WHATSAPP, status: 'ACTIVE' }],
        },
      ],
    });

    assert.equal(summary.invalidPhone, 1);
    assert.equal(summary.eligible, 0);
    assert.ok(summary.alerts.some((alert) => alert.code === 'HAS_INVALID_PHONE'));
  });

  it('conta duplicidade como risco', () => {
    const summary = analyzeSegmentDispatchReadiness({
      whatsappChannelConnected: true,
      filters: {},
      contacts: [
        {
          id: '1',
          status: ContactStatus.ACTIVE,
          phoneNumber: '(11) 98888-7771',
          channels: [{ channel: ChannelType.WHATSAPP, status: 'ACTIVE' }],
        },
        {
          id: '2',
          status: ContactStatus.ACTIVE,
          phoneNumber: '11988887771',
          channels: [{ channel: ChannelType.WHATSAPP, status: 'ACTIVE' }],
        },
      ],
    });

    assert.equal(summary.duplicatePhone, 1);
    assert.equal(summary.eligible, 1);
    assert.ok(summary.alerts.some((alert) => alert.code === 'HAS_DUPLICATES'));
  });

  it('sem canal conectado gera alerta', () => {
    const summary = analyzeSegmentDispatchReadiness({
      whatsappChannelConnected: false,
      filters: {},
      softLimit: PROVISIONAL_DISPATCH_SOFT_LIMIT,
      contacts: [
        {
          id: '1',
          status: ContactStatus.ACTIVE,
          phoneNumber: '11988887771',
          channels: [{ channel: ChannelType.WHATSAPP, status: 'ACTIVE' }],
        },
      ],
    });

    assert.equal(summary.whatsappChannelConnected, false);
    assert.ok(summary.alerts.some((alert) => alert.code === 'NO_WHATSAPP_CHANNEL'));
    assert.equal(summary.canDispatch, false);
  });
});
