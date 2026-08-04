/**
 * 09.7.1 — Distribuicao de variantes na simulacao (sem materializar todas as combinacoes).
 */

import {
  selectAndRenderComposition,
  type ContentCompositionSnapshotV1,
} from './content-selection.util';
import { assessContentRepetition } from './dispatch-repetition.util';
import { classifyContentSimilarity } from './content-ai.util';

export type ContentSimulationContact = {
  id: string;
  name?: string | null;
  companyName?: string | null;
};

export function simulateContentDistribution(input: {
  snapshot: ContentCompositionSnapshotV1;
  dispatchId: string;
  contacts: ContentSimulationContact[];
}) {
  const byBody: Record<string, number> = {};
  const byGreeting: Record<string, number> = {};
  const byClosing: Record<string, number> = {};
  let withPersonalization = 0;
  let withFallback = 0;
  let blockedByVariable = 0;
  const lengths: number[] = [];
  const renderedTexts: string[] = [];
  const hashCounts = new Map<string, number>();

  for (const contact of input.contacts) {
    const rendered = selectAndRenderComposition({
      snapshot: input.snapshot,
      dispatchId: input.dispatchId,
      dispatchItemId: `sim:${contact.id}`,
      contactId: contact.id,
      contact: {
        name: contact.name,
        companyName: contact.companyName,
      },
    });

    if (!rendered.valid || rendered.personalizationStatus === 'BLOCKED') {
      blockedByVariable += 1;
      continue;
    }

    byBody[rendered.bodyVariantId] = (byBody[rendered.bodyVariantId] ?? 0) + 1;
    if (rendered.greetingVariantId) {
      byGreeting[rendered.greetingVariantId] =
        (byGreeting[rendered.greetingVariantId] ?? 0) + 1;
    }
    if (rendered.closingVariantId) {
      byClosing[rendered.closingVariantId] =
        (byClosing[rendered.closingVariantId] ?? 0) + 1;
    }
    if (
      rendered.personalizationStatus === 'FULL' ||
      rendered.personalizationStatus === 'PARTIAL'
    ) {
      withPersonalization += 1;
    }
    if (rendered.usedFallbacks.length > 0) withFallback += 1;
    lengths.push(rendered.renderedText.length);
    renderedTexts.push(rendered.renderedText);
    hashCounts.set(
      rendered.renderedTextHash,
      (hashCounts.get(rendered.renderedTextHash) ?? 0) + 1,
    );
  }

  const exactDuplicates = [...hashCounts.values()].filter((n) => n > 1).length;
  let highSimilarityPairs = 0;
  for (let i = 0; i < Math.min(renderedTexts.length, 40); i++) {
    for (let j = i + 1; j < Math.min(renderedTexts.length, 40); j++) {
      const a = assessContentRepetition({
        currentContent: renderedTexts[i]!,
        recentContents: [renderedTexts[j]!],
        thresholdPercentage: 90,
      });
      if (classifyContentSimilarity(a.repetitionScore) === 'MUITO_SEMELHANTE') {
        highSimilarityPairs += 1;
      }
    }
  }

  const total = input.contacts.length || 1;
  const pct = (n: number) => Math.round((n / total) * 1000) / 10;

  return {
    totalContacts: input.contacts.length,
    byBodyVariant: byBody,
    byGreetingVariant: byGreeting,
    byClosingVariant: byClosing,
    withPersonalization,
    withFallback,
    blockedByVariable,
    percentages: {
      personalized: pct(withPersonalization),
      fallback: pct(withFallback),
      blocked: pct(blockedByVariable),
    },
    exactDuplicateHashGroups: exactDuplicates,
    highSimilarityPairs,
    size: {
      min: lengths.length ? Math.min(...lengths) : 0,
      max: lengths.length ? Math.max(...lengths) : 0,
      avg: lengths.length
        ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length)
        : 0,
    },
  };
}
