'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DashboardShell } from '../../../../../components/dashboard-shell';
import {
  ApiError,
  AuthUser,
  CampaignItem,
  ContactItem,
  clearStoredToken,
  fetchCampaign,
  fetchContacts,
  fetchMe,
  getStoredToken,
} from '../../../../../lib/api';
import { getChannelLabel, getConsentStatusLabel, getContactStatusLabel, hasOptOut } from '../../../../../lib/contacts';

export default function CampaignContactsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const campaignId = params.id;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [campaign, setCampaign] = useState<CampaignItem | null>(null);
  const [contacts, setContacts] = useState<ContactItem[]>([]);
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
        const [me, campaignItem, contactItems] = await Promise.all([
          fetchMe(token),
          fetchCampaign(token, campaignId),
          fetchContacts(token, campaignId),
        ]);
        setUser(me);
        setCampaign(campaignItem);
        setContacts(contactItems);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearStoredToken();
          router.replace('/login');
          return;
        }
        setError(err instanceof ApiError ? err.message : 'Nao foi possivel carregar contatos');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [campaignId, router]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f7f5]">
        <p className="text-[#65655f]">Carregando contatos...</p>
      </main>
    );
  }

  return (
    <DashboardShell userName={user?.name}>
      <div>
        <Link className="text-sm text-[#24382b] underline" href={`/dashboard/campaigns/${campaignId}`}>
          Voltar para campanha
        </Link>
        <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-[#151515]">Contatos da campanha</h2>
            {campaign ? <p className="mt-2 text-sm text-[#65655f]">{campaign.name}</p> : null}
          </div>
          <Link
            className="inline-flex rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white"
            href={`/dashboard/campaigns/${campaignId}/contacts/new`}
          >
            Novo contato
          </Link>
        </div>

        {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}

        <div className="mt-6 space-y-3">
          {contacts.length === 0 ? (
            <div className="rounded-md border border-dashed border-[#d7d6cd] bg-white p-6 text-sm text-[#65655f]">
              Nenhum contato cadastrado nesta campanha.
            </div>
          ) : (
            contacts.map((contact) => (
              <article key={contact.id} className="rounded-md border border-[#deddd4] bg-white p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="font-medium text-[#151515]">{contact.name || 'Sem nome'}</h3>
                    <p className="mt-1 text-sm text-[#65655f]">
                      {contact.phoneNumber || 'Sem telefone'}
                      {contact.email ? ` · ${contact.email}` : ''}
                    </p>
                    <p className="mt-1 text-sm text-[#65655f]">
                      {[contact.city, contact.neighborhood].filter(Boolean).join(' · ') || 'Sem localizacao'}
                    </p>
                    <p className="mt-2 text-sm text-[#24382b]">
                      {getContactStatusLabel(contact.status)}
                      {hasOptOut(contact) ? ' · Opt-out' : ''}
                    </p>
                    {contact.consents.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {contact.consents.map((consent) => (
                          <span
                            key={consent.id}
                            className="rounded-full bg-[#eef2ea] px-2 py-1 text-xs text-[#47624f]"
                          >
                            {getChannelLabel(consent.channel)}: {getConsentStatusLabel(consent.status)}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <Link
                    className="rounded-md border border-[#c9c8c0] px-3 py-2 text-sm font-medium text-[#24382b]"
                    href={`/dashboard/campaigns/${campaignId}/contacts/${contact.id}`}
                  >
                    Editar
                  </Link>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
