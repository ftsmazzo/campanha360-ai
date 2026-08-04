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
  ContentCompositionItem,
  SegmentItem,
  clearStoredToken,
  createDispatchPlan,
  fetchCampaign,
  fetchChannelAccounts,
  fetchContentCompositions,
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
    'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE' | 'CUSTOM'
  >('MODERATE');
  const [validateWhatsAppNumber, setValidateWhatsAppNumber] = useState(true);
  const [disableWhatsAppAck, setDisableWhatsAppAck] = useState(false);
  const [content, setContent] = useState('');
  const [contentCompositionId, setContentCompositionId] = useState('');
  const [compositions, setCompositions] = useState<ContentCompositionItem[]>([]);
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
        const [me, campaignItem, segmentItems, channelItems, compositionItems] =
          await Promise.all([
            fetchMe(token),
            fetchCampaign(token, campaignId),
            fetchSegments(token, campaignId),
            fetchChannelAccounts(token, campaignId),
            fetchContentCompositions(token, campaignId),
          ]);
        setUser(me);
        setCampaign(campaignItem);
        setSegments(segmentItems);
        setChannels(channelItems);
        setCompositions(
          compositionItems.filter(
            (item) => item.status === 'DRAFT' || item.status === 'APPROVED' || item.status === 'READY_FOR_REVIEW',
          ),
        );

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
        validateWhatsAppNumber,
        ...(validateWhatsAppNumber
          ? {}
          : { validateWhatsAppNumberDisableAcknowledged: true }),
        content: content.trim(),
        contentCompositionId: contentCompositionId || null,
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
                    event.target.value as
                      | 'CONSERVATIVE'
                      | 'MODERATE'
                      | 'AGGRESSIVE'
                      | 'CUSTOM',
                  )
                }
              >
                <option value="CONSERVATIVE">Conservador</option>
                <option value="MODERATE">Moderado (padrao)</option>
                <option value="AGGRESSIVE">Agressivo</option>
                <option value="CUSTOM">Custom</option>
              </select>
            </label>

            <fieldset className="rounded-md border border-[#c9c8c0] bg-white p-4 text-sm text-[#24382b]">
              <legend className="px-1 font-medium">Blindagens de envio</legend>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={validateWhatsAppNumber}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setValidateWhatsAppNumber(next);
                    if (next) setDisableWhatsAppAck(false);
                  }}
                />
                <span>
                  <span className="font-medium">
                    Validar se o destinatario possui WhatsApp antes do envio
                  </span>
                  <span className="mt-1 block text-xs text-[#65655f]">
                    Quando ativada, cada numero sera verificado pela Evolution
                    antes da reserva do slot e antes do envio. Numeros invalidos
                    nao receberao mensagem.
                  </span>
                </span>
              </label>
              {!validateWhatsAppNumber ? (
                <div className="mt-3 rounded-md border border-[#e6d9a8] bg-[#fff8e1] p-3">
                  <p className="text-sm text-[#6b5a1e]">
                    A validacao de existencia do WhatsApp sera desativada.
                    Numeros invalidos poderao chegar ao fluxo de envio.
                  </p>
                  <label className="mt-2 flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={disableWhatsAppAck}
                      onChange={(event) =>
                        setDisableWhatsAppAck(event.target.checked)
                      }
                      required
                    />
                    <span>
                      Confirmo explicitamente a desativacao desta blindagem.
                    </span>
                  </label>
                </div>
              ) : null}
            </fieldset>

            <label className="block text-sm text-[#24382b]">
              Composicao de conteudo (opcional)
              <select
                className="mt-1 w-full rounded-md border border-[#c9c8c0] bg-white px-3 py-2"
                value={contentCompositionId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setContentCompositionId(nextId);
                  if (!nextId) return;
                  const selected = compositions.find((item) => item.id === nextId);
                  const base = selected?.variants.find(
                    (variant) =>
                      variant.type === 'BODY' && variant.source === 'BASE',
                  );
                  if (base?.text) setContent(base.text);
                }}
              >
                <option value="">Nenhuma (usar apenas o texto abaixo)</option>
                {compositions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ·{' '}
                    {item.status === 'APPROVED'
                      ? 'Aprovado'
                      : item.status === 'READY_FOR_REVIEW'
                        ? 'Em revisao'
                        : 'Rascunho'}
                  </option>
                ))}
              </select>
            </label>

            {contentCompositionId ? (
              <p className="rounded-md border border-[#d7e3d2] bg-[#f3f7f1] px-3 py-2 text-sm text-[#47624f]">
                Com composicao vinculada, o conteudo do plano sincroniza a partir
                da mensagem-base da composicao.
              </p>
            ) : null}

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
                selectedChannelIds.length === 0 ||
                (!validateWhatsAppNumber && !disableWhatsAppAck)
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
