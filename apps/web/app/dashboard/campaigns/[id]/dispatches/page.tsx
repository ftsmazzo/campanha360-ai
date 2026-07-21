'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DashboardShell } from '../../../../../components/dashboard-shell';
import {
  ApiError,
  AuthUser,
  CampaignItem,
  DispatchListItem,
  clearStoredToken,
  fetchCampaign,
  fetchDispatches,
  fetchMe,
  getStoredToken,
} from '../../../../../lib/api';
import {
  getDispatchStatusBadgeClass,
  getDispatchStatusLabel,
} from '../../../../../lib/dispatches';

export default function CampaignDispatchesPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const campaignId = params.id;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [campaign, setCampaign] = useState<CampaignItem | null>(null);
  const [dispatches, setDispatches] = useState<DispatchListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    async function load() {
      const token = getStoredToken();
      if (!token) {
        router.replace('/login');
        return;
      }

      try {
        const [me, campaignItem, list] = await Promise.all([
          fetchMe(token),
          fetchCampaign(token, campaignId),
          fetchDispatches(token, campaignId, {
            search: search.trim() || undefined,
            status: status || undefined,
          }),
        ]);
        setUser(me);
        setCampaign(campaignItem);
        setDispatches(list.dispatches);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearStoredToken();
          router.replace('/login');
          return;
        }
        setError(
          err instanceof ApiError
            ? err.message
            : 'Nao foi possivel carregar disparos',
        );
      } finally {
        setLoading(false);
      }
    }

    setLoading(true);
    load();
  }, [campaignId, router, search, status]);

  return (
    <DashboardShell userName={user?.name}>
      <div className="rounded-md border border-[#deddd4] bg-[#f7f6f1] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-[#65655f]">
              Etapa 09.1 — entidade Dispatch
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-[#151515]">
              Disparos
            </h2>
            {campaign ? (
              <p className="mt-1 text-sm text-[#65655f]">{campaign.name}</p>
            ) : null}
            <p className="mt-2 max-w-2xl text-sm text-[#65655f]">
              Execucoes derivadas de Planos aprovados. Nesta etapa o Disparo e
              apenas criado e consultado — sem destinatarios materializados nem
              envio.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm font-medium text-[#24382b]"
              href={`/dashboard/campaigns/${campaignId}`}
            >
              Voltar a campanha
            </Link>
            <Link
              className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm font-medium text-[#24382b]"
              href={`/dashboard/campaigns/${campaignId}/dispatch-plans`}
            >
              Planos de disparo
            </Link>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <input
            className="rounded-md border border-[#c9c8c0] bg-white px-3 py-2 text-sm"
            placeholder="Buscar por nome ou plano"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            className="rounded-md border border-[#c9c8c0] bg-white px-3 py-2 text-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">Todos os status</option>
            <option value="DRAFT">Rascunho</option>
            <option value="PREPARING">Preparando</option>
            <option value="READY">Pronto</option>
            <option value="QUEUED">Enfileirado</option>
            <option value="RUNNING">Em execucao</option>
            <option value="PAUSED">Pausado</option>
            <option value="COMPLETED">Concluido</option>
            <option value="FAILED">Falhou</option>
            <option value="CANCELED">Cancelado</option>
          </select>
        </div>

        {loading ? (
          <p className="mt-6 text-sm text-[#65655f]">Carregando disparos...</p>
        ) : null}
        {error ? (
          <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {!loading && !error && dispatches.length === 0 ? (
          <p className="mt-6 text-sm text-[#65655f]">
            Nenhum disparo criado. Crie a partir de um Plano aprovado.
          </p>
        ) : null}

        <div className="mt-6 space-y-3">
          {dispatches.map((dispatch) => (
            <Link
              key={dispatch.id}
              className="block rounded-md border border-[#deddd4] bg-white px-4 py-3 transition hover:border-[#24382b]"
              href={`/dashboard/campaigns/${campaignId}/dispatches/${dispatch.id}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium text-[#151515]">{dispatch.name}</h3>
                  <p className="mt-1 text-sm text-[#65655f]">
                    Plano: {dispatch.dispatchPlan.name} · Canal:{' '}
                    {dispatch.channelAccount.name}
                  </p>
                  <p className="mt-1 text-sm text-[#65655f]">
                    Publico aprovado: {dispatch.approvedAudience.totalEligible} ·
                    Items preparados: {dispatch.totalItems} · Enviados:{' '}
                    {dispatch.sentItems} · Falhas: {dispatch.failedItems}
                  </p>
                  <p className="mt-1 text-xs text-[#65655f]">
                    Criado em{' '}
                    {new Date(dispatch.createdAt).toLocaleString('pt-BR')}
                    {dispatch.createdBy
                      ? ` · ${dispatch.createdBy.name}`
                      : ''}
                  </p>
                </div>
                <span
                  className={`rounded-md border px-2 py-1 text-xs font-medium ${getDispatchStatusBadgeClass(dispatch.status)}`}
                >
                  {getDispatchStatusLabel(dispatch.status)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
