'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DashboardShell } from '../../../../../../components/dashboard-shell';
import {
  ApiError,
  AuthUser,
  CampaignItem,
  ChannelAccountItem,
  SegmentItem,
  clearStoredToken,
  createDispatchPlan,
  fetchCampaign,
  fetchChannelAccounts,
  fetchMe,
  fetchSegments,
  getStoredToken,
} from '../../../../../../lib/api';
import { canWriteRole, getOrganizationRole } from '../../../../../../lib/roles';

export default function NewDispatchPlanPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const campaignId = params.id;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [campaign, setCampaign] = useState<CampaignItem | null>(null);
  const [segments, setSegments] = useState<SegmentItem[]>([]);
  const [channels, setChannels] = useState<ChannelAccountItem[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [protectionProfile, setProtectionProfile] = useState<
    'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE'
  >('MODERATE');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canWrite = campaign
    ? canWriteRole(getOrganizationRole(user?.memberships, campaign.organizationId))
    : false;

  const evolutionChannels = useMemo(
    () =>
      channels.filter(
        (channel) =>
          channel.provider === 'WHATSAPP_EVOLUTION' && channel.status !== 'ARCHIVED',
      ),
    [channels],
  );

  useEffect(() => {
    async function load() {
      const token = getStoredToken();
      if (!token) {
        router.replace('/login');
        return;
      }

      try {
        const [me, campaignItem, segmentItems, channelItems] = await Promise.all([
          fetchMe(token),
          fetchCampaign(token, campaignId),
          fetchSegments(token, campaignId),
          fetchChannelAccounts(token, campaignId),
        ]);
        setUser(me);
        setCampaign(campaignItem);
        setSegments(segmentItems);
        setChannels(channelItems);

        const role = getOrganizationRole(me.memberships, campaignItem.organizationId);
        if (!canWriteRole(role)) {
          setError('Voce nao tem permissao para criar planos de disparo');
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearStoredToken();
          router.replace('/login');
          return;
        }
        setError(
          err instanceof ApiError
            ? err.message
            : 'Nao foi possivel carregar dados do formulario',
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [campaignId, router]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canWrite) return;

    const token = getStoredToken();
    if (!token) {
      router.replace('/login');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const plan = await createDispatchPlan(token, campaignId, {
        name: name.trim(),
        description: description.trim() || undefined,
        segmentId,
        channelAccountId: selectedChannelIds[0]!,
        channels: selectedChannelIds.map((channelAccountId) => ({
          channelAccountId,
        })),
        protectionProfile,
        content: content.trim(),
      });
      router.replace(
        `/dashboard/campaigns/${campaignId}/dispatch-plans/${plan.id}`,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearStoredToken();
        router.replace('/login');
        return;
      }
      setError(
        err instanceof ApiError ? err.message : 'Nao foi possivel criar o plano',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <DashboardShell userName={user?.name}>
      <div className="rounded-md border border-[#deddd4] bg-[#f7f6f1] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-[#151515]">Criar rascunho</h2>
            {campaign ? (
              <p className="mt-1 text-sm text-[#65655f]">{campaign.name}</p>
            ) : null}
            <p className="mt-2 text-sm text-[#65655f]">
              Este plano inicia em DRAFT. Nenhuma mensagem sera enviada.
            </p>
          </div>
          <Link
            className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm font-medium text-[#24382b]"
            href={`/dashboard/campaigns/${campaignId}/dispatch-plans`}
          >
            Voltar a listagem
          </Link>
        </div>

        {loading ? (
          <p className="mt-6 text-sm text-[#65655f]">Carregando...</p>
        ) : null}
        {error ? (
          <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {!loading && canWrite ? (
          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <label className="block text-sm text-[#24382b]">
              Nome
              <input
                className="mt-1 w-full rounded-md border border-[#c9c8c0] bg-white px-3 py-2"
                value={name}
                onChange={(event) => setName(event.target.value)}
                minLength={2}
                maxLength={120}
                required
              />
            </label>

            <label className="block text-sm text-[#24382b]">
              Descricao (opcional)
              <textarea
                className="mt-1 w-full rounded-md border border-[#c9c8c0] bg-white px-3 py-2"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={1000}
                rows={3}
              />
            </label>

            <label className="block text-sm text-[#24382b]">
              Segmento
              <select
                className="mt-1 w-full rounded-md border border-[#c9c8c0] bg-white px-3 py-2"
                value={segmentId}
                onChange={(event) => setSegmentId(event.target.value)}
                required
              >
                <option value="">Selecione um segmento</option>
                {segments.map((segment) => (
                  <option key={segment.id} value={segment.id}>
                    {segment.name}
                    {typeof segment.contactCount === 'number'
                      ? ` (${segment.contactCount})`
                      : ''}
                  </option>
                ))}
              </select>
            </label>

            <fieldset className="block text-sm text-[#24382b]">
              <legend className="mb-2 font-medium">
                Instancias WhatsApp (multi-selecao)
              </legend>
              <div className="space-y-2 rounded-md border border-[#c9c8c0] bg-white p-3">
                {evolutionChannels.map((channel) => (
                  <label
                    key={channel.id}
                    className="flex cursor-pointer items-center gap-2"
                  >
                    <input
                      type="checkbox"
                      checked={selectedChannelIds.includes(channel.id)}
                      onChange={(event) => {
                        setSelectedChannelIds((current) =>
                          event.target.checked
                            ? [...current, channel.id]
                            : current.filter((id) => id !== channel.id),
                        );
                      }}
                    />
                    <span>
                      {channel.name} · {channel.status}
                    </span>
                  </label>
                ))}
              </div>
              {selectedChannelIds.length > 1 ? (
                <p className="mt-2 text-xs text-[#65655f]">
                  Plano multi-instancia: {selectedChannelIds.length} instancias
                  selecionadas.
                </p>
              ) : null}
            </fieldset>

            {evolutionChannels.length === 0 ? (
              <p className="text-sm text-[#8a5a00]">
                Nenhum canal WhatsApp Evolution disponivel. Cadastre um canal antes de criar o
                plano.
              </p>
            ) : null}

            <label className="block text-sm text-[#24382b]">
              Perfil de blindagem
              <select
                className="mt-1 w-full rounded-md border border-[#c9c8c0] bg-white px-3 py-2"
                value={protectionProfile}
                onChange={(event) =>
                  setProtectionProfile(
                    event.target.value as 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE',
                  )
                }
              >
                <option value="CONSERVATIVE">Conservador</option>
                <option value="MODERATE">Moderado (padrao)</option>
                <option value="AGGRESSIVE">Agressivo</option>
              </select>
            </label>

            <label className="block text-sm text-[#24382b]">
              Conteudo textual inicial
              <textarea
                className="mt-1 w-full rounded-md border border-[#c9c8c0] bg-white px-3 py-2"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                minLength={1}
                maxLength={4000}
                rows={6}
                required
              />
            </label>

            <p className="rounded-md border border-[#e6d9a8] bg-[#fff8e1] px-3 py-2 text-sm text-[#6b5a1e]">
              Aviso: salvar este plano nao envia mensagens, nao cria fila e nao congela publico.
            </p>

            <button
              className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              type="submit"
              disabled={
                saving ||
                evolutionChannels.length === 0 ||
                segments.length === 0 ||
                selectedChannelIds.length === 0
              }
            >
              {saving ? 'Salvando...' : 'Criar rascunho'}
            </button>
          </form>
        ) : null}
      </div>
    </DashboardShell>
  );
}
