import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeWhatsAppJid,
  toEvolutionSendNumber,
} from './whatsapp-jid.util';

describe('normalizeWhatsAppJid', () => {
  it('numero puro', () => {
    const n = normalizeWhatsAppJid('5511999990001');
    assert.equal(n.ok, true);
    if (n.ok) {
      assert.equal(n.kind, 'DIGITS');
      assert.equal(n.value, '5511999990001');
    }
  });

  it('JID correto nao recebe sufixo extra', () => {
    const n = normalizeWhatsAppJid('5511999990001@s.whatsapp.net');
    assert.equal(n.ok, true);
    if (n.ok) {
      assert.equal(n.value, '5511999990001@s.whatsapp.net');
    }
  });

  it('JID duplicado e normalizado', () => {
    const n = normalizeWhatsAppJid(
      '6282234834388@s.whatsapp.net@s.whatsapp.net',
    );
    assert.equal(n.ok, true);
    if (n.ok) {
      assert.equal(n.value, '6282234834388@s.whatsapp.net');
    }
  });

  it('JID com espacos', () => {
    const n = normalizeWhatsAppJid(' 5511 99999 0001 @s.whatsapp.net ');
    assert.equal(n.ok, true);
    if (n.ok) assert.equal(n.user, '5511999990001');
  });

  it('@lid nao vira s.whatsapp.net', () => {
    const n = normalizeWhatsAppJid('1234567890@lid');
    assert.equal(n.ok, true);
    if (n.ok) {
      assert.equal(n.kind, 'LID');
      assert.equal(n.value, '1234567890@lid');
    }
    assert.equal(toEvolutionSendNumber('1234567890@lid'), null);
  });

  it('valores invalidos', () => {
    assert.equal(normalizeWhatsAppJid('').ok, false);
    assert.equal(normalizeWhatsAppJid('abc').ok, false);
    assert.equal(normalizeWhatsAppJid('12').ok, false);
  });
});
