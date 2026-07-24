/**
 * Avaliacao de repeticao de conteudo (09.6.2).
 * ENFORCED_NON_BLOCKING: warning + reconhecimento do operador; nao bloqueia Worker.
 */

import { createHash } from 'node:crypto';

export const REPETITION_METHOD_VERSION = 'v1-fingerprint-jaccard';

export type RepetitionAssessment = {
  repetitionScore: number;
  threshold: number;
  evaluatedAt: string;
  methodVersion: string;
  fingerprint: string;
  comparedAgainst: number;
  exceedsThreshold: boolean;
  operatorAcknowledgedAt: string | null;
  operatorUserId: string | null;
};

/** Remove variaveis {{x}}, URLs e espacos para comparar o template base. */
export function normalizeContentForRepetition(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\{\{[^}]+\}\}/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function contentFingerprint(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

export function tokenizeForRepetition(normalized: string): Set<string> {
  return new Set(normalized.split(' ').filter((t) => t.length > 2));
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) {
    if (b.has(t)) inter += 1;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function assessContentRepetition(input: {
  currentContent: string;
  recentContents: string[];
  thresholdPercentage: number;
  now?: Date;
}): Omit<RepetitionAssessment, 'operatorAcknowledgedAt' | 'operatorUserId'> {
  const normalized = normalizeContentForRepetition(input.currentContent);
  const fingerprint = contentFingerprint(normalized);
  const currentTokens = tokenizeForRepetition(normalized);
  let maxScore = 0;

  for (const recent of input.recentContents) {
    const other = normalizeContentForRepetition(recent);
    if (!other) continue;
    const score = jaccardSimilarity(currentTokens, tokenizeForRepetition(other));
    if (score > maxScore) maxScore = score;
  }

  const repetitionScore = Math.round(maxScore * 1000) / 10; // 0-100.0
  const threshold = Math.max(0, Math.min(100, input.thresholdPercentage));

  return {
    repetitionScore,
    threshold,
    evaluatedAt: (input.now ?? new Date()).toISOString(),
    methodVersion: REPETITION_METHOD_VERSION,
    fingerprint,
    comparedAgainst: input.recentContents.length,
    exceedsThreshold: repetitionScore >= threshold,
  };
}

export function acknowledgeRepetition(
  assessment: Omit<RepetitionAssessment, 'operatorAcknowledgedAt' | 'operatorUserId'>,
  operatorUserId: string,
  now = new Date(),
): RepetitionAssessment {
  return {
    ...assessment,
    operatorAcknowledgedAt: now.toISOString(),
    operatorUserId,
  };
}

export function isRepetitionAcknowledged(snapshot: unknown): boolean {
  const s = (snapshot ?? {}) as {
    repetitionAssessment?: Partial<RepetitionAssessment>;
  };
  const a = s.repetitionAssessment;
  if (!a) return true; // sem avaliacao = nao exige ack
  if (!a.exceedsThreshold) return true;
  return Boolean(a.operatorAcknowledgedAt && a.operatorUserId);
}
