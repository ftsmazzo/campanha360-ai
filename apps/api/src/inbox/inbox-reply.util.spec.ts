import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeOutboundReplyBody,
  resolveWhatsAppDestination,
} from './inbox-reply.util';

test('normalizeOutboundReplyBody rejeita texto vazio', () => {
  assert.throws(() => normalizeOutboundReplyBody('   '), /Informe o texto/);
});

test('normalizeOutboundReplyBody aceita texto util', () => {
  assert.equal(normalizeOutboundReplyBody('  ola  '), 'ola');
});

test('resolveWhatsAppDestination prioriza canal normalizado', () => {
  assert.equal(
    resolveWhatsAppDestination({
      phoneNumber: '11999998888',
      channelNormalizedValue: '5511988887777',
    }),
    '5511988887777',
  );
});

test('resolveWhatsAppDestination usa phoneNumber quando canal ausente', () => {
  assert.equal(
    resolveWhatsAppDestination({
      phoneNumber: '+55 (11) 98888-7777',
      channelNormalizedValue: null,
    }),
    '5511988887777',
  );
});

test('resolveWhatsAppDestination retorna null sem destino valido', () => {
  assert.equal(
    resolveWhatsAppDestination({
      phoneNumber: '123',
      channelNormalizedValue: null,
    }),
    null,
  );
});
