'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { TagBadge } from '../../../../../components/tag-badge';
import { DashboardShell } from '../../../../../components/dashboard-shell';
import {
  ApiError,
  AuthUser,
  CampaignItem,
  CampaignMemberItem,
  ContactItem,
  ContactListFilters,
  TagItem,
  clearStoredToken,
  fetchCampaign,
  fetchCampaignMembers,
  fetchContacts,
  fetchMe,
  fetchTags,
  getStoredToken,
} from '../../../../../lib/api';
import {
  CONTACT_STATUSES,
  getChannelLabel,
  getConsentStatusLabel,
  getContactStatusLabel,
  hasOptOut,
} from '../../../../../lib/contacts';
import { CONTACT_OPERATIONAL_STATUSES, getOperationalStatusLabel } from '../../../../../lib/operational';
import { getContactTags } from '../../../../../lib/tags';

const EMPTY_FILTERS: ContactListFilters = {
  q: '',
  status: '',
  operationalStatus: '',
  assignedToUserId: '',
  tagId: '',
  hasOptOut: undefined,
};

export default function CampaignContactsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const campaignId = params.id;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [campaign, setCampaign] = useState<CampaignItem | null>(null);
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [members, setMembers] = useState<CampaignMemberItem[]>([]);
  const [filters, setFilters] = useState<ContactListFilters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<ContactListFilters>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasActiveFilters = Boolean(
    appliedFilters.q?.trim() ||
      appliedFilters.status ||
      appliedFilters.operationalStatus ||
      appliedFilters.assignedToUserId ||
      appliedFilters.tagId ||
      appliedFilters.hasOptOut !== undefined,
  );

  const loadContacts = useCallback(
    async (token: string, nextFilters: ContactListFilters) => {
      const payload: ContactListFilters = {
        q: nextFilters.q?.trim() || undefined,
        status: nextFilters.status || undefined,
        operationalStatus: nextFilters.operationalStatus || undefined,
        assignedToUserId: nextFilters.assignedToUserId || undefined,
        tagId: nextFilters.tagId || undefined,
        hasOptOut: nextFilters.hasOptOut,
      };

      const contactItems = await fetchContacts(token, campaignId, payload);
      setContacts(contactItems);
      setAppliedFilters(nextFilters);
    },
    [campaignId],
  );

  useEffect(() => {
    async function load() {
      const token = getStoredToken();
      if (!token) {
        router.replace('/login');
        return;
      }

      try {
        const [me, campaignItem, contactItems, tagItems, memberItems] = await Promise.all([
          fetchMe(token),
          fetchCampaign(token, campaignId),
          fetchContacts(token, campaignId),
          fetchTags(token, campaignId),
          fetchCampaignMembers(token, campaignId),
        ]);
        setUser(me);
        setCampaign(campaignItem);
        setContacts(contactItems);
        setTags(tagItems);
        setMembers(memberItems);
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

  async function handleFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getStoredToken();
    if (!token) return;

    setSearching(true);
    setError(null);

    try {
      await loadContacts(token, filters);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel filtrar contatos');
    } finally {
      setSearching(false);
    }
  }

  async function handleClearFilters() {
    const token = getStoredToken();
    if (!token) return;

    setFilters(EMPTY_FILTERS);
    setSearching(true);
    setError(null);

    try {
      await loadContacts(token, EMPTY_FILTERS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel limpar filtros');
    } finally {
      setSearching(false);
    }
  }

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
            <p className="mt-2 text-sm text-[#65655f]">
              Base operacional da campanha, incluindo contatos gerados pelo Atendimento/WhatsApp.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="inline-flex rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white"
              href={`/dashboard/campaigns/${campaignId}/contacts/new`}
            >
              Novo contato
            </Link>
            <Link
              className="inline-flex rounded-md border border-[#c9c8c0] px-4 py-2 text-sm font-semibold text-[#24382b]"
              href={`/dashboard/campaigns/${campaignId}/inbox`}
            >
              Atendimento
            </Link>
            <Link
              className="inline-flex rounded-md border border-[#c9c8c0] px-4 py-2 text-sm font-semibold text-[#24382b]"
              href={`/dashboard/campaigns/${campaignId}/tags`}
            >
              Tags
            </Link>
          </div>
        </div>

        <form
          className="mt-6 grid gap-4 rounded-md border border-[#deddd4] bg-white p-4 md:grid-cols-2 lg:grid-cols-3"
          onSubmit={handleFilterSubmit}
        >
          <label className="block md:col-span-2 lg:col-span-3">
            <span className="text-sm font-medium text-[#34342f]">Buscar</span>
            <input
              className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
              placeholder="Nome, telefone, e-mail, cidade ou bairro"
              value={filters.q ?? ''}
              onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">Status tecnico</span>
            <select
              className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
              value={filters.status ?? ''}
              onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
            >
              <option value="">Todos</option>
              {CONTACT_STATUSES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">Status operacional</span>
            <select
              className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
              value={filters.operationalStatus ?? ''}
              onChange={(event) =>
                setFilters((current) => ({ ...current, operationalStatus: event.target.value }))
              }
            >
              <option value="">Todos</option>
              {CONTACT_OPERATIONAL_STATUSES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">Responsavel</span>
            <select
              className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
              value={filters.assignedToUserId ?? ''}
              onChange={(event) =>
                setFilters((current) => ({ ...current, assignedToUserId: event.target.value }))
              }
            >
              <option value="">Todos</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">Tag</span>
            <select
              className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
              value={filters.tagId ?? ''}
              onChange={(event) => setFilters((current) => ({ ...current, tagId: event.target.value }))}
            >
              <option value="">Todas</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">Opt-out</span>
            <select
              className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
              value={
                filters.hasOptOut === undefined
                  ? ''
                  : filters.hasOptOut
                    ? 'true'
                    : 'false'
              }
              onChange={(event) => {
                const value = event.target.value;
                setFilters((current) => ({
                  ...current,
                  hasOptOut: value === '' ? undefined : value === 'true',
                }));
              }}
            >
              <option value="">Todos</option>
              <option value="true">Com opt-out</option>
              <option value="false">Sem opt-out</option>
            </select>
          </label>
          <div className="flex flex-wrap items-end gap-2 md:col-span-2 lg:col-span-3">
            <button
              className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              type="submit"
              disabled={searching}
            >
              {searching ? 'Filtrando...' : 'Aplicar filtros'}
            </button>
            <button
              className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm font-medium text-[#24382b] disabled:opacity-60"
              type="button"
              disabled={searching || !hasActiveFilters}
              onClick={handleClearFilters}
            >
              Limpar filtros
            </button>
          </div>
        </form>

        {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}

        <div className="mt-6 space-y-3">
          {contacts.length === 0 ? (
            <div className="rounded-md border border-dashed border-[#d7d6cd] bg-white p-6 text-sm text-[#65655f]">
              {hasActiveFilters ? (
                <p>Nenhum contato encontrado com os filtros aplicados.</p>
              ) : (
                <div className="space-y-2">
                  <p className="font-medium text-[#34342f]">Nenhum contato nesta campanha</p>
                  <p>
                    Cadastre um contato manualmente ou aguarde mensagens pelo WhatsApp — o
                    Atendimento cria/atualiza contatos automaticamente.
                  </p>
                </div>
              )}
            </div>
          ) : (
            contacts.map((contact) => {
              const primaryChannel =
                contact.channels.find((channel) => channel.isPrimary)?.channel ||
                contact.channels[0]?.channel ||
                contact.latestChannel ||
                null;
              const blocked = contact.status === 'BLOCKED' || hasOptOut(contact);

              return (
              <article key={contact.id} className="rounded-md border border-[#deddd4] bg-white p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="font-medium text-[#151515]">{contact.name || 'Sem nome'}</h3>
                    <p className="mt-1 text-sm text-[#65655f]">
                      {contact.phoneNumber || 'Sem telefone'}
                      {contact.email ? ` · ${contact.email}` : ''}
                    </p>
                    <p className="mt-1 text-sm text-[#65655f]">
                      Canal/origem:{' '}
                      {primaryChannel ? getChannelLabel(primaryChannel) : 'Nao informado'}
                      {contact.messageCount !== undefined
                        ? ` · ${contact.messageCount} mensagem(ns)`
                        : ''}
                    </p>
                    <p className="mt-1 text-sm text-[#65655f]">
                      Ultima interacao:{' '}
                      {contact.lastInteractionAt
                        ? new Date(contact.lastInteractionAt).toLocaleString('pt-BR')
                        : 'Sem interacao registrada'}
                    </p>
                    <p className="mt-2 text-sm text-[#24382b]">
                      {getContactStatusLabel(contact.status)}
                      {blocked ? ' · Opt-out/bloqueio ativo' : ''}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-[#eef2ea] px-2 py-1 text-xs font-medium text-[#47624f]">
                        {getOperationalStatusLabel(contact.operationalStatus ?? 'NEW')}
                      </span>
                      {contact.assignedTo ? (
                        <span className="text-xs text-[#65655f]">
                          Responsavel: {contact.assignedTo.name}
                        </span>
                      ) : null}
                    </div>
                    {getContactTags(contact).length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {getContactTags(contact).map((tag) => (
                          <TagBadge key={tag.id} tag={tag} />
                        ))}
                      </div>
                    ) : null}
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
                  <div className="flex flex-wrap gap-2">
                    {contact.latestThreadId ? (
                      <Link
                        className="rounded-md bg-[#24382b] px-3 py-2 text-sm font-medium text-white"
                        href={`/dashboard/campaigns/${campaignId}/inbox?thread=${contact.latestThreadId}`}
                      >
                        Abrir conversa
                      </Link>
                    ) : null}
                    <Link
                      className="rounded-md border border-[#c9c8c0] px-3 py-2 text-sm font-medium text-[#24382b]"
                      href={`/dashboard/campaigns/${campaignId}/contacts/${contact.id}`}
                    >
                      Ver contato
                    </Link>
                  </div>
                </div>
              </article>
              );
            })
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
