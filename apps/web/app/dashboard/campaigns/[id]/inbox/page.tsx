'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
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
} from '../../../../../lib/api';

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('pt-BR');
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

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [threads, selectedThreadId],
  );

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

  function selectThread(threadId: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set('thread', threadId);
    router.replace(`/dashboard/campaigns/${campaignId}/inbox?${next.toString()}`);
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
            Conversas recebidas via WhatsApp. Envio de respostas ainda nao esta disponivel nesta
            etapa.
          </p>
        </div>

        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
          <section className="rounded-md border border-[#deddd4] bg-white">
            <div className="border-b border-[#e8e7df] px-4 py-3">
              <h3 className="text-sm font-medium text-[#24382b]">Conversas</h3>
            </div>
            {threads.length === 0 ? (
              <div className="space-y-2 px-4 py-8 text-sm text-[#65655f]">
                <p>Nenhuma conversa nesta campanha ainda.</p>
                <p>
                  Quando uma mensagem chegar pelo webhook Evolution, ela aparece aqui
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
                          <span className="shrink-0 text-[11px] text-[#65655f]">
                            {formatDateTime(thread.lastMessageAt || thread.updatedAt)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-[#65655f]">
                          {thread.channelAccount?.name || thread.channel}
                          {thread.contact.phoneNumber
                            ? ` · ${thread.contact.phoneNumber}`
                            : ''}
                        </p>
                        <p className="mt-1 line-clamp-2 text-sm text-[#34342f]">
                          {previewBody(thread.lastMessage?.body)}
                        </p>
                        {thread.contact.optOutActive ? (
                          <span className="mt-2 inline-block rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-900">
                            Opt-out ativo
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
              <div className="flex h-full min-h-[420px] items-center justify-center px-6 text-center text-sm text-[#65655f]">
                Selecione uma conversa para ver o historico de mensagens.
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
                      {threadDetail.contact.optOutActive ? (
                        <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                          Opt-out ativo
                        </span>
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
                    <p className="text-sm text-[#65655f]">
                      Esta conversa ainda nao possui mensagens registradas.
                    </p>
                  ) : (
                    threadDetail.messages.map((message) => {
                      const inbound = message.direction !== 'OUTBOUND';
                      return (
                        <div
                          key={message.id}
                          className={`max-w-[85%] rounded-md border px-3 py-2 text-sm ${
                            inbound
                              ? 'mr-auto border-[#deddd4] bg-white text-[#24382b]'
                              : 'ml-auto border-[#d7e5d8] bg-[#eef2ea] text-[#24382b]'
                          }`}
                        >
                          <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-[#65655f]">
                            <span>{directionLabel(message.direction)}</span>
                            <span>·</span>
                            <span>{formatDateTime(message.createdAt)}</span>
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
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="border-t border-[#e8e7df] px-4 py-3 text-xs text-[#65655f]">
                  Resposta manual fica para a proxima etapa. Nesta tela voce apenas visualiza o
                  historico.
                  {selectedThread?.lastMessage ? (
                    <span className="mt-1 block">
                      Ultima mensagem listada: {formatDateTime(selectedThread.lastMessage.createdAt)}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[420px] items-center justify-center px-6 text-sm text-[#65655f]">
                Conversa nao encontrada.
              </div>
            )}
          </section>
        </div>
      </div>
    </DashboardShell>
  );
}
