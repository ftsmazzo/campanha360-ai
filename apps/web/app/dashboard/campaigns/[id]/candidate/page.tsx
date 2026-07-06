'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DashboardShell } from '../../../../../components/dashboard-shell';
import {
  ApiError,
  AuthUser,
  CampaignItem,
  CandidateItem,
  clearStoredToken,
  fetchCampaign,
  fetchCandidate,
  fetchMe,
  getStoredToken,
  upsertCandidate,
} from '../../../../../lib/api';

function linesToArray(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function arrayToLines(value: string[] | null | undefined) {
  return (value ?? []).join('\n');
}

export default function EditCandidatePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const campaignId = params.id;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [campaign, setCampaign] = useState<CampaignItem | null>(null);
  const [name, setName] = useState('');
  const [party, setParty] = useState('');
  const [office, setOffice] = useState('');
  const [bio, setBio] = useState('');
  const [toneOfVoice, setToneOfVoice] = useState('');
  const [mainProposals, setMainProposals] = useState('');
  const [restrictedTopics, setRestrictedTopics] = useState('');
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
        const [me, item, candidateResponse] = await Promise.all([
          fetchMe(token),
          fetchCampaign(token, campaignId),
          fetchCandidate(token, campaignId),
        ]);
        setUser(me);
        setCampaign(item);
        fillCandidate(candidateResponse.candidate, item);
      } catch {
        clearStoredToken();
        router.replace('/login');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [campaignId, router]);

  function fillCandidate(candidate: CandidateItem | null, campaignItem: CampaignItem) {
    setName(candidate?.name ?? '');
    setParty(candidate?.party ?? '');
    setOffice(candidate?.office ?? campaignItem.office);
    setBio(candidate?.bio ?? '');
    setToneOfVoice(candidate?.toneOfVoice ?? '');
    setMainProposals(arrayToLines(candidate?.mainProposals as string[] | null));
    setRestrictedTopics(arrayToLines(candidate?.restrictedTopics as string[] | null));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getStoredToken();
    if (!token) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await upsertCandidate(token, campaignId, {
        name,
        party: party || undefined,
        office: office || undefined,
        bio: bio || undefined,
        toneOfVoice: toneOfVoice || undefined,
        mainProposals: linesToArray(mainProposals),
        restrictedTopics: linesToArray(restrictedTopics),
      });
      setSuccess('Candidato salvo com sucesso.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel salvar o candidato');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f7f5]">
        <p className="text-[#65655f]">Carregando candidato...</p>
      </main>
    );
  }

  if (!campaign) return null;

  return (
    <DashboardShell userName={user?.name}>
      <div className="max-w-2xl">
        <Link className="text-sm text-[#24382b] underline" href={`/dashboard/campaigns/${campaignId}`}>
          Voltar para campanha
        </Link>
        <h2 className="mt-4 text-2xl font-semibold text-[#151515]">Candidato da campanha</h2>
        <p className="mt-2 text-sm text-[#65655f]">{campaign.name}</p>

        <form className="mt-6 space-y-4 rounded-md border border-[#deddd4] bg-white p-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">Nome do candidato</span>
            <input
              className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">Partido</span>
            <input
              className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
              value={party}
              onChange={(event) => setParty(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">Cargo</span>
            <input
              className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
              value={office}
              onChange={(event) => setOffice(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">Bio</span>
            <textarea
              className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
              rows={4}
              value={bio}
              onChange={(event) => setBio(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">Tom de voz</span>
            <textarea
              className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
              rows={3}
              value={toneOfVoice}
              onChange={(event) => setToneOfVoice(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">Propostas principais (uma por linha)</span>
            <textarea
              className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
              rows={4}
              value={mainProposals}
              onChange={(event) => setMainProposals(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">Topicos restritos (um por linha)</span>
            <textarea
              className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
              rows={4}
              value={restrictedTopics}
              onChange={(event) => setRestrictedTopics(event.target.value)}
            />
          </label>

          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          {success ? <p className="text-sm text-[#47624f]">{success}</p> : null}

          <button
            className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            type="submit"
            disabled={saving}
          >
            {saving ? 'Salvando...' : 'Salvar candidato'}
          </button>
        </form>
      </div>
    </DashboardShell>
  );
}
