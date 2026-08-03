import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertNoSecretsInText,
  sanitizeLogText,
  sanitizeLogValue,
} from './log-sanitizer.util';

describe('log sanitizer', () => {
  it('remove API key', () => {
    const out = sanitizeLogText('apikey=super-secret-key-123 headers');
    assert.match(out, /\[redacted-secret\]/);
    assert.ok(!out.includes('super-secret'));
    assert.equal(assertNoSecretsInText(out), true);
  });

  it('mascara QR base64', () => {
    const qr = `data:image/png;base64,${'A'.repeat(120)}`;
    const out = sanitizeLogText(`payload ${qr}`);
    assert.match(out, /\[redacted-qr\]/);
    assert.ok(!out.includes('AAAA'));
  });

  it('mascara telefone e JID', () => {
    const out = sanitizeLogText(
      'from 5511999887766 jid=5511999887766@s.whatsapp.net',
    );
    assert.ok(!out.includes('5511999887766'));
  });

  it('sanitizeLogValue em objeto webhook', () => {
    const out = sanitizeLogValue({
      apikey: 'abc',
      number: '5511999990001',
      base64: 'AAAA'.repeat(40),
      state: 'open',
    }) as Record<string, unknown>;
    assert.equal(out.apikey, '[redacted-secret]');
    assert.equal(out.number, '[redacted-pii]');
    assert.equal(out.base64, '[redacted-qr]');
    assert.equal(out.state, 'open');
  });
});
