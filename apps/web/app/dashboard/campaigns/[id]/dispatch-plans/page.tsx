'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DashboardShell } from '../../../../../components/dashboard-shell';
import {
  ApiError,
  AuthUser,
  CampaignItem,
  DispatchPlanItem,
  clearStoredToken,
  fetchCampaign,
  fetchDispatchPlans,
  fetchMe,
  getStoredToken,
} from '../../../../../lib/api';
import { canWriteRole, getOrganizationRole } from '../../../../../lib/roles';
import { getDispatchPlanStatusLabel } from '../../../../../lib/dispatch-plans';

export default function CampaignDispatchPlansPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const campaignId = params.id;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [campaign, setCampaign] = useState<CampaignItem | null>(null);
  const [plans, setPlans] = useState<DispatchPlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canWrite = campaign
    ? canWriteRole(getOrganizationRole(user?.memberships, campaign.organizationId))
    : false;

  useEffect(() => {
    async function load() {
      const token = getStoredToken();
      if (!token) {
        router.replace('/login');
        return;
      }

      try {
        const [me, campaignItem, planItems] = await Promise.all([
          fetchMe(token),
          fetchCampaign(token, campaignId),
          fetchDispatchPlans(token, campaignId),
        ]);
        setUser(me);
        setCampaign(campaignItem);
        setPlans(planItems);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearStoredToken();
          router.replace('/login');
          return;
        }
        setError(
          err instanceof ApiError
            ? err.message
            : 'Nao foi possivel carregar planos de disparo',
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [campaignId, router]);

  return (
    <DashboardShell userName={user?.name}>
      <div className="rounded-md border border-[#deddd4] bg-[#f7f6f1] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-[#65655f]">
              Etapa 08.1 — rascunho
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-[#151515]">
              Planos de disparo
            </h2>
            {campaign ? (
              <p className="mt-1 text-sm text-[#65655f]">{campaign.name}</p>
            ) : null}
            <p className="mt-2 max-w-2xl text-sm text-[#65655f]">
              Crie rascunhos vinculados a segmento e canal. Nada sera enviado nesta etapa —
              sem snapshot, fila, Worker ou envio real.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm font-medium text-[#24382b]"
              href={`/dashboard/campaigns/${campaignId}`}
            >
              Voltar a campanha
            </Link>
            {canWrite ? (
              <Link
                className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white"
                href={`/dashboard/campaigns/${campaignId}/dispatch-plans/new`}
              >
                Novo plano
              </Link>
            ) : null}
          </div>
        </div>

        {loading ? (
          <p className="mt-6 text-sm text-[#65655f]">Carregando planos...</p>
        ) : null}
        {error ? (
          <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {!loading && !error && plans.length === 0 ? (
          <p className="mt-6 text-sm text-[#65655f]">
            Nenhum plano criado ainda. {canWrite ? 'Crie o primeiro rascunho.' : ''}
          </p>
        ) : null}

        <div className="mt-6 space-y-3">
          {plans.map((plan) => (
            <Link
              key={plan.id}
              className="block rounded-md border border-[#deddd4] bg-white px-4 py-3 transition hover:border-[#24382b]"
              href={`/dashboard/campaigns/${campaignId}/dispatch-plans/${plan.id}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-medium text-[#151515]">{plan.name}</h3>
                  <p className="mt-1 text-sm text-[#65655f]">
                    Segmento: {plan.segment.name} · Canal: {plan.channelAccount.name} ·
                    v{plan.version}
                  </p>
                </div>
                <span className="rounded-md border border-[#c9c8c0] px-2 py-1 text-xs font-medium text-[#24382b]">
                  {getDispatchPlanStatusLabel(plan.status)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
