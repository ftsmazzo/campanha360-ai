'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DashboardShell } from '../../../../../components/dashboard-shell';
import {
  ApiError,
  AuthUser,
  CampaignItem,
  SegmentFilters,
  SegmentItem,
  SegmentPreviewResult,
  TagItem,
  clearStoredToken,
  createSegment,
  fetchCampaign,
  fetchMe,
  fetchSegments,
  fetchTags,
  getStoredToken,
  previewSegment,
} from '../../../../../lib/api';
import { CONTACT_CHANNELS, CONTACT_STATUSES, getChannelLabel, getContactStatusLabel } from '../../../../../lib/contacts';
import { canWriteRole, getOrganizationRole } from '../../../../../lib/roles';
import { getContactTags } from '../../../../../lib/tags';

const EMPTY_FILTERS: SegmentFilters = {
  tagIds: [],
  status: '',
  includeOptOut: false,
  channel: '',
};

export default function CampaignSegmentsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const campaignId = params.id;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [campaign, setCampaign] = useState<CampaignItem | null>(null);
  const [segments, setSegments] = useState<SegmentItem[]>([]);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [filters, setFilters] = useState<SegmentFilters>(EMPTY_FILTERS);
  const [preview, setPreview] = useState<SegmentPreviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canWrite = campaign
    ? canWriteRole(getOrganizationRole(user?.memberships, campaign.organizationId))
    : false;

  function buildPayloadFilters(): SegmentFilters {
    return {
      tagIds: filters.tagIds ?? [],
      status: filters.status || undefined,
      includeOptOut: filters.includeOptOut === true,
      channel: filters.channel || undefined,
    };
  }

  useEffect(() => {
    async function load() {
      const token = getStoredToken();
      if (!token) {
        router.replace('/login');
        return;
      }

      try {
        const [me, campaignItem, segmentItems, tagItems] = await Promise.all([
          fetchMe(token),
          fetchCampaign(token, campaignId),
          fetchSegments(token, campaignId),
          fetchTags(token, campaignId),
        ]);
        setUser(me);
        setCampaign(campaignItem);
        setSegments(segmentItems);
        setTags(tagItems);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearStoredToken();
          router.replace('/login');
          return;
        }
        setError(err instanceof ApiError ? err.message : 'Nao foi possivel carregar segmentos');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [campaignId, router]);

  async function handlePreview(event?: FormEvent) {
    event?.preventDefault();
    const token = getStoredToken();
    if (!token) return;

    setPreviewing(true);
    setError(null);

    try {
      const result = await previewSegment(token, campaignId, buildPayloadFilters());
      setPreview(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel gerar previa');
    } finally {
      setPreviewing(false);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getStoredToken();
    if (!token || !canWrite) return;

    if (filters.includeOptOut) {
      const confirmed = window.confirm(
        'Este segmento INCLUI contatos com opt-out/bloqueio. Confirma salvar assim?',
      );
      if (!confirmed) return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const created = await createSegment(token, campaignId, {
        name,
        description: description || undefined,
        filters: buildPayloadFilters(),
      });
      setSegments((current) =>
        [...current, created].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setName('');
      setDescription('');
      setFilters(EMPTY_FILTERS);
      setPreview(null);
      setSuccess('Segmento criado com sucesso.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel criar o segmento');
    } finally {
      setSaving(false);
    }
  }

  function toggleTag(tagId: string) {
    setFilters((current) => {
      const selected = new Set(current.tagIds ?? []);
      if (selected.has(tagId)) selected.delete(tagId);
      else selected.add(tagId);
      return { ...current, tagIds: [...selected] };
    });
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f7f5]">
        <p className="text-[#65655f]">Carregando segmentos...</p>
      </main>
    );
  }

  return (
    <DashboardShell userName={user?.name}>
      <div className="space-y-6">
        <div>
          <Link className="text-sm text-[#24382b] underline" href={`/dashboard/campaigns/${campaignId}`}>
            Voltar para campanha
          </Link>
          <h2 className="mt-4 text-2xl font-semibold text-[#151515]">Segmentos da campanha</h2>
          {campaign ? <p className="mt-2 text-sm text-[#65655f]">{campaign.name}</p> : null}
          <p className="mt-2 text-sm text-[#65655f]">
            Listas operacionais salvas a partir de criterios simples. Sem disparos em massa.
          </p>
        </div>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {success ? <p className="text-sm text-[#47624f]">{success}</p> : null}

        {canWrite ? (
          <form
            className="space-y-4 rounded-md border border-[#deddd4] bg-white p-4"
            onSubmit={handleCreate}
          >
            <div>
              <h3 className="font-medium text-[#24382b]">Novo segmento</h3>
              <p className="mt-1 text-sm text-[#65655f]">
                Contatos removidos (DELETED) nunca entram. Opt-out/bloqueio e excluido por padrao.
              </p>
            </div>
            <label className="block">
              <span className="text-sm font-medium text-[#34342f]">Nome</span>
              <input
                className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                minLength={2}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-[#34342f]">Descricao (opcional)</span>
              <textarea
                className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                rows={2}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <div>
              <p className="text-sm font-medium text-[#34342f]">Tags incluidas</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {tags.length === 0 ? (
                  <p className="text-sm text-[#65655f]">Nenhuma tag cadastrada.</p>
                ) : (
                  tags.map((tag) => {
                    const selected = (filters.tagIds ?? []).includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        className={`rounded-full px-3 py-1 text-xs font-medium ${
                          selected
                            ? 'bg-[#24382b] text-white'
                            : 'bg-[#eef2ea] text-[#47624f]'
                        }`}
                        onClick={() => toggleTag(tag.id)}
                      >
                        {tag.name}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-[#34342f]">Status do contato</span>
                <select
                  className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                  value={filters.status ?? ''}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, status: event.target.value }))
                  }
                >
                  <option value="">Qualquer (exceto removidos)</option>
                  {CONTACT_STATUSES.filter((item) => item.value !== 'DELETED').map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-[#34342f]">Canal / origem</span>
                <select
                  className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                  value={filters.channel ?? ''}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, channel: event.target.value }))
                  }
                >
                  <option value="">Qualquer</option>
                  {CONTACT_CHANNELS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex items-start gap-2 text-sm text-[#34342f]">
              <input
                className="mt-1"
                type="checkbox"
                checked={filters.includeOptOut === true}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    includeOptOut: event.target.checked,
                  }))
                }
              />
              <span>
                Incluir contatos com opt-out/bloqueio
                <span className="block text-[#8a1f1f]">
                  Aviso: so use com ciencia. O padrao e excluir esses contatos.
                </span>
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-md border border-[#24382b] px-4 py-2 text-sm font-semibold text-[#24382b] disabled:opacity-60"
                type="button"
                disabled={previewing}
                onClick={() => void handlePreview()}
              >
                {previewing ? 'Gerando previa...' : 'Gerar previa'}
              </button>
              <button
                className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                type="submit"
                disabled={saving || !name.trim()}
              >
                {saving ? 'Salvando...' : 'Salvar segmento'}
              </button>
            </div>
          </form>
        ) : null}

        {preview ? (
          <section className="rounded-md border border-[#deddd4] bg-white p-4">
            <h3 className="font-medium text-[#24382b]">Previa</h3>
            <p className="mt-1 text-sm text-[#65655f]">
              {preview.contactCount} contato(s) elegiveis
              {preview.includeOptOutWarning ? ' · inclui opt-out/bloqueio' : ''}
            </p>
            {preview.contacts.length === 0 ? (
              <p className="mt-3 text-sm text-[#65655f]">Nenhum contato para estes criterios.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {preview.contacts.map((contact) => (
                  <li
                    key={contact.id}
                    className="rounded-md border border-[#eef2ea] bg-[#f7f7f5] px-3 py-2 text-sm"
                  >
                    <p className="font-medium text-[#151515]">{contact.name || 'Sem nome'}</p>
                    <p className="text-[#65655f]">
                      {contact.phoneNumber || 'Sem telefone'} ·{' '}
                      {getContactStatusLabel(contact.status)}
                      {contact.channels[0]
                        ? ` · ${getChannelLabel(contact.channels[0].channel)}`
                        : ''}
                    </p>
                    {getContactTags(contact).length > 0 ? (
                      <p className="mt-1 text-xs text-[#47624f]">
                        {getContactTags(contact)
                          .map((tag) => tag.name)
                          .join(', ')}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        <section className="space-y-3">
          <h3 className="font-medium text-[#24382b]">Segmentos salvos</h3>
          {segments.length === 0 ? (
            <div className="rounded-md border border-dashed border-[#d7d6cd] bg-white p-6 text-sm text-[#65655f]">
              Nenhum segmento salvo nesta campanha.
            </div>
          ) : (
            segments.map((segment) => (
              <article
                key={segment.id}
                className="flex flex-col gap-3 rounded-md border border-[#deddd4] bg-white p-4 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <h4 className="font-medium text-[#151515]">{segment.name}</h4>
                  {segment.description ? (
                    <p className="mt-1 text-sm text-[#65655f]">{segment.description}</p>
                  ) : null}
                  <p className="mt-1 text-sm text-[#47624f]">
                    {segment.contactCount ?? 0} contato(s)
                    {segment.includeOptOutWarning ? ' · inclui opt-out' : ''}
                  </p>
                </div>
                <Link
                  className="rounded-md border border-[#24382b] px-3 py-2 text-sm font-medium text-[#24382b]"
                  href={`/dashboard/campaigns/${campaignId}/segments/${segment.id}`}
                >
                  Abrir segmento
                </Link>
              </article>
            ))
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
