'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DashboardShell } from '../../../../components/dashboard-shell';
import {
  ApiError,
  AuthUser,
  CampaignItem,
  clearStoredToken,
  fetchCampaign,
  fetchMe,
  getStoredToken,
  updateCampaign,
} from '../../../../lib/api';
import { CAMPAIGN_PHASES, CAMPAIGN_STATUSES } from '../../../../lib/campaigns';

export default function EditCampaignPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const campaignId = params.id;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [campaign, setCampaign] = useState<CampaignItem | null>(null);
  const [name, setName] = useState('');
  const [electionYear, setElectionYear] = useState('');
  const [office, setOffice] = useState('');
  const [territory, setTerritory] = useState('');
  const [phase, setPhase] = useState('PRE_CAMPAIGN');
  const [status, setStatus] = useState('DRAFT');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const token = getStoredToken();
      if (!token) {
        router.replace('/login');
        return;
      }

      try {
        const [me, item] = await Promise.all([fetchMe(token), fetchCampaign(token, campaignId)]);
        setUser(me);
        setCampaign(item);
        setName(item.name);
        setElectionYear(String(item.electionYear));
        setOffice(item.office);
        setTerritory(item.territory ?? '');
        setPhase(item.phase);
        setStatus(item.status);
      } catch {
        clearStoredToken();
        router.replace('/login');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [campaignId, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getStoredToken();
    if (!token) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await updateCampaign(token, campaignId, {
        name,
        electionYear: Number(electionYear),
        office,
        territory,
        phase,
        status,
      });
      setCampaign(updated);
      setSuccess('Campanha atualizada com sucesso.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel atualizar a campanha');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f7f5]">
        <p className="text-[#65655f]">Carregando campanha...</p>
      </main>
    );
  }

  if (!campaign) return null;

  return (
    <DashboardShell userName={user?.name}>
      <div className="max-w-2xl">
        <Link className="text-sm text-[#24382b] underline" href="/dashboard/campaigns">
          Voltar para campanhas
        </Link>
        <h2 className="mt-4 text-2xl font-semibold text-[#151515]">Editar campanha</h2>
        <p className="mt-2 text-sm text-[#65655f]">{campaign.name}</p>

        <form className="mt-6 space-y-4 rounded-md border border-[#deddd4] bg-white p-4" onSubmit={handleSubmit}>
          <label className="block">
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

          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          {success ? <p className="text-sm text-[#47624f]">{success}</p> : null}

          <div className="flex gap-3">
            <button
              className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              type="submit"
              disabled={saving}
            >
              {saving ? 'Salvando...' : 'Salvar campanha'}
            </button>
            <Link
              className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm font-medium text-[#24382b]"
              href={`/dashboard/campaigns/${campaignId}/candidate`}
            >
              Editar candidato
            </Link>
            <Link
              className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm font-medium text-[#24382b]"
              href={`/dashboard/campaigns/${campaignId}/contacts`}
            >
              Contatos
            </Link>
            <Link
              className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm font-medium text-[#24382b]"
              href={`/dashboard/campaigns/${campaignId}/tags`}
            >
              Tags
            </Link>
            <Link
              className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm font-medium text-[#24382b]"
              href={`/dashboard/campaigns/${campaignId}/channels`}
            >
              Canais
            </Link>
            <Link
              className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm font-medium text-[#24382b]"
              href={`/dashboard/campaigns/${campaignId}/inbox`}
            >
              Atendimento
            </Link>
          </div>
        </form>
      </div>
    </DashboardShell>
  );
}
