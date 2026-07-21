'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DashboardShell } from '../../../../../../components/dashboard-shell';
import {
  ApiError,
  AuthUser,
  CampaignItem,
  DispatchDetail,
  clearStoredToken,
  fetchCampaign,
  fetchDispatch,
  fetchMe,
  getStoredToken,
} from '../../../../../../lib/api';
import {
  formatDurationSeconds,
  formatZonedDateTime,
} from '../../../../../../lib/dispatch-plans';
import {
  getDispatchStatusBadgeClass,
  getDispatchStatusLabel,
} from '../../../../../../lib/dispatches';

export default function DispatchDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string; dispatchId: string }>();
  const campaignId = params.id;
  const dispatchId = params.dispatchId;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [campaign, setCampaign] = useState<CampaignItem | null>(null);
  const [dispatch, setDispatch] = useState<DispatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const token = getStoredToken();
      if (!token) {
        router.replace('/login');
        return;
      }

      try {
        const [me, campaignItem, dispatchItem] = await Promise.all([
          fetchMe(token),
          fetchCampaign(token, campaignId),
          fetchDispatch(token, campaignId, dispatchId),
        ]);
        setUser(me);
        setCampaign(campaignItem);
        setDispatch(dispatchItem);
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
  }, [campaignId, dispatchId, router]);

  const configuration = dispatch?.configurationSnapshot;
  const content = dispatch?.contentSnapshot;
  const timezone = configuration?.timezone ?? 'America/Sao_Paulo';

  return (
    <DashboardShell userName={user?.name}>
      <div className="rounded-md border border-[#deddd4] bg-[#f7f6f1] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-[#65655f]">
              Etapa 09.1 — entidade Dispatch
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

            {dispatch.description ? (
              <p className="text-sm text-[#24382b]">{dispatch.description}</p>
            ) : null}

            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Este Disparo ainda nao possui destinatarios materializados. A
              preparacao sera implementada na subetapa 09.2.
            </div>

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
                  <dt className="text-[#65655f]">Delays</dt>
                  <dd>
                    {configuration?.minDelaySeconds ?? '—'}–
                    {configuration?.maxDelaySeconds ?? '—'} s
                  </dd>
                </div>
                <div>
                  <dt className="text-[#65655f]">Lotes</dt>
                  <dd>
                    {configuration?.totalBatches ?? '—'} lotes · tamanho{' '}
                    {configuration?.batchSize ?? '—'} · pausa{' '}
                    {configuration?.pauseBetweenBatchesSeconds ?? '—'} s
                  </dd>
                </div>
                <div>
                  <dt className="text-[#65655f]">Janela</dt>
                  <dd>
                    {configuration?.allowedStartTime ?? '—'}–
                    {configuration?.allowedEndTime ?? '—'} ·{' '}
                    {configuration?.timezone ?? '—'}
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
                  <dt className="text-[#65655f]">Fim estimado</dt>
                  <dd>
                    {configuration?.estimatedEndAt
                      ? formatZonedDateTime(
                          configuration.estimatedEndAt,
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

            <section className="rounded-md border border-[#deddd4] bg-white p-4">
              <h3 className="font-semibold text-[#151515]">Contadores</h3>
              <p className="mt-2 text-sm text-[#65655f]">
                Items preparados: {dispatch.totalItems} · enviados:{' '}
                {dispatch.sentItems} · falhas: {dispatch.failedItems}
              </p>
            </section>

            <section className="rounded-md border border-[#deddd4] bg-white p-4">
              <h3 className="font-semibold text-[#151515]">Proximas etapas</h3>
              <p className="mt-2 text-sm text-[#65655f]">
                Preparar, enfileirar e iniciar permanecem indisponiveis ate a
                subetapa 09.2+.
              </p>
              <button
                type="button"
                className="mt-3 rounded-md border border-[#c9c8c0] px-4 py-2 text-sm text-[#65655f]"
                disabled
              >
                Preparar (indisponivel)
              </button>
            </section>
          </div>
        ) : null}
      </div>
    </DashboardShell>
  );
}
