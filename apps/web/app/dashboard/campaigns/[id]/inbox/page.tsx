'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { DashboardShell } from '../../../../../components/dashboard-shell';
import {
  ApiError,
  AuthUser,
  CampaignItem,
  InboxThreadDetail,
  InboxThreadListItem,
  clearStoredToken,
  fetchCampaign,
  fetchInboxThread,
  fetchInboxThreads,
  fetchMe,
  getStoredToken,
  retryInboxMessage,
  sendInboxReply,
} from '../../../../../lib/api';
import { canWriteRole, getOrganizationRole } from '../../../../../lib/roles';

const POLL_INTERVAL_MS = 5000;

type InboxMessage = InboxThreadDetail['messages'][number];

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  if (Number.isNaN(diffMs)) return formatDateTime(value);
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 45) return 'agora';
  if (diffSec < 3600) return `ha ${Math.floor(diffSec / 60)} min`;
  if (diffSec < 86400) return `ha ${Math.floor(diffSec / 3600)} h`;
  return formatDateTime(value);
}

function contactLabel(contact: {
  name: string | null;
  phoneNumber: string | null;
}) {
  return contact.name?.trim() || contact.phoneNumber || 'Contato sem nome';
}

function previewBody(body: string | null | undefined) {
  if (!body?.trim()) return '(sem texto)';
  const trimmed = body.trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
}

function directionLabel(direction: string) {
  return direction === 'OUTBOUND' ? 'Enviada' : 'Recebida';
}

function deliveryStatusLabel(status: string) {
  const normalized = status.toUpperCase();
  if (normalized === 'ERROR' || normalized === 'FAILED') return 'Falhou';
  if (normalized === 'PENDING' || normalized === 'SENDING') return 'Enviando';
  if (normalized === 'SENT' || normalized === 'DELIVERED' || normalized === 'READ') {
    return 'Enviado';
  }
  if (normalized === 'RECEIVED') return 'Recebida';
  return status;
}

function isFailedOutbound(message: InboxMessage) {
  return (
    message.direction === 'OUTBOUND' &&
    ['ERROR', 'FAILED'].includes(message.status.toUpperCase())
  );
}

function optOutBannerText(reason?: 'BLOCKED' | 'OPT_OUT' | null) {
  if (reason === 'BLOCKED') {
    return 'Contato bloqueado. Envio manual desabilitado.';
  }
  return 'Contato com opt-out ativo. Envio manual desabilitado.';
}

function mergeMessagesById(
  current: InboxThreadDetail['messages'],
  incoming: InboxThreadDetail['messages'],
) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    byId.set(message.id, message);
  }
  return [...byId.values()].sort((left, right) => {
    const timeDiff =
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return left.id.localeCompare(right.id);
  });
}

