'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DashboardShell } from '../../../components/dashboard-shell';
import {
  OrganizationSelector,
  resolveActiveOrganizationId,
} from '../../../components/organization-selector';
import {
  ApiError,
  AuthUser,
  CampaignItem,
  OrganizationItem,
  clearStoredToken,
  createCampaign,
  fetchCampaigns,
  fetchMe,
  fetchOrganizations,
  getStoredToken,
} from '../../../lib/api';
import { CAMPAIGN_PHASES, CAMPAIGN_STATUSES, getPhaseLabel, getStatusLabel } from '../../../lib/campaigns';
import { setActiveOrganizationId } from '../../../lib/organization';

export default function CampaignsPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationItem[]>([]);
  const [activeOrganizationId, setActiveOrganizationIdState] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [electionYear, setElectionYear] = useState(String(new Date().getFullYear()));
  const [office, setOffice] = useState('');
  const [territory, setTerritory] = useState('');
  const [phase, setPhase] = useState('PRE_CAMPAIGN');
  const [status, setStatus] = useState('DRAFT');

  async function loadCampaigns(token: string, organizationId: string) {
    const items = await fetchCampaigns(token, organizationId);
    setCampaigns(items);
  }

  useEffect(() => {
    async function load() {
      const token = getStoredToken();
      if (!token) {
        router.replace('/login');
        return;
      }

      try {
        const [me, orgs] = await Promise.all([fetchMe(token), fetchOrganizations(token)]);
        setUser(me);
        setOrganizations(orgs);

        const activeId = resolveActiveOrganizationId(orgs);
        setActiveOrganizationIdState(activeId);
        if (activeId) {
          setActiveOrganizationId(activeId);
          await loadCampaigns(token, activeId);
        }
      } catch {
        clearStoredToken();
        router.replace('/login');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [router]);

  async function handleOrganizationChange(organizationId: string) {
    setActiveOrganizationIdState(organizationId);
    const token = getStoredToken();
    if (!token || !organizationId) return;
    setError(null);
    try {
      await loadCampaigns(token, organizationId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel carregar campanhas');
    }
  }

  async function handleCreateCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getStoredToken();
    if (!token || !activeOrganizationId) return;

    setCreating(true);
    setError(null);

    try {
      await createCampaign(token, {
        organizationId: activeOrganizationId,
        name,
        electionYear: Number(electionYear),
        office,
        territory: territory || undefined,
        phase,
        status,
      });
      await loadCampaigns(token, activeOrganizationId);
      setName('');
      setOffice('');
      setTerritory('');
      setPhase('PRE_CAMPAIGN');
      setStatus('DRAFT');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel criar a campanha');
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f7f5]">
        <p className="text-[#65655f]">Carregando campanhas...</p>
      </main>
    );
  }

  return (
    <DashboardShell userName={user?.name}>
      <div>
        <h2 className="text-2xl font-semibold text-[#151515]">Campanhas</h2>
        <p className="mt-2 text-sm text-[#65655f]">
          Campanhas vinculadas a organizacao ativa.
        </p>

        <div className="mt-6">
          <OrganizationSelector
            organizations={organizations}
            activeOrganizationId={activeOrganizationId}
            onChange={handleOrganizationChange}
          />
        </div>

        {activeOrganizationId ? (
          <>
            <form className="mt-6 rounded-md border border-[#deddd4] bg-white p-4" onSubmit={handleCreateCampaign}>
              <h3 className="font-medium text-[#24382b]">Nova campanha</h3>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="block md:col-span-2">
                  <span className="text-sm font-medium text-[#34342f]">Nome</span>
                  <input
                    className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[#34342f]">Ano da eleicao</span>
                  <input
                    className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                    type="number"
                    value={electionYear}
                    onChange={(event) => setElectionYear(event.target.value)}
                    required
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[#34342f]">Cargo</span>
                  <input
                    className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                    value={office}
                    onChange={(event) => setOffice(event.target.value)}
                    required
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[#34342f]">Territorio</span>
                  <input
                    className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                    value={territory}
                    onChange={(event) => setTerritory(event.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[#34342f]">Fase eleitoral</span>
                  <select
                    className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                    value={phase}
                    onChange={(event) => setPhase(event.target.value)}
                  >
                    {CAMPAIGN_PHASES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[#34342f]">Status</span>
                  <select
                    className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                  >
                    {CAMPAIGN_STATUSES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
              <button
                className="mt-4 rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                type="submit"
                disabled={creating}
              >
                {creating ? 'Criando...' : 'Criar campanha'}
              </button>
            </form>

            <div className="mt-6 space-y-3">
              {campaigns.length === 0 ? (
                <div className="rounded-md border border-dashed border-[#d7d6cd] bg-white p-6 text-sm text-[#65655f]">
                  Nenhuma campanha nesta organizacao.
                </div>
              ) : (
                campaigns.map((campaign) => (
                  <article key={campaign.id} className="rounded-md border border-[#deddd4] bg-white p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <h3 className="font-medium text-[#151515]">{campaign.name}</h3>
                        <p className="mt-1 text-sm text-[#65655f]">
                          {campaign.office} · {campaign.electionYear}
                          {campaign.territory ? ` · ${campaign.territory}` : ''}
                        </p>
                        <p className="mt-2 text-sm text-[#65655f]">
                          {getPhaseLabel(campaign.phase)} · {getStatusLabel(campaign.status)}
                        </p>
                        {campaign.candidate ? (
                          <p className="mt-2 text-sm text-[#24382b]">
                            Candidato: {campaign.candidate.name}
                          </p>
                        ) : (
                          <p className="mt-2 text-sm text-[#65655f]">Candidato nao cadastrado</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Link
                          className="rounded-md border border-[#c9c8c0] px-3 py-2 text-sm font-medium text-[#24382b]"
                          href={`/dashboard/campaigns/${campaign.id}`}
                        >
                          Editar campanha
                        </Link>
                        <Link
                          className="rounded-md bg-[#24382b] px-3 py-2 text-sm font-semibold text-white"
                          href={`/dashboard/campaigns/${campaign.id}/candidate`}
                        >
                          Candidato
                        </Link>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </>
        ) : (
          <p className="mt-6 text-sm text-[#65655f]">Selecione uma organizacao para ver campanhas.</p>
        )}
      </div>
    </DashboardShell>
  );
}
