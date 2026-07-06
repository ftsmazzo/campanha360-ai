'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DashboardShell } from '../../../../../../components/dashboard-shell';
import {
  ApiError,
  AuthUser,
  CampaignItem,
  ContactItem,
  clearStoredToken,
  createContactOptOut,
  fetchCampaign,
  fetchContact,
  fetchMe,
  getStoredToken,
  updateContact,
  upsertContactConsent,
} from '../../../../../../lib/api';
import {
  CONSENT_STATUSES,
  CONTACT_CHANNELS,
  CONTACT_STATUSES,
  getChannelLabel,
  getConsentStatusLabel,
  hasOptOut,
} from '../../../../../../lib/contacts';

function metadataToText(value: Record<string, unknown> | null) {
  if (!value) return '';
  return JSON.stringify(value, null, 2);
}

function parseMetadata(value: string) {
  if (!value.trim()) return undefined;
  return JSON.parse(value) as Record<string, unknown>;
}

export default function EditContactPage() {
  const router = useRouter();
  const params = useParams<{ id: string; contactId: string }>();
  const campaignId = params.id;
  const contactId = params.contactId;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [campaign, setCampaign] = useState<CampaignItem | null>(null);
  const [contact, setContact] = useState<ContactItem | null>(null);
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [metadata, setMetadata] = useState('');
  const [consentChannel, setConsentChannel] = useState('WHATSAPP');
  const [consentStatus, setConsentStatus] = useState('UNKNOWN');
  const [consentSource, setConsentSource] = useState('manual');
  const [consentText, setConsentText] = useState('');
  const [optOutReason, setOptOutReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingConsent, setSavingConsent] = useState(false);
  const [savingOptOut, setSavingOptOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function fillContact(item: ContactItem) {
    setContact(item);
    setName(item.name ?? '');
    setPhoneNumber(item.phoneNumber ?? '');
    setEmail(item.email ?? '');
    setCity(item.city ?? '');
    setNeighborhood(item.neighborhood ?? '');
    setStatus(item.status);
    setMetadata(metadataToText(item.metadata));
    const latestConsent = item.consents[0];
    if (latestConsent) {
      setConsentChannel(latestConsent.channel);
      setConsentStatus(latestConsent.status);
      setConsentSource(latestConsent.source ?? 'manual');
      setConsentText(latestConsent.consentText ?? '');
    }
  }

  useEffect(() => {
    async function load() {
      const token = getStoredToken();
      if (!token) {
        router.replace('/login');
        return;
      }

      try {
        const [me, campaignItem, contactItem] = await Promise.all([
          fetchMe(token),
          fetchCampaign(token, campaignId),
          fetchContact(token, campaignId, contactId),
        ]);
        setUser(me);
        setCampaign(campaignItem);
        fillContact(contactItem);
      } catch {
        clearStoredToken();
        router.replace('/login');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [campaignId, contactId, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getStoredToken();
    if (!token) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      let metadataValue: Record<string, unknown> | undefined;
      try {
        metadataValue = parseMetadata(metadata);
      } catch {
        throw new ApiError('Metadata deve ser um JSON valido', 400);
      }

      const updated = await updateContact(token, campaignId, contactId, {
        name,
        phoneNumber,
        email,
        city,
        neighborhood,
        status,
        metadata: metadataValue,
      });
      fillContact(updated);
      setSuccess('Contato atualizado com sucesso.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel atualizar o contato');
    } finally {
      setSaving(false);
    }
  }

  async function handleConsentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getStoredToken();
    if (!token) return;

    setSavingConsent(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await upsertContactConsent(token, campaignId, contactId, {
        channel: consentChannel,
        status: consentStatus,
        source: consentSource,
        consentText: consentText || undefined,
      });
      fillContact(updated);
      setSuccess('Consentimento salvo com sucesso.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel salvar o consentimento');
    } finally {
      setSavingConsent(false);
    }
  }

  async function handleOptOut() {
    const token = getStoredToken();
    if (!token) return;

    setSavingOptOut(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await createContactOptOut(token, campaignId, contactId, {
        channel: consentChannel,
        reason: optOutReason || undefined,
        source: 'manual',
      });
      fillContact(updated);
      setSuccess('Opt-out registrado com sucesso.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel registrar opt-out');
    } finally {
      setSavingOptOut(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f7f5]">
        <p className="text-[#65655f]">Carregando contato...</p>
      </main>
    );
  }

  if (!contact) return null;

  return (
    <DashboardShell userName={user?.name}>
      <div className="max-w-3xl space-y-6">
        <Link className="text-sm text-[#24382b] underline" href={`/dashboard/campaigns/${campaignId}/contacts`}>
          Voltar para contatos
        </Link>
        <div>
          <h2 className="text-2xl font-semibold text-[#151515]">Editar contato</h2>
          {campaign ? <p className="mt-2 text-sm text-[#65655f]">{campaign.name}</p> : null}
          {hasOptOut(contact) ? (
            <p className="mt-2 text-sm font-medium text-red-700">Este contato possui opt-out registrado.</p>
          ) : null}
        </div>

        <form className="space-y-4 rounded-md border border-[#deddd4] bg-white p-4" onSubmit={handleSubmit}>
          <h3 className="font-medium text-[#24382b]">Dados do eleitor</h3>
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
            <span className="text-sm font-medium text-[#34342f]">Metadata (JSON)</span>
            <textarea className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2 font-mono text-sm" rows={4} value={metadata} onChange={(e) => setMetadata(e.target.value)} />
          </label>

          {contact.channels.length > 0 ? (
            <div>
              <p className="text-sm font-medium text-[#34342f]">Canais sincronizados</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {contact.channels.map((channel) => (
                  <span key={channel.id} className="rounded-full bg-[#eef2ea] px-2 py-1 text-xs text-[#47624f]">
                    {getChannelLabel(channel.channel)}: {channel.value}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <button className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" type="submit" disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar contato'}
          </button>
        </form>

        <form className="space-y-4 rounded-md border border-[#deddd4] bg-white p-4" onSubmit={handleConsentSubmit}>
          <h3 className="font-medium text-[#24382b]">Consentimento por canal</h3>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">Canal</span>
            <select className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2" value={consentChannel} onChange={(e) => setConsentChannel(e.target.value)}>
              {CONTACT_CHANNELS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">Status</span>
            <select className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2" value={consentStatus} onChange={(e) => setConsentStatus(e.target.value)}>
              {CONSENT_STATUSES.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">Origem</span>
            <input className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2" value={consentSource} onChange={(e) => setConsentSource(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">Texto do consentimento</span>
            <textarea className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2" rows={3} value={consentText} onChange={(e) => setConsentText(e.target.value)} />
          </label>
          {contact.consents.length > 0 ? (
            <div className="space-y-2">
              {contact.consents.map((consent) => (
                <p key={consent.id} className="text-sm text-[#65655f]">
                  {getChannelLabel(consent.channel)}: {getConsentStatusLabel(consent.status)}
                  {consent.source ? ` · origem ${consent.source}` : ''}
                </p>
              ))}
            </div>
          ) : null}
          <button className="rounded-md border border-[#24382b] px-4 py-2 text-sm font-semibold text-[#24382b] disabled:opacity-60" type="submit" disabled={savingConsent}>
            {savingConsent ? 'Salvando...' : 'Salvar consentimento'}
          </button>
        </form>

        <section className="rounded-md border border-[#deddd4] bg-white p-4">
          <h3 className="font-medium text-[#24382b]">Opt-out</h3>
          <p className="mt-2 text-sm text-[#65655f]">
            Registra opt-out no canal selecionado e bloqueia o contato para envios futuros.
          </p>
          <label className="mt-4 block">
            <span className="text-sm font-medium text-[#34342f]">Motivo</span>
            <input className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2" value={optOutReason} onChange={(e) => setOptOutReason(e.target.value)} />
          </label>
          <button
            className="mt-4 rounded-md bg-red-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            type="button"
            disabled={savingOptOut || hasOptOut(contact)}
            onClick={handleOptOut}
          >
            {savingOptOut ? 'Registrando...' : 'Registrar opt-out'}
          </button>
        </section>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {success ? <p className="text-sm text-[#47624f]">{success}</p> : null}
      </div>
    </DashboardShell>
  );
}
