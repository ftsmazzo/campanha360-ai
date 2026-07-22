/**
 * Utilitario puro para reparo seguro de conversas misturadas:
 * mensagens cujo channelAccountId difere do da thread nao devem
 * permanecer agrupadas. Nao apaga historico — apenas decide para
 * qual channelAccountId cada mensagem deve migrar.
 */

export type IntegrityMessage = {
  id: string;
  channelAccountId: string | null;
  createdAt: Date;
};

export type IntegrityThread = {
  id: string;
  channelAccountId: string | null;
  contactId: string;
  messages: IntegrityMessage[];
};

export type IntegrityRepairPlan = {
  threadId: string;
  keepChannelAccountId: string | null;
  /** Mensagens que precisam de nova thread (outro ChannelAccount). */
  relocate: Array<{
    messageId: string;
    targetChannelAccountId: string;
  }>;
  /** Mensagens sem channelAccountId: herdam o da thread (preenchimento). */
  backfill: Array<{
    messageId: string;
    channelAccountId: string;
  }>;
};

export function planConversationChannelRepair(
  thread: IntegrityThread,
): IntegrityRepairPlan {
  const keepChannelAccountId = thread.channelAccountId;
  const relocate: IntegrityRepairPlan['relocate'] = [];
  const backfill: IntegrityRepairPlan['backfill'] = [];

  for (const message of thread.messages) {
    if (!message.channelAccountId) {
      if (keepChannelAccountId) {
        backfill.push({
          messageId: message.id,
          channelAccountId: keepChannelAccountId,
        });
      }
      continue;
    }

    if (
      keepChannelAccountId &&
      message.channelAccountId !== keepChannelAccountId
    ) {
      relocate.push({
        messageId: message.id,
        targetChannelAccountId: message.channelAccountId,
      });
    }
  }

  return {
    threadId: thread.id,
    keepChannelAccountId,
    relocate,
    backfill,
  };
}

/**
 * Agrupa mensagens pelo channelAccountId para criar/reativar threads
 * separadas por instancia, preservando timestamps das mensagens.
 */
export function groupMessagesByChannelAccount(
  messages: IntegrityMessage[],
): Map<string, IntegrityMessage[]> {
  const groups = new Map<string, IntegrityMessage[]>();
  for (const message of messages) {
    if (!message.channelAccountId) continue;
    const list = groups.get(message.channelAccountId) ?? [];
    list.push(message);
    groups.set(message.channelAccountId, list);
  }
  return groups;
}
