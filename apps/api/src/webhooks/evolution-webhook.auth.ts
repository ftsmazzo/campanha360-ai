import { UnauthorizedException } from '@nestjs/common';
import { verify } from 'jsonwebtoken';

export type EvolutionWebhookAuthHeaders = {
  authorization?: string | null;
  evolutionSecret?: string | null;
  campanhaSecret?: string | null;
};

export type EvolutionWebhookAuthOk = {
  ok: true;
  mode: 'disabled' | 'jwt' | 'header';
};

export type EvolutionWebhookAuthFail = {
  ok: false;
  reason: 'missing_auth' | 'invalid_secret' | 'invalid_jwt' | 'invalid_jwt_claims';
};

export type EvolutionWebhookAuthResult = EvolutionWebhookAuthOk | EvolutionWebhookAuthFail;

type JwtWebhookClaims = {
  app?: unknown;
  action?: unknown;
};

function extractBearerToken(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const match = authorization.trim().match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return null;
  const token = match[1].trim();
  return token || null;
}

function secretsMatch(expected: string, provided: string): boolean {
  if (expected.length !== provided.length) {
    return false;
  }

  // Comparacao constante via XOR para evitar timing leaks sem Buffer no helper puro.
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Autenticacao do webhook Evolution.
 *
 * Formatos aceitos quando EVOLUTION_WEBHOOK_SECRET esta definido:
 * 1) Authorization: Bearer <JWT HS256> assinado com o secret (claims app=evolution, action=webhook)
 *    — formato nativo da Evolution com headers.jwt_key
 * 2) Header cru x-evolution-webhook-secret (ou legado x-campanha360-webhook-secret)
 *    — quando webhook.headers envia o secret estatico
 *
 * Sem secret: aceita (modo homologacao) — o caller deve logar warning.
 */
export function validateEvolutionWebhookAuth(
  expectedSecret: string | null | undefined,
  headers: EvolutionWebhookAuthHeaders,
): EvolutionWebhookAuthResult {
  const expected = (expectedSecret || '').trim();
  if (!expected) {
    return { ok: true, mode: 'disabled' };
  }

  const bearer = extractBearerToken(headers.authorization);
  if (bearer) {
    try {
      const decoded = verify(bearer, expected, {
        algorithms: ['HS256'],
      }) as JwtWebhookClaims;

      if (decoded.app !== 'evolution' || decoded.action !== 'webhook') {
        return { ok: false, reason: 'invalid_jwt_claims' };
      }

      return { ok: true, mode: 'jwt' };
    } catch {
      return { ok: false, reason: 'invalid_jwt' };
    }
  }

  const headerSecret = (
    headers.evolutionSecret ||
    headers.campanhaSecret ||
    ''
  ).trim();

  if (headerSecret) {
    if (secretsMatch(expected, headerSecret)) {
      return { ok: true, mode: 'header' };
    }
    return { ok: false, reason: 'invalid_secret' };
  }

  return { ok: false, reason: 'missing_auth' };
}

export function assertEvolutionWebhookAuth(
  expectedSecret: string | null | undefined,
  headers: EvolutionWebhookAuthHeaders,
): EvolutionWebhookAuthOk {
  const result = validateEvolutionWebhookAuth(expectedSecret, headers);
  if (result.ok) {
    return result;
  }

  switch (result.reason) {
    case 'missing_auth':
      throw new UnauthorizedException(
        'Autenticacao do webhook Evolution ausente (Authorization Bearer ou header de secret)',
      );
    case 'invalid_jwt':
      throw new UnauthorizedException('JWT do webhook Evolution invalido');
    case 'invalid_jwt_claims':
      throw new UnauthorizedException('JWT do webhook Evolution com claims invalidas');
    case 'invalid_secret':
      throw new UnauthorizedException('Secret do webhook Evolution invalido');
    default:
      throw new UnauthorizedException('Webhook Evolution nao autorizado');
  }
}
