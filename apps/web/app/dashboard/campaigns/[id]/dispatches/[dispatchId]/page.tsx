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
  QueueDispatchResponse,
  StartDispatchResponse,
  clearStoredToken,
  fetchCampaign,
  fetchDispatch,
  fetchDispatchItem,
  fetchDispatchItems,
  fetchMe,
  getStoredToken,
  prepareDispatch,
  queueDispatch,
  redistributeDispatch,
  reconcileDispatchQueue,
  startDispatch,
} from '../../../../../../lib/api';
import {
  formatDurationSeconds,
  formatZonedDateTime,
  getDispatchChannelOperationalStatusLabel,
} from '../../../../../../lib/dispatch-plans';
import {
  getDispatchItemDiagnosticNote,
  getDispatchItemErrorCategoryLabel,
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
  const [redistributing, setRedistributing] = useState(false);
  const [queuing, setQueuing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [showPrepareConfirm, setShowPrepareConfirm] = useState(false);
  const [showQueueConfirm, setShowQueueConfirm] = useState(false);
  const [showStartConfirm, setShowStartConfirm] = useState(false);
  const [queueResult, setQueueResult] = useState<QueueDispatchResponse | null>(
    null,
  );
  const [startResult, setStartResult] = useState<StartDispatchResponse | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] =
    useState<DispatchItemListEntry | null>(null);
  const [itemDetailLoading, setItemDetailLoading] = useState(false);

  const openItemDetails = async (item: DispatchItemListEntry) => {
    setSelectedItem(item);
    setItemDetailLoading(true);
    try {
      const token = getStoredToken();
      if (!token) return;
      const detail = await fetchDispatchItem(
        token,
        campaignId,
        dispatchId,
        item.id,
      );
      setSelectedItem(detail);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Nao foi possivel carregar o detalhe do item.',
      );
    } finally {
      setItemDetailLoading(false);
    }
  };

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

  async function onRedistribute() {
    const token = getStoredToken();
    if (!token) return;
    setRedistributing(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await redistributeDispatch(token, campaignId, dispatchId);
      setDispatch(updated);
      setSuccess('Redistribuicao concluida.');
      await reload();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Nao foi possivel redistribuir os itens',
      );
    } finally {
      setRedistributing(false);
    }
  }

  async function onReconcileQueue() {
    const token = getStoredToken();
    if (!token) return;
    setReconciling(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await reconcileDispatchQueue(
        token,
        campaignId,
        dispatchId,
      );
      setSuccess(
        `Fila republicada: ${result.itemsRequeued} job(s), ${result.itemsUnlocked} lock(s) liberado(s).`,
      );
      await reload();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Nao foi possivel republicar a fila',
      );
    } finally {
      setReconciling(false);
    }
  }

  async function onStart() {
    const token = getStoredToken();
    if (!token) return;
    setStarting(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await startDispatch(token, campaignId, dispatchId);
      setStartResult(result);
      setShowStartConfirm(false);
      setSuccess(
        `Execucao iniciada: ${result.jobsRepublished} job(s) republicado(s) de ${result.itemsEligible} item(ns) elegivel(is).`,
      );
      await reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(err.message || 'Inicio ja realizado ou em andamento.');
        setShowStartConfirm(false);
        await reload();
      } else {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Nao foi possivel iniciar o envio real',
        );
      }
    } finally {
      setStarting(false);
    }
  }

  async function onQueue() {
    const token = getStoredToken();
    if (!token) return;
    setQueuing(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await queueDispatch(token, campaignId, dispatchId);
      setQueueResult(result);
      setShowQueueConfirm(false);
      setSuccess(
        `Fila criada: ${result.jobsCreated} job(s), ${result.itemsReassigned} realocado(s), ${result.itemsDeferred} adiado(s).`,
      );
      await reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(err.message || 'Enfileiramento ja em andamento ou concluido.');
        setShowQueueConfirm(false);
        await reload();
      } else {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Nao foi possivel enfileirar os destinatarios',
        );
      }
    } finally {
      setQueuing(false);
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
  const canQueueAction =
    canApprove && (dispatch?.allowedActions?.canQueue ?? false);
  const canStartAction =
    canApprove && (dispatch?.allowedActions?.canStart ?? false);

  return (
    <DashboardShell userName={user?.name}>
      <div className="rounded-md border border-[#deddd4] bg-[#f7f6f1] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-[#65655f]">
              Etapa 09.4 — envio real (Worker + Evolution)
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

            {dispatch.requiringRedistribution ? (
              <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
                <p className="font-semibold">Redistribuicao necessaria</p>
                <p className="mt-1">
                  Este Disparo precisa ser redistribuido entre as instancias antes
                  de enfileirar. O enfileiramento permanece bloqueado ate a
                  redistribuicao.
                </p>
                {canApprove ? (
                  <button
                    type="button"
                    className="mt-3 rounded-md bg-red-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    disabled={redistributing}
                    onClick={onRedistribute}
                  >
                    {redistributing ? 'Redistribuindo...' : 'Redistribuir'}
                  </button>
                ) : null}
              </div>
            ) : null}

            {dispatch.multiInstance ? (
              <p className="text-sm text-[#65655f]">
                Modo multi-instancia ativo
                {dispatch.channels?.length
                  ? ` · ${dispatch.channels.length} canal(is) no pool`
                  : ''}
              </p>
            ) : null}

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
                Os destinatarios estao preparados e prontos para a fila operacional.
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

            {dispatch.status === 'QUEUED' ? (
              <div className="rounded-md border border-[#c9d7ee] bg-[#eef4fc] px-4 py-3 text-sm text-[#1e3a5f]">
                <p className="font-semibold">Fila operacional criada</p>
                <p className="mt-1">
                  A fila foi validada tecnicamente. Use Iniciar envio para
                  disparar o envio real via Evolution (respeitando os limites
                  do modo piloto quando habilitado).
                </p>
                <p className="mt-2">
                  Enfileirados: {dispatch.queuedItems} · Pendentes:{' '}
                  {dispatch.pendingItems}
                  {dispatch.queuedAt
                    ? ` · Enfileirado em ${new Date(dispatch.queuedAt).toLocaleString('pt-BR')}`
                    : ''}
                </p>
                {queueResult ? (
                  <p className="mt-2 text-xs">
                    Jobs: {queueResult.jobsCreated} · Realocados:{' '}
                    {queueResult.itemsReassigned} · Adiados:{' '}
                    {queueResult.itemsDeferred} · Bloqueados:{' '}
                    {queueResult.itemsBlocked} · Fila: {queueResult.queueName}
                  </p>
                ) : null}
              </div>
            ) : null}

            {dispatch.status === 'RUNNING' ? (
              <div className="rounded-md border border-[#1e3a5f] bg-[#eef4fc] px-4 py-3 text-sm text-[#1e3a5f]">
                <p className="font-semibold">Envio real em execucao</p>
                <p className="mt-1">
                  O Worker processa os itens elegiveis. Se ficar parado em
                  Enfileirado com 0 enviados, confira no EasyPanel se o{' '}
                  <strong>Worker</strong> tem{' '}
                  <code>DISPATCH_SEND_ENABLED=true</code> (alem da API) e use
                  Republicar fila.
                </p>
                <p className="mt-2">
                  Enviados: {dispatch.sentItems} · Falhas: {dispatch.failedItems}{' '}
                  · Ignorados: {dispatch.skippedItems} · Enfileirados:{' '}
                  {dispatch.queuedItems}
                  {dispatch.startedAt
                    ? ` · Iniciado em ${new Date(dispatch.startedAt).toLocaleString('pt-BR')}`
                    : ''}
                </p>
                {startResult ? (
                  <p className="mt-2 text-xs">
                    Jobs republicados: {startResult.jobsRepublished} · Items
                    elegiveis: {startResult.itemsEligible}
                  </p>
                ) : null}
                {canApprove ? (
                  <button
                    type="button"
                    className="mt-3 rounded-md border border-[#1e3a5f] bg-white px-3 py-1.5 text-xs font-semibold text-[#1e3a5f] disabled:opacity-60"
                    disabled={reconciling}
                    onClick={() => void onReconcileQueue()}
                  >
                    {reconciling ? 'Republicando...' : 'Republicar fila'}
                  </button>
                ) : null}
              </div>
            ) : null}

            {(dispatch.status === 'COMPLETED' ||
              dispatch.status === 'COMPLETED_WITH_ERRORS') ? (
              <div
                className={`rounded-md border px-4 py-3 text-sm ${
                  dispatch.status === 'COMPLETED'
                    ? 'border-green-200 bg-green-50 text-green-900'
                    : 'border-amber-200 bg-amber-50 text-amber-900'
                }`}
              >
                <p className="font-semibold">
                  {dispatch.status === 'COMPLETED'
                    ? 'Envio concluido com sucesso'
                    : 'Envio concluido com erros'}
                </p>
                <p className="mt-2">
                  Enviados: {dispatch.sentItems} · Falhas: {dispatch.failedItems}{' '}
                  · Ignorados: {dispatch.skippedItems}
                  {dispatch.completedAt
                    ? ` · Concluido em ${new Date(dispatch.completedAt).toLocaleString('pt-BR')}`
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

            {canQueueAction ? (
              <div>
                <button
                  type="button"
                  className="rounded-md bg-[#1e3a5f] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  disabled={queuing}
                  onClick={() => setShowQueueConfirm(true)}
                >
                  {queuing ? 'Enfileirando...' : 'Enfileirar destinatarios'}
                </button>
              </div>
            ) : null}

            {canStartAction ? (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="rounded-md bg-[#7a2e2e] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  disabled={starting}
                  onClick={() => setShowStartConfirm(true)}
                >
                  {starting ? 'Iniciando...' : 'Iniciar execucao'}
                </button>
                <span
                  className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900"
                  title="Modo piloto ativo por padrao (DISPATCH_PILOT_MODE): volume e destinos podem estar limitados pelo backend."
                >
                  Modo piloto
                </span>
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

            {showQueueConfirm ? (
              <div className="rounded-md border border-[#1e3a5f] bg-white p-4">
                <h4 className="font-semibold text-[#151515]">
                  Confirmar enfileiramento
                </h4>
                <p className="mt-2 text-sm text-[#24382b]">
                  Os destinatarios preparados serao adicionados a fila
                  operacional. Nesta etapa nenhuma mensagem sera enviada.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-md bg-[#1e3a5f] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    disabled={queuing}
                    onClick={onQueue}
                  >
                    {queuing ? 'Enfileirando...' : 'Confirmar enfileiramento'}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm"
                    disabled={queuing}
                    onClick={() => setShowQueueConfirm(false)}
                  >
                    Voltar
                  </button>
                </div>
              </div>
            ) : null}

            {showStartConfirm ? (
              <div className="rounded-md border border-[#7a2e2e] bg-white p-4">
                <h4 className="font-semibold text-[#151515]">
                  Confirmar inicio da execucao
                </h4>
                <p className="mt-2 text-sm text-[#24382b]">
                  Esta acao iniciara envios reais pelo WhatsApp usando as
                  instancias aprovadas. Confirme somente se os destinatarios
                  sao internos/autorizados e se o piloto foi validado.
                </p>
                <p className="mt-2 text-xs text-[#65655f]">
                  Destinatarios: {dispatch.queuedItems} · Instancias:{' '}
                  {dispatch.channels?.length ?? 1} · Status: {dispatch.status}
                  {dispatch.queuedAt
                    ? ` · Enfileirado em ${new Date(dispatch.queuedAt).toLocaleString('pt-BR')}`
                    : ''}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-md bg-[#7a2e2e] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    disabled={starting}
                    onClick={onStart}
                  >
                    {starting ? 'Iniciando...' : 'Confirmar execucao'}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm"
                    disabled={starting}
                    onClick={() => setShowStartConfirm(false)}
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
                  <dt className="text-[#65655f]">Canal primario</dt>
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

            {dispatch.channels && dispatch.channels.length > 0 ? (
              <section className="rounded-md border border-[#deddd4] bg-white p-4">
                <h3 className="font-semibold text-[#151515]">
                  Pool de instancias (DispatchChannels)
                </h3>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-[#deddd4] text-[#65655f]">
                      <tr>
                        <th className="px-2 py-2 font-medium">Instancia</th>
                        <th className="px-2 py-2 font-medium">Operacional</th>
                        <th className="px-2 py-2 font-medium">Limite efetivo</th>
                        <th className="px-2 py-2 font-medium">Items atribuidos</th>
                        <th className="px-2 py-2 font-medium">Enviados / falhas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dispatch.channels.map((channel) => (
                        <tr
                          key={channel.id}
                          className="border-b border-[#f0efe8] text-[#24382b]"
                        >
                          <td className="px-2 py-2">
                            {channel.channelAccount.name}
                          </td>
                          <td className="px-2 py-2">
                            {getDispatchChannelOperationalStatusLabel(
                              channel.operationalStatus,
                            )}
                          </td>
                          <td className="px-2 py-2">
                            {channel.effectiveDailyLimit}
                          </td>
                          <td className="px-2 py-2">{channel.assignedItems}</td>
                          <td className="px-2 py-2">
                            {channel.sentItems} / {channel.failedItems}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

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
                      <option value="PROCESSING">Processando</option>
                      <option value="SENT">Enviado</option>
                      <option value="RETRY_SCHEDULED">Retry agendado</option>
                      <option value="FAILED">Falhou</option>
                      <option value="SKIPPED">Ignorado</option>
                      <option value="UNKNOWN_PROVIDER_STATE">
                        Estado desconhecido
                      </option>
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
                        <th className="px-2 py-2 font-medium">Diagnostico</th>
                        <th className="px-2 py-2 font-medium">Instancia</th>
                        <th className="px-2 py-2 font-medium">Realocacoes</th>
                        <th className="px-2 py-2 font-medium">Agendado</th>
                        <th className="px-2 py-2 font-medium">Fila</th>
                        <th className="px-2 py-2 font-medium">Tecnico</th>
                        <th className="px-2 py-2 font-medium">Acoes</th>
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
                          <td className="px-2 py-2 text-xs text-[#65655f]">
                            {item.errorCode || item.errorCategory
                              ? `${item.errorCategory ?? '—'} / ${item.errorCode ?? '—'}`
                              : '—'}
                          </td>
                          <td className="px-2 py-2 font-mono text-xs">
                            {item.dispatchChannel?.channelAccountName ??
                              (item.dispatchChannelId
                                ? `${item.dispatchChannelId.slice(0, 8)}…`
                                : '—')}
                            {item.originalDispatchChannelId &&
                            item.originalDispatchChannelId !==
                              item.dispatchChannelId
                              ? ` (orig. ${item.originalDispatchChannelId.slice(0, 8)}…)`
                              : ''}
                          </td>
                          <td className="px-2 py-2">
                            {item.reassignmentCount ?? 0}
                          </td>
                          <td className="px-2 py-2 text-xs">
                            {item.scheduledAt
                              ? new Date(item.scheduledAt).toLocaleString('pt-BR')
                              : '—'}
                          </td>
                          <td className="px-2 py-2 text-xs">
                            {item.queuedAt
                              ? new Date(item.queuedAt).toLocaleString('pt-BR')
                              : '—'}
                          </td>
                          <td className="px-2 py-2 text-xs">
                            {item.technicalValidatedAt
                              ? new Date(
                                  item.technicalValidatedAt,
                                ).toLocaleString('pt-BR')
                              : '—'}
                          </td>
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              className="rounded border border-[#c9c8c0] px-2 py-1 text-xs text-[#24382b] hover:bg-[#f7f6f1]"
                              onClick={() => void openItemDetails(item)}
                            >
                              Detalhes
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {selectedItem ? (
                  <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
                    <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-md border border-[#deddd4] bg-white p-4 shadow-lg">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="font-semibold text-[#151515]">
                            Detalhe do item
                          </h4>
                          <p className="mt-1 text-xs text-[#65655f]">
                            {selectedItem.contactName ?? 'Contato'} ·{' '}
                            {selectedItem.destinationMasked}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="rounded border border-[#c9c8c0] px-2 py-1 text-xs"
                          onClick={() => setSelectedItem(null)}
                        >
                          Fechar
                        </button>
                      </div>

                      {itemDetailLoading ? (
                        <p className="mt-4 text-sm text-[#65655f]">
                          Carregando diagnostico…
                        </p>
                      ) : (
                        <dl className="mt-4 space-y-2 text-sm text-[#24382b]">
                          <div className="flex justify-between gap-3">
                            <dt className="text-[#65655f]">Status</dt>
                            <dd>
                              {getDispatchItemStatusLabel(selectedItem.status)}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-[#65655f]">Instancia</dt>
                            <dd>
                              {selectedItem.dispatchChannel
                                ?.channelAccountName ??
                                selectedItem.dispatchChannelId?.slice(0, 8) ??
                                '—'}
                              {selectedItem.dispatchChannel?.externalAccountId
                                ? ` (${selectedItem.dispatchChannel.externalAccountId})`
                                : ''}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-[#65655f]">Tentativa</dt>
                            <dd>
                              {selectedItem.attemptCount}/
                              {selectedItem.maxAttempts}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-[#65655f]">Categoria</dt>
                            <dd>
                              {getDispatchItemErrorCategoryLabel(
                                selectedItem.errorCategory,
                              )}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-[#65655f]">Codigo</dt>
                            <dd className="font-mono text-xs">
                              {selectedItem.errorCode ?? '—'}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[#65655f]">
                              Mensagem operacional
                            </dt>
                            <dd className="mt-1 rounded bg-[#f7f6f1] p-2 text-xs">
                              {selectedItem.errorMessage ?? '—'}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-[#65655f]">Ultima tentativa</dt>
                            <dd className="text-xs">
                              {selectedItem.lastAttemptAt
                                ? new Date(
                                    selectedItem.lastAttemptAt,
                                  ).toLocaleString('pt-BR')
                                : '—'}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-[#65655f]">Proxima tentativa</dt>
                            <dd className="text-xs">
                              {selectedItem.nextRetryAt
                                ? new Date(
                                    selectedItem.nextRetryAt,
                                  ).toLocaleString('pt-BR')
                                : '—'}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-[#65655f]">Provider status</dt>
                            <dd>{selectedItem.providerStatus ?? '—'}</dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-[#65655f]">
                              providerMessageId
                            </dt>
                            <dd className="font-mono text-xs">
                              {selectedItem.providerMessageIdMasked ?? '—'}
                            </dd>
                          </div>
                          {getDispatchItemDiagnosticNote(selectedItem.status) ? (
                            <p
                              className={`mt-3 rounded border p-2 text-xs ${
                                selectedItem.status === 'UNKNOWN_PROVIDER_STATE'
                                  ? 'border-red-200 bg-red-50 text-red-800'
                                  : selectedItem.status === 'RETRY_SCHEDULED'
                                    ? 'border-amber-200 bg-amber-50 text-amber-900'
                                    : 'border-[#deddd4] bg-[#f7f6f1] text-[#24382b]'
                              }`}
                            >
                              {getDispatchItemDiagnosticNote(
                                selectedItem.status,
                              )}
                            </p>
                          ) : null}
                        </dl>
                      )}
                    </div>
                  </div>
                ) : null}

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
                O envio real (Worker Evolution) foi implementado na subetapa
                09.4. Pausar/retomar/cancelar em execucao permanecem para
                subetapas futuras.
              </p>
            </section>
          </div>
        ) : null}
      </div>
    </DashboardShell>
  );
}