function mergeThreadsById(
  current: InboxThreadListItem[],
  incoming: InboxThreadListItem[],
) {
  const byId = new Map(current.map((thread) => [thread.id, thread]));
  for (const thread of incoming) {
    byId.set(thread.id, thread);
  }

  return [...byId.values()].sort((left, right) => {
    const leftAt = left.lastMessageAt || left.updatedAt;
    const rightAt = right.lastMessageAt || right.updatedAt;
    const timeDiff = new Date(rightAt).getTime() - new Date(leftAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return left.id.localeCompare(right.id);
  });
}

function applyMessageToThreadList(
  current: InboxThreadListItem[],
  threadId: string,
  message: InboxMessage,
  lastMessageAt: string,
) {
  const existing = current.find((thread) => thread.id === threadId);
  if (!existing) return current;
  return mergeThreadsById(current, [
    {
      ...existing,
      lastMessageAt,
      updatedAt: lastMessageAt,
      lastMessage: {
        id: message.id,
        body: message.body,
        direction: message.direction,
        status: message.status,
        createdAt: message.createdAt,
        optOutActive: message.optOutActive,
      },
    },
  ]);
}

function readFailedPayload(error: unknown): {
  message: string;
  failedMessage?: InboxMessage;
  lastMessageAt?: string;
} | null {
  if (!(error instanceof ApiError)) return null;
  const data = error.data as
    | {
        message?: string;
        failedMessage?: InboxMessage;
        thread?: { lastMessageAt?: string };
      }
    | null;
  if (!data) return { message: error.message };
  return {
    message: typeof data.message === 'string' ? data.message : error.message,
    failedMessage: data.failedMessage,
    lastMessageAt: data.thread?.lastMessageAt,
  };
}

export default function CampaignInboxPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const campaignId = params.id;
  const selectedThreadId = searchParams.get('thread');

  const [user, setUser] = useState<AuthUser | null>(null);
  const [campaign, setCampaign] = useState<CampaignItem | null>(null);
  const [threads, setThreads] = useState<InboxThreadListItem[]>([]);
  const [threadDetail, setThreadDetail] = useState<InboxThreadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pollNotice, setPollNotice] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [sending, setSending] = useState(false);
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);

  const selectedThreadIdRef = useRef(selectedThreadId);
  const pollInFlightRef = useRef(false);
  const sendingRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  selectedThreadIdRef.current = selectedThreadId;

  const canWrite = campaign
    ? canWriteRole(getOrganizationRole(user?.memberships, campaign.organizationId))
    : false;

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [threads, selectedThreadId],
  );

  const sendBlocked = Boolean(threadDetail?.contact.optOutActive);
  const instanceDisconnected = Boolean(
    threadDetail?.channelAccount &&
      threadDetail.channelAccount.status !== 'CONNECTED',
  );
  const canCompose =
    canWrite && !sendBlocked && !instanceDisconnected && !sending;

  useEffect(() => {
    async function load() {
      const token = getStoredToken();
      if (!token) {
        router.replace('/login');
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const [me, campaignItem, threadItems] = await Promise.all([
          fetchMe(token),
          fetchCampaign(token, campaignId),
          fetchInboxThreads(token, campaignId),
        ]);
        setUser(me);
        setCampaign(campaignItem);
        setThreads(threadItems);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearStoredToken();
          router.replace('/login');
          return;
        }
        setError(
          err instanceof ApiError ? err.message : 'Nao foi possivel carregar o atendimento',
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [campaignId, router]);

  useEffect(() => {
    async function loadDetail() {
      if (!selectedThreadId) {
        setThreadDetail(null);
        setDetailError(null);
        return;
      }

      const token = getStoredToken();
      if (!token) {
        router.replace('/login');
        return;
      }

      setLoadingDetail(true);
      setDetailError(null);

      try {
        const detail = await fetchInboxThread(token, campaignId, selectedThreadId);
        setThreadDetail(detail);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearStoredToken();
          router.replace('/login');
          return;
        }
        setThreadDetail(null);
        setDetailError(
          err instanceof ApiError ? err.message : 'Nao foi possivel carregar a conversa',
        );
      } finally {
        setLoadingDetail(false);
      }
    }

    loadDetail();
  }, [campaignId, selectedThreadId, router]);

  useEffect(() => {
    if (loading) return;

    let cancelled = false;

    async function pollInbox() {
      if (cancelled || pollInFlightRef.current || sendingRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }

      const token = getStoredToken();
      if (!token) return;

      const activeThreadId = selectedThreadIdRef.current;
      pollInFlightRef.current = true;

      try {
        const threadItems = await fetchInboxThreads(token, campaignId);
        if (cancelled) return;
        setThreads((current) => mergeThreadsById(current, threadItems));

        if (activeThreadId) {
          const detail = await fetchInboxThread(token, campaignId, activeThreadId);
          if (cancelled) return;
          if (selectedThreadIdRef.current !== activeThreadId) return;

          setThreadDetail((current) => {
            if (!current || current.id !== detail.id) {
              return detail;
            }
            return {
              ...detail,
              messages: mergeMessagesById(current.messages, detail.messages),
            };
          });
        }

        setPollNotice(null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          clearStoredToken();
          router.replace('/login');
          return;
        }
        setPollNotice('Atualizacao automatica temporariamente indisponivel');
      } finally {
        pollInFlightRef.current = false;
      }
    }

    const intervalId = window.setInterval(() => {
      void pollInbox();
    }, POLL_INTERVAL_MS);

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        void pollInbox();
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [campaignId, loading, router]);

  useEffect(() => {
    setReplyBody('');
    setSendError(null);
    setSendSuccess(null);
    setRetryingMessageId(null);
  }, [selectedThreadId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [threadDetail?.messages.length, selectedThreadId]);

  function selectThread(threadId: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set('thread', threadId);
    router.replace(`/dashboard/campaigns/${campaignId}/inbox?${next.toString()}`);
  }

  function applySuccessfulSend(result: {
    message: InboxMessage;
    thread: { id: string; lastMessageAt: string };
  }) {
    setThreadDetail((current) => {
      if (!current || current.id !== result.thread.id) return current;
      return {
        ...current,
        lastMessageAt: result.thread.lastMessageAt,
        messages: mergeMessagesById(current.messages, [result.message]),
      };
    });
    setThreads((current) =>
      applyMessageToThreadList(
        current,
        result.thread.id,
        result.message,
        result.thread.lastMessageAt,
      ),
    );
  }

  async function handleSendReply(event?: FormEvent) {
    event?.preventDefault();
    const token = getStoredToken();
    if (!token || !selectedThreadId || !canWrite || sendingRef.current) return;

    const trimmed = replyBody.trim();
    if (!trimmed) {
      setSendError('Informe o texto da mensagem');
      setSendSuccess(null);
      return;
    }

    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    setSendSuccess(null);

    try {
      const result = await sendInboxReply(token, campaignId, selectedThreadId, trimmed);
      applySuccessfulSend(result);
      setReplyBody('');
      setSendSuccess('Mensagem enviada');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearStoredToken();
        router.replace('/login');
        return;
      }

      const failed = readFailedPayload(err);
      if (failed?.failedMessage && selectedThreadId) {
        setThreadDetail((current) => {
          if (!current || current.id !== selectedThreadId) return current;
          return {
            ...current,
            lastMessageAt: failed.lastMessageAt || current.lastMessageAt,
            messages: mergeMessagesById(current.messages, [failed.failedMessage!]),
          };
        });
        if (failed.lastMessageAt) {
          setThreads((current) =>
            applyMessageToThreadList(
              current,
              selectedThreadId,
              failed.failedMessage!,
              failed.lastMessageAt!,
            ),
          );
        }
      }

      setSendError(
        failed?.message ||
          (err instanceof ApiError ? err.message : 'Nao foi possivel enviar a mensagem'),
      );
      setSendSuccess(null);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function handleRetryMessage(messageId: string) {
    const token = getStoredToken();
    if (!token || !selectedThreadId || !canWrite || sendingRef.current) return;

    sendingRef.current = true;
    setRetryingMessageId(messageId);
    setSendError(null);
    setSendSuccess(null);

    try {
      const result = await retryInboxMessage(
        token,
        campaignId,
        selectedThreadId,
        messageId,
      );
      applySuccessfulSend(result);
      setSendSuccess('Mensagem reenviada');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearStoredToken();
        router.replace('/login');
        return;
      }
      setSendError(
        err instanceof ApiError
          ? err.message
          : 'Nao foi possivel reenviar a mensagem',
      );
    } finally {
      sendingRef.current = false;
      setRetryingMessageId(null);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f7f5]">
        <p className="text-[#65655f]">Carregando atendimento...</p>
      </main>
    );
  }

  return (
    <DashboardShell userName={user?.name}>
      <div className="mx-auto max-w-6xl space-y-4">
        <Link className="text-sm text-[#24382b] underline" href={`/dashboard/campaigns/${campaignId}`}>
          Voltar para campanha
        </Link>

        <div>
          <h2 className="text-2xl font-semibold text-[#151515]">Atendimento</h2>
          {campaign ? <p className="mt-2 text-sm text-[#65655f]">{campaign.name}</p> : null}
          <p className="mt-2 text-sm text-[#65655f]">
            Conversas WhatsApp com atualizacao automatica a cada {POLL_INTERVAL_MS / 1000}s.
          </p>
        </div>

        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        {pollNotice ? (
          <p className="text-xs text-[#8a8a82]">{pollNotice}</p>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
          <section className="rounded-md border border-[#deddd4] bg-white">
            <div className="border-b border-[#e8e7df] px-4 py-3">
              <h3 className="text-sm font-medium text-[#24382b]">Conversas</h3>
            </div>
            {threads.length === 0 ? (
              <div className="space-y-2 px-4 py-10 text-center text-sm text-[#65655f]">
                <p className="font-medium text-[#34342f]">Nenhuma conversa ainda</p>
                <p>
                  Assim que uma mensagem chegar pelo WhatsApp, ela aparece nesta lista
                  automaticamente.
                </p>
              </div>
            ) : (
              <ul className="max-h-[70vh] divide-y divide-[#ecebe3] overflow-y-auto">
                {threads.map((thread) => {
                  const active = thread.id === selectedThreadId;
                  return (
                    <li key={thread.id}>
                      <button
                        type="button"
                        className={`w-full px-4 py-3 text-left transition ${
                          active ? 'bg-[#eef2ea]' : 'hover:bg-[#f7f7f5]'
                        }`}
                        onClick={() => selectThread(thread.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium text-[#24382b]">
                            {contactLabel(thread.contact)}
                          </p>
                          <span
                            className="shrink-0 text-[11px] text-[#65655f]"
                            title={formatDateTime(thread.lastMessageAt || thread.updatedAt)}
                          >
                            {formatRelativeTime(thread.lastMessageAt || thread.updatedAt)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-[#65655f]">
                          {thread.channelAccount?.name || thread.channel}
                          {thread.contact.phoneNumber
                            ? ` · ${thread.contact.phoneNumber}`
                            : ''}
                        </p>
                        {thread.channelAccount &&
                        thread.channelAccount.status !== 'CONNECTED' ? (
                          <span className="mt-1 inline-block rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-900">
                            Instancia desconectada
                          </span>
                        ) : null}
                        <p className="mt-1 line-clamp-2 text-sm text-[#34342f]">
                          {thread.lastMessage?.direction === 'OUTBOUND' ? 'Voce: ' : ''}
                          {previewBody(thread.lastMessage?.body)}
                        </p>
                        {thread.contact.optOutActive ? (
                          <span className="mt-2 inline-block rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-900">
                            {thread.contact.optOutReason === 'BLOCKED'
                              ? 'Bloqueado'
                              : 'Opt-out'}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="min-h-[420px] rounded-md border border-[#deddd4] bg-white">
            {!selectedThreadId ? (
              <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-2 px-6 text-center text-sm text-[#65655f]">
                <p className="font-medium text-[#34342f]">Selecione uma conversa</p>
                <p>Escolha um contato a esquerda para ver o historico e responder.</p>
              </div>
            ) : loadingDetail ? (
              <div className="flex h-full min-h-[420px] items-center justify-center text-sm text-[#65655f]">
                Carregando conversa...
              </div>
            ) : detailError ? (
              <div className="space-y-2 px-4 py-6">
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {detailError}
                </p>
              </div>
            ) : threadDetail ? (
              <div className="flex h-full min-h-[420px] flex-col">
                <div className="border-b border-[#e8e7df] px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium text-[#24382b]">
                        {contactLabel(threadDetail.contact)}
                      </h3>
                      <p className="mt-1 text-xs text-[#65655f]">
                        {threadDetail.contact.phoneNumber || 'Sem telefone'}
                        {threadDetail.channelAccount
                          ? ` · Canal: ${threadDetail.channelAccount.name}`
                          : ` · ${threadDetail.channel}`}
                      </p>
                      <p className="mt-1 text-xs text-[#65655f]">
                        Status da conversa: {threadDetail.status}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {threadDetail.channelAccount &&
                      threadDetail.channelAccount.status !== 'CONNECTED' ? (
                        <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                          Instancia desconectada
                        </span>
                      ) : null}
                      {threadDetail.contact.optOutActive ? (
                        <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                          {threadDetail.contact.optOutReason === 'BLOCKED'
                            ? 'Bloqueado'
                            : 'Opt-out ativo'}
                        </span>
                      ) : null}
                      {threadDetail.channelAccountId ? (
                        <Link
                          className="rounded-md border border-[#c9c8c0] px-2 py-1 text-xs font-medium text-[#24382b]"
                          href={`/dashboard/campaigns/${campaignId}/channels`}
                        >
                          Reconectar instancia
                        </Link>
                      ) : null}
                      <Link
                        className="rounded-md border border-[#c9c8c0] px-2 py-1 text-xs font-medium text-[#24382b]"
                        href={`/dashboard/campaigns/${campaignId}/contacts/${threadDetail.contact.id}`}
                      >
                        Ver contato
                      </Link>
                    </div>
                  </div>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto bg-[#fafaf8] px-4 py-4">
                  {threadDetail.messages.length === 0 ? (
                    <div className="rounded-md border border-dashed border-[#d7d6cd] bg-white px-4 py-8 text-center text-sm text-[#65655f]">
                      <p className="font-medium text-[#34342f]">Sem mensagens nesta conversa</p>
                      <p className="mt-1">
                        O historico aparece aqui quando houver mensagens recebidas ou enviadas.
                      </p>
                    </div>
                  ) : (
                    threadDetail.messages.map((message) => {
                      const inbound = message.direction !== 'OUTBOUND';
                      const failed = isFailedOutbound(message);
                      return (
                        <div
                          key={message.id}
                          className={`max-w-[85%] rounded-md border px-3 py-2 text-sm shadow-sm ${
                            inbound
                              ? 'mr-auto border-[#deddd4] bg-white text-[#24382b]'
                              : failed
                                ? 'ml-auto border-red-200 bg-red-50 text-[#24382b]'
                                : 'ml-auto border-[#cfe0d1] bg-[#e7f0e4] text-[#24382b]'
                          }`}
                        >
                          <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-[#65655f]">
                            <span className="font-medium">
                              {inbound ? 'Recebida' : 'Enviada'}
                            </span>
                            <span>·</span>
                            <span title={formatDateTime(message.createdAt)}>
                              {formatRelativeTime(message.createdAt)}
                            </span>
                            <span>·</span>
                            <span>{deliveryStatusLabel(message.status)}</span>
                            {message.optOutActive ? (
                              <>
                                <span>·</span>
                                <span className="text-amber-800">opt-out no recebimento</span>
                              </>
                            ) : null}
                          </div>
                          <p className="whitespace-pre-wrap">
                            {message.body?.trim() || '(mensagem sem texto)'}
                          </p>
                          {failed && canWrite && !sendBlocked ? (
                            <button
                              type="button"
                              className="mt-2 text-xs font-medium text-[#8a2f2f] underline disabled:opacity-60"
                              disabled={retryingMessageId === message.id || sending}
                              onClick={() => void handleRetryMessage(message.id)}
                            >
                              {retryingMessageId === message.id
                                ? 'Reenviando...'
                                : 'Tentar reenviar'}
                            </button>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <div className="space-y-3 border-t border-[#e8e7df] px-4 py-3">
                  {sendBlocked ? (
                    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      {optOutBannerText(threadDetail.contact.optOutReason)}
                    </p>
                  ) : null}

                  {instanceDisconnected ? (
                    <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      <p>
                        A instancia desta conversa esta desconectada. Reconecte-a
                        para responder. O envio nao sera redirecionado para outra
                        instancia.
                      </p>
                      {threadDetail.channelAccountId ? (
                        <Link
                          className="inline-block font-medium underline"
                          href={`/dashboard/campaigns/${campaignId}/channels`}
                        >
                          Abrir / reconectar instancia
                        </Link>
                      ) : null}
                    </div>
                  ) : null}

                  {canWrite && !sendBlocked ? (
                    <form className="space-y-2" onSubmit={(event) => void handleSendReply(event)}>
                      <label className="block">
                        <span className="text-sm font-medium text-[#34342f]">Resposta manual</span>
                        <textarea
                          className="mt-1 min-h-[88px] w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2 text-sm disabled:bg-[#f3f3f0]"
                          value={replyBody}
                          onChange={(event) => {
                            setReplyBody(event.target.value);
                            setSendError(null);
                            setSendSuccess(null);
                          }}
                          placeholder="Escreva a mensagem para enviar pelo WhatsApp"
                          maxLength={4000}
                          disabled={sending || instanceDisconnected}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                              event.preventDefault();
                              if (!instanceDisconnected) void handleSendReply();
                            }
                          }}
                        />
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="submit"
                          className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={!canCompose || !replyBody.trim()}
                        >
                          {sending ? 'Enviando...' : 'Enviar'}
                        </button>
                        {sending ? (
                          <span className="text-xs text-[#65655f]">Enviando mensagem...</span>
                        ) : null}
                        {!sending && sendSuccess ? (
                          <span className="text-xs text-[#47624f]">{sendSuccess}</span>
                        ) : null}
                      </div>
                      {sendError ? (
                        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                          {sendError}
                        </p>
                      ) : null}
                    </form>
                  ) : null}

                  {canWrite && instanceDisconnected && replyBody.trim() ? (
                    <p className="text-xs text-[#65655f]">
                      Texto preservado. Apos reconectar a instancia, voce podera
                      enviar nesta mesma conversa.
                    </p>
                  ) : null}

                  {!canWrite ? (
                    <p className="text-xs text-[#65655f]">
                      Seu perfil possui acesso somente leitura neste atendimento.
                    </p>
                  ) : null}

                  {selectedThread?.lastMessage ? (
                    <p className="text-xs text-[#65655f]">
                      Ultima mensagem: {formatDateTime(selectedThread.lastMessage.createdAt)} (
                      {directionLabel(selectedThread.lastMessage.direction)})
                    </p>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-2 px-6 text-center text-sm text-[#65655f]">
                <p className="font-medium text-[#34342f]">Conversa nao encontrada</p>
                <p>Selecione outra conversa na lista ou aguarde novas mensagens.</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </DashboardShell>
  );
}
