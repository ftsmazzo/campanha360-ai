import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { validateEvolutionWebhookAuth } from './evolution-webhook.auth';

const SECRET = 'test-evolution-webhook-secret';

function base64Url(input: string | Buffer) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signEvolutionJwt(secret: string, claims?: Record<string, unknown>) {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64Url(
    JSON.stringify({
      iat: now,
      exp: now + 600,
      app: 'evolution',
      action: 'webhook',
      ...claims,
    }),
  );
  const data = `${header}.${payload}`;
  const signature = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${signature}`;
}

test('sem EVOLUTION_WEBHOOK_SECRET aceita webhook em modo homologacao', () => {
  const result = validateEvolutionWebhookAuth('', {});
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.mode, 'disabled');
  }
});

test('com secret configurado rejeita webhook sem autenticacao', () => {
  const result = validateEvolutionWebhookAuth(SECRET, {});
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'missing_auth');
  }
});

test('com secret configurado aceita JWT Bearer valido da Evolution', () => {
  const token = signEvolutionJwt(SECRET);
  const result = validateEvolutionWebhookAuth(SECRET, {
    authorization: `Bearer ${token}`,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.mode, 'jwt');
  }
});

test('com secret configurado rejeita JWT com claims invalidas', () => {
  const token = signEvolutionJwt(SECRET, { app: 'other', action: 'webhook' });
  const result = validateEvolutionWebhookAuth(SECRET, {
    authorization: `Bearer ${token}`,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'invalid_jwt_claims');
  }
});

test('com secret configurado rejeita JWT assinado com outra chave', () => {
  const token = signEvolutionJwt('outra-chave');
  const result = validateEvolutionWebhookAuth(SECRET, {
    authorization: `Bearer ${token}`,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'invalid_jwt');
  }
});

test('com secret configurado aceita header x-evolution-webhook-secret', () => {
  const result = validateEvolutionWebhookAuth(SECRET, {
    evolutionSecret: SECRET,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.mode, 'header');
  }
});

test('com secret configurado rejeita header de secret incorreto', () => {
  const result = validateEvolutionWebhookAuth(SECRET, {
    evolutionSecret: 'errado',
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'invalid_secret');
  }
});
