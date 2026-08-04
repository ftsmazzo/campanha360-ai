'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CampaignNav } from '../../../../components/campaign-nav';
import { DashboardShell } from '../../../../components/dashboard-shell';
import {
  ApiError,
  AuthUser,
  CampaignItem,
  clearStoredToken,
  fetchCampaign,
  fetchCandidate,
  fetchChannelAccounts,
  fetchContacts,
  fetchContentCompositions,
  fetchDispatchPlans,
  fetchDispatches,
  fetchMe,
  getStoredToken,
  updateCampaign,
} from '../../../../lib/api';
import { CAMPAIGN_PHASES, CAMPAIGN_STATUSES, getPhaseLabel, getStatusLabel } from '../../../../lib/campaigns';
import { computeTrunkProgress, TrunkProgress } from '../../../../lib/campaign-trunk';

export default function CampaignHubPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const campaignId = params.id;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [campaign, setCampaign] = useState<CampaignItem | null>(null);
  const [progress, setProgress] = useState<TrunkProgress | null>(null);
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
        const [me, item, candidateRes, channels, contacts, compositions, plans, dispatches] =
          await Promise.all([
            fetchMe(token),
            fetchCampaign(token, campaignId),
            fetchCandidate(token, campaignId),
            fetchChannelAccounts(token, campaignId),
            fetchContacts(token, campaignId),
            fetchContentCompositions(token, campaignId),
            fetchDispatchPlans(token, campaignId),
            fetchDispatches(token, campaignId, { limit: 1 }),
          ]);

        setUser(me);
        setCampaign(item);
        setName(item.name);
        setElectionYear(String(item.electionYear));
        setOffice(item.office);
        setTerritory(item.territory ?? '');
        setPhase(item.phase);
        setStatus(item.status);

        const whatsappConnected = channels.some(
          (channel) =>
            channel.provider === 'WHATSAPP_EVOLUTION' && channel.status === 'CONNECTED',
        );

        setProgress(
          computeTrunkProgress({
            hasCandidate: Boolean(candidateRes.candidate),
            whatsappConnected,
            contactCount: contacts.length,
            hasApprovedMessage: compositions.some((c) => c.status === 'APPROVED'),
            hasMessageDraft: compositions.some(
              (c) => c.status === 'DRAFT' || c.status === 'READY_FOR_REVIEW',
            ),
            dispatchCount: dispatches.pagination.total,
            planCount: plans.length,
          }),
        );
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

  if (!campaign || !progress) return null;

  const next = progress.nextStep;

  return (
    <DashboardShell userName={user?.name}>
      <div className="max-w-3xl">
        <CampaignNav campaignId={campaignId} campaignName={campaign.name} />

        <h2 className="text-2xl font-semibold text-[#151515]">{campaign.name}</h2>
        <p className="mt-2 text-sm text-[#65655f]">
          {campaign.office} · {campaign.electionYear}
          {campaign.territory ? ` · ${campaign.territory}` : ''} · {getPhaseLabel(campaign.phase)} ·{' '}
          {getStatusLabel(campaign.status)}
        </p>
        <p className="mt-3 text-sm text-[#34342f]">
          Caminho principal: conectar WhatsApp, montar a base, preparar a mensagem e enviar. O resto
          fica em ferramentas avancadas.
        </p>

        <section className="mt-6 rounded-md border border-[#deddd4] bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-medium text-[#24382b]">Progresso</h3>
              <p className="mt-1 text-sm text-[#65655f]">
                {progress.completedCount} de {progress.steps.length} passos concluidos
              </p>
            </div>
            {next ? (
              <Link
                className="inline-flex rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white"
                href={next.href(campaignId)}
              >
                Proximo: {next.actionLabel}
              </Link>
            ) : (
              <Link
                className="inline-flex rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white"
                href={`/dashboard/campaigns/${campaignId}/inbox`}
              >
                Ir para atendimento
              </Link>
            )}
          </div>

          <ol className="mt-5 space-y-3">
            {progress.steps.map((step) => {
              const tone =
                step.state === 'done'
                  ? 'border-[#c5d4c8] bg-[#f3f7f4]'
                  : step.state === 'current'
                    ? 'border-[#24382b] bg-white'
                    : 'border-[#deddd4] bg-[#fafaf8]';

              return (
                <li key={step.id} className={`rounded-md border p-3 ${tone}`}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-[#151515]">
                        {step.number}. {step.title}
                        {step.state === 'done' ? (
                          <span className="ml-2 font-normal text-[#47624f]">Pronto</span>
                        ) : step.state === 'current' ? (
                          <span className="ml-2 font-normal text-[#24382b]">Agora</span>
                        ) : null}
                      </p>
                      <p className="mt-1 text-sm text-[#65655f]">{step.description}</p>
                      <p className="mt-1 text-sm text-[#34342f]">{step.detail}</p>
                    </div>
                    <Link
                      className={
                        step.state === 'current'
                          ? 'inline-flex shrink-0 rounded-md bg-[#24382b] px-3 py-1.5 text-sm font-semibold text-white'
                          : 'inline-flex shrink-0 rounded-md border border-[#c9c8c0] px-3 py-1.5 text-sm font-medium text-[#24382b]'
                      }
                      href={step.href(campaignId)}
                    >
                      {step.complete ? 'Revisar' : step.actionLabel}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <details id="configuracoes" className="mt-6 rounded-md border border-[#deddd4] bg-white p-4">
          <summary className="cursor-pointer font-medium text-[#24382b]">
            Configuracoes da campanha
          </summary>
          <p className="mt-2 text-sm text-[#65655f]">
            Dados basicos. O candidato fica em uma tela propria no passo 1.
          </p>

          <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
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

            <div className="flex flex-wrap gap-3">
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
            </div>
          </form>
        </details>
      </div>
    </DashboardShell>
  );
}
