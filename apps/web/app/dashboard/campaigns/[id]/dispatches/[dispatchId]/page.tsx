'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DashboardShell } from '../../../../../../components/dashboard-shell';
import {
  ApiError,
  AuthUser,
  CampaignItem,
  DispatchDetail,
  DispatchItemListEntry,
  clearStoredToken,
  fetchCampaign,
  fetchDispatch,
  fetchDispatchItems,
  fetchMe,
  getStoredToken,
  prepareDispatch,
} from '../../../../../../lib/api';
import {
  formatDurationSeconds,
  formatZonedDateTime,
} from '../../../../../../lib/dispatch-plans';
import {
  getDispatchItemStatusLabel,
  getDispatchProgressSteps,
  getDispatchStatusBadgeClass,
  getDispatchStatusLabel,
} from '../../../../../../lib/dispatches';
import { canApproveRole, getOrganizationRole } from '../../../../../../lib/roles';

export default function DispatchDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string; dispatchId: string }>();
  const campaignId = params.id;
  const dispatchId = params.dispatchId;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [campaign, setCampaign] = useState<CampaignItem | null>(null);
  const [dispatch, setDispatch] = useState<DispatchDetail | null>(null);
  const [items, setItems] = useState<DispatchItemListEntry[]>([]);
  const [itemsTotal, setItemsTotal] = useState(0);
  const [itemPage, setItemPage] = useState(1);
  const [itemStatus, setItemStatus] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [showPrepareConfirm, setShowPrepareConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canApprove = campaign
    ? canApproveRole(
        getOrganizationRole(user?.memberships, campaign.organizationId),
      )
    : false;

  const loadItems = useCallback(
    async (token: string, page = 1) => {
      const listed = await fetchDispatchItems(token, campaignId, dispatchId, {
        page,
        limit: 20,
        status: itemStatus || undefined,
        search: itemSearch.trim() || undefined,
      });
      setItems(listed.items);
      setItemsTotal(listed.pagination.total);
      setItemPage(listed.pagination.page);
    },
    [campaignId, dispatchId, itemSearch, itemStatus],
  );

  const reload = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      router.replace('/login');
      return;
    }
    const [me, campaignItem, dispatchItem] = await Promise.all([
      fetchMe(token),
      fetchCampaign(token, campaignId),
      fetchDispatch(token, campaignId, dispatchId),
    ]);
    setUser(me);
    setCampaign(campaignItem);
    setDispatch(dispatchItem);
    if (dispatchItem.totalItems > 0 || dispatchItem.status === 'READY') {
      await loadItems(token);
    } else {
      setItems([]);
      setItemsTotal(0);
    }
  }, [campaignId, dispatchId, loadItems, router]);

  useEffect(() => {
    async function load() {
      try {
        await reload();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearStoredToken();
          router.replace('/login');
          return;
        }
        setError(
          err instanceof ApiError
            ? err.message
            : 'Nao foi possivel carregar o disparo',
        );
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [reload, router]);

  useEffect(() => {
    async function refreshItems() {
      if (!dispatch || (dispatch.totalItems === 0 && dispatch.status !== 'READY')) {
        return;
      }
      const token = getStoredToken();
      if (!token) return;
      try {
        await loadItems(token, 1);
      } catch {
        // mantem listagem anterior
      }
    }
    refreshItems();
  }, [dispatch, itemSearch, itemStatus, loadItems]);

  async function onPrepare() {
    const token = getStoredToken();
    if (!token) return;
    setPreparing(true);
    setError(null);
    setSuccess(null);
    try {
      await prepareDispatch(token, campaignId, dispatchId);
      setShowPrepareConfirm(false);
      setSuccess('Destinatarios preparados com sucesso.');
      await reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(err.message || 'Preparacao ja realizada ou em andamento.');
        setShowPrepareConfirm(false);
        await reload();
      } else {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Nao foi possivel preparar os destinatarios',
        );
      }
    } finally {
      setPreparing(false);
    }
  }

  const configuration = dispatch?.configurationSnapshot;
  const content = dispatch?.contentSnapshot;
  const timezone = configuration?.timezone ?? 'America/Sao_Paulo';
  const progress = dispatch
    ? getDispatchProgressSteps(dispatch.status)
    : [];
  const canPrepareAction =
    canApprove && (dispatch?.allowedActions?.canPrepare ?? false);

  return (
    <DashboardShell userName={user?.name}>
      <div className="rounded-md border border-[#deddd4] bg-[#f7f6f1] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-[#65655f]">
              Etapa 09.2 — materializacao de items
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-[#151515]">
              {dispatch?.name ?? 'Disparo'}
            </h2>
            {campaign ? (
              <p className="mt-1 text-sm text-[#65655f]">{campaign.name}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm font-medium text-[#24382b]"
              href={`/dashboard/campaigns/${campaignId}/dispatches`}
            >
              Voltar aos disparos
            </Link>
            {dispatch ? (
              <Link
                className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm font-medium text-[#24382b]"
                href={`/dashboard/campaigns/${campaignId}/dispatch-plans/${dispatch.dispatchPlanId}`}
              >
                Ver plano de origem
              </Link>
            ) : null}
          </div>
        </div>

        {loading ? (
          <p className="mt-6 text-sm text-[#65655f]">Carregando disparo...</p>
        ) : null}
        {error ? (
          <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="mt-6 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            {success}
          </p>
        ) : null}

        {dispatch ? (
          <div className="mt-6 space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`rounded-md border px-2 py-1 text-xs font-medium ${getDispatchStatusBadgeClass(dispatch.status)}`}
              >
                {getDispatchStatusLabel(dispatch.status)}
              </span>
              <p className="text-sm text-[#65655f]">
                Criado em{' '}
                {new Date(dispatch.createdAt).toLocaleString('pt-BR')} por{' '}
                {dispatch.createdBy.name}
              </p>
            </div>

            <section className="rounded-md border border-[#deddd4] bg-white p-4">
              <h3 className="font-semibold text-[#151515]">Progresso</h3>
              <ol className="mt-3 flex flex-wrap gap-2">
                {progress.map((step) => (
                  <li
                    key={step.id}
                    className={`rounded-md border px-3 py-2 text-xs font-medium ${
                      step.state === 'done'
                        ? 'border-green-200 bg-green-50 text-green-800'
                        : step.state === 'current'
                          ? 'border-[#c9d7ee] bg-[#eef4fc] text-[#1e3a5f]'
                          : 'border-[#deddd4] bg-[#f7f6f1] text-[#65655f]'
                    }`}
                  >
                    {step.label}
                    {step.state === 'done'
                      ? ' · concluida'
                      : step.state === 'current'
                        ? ' · em andamento'
                        : ' · pendente'}
                  </li>
                ))}
              </ol>
            </section>

            {dispatch.status === 'DRAFT' ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Este Disparo ainda nao possui destinatarios materializados.
                {canPrepareAction
                  ? ' Use Preparar destinatarios para materializar o publico aprovado.'
                  : ' Apenas OWNER/ADMIN podem preparar.'}
              </div>
            ) : null}

            {dispatch.status === 'PREPARING' ? (
              <div className="rounded-md border border-[#c9d7ee] bg-[#eef4fc] px-4 py-3 text-sm text-[#1e3a5f]">
                Preparacao em andamento. Aguarde a conclusao antes de nova acao.
              </div>
            ) : null}

            {dispatch.status === 'READY' ? (
              <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
                Os destinatarios estao preparados. O enfileiramento sera
                implementado na subetapa 09.3.
                <p className="mt-2">
                  Publico aprovado: {dispatch.approvedAudience.totalEligible} ·
                  Items preparados: {dispatch.totalItems} · Pendentes:{' '}
                  {dispatch.pendingItems}
                  {dispatch.preparedAt
                    ? ` · Preparado em ${new Date(dispatch.preparedAt).toLocaleString('pt-BR')}`
                    : ''}
                </p>
              </div>
            ) : null}

            {canPrepareAction ? (
              <div>
                <button
                  type="button"
                  className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  disabled={preparing || dispatch.status === 'PREPARING'}
                  onClick={() => setShowPrepareConfirm(true)}
                >
                  Preparar destinatarios
                </button>
              </div>
            ) : null}

            {showPrepareConfirm ? (
              <div className="rounded-md border border-[#24382b] bg-white p-4">
                <h4 className="font-semibold text-[#151515]">
                  Confirmar preparacao
                </h4>
                <p className="mt-2 text-sm text-[#24382b]">
                  Os contatos elegiveis do Plano aprovado serao materializados
                  como itens individuais e imutaveis deste Disparo. Nenhuma
                  mensagem sera enviada nesta etapa.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    disabled={preparing}
                    onClick={onPrepare}
                  >
                    {preparing ? 'Preparando...' : 'Confirmar preparacao'}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm"
                    disabled={preparing}
                    onClick={() => setShowPrepareConfirm(false)}
                  >
                    Voltar
                  </button>
                </div>
              </div>
            ) : null}

            {dispatch.description ? (
              <p className="text-sm text-[#24382b]">{dispatch.description}</p>
            ) : null}

            <section className="rounded-md border border-[#deddd4] bg-white p-4">
              <h3 className="font-semibold text-[#151515]">Origem</h3>
              <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-[#65655f]">Plano</dt>
                  <dd>{dispatch.dispatchPlan.name}</dd>
                </div>
                <div>
                  <dt className="text-[#65655f]">Campanha</dt>
                  <dd>{campaign?.name ?? campaignId}</dd>
                </div>
                <div>
                  <dt className="text-[#65655f]">Canal</dt>
                  <dd>
                    {dispatch.channelAccount.name} ·{' '}
                    {dispatch.channelAccount.status}
                  </dd>
                </div>
                <div>
                  <dt className="text-[#65655f]">Publico aprovado</dt>
                  <dd>
                    {dispatch.approvedAudience.totalEligible} elegiveis ·{' '}
                    {dispatch.approvedAudience.totalExcluded} excluidos
                  </dd>
                </div>
              </dl>
            </section>

            <section className="rounded-md border border-[#deddd4] bg-white p-4">
              <h3 className="font-semibold text-[#151515]">Conteudo aprovado</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm text-[#24382b]">
                {content?.body}
              </p>
              <p className="mt-2 text-xs text-[#65655f]">
                Hash: {content?.hash.slice(0, 12)}… · versao{' '}
                {content?.approvedVersion} · {content?.length} caracteres
              </p>
            </section>

            <section className="rounded-md border border-[#deddd4] bg-white p-4">
              <h3 className="font-semibold text-[#151515]">Configuracao</h3>
              <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-[#65655f]">Velocidade</dt>
                  <dd>
                    solicitada {configuration?.requestedMessagesPerMinute ?? '—'}{' '}
                    · efetiva{' '}
                    {configuration?.effectiveMessagesPerMinute ?? '—'} msg/min
                  </dd>
                </div>
                <div>
                  <dt className="text-[#65655f]">Lotes</dt>
                  <dd>
                    {configuration?.totalBatches ?? '—'} lotes · tamanho{' '}
                    {configuration?.batchSize ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[#65655f]">Inicio estimado</dt>
                  <dd>
                    {configuration?.estimatedStartAt
                      ? formatZonedDateTime(
                          configuration.estimatedStartAt,
                          timezone,
                        )
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[#65655f]">Duracao estimada</dt>
                  <dd>
                    {configuration?.estimatedCalendarDurationSeconds != null
                      ? formatDurationSeconds(
                          configuration.estimatedCalendarDurationSeconds,
                        )
                      : '—'}
                  </dd>
                </div>
              </dl>
            </section>

            {(dispatch.status === 'READY' || dispatch.totalItems > 0) && (
              <section className="rounded-md border border-[#deddd4] bg-white p-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-[#151515]">
                      Destinatarios materializados
                    </h3>
                    <p className="mt-1 text-sm text-[#65655f]">
                      {itemsTotal} item(ns)
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input
                      className="rounded-md border border-[#c9c8c0] px-3 py-2 text-sm"
                      placeholder="Buscar nome ou destino"
                      value={itemSearch}
                      onChange={(event) => setItemSearch(event.target.value)}
                    />
                    <select
                      className="rounded-md border border-[#c9c8c0] px-3 py-2 text-sm"
                      value={itemStatus}
                      onChange={(event) => setItemStatus(event.target.value)}
                    >
                      <option value="">Todos</option>
                      <option value="PENDING">Pendente</option>
                      <option value="QUEUED">Enfileirado</option>
                      <option value="SENT">Enviado</option>
                      <option value="FAILED">Falhou</option>
                    </select>
                  </div>
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-[#deddd4] text-[#65655f]">
                      <tr>
                        <th className="px-2 py-2 font-medium">Contato</th>
                        <th className="px-2 py-2 font-medium">Destino</th>
                        <th className="px-2 py-2 font-medium">Status</th>
                        <th className="px-2 py-2 font-medium">Tentativas</th>
                        <th className="px-2 py-2 font-medium">Criacao</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr
                          key={item.id}
                          className="border-b border-[#f0efe8] text-[#24382b]"
                        >
                          <td className="px-2 py-2">
                            {item.contactName ?? '—'}
                          </td>
                          <td className="px-2 py-2 font-mono text-xs">
                            {item.destinationMasked}
                          </td>
                          <td className="px-2 py-2">
                            {getDispatchItemStatusLabel(item.status)}
                          </td>
                          <td className="px-2 py-2">
                            {item.attemptCount}/{item.maxAttempts}
                          </td>
                          <td className="px-2 py-2 text-xs">
                            {new Date(item.createdAt).toLocaleString('pt-BR')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {itemsTotal > 20 ? (
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-[#c9c8c0] px-3 py-1 text-xs disabled:opacity-50"
                      disabled={itemPage <= 1}
                      onClick={async () => {
                        const token = getStoredToken();
                        if (!token) return;
                        await loadItems(token, itemPage - 1);
                      }}
                    >
                      Anterior
                    </button>
                    <span className="text-xs text-[#65655f]">
                      Pagina {itemPage}
                    </span>
                    <button
                      type="button"
                      className="rounded-md border border-[#c9c8c0] px-3 py-1 text-xs disabled:opacity-50"
                      disabled={itemPage * 20 >= itemsTotal}
                      onClick={async () => {
                        const token = getStoredToken();
                        if (!token) return;
                        await loadItems(token, itemPage + 1);
                      }}
                    >
                      Proxima
                    </button>
                  </div>
                ) : null}
              </section>
            )}

            <section className="rounded-md border border-[#deddd4] bg-white p-4">
              <h3 className="font-semibold text-[#151515]">Proximas etapas</h3>
              <p className="mt-2 text-sm text-[#65655f]">
                Enfileirar e iniciar permanecem indisponiveis ate a subetapa
                09.3+.
              </p>
              <button
                type="button"
                className="mt-3 rounded-md border border-[#c9c8c0] px-4 py-2 text-sm text-[#65655f]"
                disabled
              >
                Enfileirar (indisponivel)
              </button>
            </section>
          </div>
        ) : null}
      </div>
    </DashboardShell>
  );
}
