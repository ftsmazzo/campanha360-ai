'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DashboardShell } from '../../../../../../components/dashboard-shell';
import {
  ApiError,
  AuthUser,
  CampaignItem,
  SegmentDetail,
  SegmentFilters,
  SegmentPrevalidateResult,
  TagItem,
  clearStoredToken,
  deleteSegment,
  fetchCampaign,
  fetchMe,
  fetchSegment,
  fetchTags,
  getStoredToken,
  prevalidateSegment,
  previewSegment,
  updateSegment,
} from '../../../../../../lib/api';
import {
  CONTACT_CHANNELS,
  CONTACT_STATUSES,
  getChannelLabel,
  getContactStatusLabel,
} from '../../../../../../lib/contacts';
import { canWriteRole, getOrganizationRole } from '../../../../../../lib/roles';
import { getContactTags } from '../../../../../../lib/tags';

export default function SegmentDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string; segmentId: string }>();
  const campaignId = params.id;
  const segmentId = params.segmentId;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [campaign, setCampaign] = useState<CampaignItem | null>(null);
  const [segment, setSegment] = useState<SegmentDetail | null>(null);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [filters, setFilters] = useState<SegmentFilters>({
    tagIds: [],
    status: '',
    includeOptOut: false,
    channel: '',
  });
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [prevalidating, setPrevalidating] = useState(false);
  const [prevalidation, setPrevalidation] = useState<SegmentPrevalidateResult | null>(null);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canWrite = campaign
    ? canWriteRole(getOrganizationRole(user?.memberships, campaign.organizationId))
    : false;

  function fillSegment(item: SegmentDetail) {
    setSegment(item);
    setName(item.name);
    setDescription(item.description ?? '');
    setFilters({
      tagIds: item.filters?.tagIds ?? [],
      status: item.filters?.status ?? '',
      includeOptOut: item.filters?.includeOptOut === true,
      channel: item.filters?.channel ?? '',
    });
    setPreviewCount(item.contactCount ?? null);
  }

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
        const [me, campaignItem, segmentItem, tagItems] = await Promise.all([
          fetchMe(token),
          fetchCampaign(token, campaignId),
          fetchSegment(token, campaignId, segmentId),
          fetchTags(token, campaignId),
        ]);
        setUser(me);
        setCampaign(campaignItem);
        fillSegment(segmentItem);
        setTags(tagItems);
        try {
          const prevalidateResult = await prevalidateSegment(token, campaignId, segmentId);
          setPrevalidation(prevalidateResult);
        } catch {
          // Pre-validacao e opcional no carregamento inicial.
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearStoredToken();
          router.replace('/login');
          return;
        }
        setError(err instanceof ApiError ? err.message : 'Nao foi possivel carregar o segmento');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [campaignId, router, segmentId]);

  async function handlePrevalidate() {
    const token = getStoredToken();
    if (!token) return;

    setPrevalidating(true);
    setError(null);

    try {
      const result = await prevalidateSegment(token, campaignId, segmentId);
      setPrevalidation(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel pre-validar o segmento');
    } finally {
      setPrevalidating(false);
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

  async function handlePreview() {
    const token = getStoredToken();
    if (!token) return;
    setError(null);
    try {
      const result = await previewSegment(token, campaignId, buildPayloadFilters());
      setPreviewCount(result.contactCount);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel gerar previa');
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
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
      await updateSegment(token, campaignId, segmentId, {
        name,
        description: description || undefined,
        filters: buildPayloadFilters(),
      });
      const refreshed = await fetchSegment(token, campaignId, segmentId);
      fillSegment(refreshed);
      setEditing(false);
      setSuccess('Segmento atualizado com sucesso.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel atualizar o segmento');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    const token = getStoredToken();
    if (!token || !canWrite) return;

    const confirmed = window.confirm(
      'Remover este segmento? Os contatos nao serao apagados — apenas o filtro salvo.',
    );
    if (!confirmed) return;

    setRemoving(true);
    setError(null);

    try {
      await deleteSegment(token, campaignId, segmentId);
      router.replace(`/dashboard/campaigns/${campaignId}/segments`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel remover o segmento');
      setRemoving(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f7f5]">
        <p className="text-[#65655f]">Carregando segmento...</p>
      </main>
    );
  }

  if (!segment) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f7f5]">
        <p className="text-[#65655f]">Segmento nao encontrado.</p>
      </main>
    );
  }

  return (
    <DashboardShell userName={user?.name}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              className="text-sm text-[#24382b] underline"
              href={`/dashboard/campaigns/${campaignId}/segments`}
            >
              Voltar para segmentos
            </Link>
            <h2 className="mt-4 text-2xl font-semibold text-[#151515]">{segment.name}</h2>
            {segment.description ? (
              <p className="mt-2 text-sm text-[#65655f]">{segment.description}</p>
            ) : null}
            <p className="mt-2 text-sm text-[#47624f]">
              {segment.contactCount ?? 0} contato(s) elegiveis
              {segment.includeOptOutWarning ? ' · inclui opt-out/bloqueio' : ''}
            </p>
          </div>
          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-md border border-[#24382b] px-3 py-2 text-sm font-medium text-[#24382b]"
                type="button"
                onClick={() => {
                  setEditing((current) => !current);
                  setError(null);
                  setSuccess(null);
                }}
              >
                {editing ? 'Fechar edicao' : 'Editar segmento'}
              </button>
              <button
                className="rounded-md border border-red-700 px-3 py-2 text-sm font-semibold text-red-800 disabled:opacity-60"
                type="button"
                disabled={removing}
                onClick={handleRemove}
              >
                {removing ? 'Removendo...' : 'Remover segmento'}
              </button>
            </div>
          ) : null}
        </div>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {success ? <p className="text-sm text-[#47624f]">{success}</p> : null}

        <section className="rounded-md border border-[#deddd4] bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-medium text-[#24382b]">Pre-validacao de disparo</h3>
              <p className="mt-1 text-sm text-[#65655f]">
                Analise de elegibilidade e risco. Nao envia mensagens e nao cria fila.
              </p>
            </div>
            <button
              className="rounded-md border border-[#24382b] px-3 py-2 text-sm font-semibold text-[#24382b] disabled:opacity-60"
              type="button"
              disabled={prevalidating}
              onClick={() => void handlePrevalidate()}
            >
              {prevalidating ? 'Analisando...' : 'Atualizar pre-validacao'}
            </button>
          </div>

          {prevalidation ? (
            <div className="mt-4 space-y-4">
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-md bg-[#f7f7f5] px-3 py-2">
                  <dt className="text-xs uppercase tracking-wide text-[#65655f]">Total bruto</dt>
                  <dd className="mt-1 text-lg font-semibold text-[#151515]">
                    {prevalidation.totalGross}
                  </dd>
                </div>
                <div className="rounded-md bg-[#eef2ea] px-3 py-2">
                  <dt className="text-xs uppercase tracking-wide text-[#65655f]">Elegiveis</dt>
                  <dd className="mt-1 text-lg font-semibold text-[#24382b]">
                    {prevalidation.eligible}
                  </dd>
                </div>
                <div className="rounded-md bg-[#f7f7f5] px-3 py-2">
                  <dt className="text-xs uppercase tracking-wide text-[#65655f]">
                    Opt-out / BLOCKED
                  </dt>
                  <dd className="mt-1 text-lg font-semibold text-[#151515]">
                    {prevalidation.optOutOrBlocked}
                  </dd>
                </div>
                <div className="rounded-md bg-[#f7f7f5] px-3 py-2">
                  <dt className="text-xs uppercase tracking-wide text-[#65655f]">DELETED</dt>
                  <dd className="mt-1 text-lg font-semibold text-[#151515]">
                    {prevalidation.deleted}
                  </dd>
                </div>
                <div className="rounded-md bg-[#f7f7f5] px-3 py-2">
                  <dt className="text-xs uppercase tracking-wide text-[#65655f]">
                    Telefone invalido
                  </dt>
                  <dd className="mt-1 text-lg font-semibold text-[#151515]">
                    {prevalidation.invalidPhone}
                  </dd>
                </div>
                <div className="rounded-md bg-[#f7f7f5] px-3 py-2">
                  <dt className="text-xs uppercase tracking-wide text-[#65655f]">
                    Telefones duplicados
                  </dt>
                  <dd className="mt-1 text-lg font-semibold text-[#151515]">
                    {prevalidation.duplicatePhone}
                  </dd>
                </div>
                <div className="rounded-md bg-[#f7f7f5] px-3 py-2">
                  <dt className="text-xs uppercase tracking-wide text-[#65655f]">
                    Sem canal compativel
                  </dt>
                  <dd className="mt-1 text-lg font-semibold text-[#151515]">
                    {prevalidation.missingCompatibleChannel}
                  </dd>
                </div>
                <div className="rounded-md bg-[#f7f7f5] px-3 py-2">
                  <dt className="text-xs uppercase tracking-wide text-[#65655f]">
                    WhatsApp campanha
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-[#151515]">
                    {prevalidation.whatsappChannelConnected
                      ? `Conectado${prevalidation.channelAccount ? ` · ${prevalidation.channelAccount.name}` : ''}`
                      : 'Nao conectado'}
                  </dd>
                </div>
              </dl>

              <p className="text-sm text-[#65655f]">
                Limite provisório de volume: {prevalidation.softLimit}. Envios nao estao
                disponiveis nesta etapa.
                {prevalidation.truncated ? ' Analise limitada aos primeiros 5000 contatos.' : ''}
              </p>

              {prevalidation.alerts.length > 0 ? (
                <ul className="space-y-2">
                  {prevalidation.alerts.map((alert) => (
                    <li
                      key={`${alert.code}-${alert.message}`}
                      className={`rounded-md border px-3 py-2 text-sm ${
                        alert.severity === 'critical'
                          ? 'border-red-300 bg-red-50 text-red-900'
                          : alert.severity === 'warning'
                            ? 'border-amber-300 bg-amber-50 text-amber-950'
                            : 'border-[#d7d6cd] bg-[#f7f7f5] text-[#34342f]'
                      }`}
                    >
                      {alert.message}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-[#47624f]">Nenhum alerta critico na pre-validacao.</p>
              )}

              <p className="text-sm font-medium text-[#65655f]">
                Disparo em massa: indisponivel (somente analise).
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-[#65655f]">
              Clique em atualizar para calcular elegibilidade e riscos do publico.
            </p>
          )}
        </section>

        {editing && canWrite ? (
          <form
            className="space-y-4 rounded-md border border-[#deddd4] bg-white p-4"
            onSubmit={handleSave}
          >
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
              <span className="text-sm font-medium text-[#34342f]">Descricao</span>
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
                {tags.map((tag) => {
                  const selected = (filters.tagIds ?? []).includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        selected ? 'bg-[#24382b] text-white' : 'bg-[#eef2ea] text-[#47624f]'
                      }`}
                      onClick={() => toggleTag(tag.id)}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-[#34342f]">Status</span>
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
                <span className="text-sm font-medium text-[#34342f]">Canal</span>
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
                <span className="block text-[#8a1f1f]">Requer confirmacao ao salvar.</span>
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-md border border-[#24382b] px-4 py-2 text-sm font-semibold text-[#24382b]"
                type="button"
                onClick={() => void handlePreview()}
              >
                Atualizar previa ({previewCount ?? '—'})
              </button>
              <button
                className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                type="submit"
                disabled={saving}
              >
                {saving ? 'Salvando...' : 'Salvar alteracoes'}
              </button>
            </div>
          </form>
        ) : null}

        <section className="space-y-3">
          <h3 className="font-medium text-[#24382b]">Contatos do segmento</h3>
          <p className="text-sm text-[#65655f]">Exibindo ate 100 contatos elegiveis no momento.</p>
          {(segment.contacts ?? []).length === 0 ? (
            <div className="rounded-md border border-dashed border-[#d7d6cd] bg-white p-6 text-sm text-[#65655f]">
              Nenhum contato elegivel para estes criterios.
            </div>
          ) : (
            segment.contacts.map((contact) => (
              <article
                key={contact.id}
                className="flex flex-col gap-2 rounded-md border border-[#deddd4] bg-white p-4 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <p className="font-medium text-[#151515]">{contact.name || 'Sem nome'}</p>
                  <p className="text-sm text-[#65655f]">
                    {contact.phoneNumber || 'Sem telefone'} · {getContactStatusLabel(contact.status)}
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
                </div>
                <Link
                  className="rounded-md border border-[#c9c8c0] px-3 py-2 text-sm font-medium text-[#24382b]"
                  href={`/dashboard/campaigns/${campaignId}/contacts/${contact.id}`}
                >
                  Ver contato
                </Link>
              </article>
            ))
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
