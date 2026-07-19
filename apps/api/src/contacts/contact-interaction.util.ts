export type ContactThreadSummary = {
  id: string;
  contactId: string;
  lastMessageAt: Date | null;
  channel: string;
};

export type ContactMessageCount = {
  contactId: string | null;
  count: number;
};

export type ContactInteractionSummary = {
  lastInteractionAt: string | null;
  messageCount: number;
  latestThreadId: string | null;
  latestChannel: string | null;
};

/**
 * Monta resumo de interação por contato a partir de threads e contagens.
 * Usa a thread mais recente (por lastMessageAt) para abrir o Atendimento.
 */
export function buildContactInteractionMap(
  threads: ContactThreadSummary[],
  messageCounts: ContactMessageCount[],
): Map<string, ContactInteractionSummary> {
  const map = new Map<string, ContactInteractionSummary>();

  for (const row of messageCounts) {
    if (!row.contactId) continue;
    map.set(row.contactId, {
      lastInteractionAt: null,
      messageCount: row.count,
      latestThreadId: null,
      latestChannel: null,
    });
  }

  const sortedThreads = [...threads].sort((left, right) => {
    const leftAt = left.lastMessageAt?.getTime() ?? 0;
    const rightAt = right.lastMessageAt?.getTime() ?? 0;
    if (rightAt !== leftAt) return rightAt - leftAt;
    return left.id.localeCompare(right.id);
  });

  for (const thread of sortedThreads) {
    const current = map.get(thread.contactId) ?? {
      lastInteractionAt: null,
      messageCount: 0,
      latestThreadId: null,
      latestChannel: null,
    };

    if (!current.latestThreadId) {
      current.latestThreadId = thread.id;
      current.latestChannel = thread.channel;
      current.lastInteractionAt = thread.lastMessageAt
        ? thread.lastMessageAt.toISOString()
        : null;
    }

    map.set(thread.contactId, current);
  }

  return map;
}
