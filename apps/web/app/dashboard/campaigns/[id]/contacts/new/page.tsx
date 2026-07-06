'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DashboardShell } from '../../../../../../components/dashboard-shell';
import {
  ApiError,
  AuthUser,
  CampaignItem,
  clearStoredToken,
  createContact,
  fetchCampaign,
  fetchMe,
  getStoredToken,
} from '../../../../../../lib/api';
import { CONTACT_STATUSES } from '../../../../../../lib/contacts';

function parseMetadata(value: string) {
  if (!value.trim()) return undefined;
  return JSON.parse(value) as Record<string, unknown>;
}

export default function NewContactPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const campaignId = params.id;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [campaign, setCampaign] = useState<CampaignItem | null>(null);
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [metadata, setMetadata] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const token = getStoredToken();
      if (!token) {
        router.replace('/login');
        return;
      }

      try {
        const [me, campaignItem] = await Promise.all([
          fetchMe(token),
          fetchCampaign(token, campaignId),
        ]);
        setUser(me);
        setCampaign(campaignItem);
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

    try {
      let metadataValue: Record<string, unknown> | undefined;
      try {
        metadataValue = parseMetadata(metadata);
      } catch {
        throw new ApiError('Metadata deve ser um JSON valido', 400);
      }

      const contact = await createContact(token, campaignId, {
        name: name || undefined,
        phoneNumber: phoneNumber || undefined,
        email: email || undefined,
        city: city || undefined,
        neighborhood: neighborhood || undefined,
        status,
        metadata: metadataValue,
      });
      router.push(`/dashboard/campaigns/${campaignId}/contacts/${contact.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel criar o contato');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f7f5]">
        <p className="text-[#65655f]">Carregando...</p>
      </main>
    );
  }

  return (
    <DashboardShell userName={user?.name}>
      <div className="max-w-2xl">
        <Link className="text-sm text-[#24382b] underline" href={`/dashboard/campaigns/${campaignId}/contacts`}>
          Voltar para contatos
        </Link>
        <h2 className="mt-4 text-2xl font-semibold text-[#151515]">Novo contato</h2>
        {campaign ? <p className="mt-2 text-sm text-[#65655f]">{campaign.name}</p> : null}

        <form className="mt-6 space-y-4 rounded-md border border-[#deddd4] bg-white p-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">Nome</span>
            <input className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">Telefone</span>
            <input className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">E-mail</span>
            <input className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">Cidade</span>
            <input className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2" value={city} onChange={(e) => setCity(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">Bairro</span>
            <input className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">Status</span>
            <select className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2" value={status} onChange={(e) => setStatus(e.target.value)}>
              {CONTACT_STATUSES.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">Metadata (JSON opcional)</span>
            <textarea className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2 font-mono text-sm" rows={4} value={metadata} onChange={(e) => setMetadata(e.target.value)} placeholder='{"origem":"cadastro-manual"}' />
          </label>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <button className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" type="submit" disabled={saving}>
            {saving ? 'Salvando...' : 'Criar contato'}
          </button>
        </form>
      </div>
    </DashboardShell>
  );
}
