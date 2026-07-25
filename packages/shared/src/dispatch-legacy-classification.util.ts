/**
 * Marca classificacoes legadas CONTENT_REJECTED/HTTP_400 sem evidencia
 * como UNCONFIRMED_LEGACY_CLASSIFICATION (09.6.4).
 * NAO inventa CHANNEL_DISCONNECTED retroativamente.
 */

export type LegacyReclassifyResult = {
  scanned: number;
  marked: number;
  skipped: number;
};

export function shouldMarkUnconfirmedLegacyContentRejected(item: {
  errorCategory?: string | null;
  errorCode?: string | null;
  providerErrorMessageSafe?: string | null;
  providerErrorCode?: string | null;
  classificationConfidence?: string | null;
}): boolean {
  if (item.classificationConfidence === 'UNCONFIRMED_LEGACY_CLASSIFICATION') {
    return false;
  }
  if (String(item.errorCategory) !== 'CONTENT_REJECTED') return false;
  const code = String(item.errorCode ?? '');
  if (code !== 'HTTP_400' && code !== 'HTTP_422') return false;
  const evidence = `${item.providerErrorMessageSafe ?? ''} ${item.providerErrorCode ?? ''}`;
  // Se ja houver evidencia explicita de payload, mantem CONTENT_REJECTED
  if (
    /invalid\s*payload|missing\s*required|unsupported\s*(message|type)|empty\s*(text|content)/i.test(
      evidence,
    )
  ) {
    return false;
  }
  return true;
}

export function buildLegacyUnconfirmedUpdate() {
  return {
    classificationConfidence: 'UNCONFIRMED_LEGACY_CLASSIFICATION',
    // Mantem categoria historica; evidencia insuficiente para reclassificar
    providerErrorMessageSafe:
      'Classificacao historica CONTENT_REJECTED sem evidencia explicita de rejeicao de conteudo (09.6.4)',
  };
}
