/**
 * 09.7.1 — Validacao last-mile do conteudo congelado antes do envio.
 * Nunca regenera variantes; so confere o snapshot do DispatchItem.
 */

import { hashContentText } from './content-selection.util';

export type FrozenItemContentCheck = {
  ok: true;
  text: string;
  renderedTextHash: string;
} | {
  ok: false;
  errorCode:
    | 'CONTENT_RENDER_FAILED'
    | 'CONTENT_SNAPSHOT_MISMATCH'
    | 'CONTENT_VARIABLE_UNRESOLVED'
    | 'CONTENT_VARIANT_NOT_FOUND'
    | 'CONTENT_EMPTY';
  message: string;
};

export function assertFrozenItemContentReady(
  contentSnapshot: unknown,
): FrozenItemContentCheck {
  const cs = (contentSnapshot ?? {}) as {
    body?: unknown;
    hash?: unknown;
    renderedTextHash?: unknown;
    contentValid?: unknown;
    personalizationStatus?: unknown;
    bodyVariantId?: unknown;
    composition?: unknown;
    compositionSnapshotHash?: unknown;
  };

  if (cs.contentValid === false || cs.personalizationStatus === 'BLOCKED') {
    return {
      ok: false,
      errorCode: 'CONTENT_RENDER_FAILED',
      message: 'Conteudo personalizado bloqueado na materializacao',
    };
  }

  const text = typeof cs.body === 'string' ? cs.body : '';
  if (!text.trim()) {
    return {
      ok: false,
      errorCode: 'CONTENT_EMPTY',
      message: 'Texto do item vazio',
    };
  }

  if (/\{\{[^}]+\}\}/.test(text)) {
    return {
      ok: false,
      errorCode: 'CONTENT_VARIABLE_UNRESOLVED',
      message: 'Placeholder nao resolvido no texto congelado',
    };
  }

  const expectedHash =
    typeof cs.renderedTextHash === 'string' && cs.renderedTextHash
      ? cs.renderedTextHash
      : typeof cs.hash === 'string'
        ? cs.hash
        : '';
  const actualHash = hashContentText(text);
  if (!expectedHash || actualHash !== expectedHash) {
    return {
      ok: false,
      errorCode: 'CONTENT_SNAPSHOT_MISMATCH',
      message: 'Hash do texto diverge do snapshot do item',
    };
  }

  if (cs.composition && typeof cs.composition === 'object') {
    if (!cs.bodyVariantId || typeof cs.bodyVariantId !== 'string') {
      return {
        ok: false,
        errorCode: 'CONTENT_VARIANT_NOT_FOUND',
        message: 'bodyVariantId ausente no item com composicao',
      };
    }
  }

  return {
    ok: true,
    text,
    renderedTextHash: actualHash,
  };
}
