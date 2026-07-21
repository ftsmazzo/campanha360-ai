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
  DispatchPlanItem,
  DispatchPlanSnapshotSummary,
  SegmentItem,
  cancelDispatchPlan,
  clearStoredToken,
  fetchCampaign,
  fetchChannelAccounts,
  fetchDispatchPlan,
  fetchMe,
  fetchSegments,
  getStoredToken,
  updateDispatchPlan,
} from '../../../../../../lib/api';
import {
  canCancelDispatchPlanStatus,
  getDispatchPlanStatusBadgeClass,
  getDispatchPlanStatusLabel,
  isDispatchPlanEditableStatus,
} from '../../../../../../lib/dispatch-plans';
import { canWriteRole, getOrganizationRole } from '../../../../../../lib/roles';
import { DispatchPlanAudience } from './dispatch-plan-audience';
import { DispatchPlanValidation } from './dispatch-plan-validation';

export default function DispatchPlanDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string; dispatchPlanId: string }>();
  const campaignId = params.id;
  const dispatchPlanId = params.dispatchPlanId;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [campaign, setCampaign] = useState<CampaignItem | null>(null);
  const [plan, setPlan] = useState<DispatchPlanItem | null>(null);
  const [segments, setSegments] = useState<SegmentItem[]>([]);
  const [channels, setChannels] = useState<ChannelAccountItem[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const [channelAccountId, setChannelAccountId] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canWrite = campaign
    ? canWriteRole(getOrganizationRole(user?.memberships, campaign.organizationId))
    : false;

  const editable = plan
    ? isDispatchPlanEditableStatus(plan.status) &&
      canWrite &&
      plan.status !== 'VALIDATING'
    : false;
  const cancelable =
    plan && canWrite ? canCancelDispatchPlanStatus(plan.status) : false;

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
        const [me, campaignItem, planItem, segmentItems, channelItems] =
          await Promise.all([
            fetchMe(token),
            fetchCampaign(token, campaignId),
            fetchDispatchPlan(token, campaignId, dispatchPlanId),
            fetchSegments(token, campaignId),
            fetchChannelAccounts(token, campaignId),
          ]);
        setUser(me);
        setCampaign(campaignItem);
        setPlan(planItem);
        setSegments(segmentItems);
        setChannels(channelItems);
        setName(planItem.name);
        setDescription(planItem.description ?? '');
        setSegmentId(planItem.segmentId);
        setChannelAccountId(planItem.channelAccountId);
        setContent(planItem.content);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearStoredToken();
          router.replace('/login');
          return;
        }
        setError(
          err instanceof ApiError
            ? err.message
            : 'Nao foi possivel carregar o plano',
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [campaignId, dispatchPlanId, router]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!editable) return;

    const token = getStoredToken();
    if (!token) {
      router.replace('/login');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await updateDispatchPlan(token, campaignId, dispatchPlanId, {
        name: name.trim(),
        description: description.trim() || undefined,
        segmentId,
        channelAccountId,
        content: content.trim(),
      });
      setPlan(updated);
      setName(updated.name);
      setDescription(updated.description ?? '');
      setSegmentId(updated.segmentId);
      setChannelAccountId(updated.channelAccountId);
      setContent(updated.content);
      setSuccess('Plano atualizado');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearStoredToken();
        router.replace('/login');
        return;
      }
      setError(
        err instanceof ApiError ? err.message : 'Nao foi possivel atualizar o plano',
      );
    } finally {
      setSaving(false);
    }
  }

  async function onCancel() {
    if (!cancelable || !plan) return;
    if (!window.confirm('Cancelar este plano de disparo?')) return;

    const token = getStoredToken();
    if (!token) {
      router.replace('/login');
      return;
    }

    setCanceling(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await cancelDispatchPlan(token, campaignId, dispatchPlanId);
      setPlan(updated);
      setSuccess('Plano cancelado');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearStoredToken();
        router.replace('/login');
        return;
      }
      setError(
        err instanceof ApiError ? err.message : 'Nao foi possivel cancelar o plano',
      );
    } finally {
      setCanceling(false);
    }
  }

  function onSnapshotGenerated(summary: DispatchPlanSnapshotSummary) {
    setPlan((current) =>
      current
        ? {
            ...current,
            version: summary.version,
            snapshotCreatedAt: summary.snapshotCreatedAt,
            totalEvaluated: summary.totalEvaluated,
            totalEligible: summary.totalEligible,
            totalExcluded: summary.totalExcluded,
            byEligibilityStatus: summary.byEligibilityStatus,
            validationSnapshot: null,
            validatedAt: null,
            validatedVersion: null,
            validationIsCurrent: false,
            status: 'DRAFT',
          }
        : current,
    );
  }

  function onPlanUpdated(updated: DispatchPlanItem) {
    setPlan(updated);
    setName(updated.name);
    setDescription(updated.description ?? '');
    setSegmentId(updated.segmentId);
    setChannelAccountId(updated.channelAccountId);
    setContent(updated.content);
  }

  return (
    <DashboardShell userName={user?.name}>
      <div className="rounded-md border border-[#deddd4] bg-[#f7f6f1] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-[#65655f]">
              Planejamento de Disparos
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-[#151515]">
              {plan?.name ?? 'Carregando...'}
            </h2>
            {campaign ? (
              <p className="mt-1 text-sm text-[#65655f]">{campaign.name}</p>
            ) : null}
            {plan ? (
              <p className="mt-2 text-sm text-[#65655f]">
                Status:{' '}
                <span
                  className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${getDispatchPlanStatusBadgeClass(plan.status)}`}
                >
                  {getDispatchPlanStatusLabel(plan.status)}
                </span>{' '}
                · versao {plan.version} · criado por {plan.createdBy.name}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm font-medium text-[#24382b]"
              href={`/dashboard/campaigns/${campaignId}/dispatch-plans`}
            >
              Voltar a listagem
            </Link>
            {cancelable ? (
              <button
                className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-60"
                type="button"
                onClick={onCancel}
                disabled={canceling}
              >
                {canceling ? 'Cancelando...' : 'Cancelar plano'}
              </button>
            ) : null}
          </div>
        </div>

        <p className="mt-4 rounded-md border border-[#e6d9a8] bg-[#fff8e1] px-3 py-2 text-sm text-[#6b5a1e]">
          Nada sera enviado a partir desta tela. Simulacao, aprovacao e execucao
          permanecem fora desta subetapa.
        </p>

        {loading ? (
          <p className="mt-6 text-sm text-[#65655f]">Carregando...</p>
        ) : null}
        {error ? (
          <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="mt-6 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            {success}
          </p>
        ) : null}

        {!loading && plan ? (
          <>
          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <label className="block text-sm text-[#24382b]">
              Nome
              <input
                className="mt-1 w-full rounded-md border border-[#c9c8c0] bg-white px-3 py-2 disabled:bg-[#eee]"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={!editable}
                minLength={2}
                maxLength={120}
                required
              />
            </label>

            <label className="block text-sm text-[#24382b]">
              Descricao
              <textarea
                className="mt-1 w-full rounded-md border border-[#c9c8c0] bg-white px-3 py-2 disabled:bg-[#eee]"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={!editable}
                maxLength={1000}
                rows={3}
              />
            </label>

            <label className="block text-sm text-[#24382b]">
              Segmento
              <select
                className="mt-1 w-full rounded-md border border-[#c9c8c0] bg-white px-3 py-2 disabled:bg-[#eee]"
                value={segmentId}
                onChange={(event) => setSegmentId(event.target.value)}
                disabled={!editable}
                required
              >
                {segments.map((segment) => (
                  <option key={segment.id} value={segment.id}>
                    {segment.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm text-[#24382b]">
              Canal
              <select
                className="mt-1 w-full rounded-md border border-[#c9c8c0] bg-white px-3 py-2 disabled:bg-[#eee]"
                value={channelAccountId}
                onChange={(event) => setChannelAccountId(event.target.value)}
                disabled={!editable}
                required
              >
                {evolutionChannels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name} · {channel.status}
                  </option>
                ))}
                {!evolutionChannels.some((channel) => channel.id === channelAccountId) &&
                plan.channelAccount ? (
                  <option value={plan.channelAccountId}>
                    {plan.channelAccount.name} · {plan.channelAccount.status}
                  </option>
                ) : null}
              </select>
            </label>

            <label className="block text-sm text-[#24382b]">
              Conteudo textual
              <textarea
                className="mt-1 w-full rounded-md border border-[#c9c8c0] bg-white px-3 py-2 disabled:bg-[#eee]"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                disabled={!editable}
                minLength={1}
                maxLength={4000}
                rows={6}
                required
              />
            </label>

            {editable ? (
              <button
                className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                type="submit"
                disabled={saving}
              >
                {saving ? 'Salvando...' : 'Salvar alteracoes'}
              </button>
            ) : (
              <p className="text-sm text-[#65655f]">
                {canWrite
                  ? plan.status === 'VALIDATED'
                    ? 'Plano validado. Use Reabrir para edicao antes de alterar.'
                    : plan.status === 'VALIDATING'
                      ? 'Validacao em andamento. Aguarde a conclusao.'
                      : 'Este plano nao pode ser editado no status atual.'
                  : 'Voce possui acesso somente leitura a este plano.'}
              </p>
            )}
          </form>
          <DispatchPlanAudience
            campaignId={campaignId}
            plan={plan}
            canWrite={canWrite}
            onSnapshotGenerated={onSnapshotGenerated}
          />
          <DispatchPlanValidation
            campaignId={campaignId}
            plan={plan}
            canWrite={canWrite}
            onPlanUpdated={onPlanUpdated}
          />
          </>
        ) : null}
      </div>
    </DashboardShell>
  );
}
