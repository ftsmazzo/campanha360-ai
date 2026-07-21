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
  MultiInstanceConsolidated,
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
  getDistributionStrategyLabel,
  getPlanChannelStageLabel,
  getProtectionProfileLabel,
  hasMultiInstanceCapacityDeficit,
  isDispatchPlanEditableStatus,
  resolveMultiInstanceConsolidated,
} from '../../../../../../lib/dispatch-plans';
import { canApproveRole, canWriteRole, getOrganizationRole } from '../../../../../../lib/roles';
import { DispatchPlanAudience } from './dispatch-plan-audience';
import { DispatchPlanApproval } from './dispatch-plan-approval';
import { DispatchPlanProgress } from './dispatch-plan-progress';
import { DispatchPlanSimulation } from './dispatch-plan-simulation';
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
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [protectionProfile, setProtectionProfile] = useState<
    'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE'
  >('MODERATE');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canWrite = campaign
    ? canWriteRole(getOrganizationRole(user?.memberships, campaign.organizationId))
    : false;
  const canApprove = campaign
    ? canApproveRole(
        getOrganizationRole(user?.memberships, campaign.organizationId),
      )
    : false;

  const editable = plan
    ? isDispatchPlanEditableStatus(plan.status) &&
      canWrite &&
      plan.status !== 'VALIDATING' &&
      !plan.planIsImmutable
    : false;
  const cancelable =
    plan && canWrite
      ? (plan.allowedActions?.canCancel ??
        canCancelDispatchPlanStatus(plan.status))
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
        setSelectedChannelIds(
          planItem.planChannels?.length
            ? planItem.planChannels.map((row) => row.channelAccountId)
            : [planItem.channelAccountId],
        );
        setProtectionProfile(
          (planItem.protectionPolicySnapshot?.profile as
            | 'CONSERVATIVE'
            | 'MODERATE'
            | 'AGGRESSIVE') ?? 'MODERATE',
        );
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
        channelAccountId: selectedChannelIds[0],
        channels: selectedChannelIds.map((channelAccountId) => ({
          channelAccountId,
        })),
        protectionProfile,
        content: content.trim(),
      });
      setPlan(updated);
      setName(updated.name);
      setDescription(updated.description ?? '');
      setSegmentId(updated.segmentId);
      setSelectedChannelIds(
        updated.planChannels?.length
          ? updated.planChannels.map((row) => row.channelAccountId)
          : [updated.channelAccountId],
      );
      setProtectionProfile(
        (updated.protectionPolicySnapshot?.profile as
          | 'CONSERVATIVE'
          | 'MODERATE'
          | 'AGGRESSIVE') ?? 'MODERATE',
      );
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
    const reason = window.prompt(
      'Informe o motivo do cancelamento (minimo 10 caracteres):',
    );
    if (reason == null) return;
    if (reason.trim().length < 10) {
      setError('Motivo do cancelamento deve ter ao menos 10 caracteres');
      return;
    }

    const token = getStoredToken();
    if (!token) {
      router.replace('/login');
      return;
    }

    setCanceling(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await cancelDispatchPlan(
        token,
        campaignId,
        dispatchPlanId,
        reason.trim(),
      );
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
            simulationSnapshot: null,
            simulatedAt: null,
            simulatedVersion: null,
            simulationIsCurrent: false,
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
    setSelectedChannelIds(
      updated.planChannels?.length
        ? updated.planChannels.map((row) => row.channelAccountId)
        : [updated.channelAccountId],
    );
    setProtectionProfile(
      (updated.protectionPolicySnapshot?.profile as
        | 'CONSERVATIVE'
        | 'MODERATE'
        | 'AGGRESSIVE') ?? 'MODERATE',
    );
    setContent(updated.content);
  }

  const policy = plan?.protectionPolicySnapshot;
  const multiInstanceConsolidated = useMemo((): MultiInstanceConsolidated | null => {
    if (!plan) return null;
    return resolveMultiInstanceConsolidated(plan) as MultiInstanceConsolidated | null;
  }, [plan]);
  const showCapacityDeficitAlert = hasMultiInstanceCapacityDeficit(
    multiInstanceConsolidated?.capacityDeficit,
  );

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
          Nada sera enviado a partir desta tela. A criacao do disparo real
          permanece no Epico 09.
        </p>

        {!loading && plan ? <DispatchPlanProgress plan={plan} /> : null}

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
              Instancias WhatsApp
              <div className="mt-1 space-y-2 rounded-md border border-[#c9c8c0] bg-white p-3 disabled:bg-[#eee]">
                {evolutionChannels.map((channel) => (
                  <label
                    key={channel.id}
                    className={`flex items-center gap-2 ${editable ? 'cursor-pointer' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedChannelIds.includes(channel.id)}
                      disabled={!editable}
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
                {!evolutionChannels.some((channel) =>
                  selectedChannelIds.includes(channel.id),
                ) &&
                plan.channelAccount ? (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked disabled readOnly />
                    <span>
                      {plan.channelAccount.name} · {plan.channelAccount.status}
                    </span>
                  </label>
                ) : null}
              </div>
            </label>

            <label className="block text-sm text-[#24382b]">
              Perfil de blindagem
              <select
                className="mt-1 w-full rounded-md border border-[#c9c8c0] bg-white px-3 py-2 disabled:bg-[#eee]"
                value={protectionProfile}
                disabled={!editable}
                onChange={(event) =>
                  setProtectionProfile(
                    event.target.value as 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE',
                  )
                }
              >
                <option value="CONSERVATIVE">Conservador</option>
                <option value="MODERATE">Moderado</option>
                <option value="AGGRESSIVE">Agressivo</option>
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
                disabled={saving || selectedChannelIds.length === 0}
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

          {policy ? (
            <section className="mt-6 rounded-md border border-[#deddd4] bg-white p-4">
              <h3 className="font-semibold text-[#151515]">
                Politica de blindagem
              </h3>
              <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-[#65655f]">Perfil</dt>
                  <dd>{getProtectionProfileLabel(policy.profile)}</dd>
                </div>
                <div>
                  <dt className="text-[#65655f]">Distribuicao</dt>
                  <dd>
                    {getDistributionStrategyLabel(policy.distributionStrategy)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[#65655f]">Limite diario / instancia</dt>
                  <dd>{policy.dailyLimitPerInstance} msg</dd>
                </div>
                <div>
                  <dt className="text-[#65655f]">Janela operacional</dt>
                  <dd>
                    {policy.allowedStartTime}–{policy.allowedEndTime} (
                    {policy.timezone})
                  </dd>
                </div>
              </dl>
              {plan.multiInstanceEnabled ? (
                <p className="mt-2 text-xs text-[#65655f]">
                  Multi-instancia ativo · {plan.planChannels?.length ?? 0}{' '}
                  instancia(s) no pool.
                </p>
              ) : null}
            </section>
          ) : null}

          {plan.planChannels && plan.planChannels.length > 0 ? (
            <section className="mt-6 rounded-md border border-[#deddd4] bg-white p-4">
              <h3 className="font-semibold text-[#151515]">
                Pool de instancias (planChannels)
              </h3>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-[#deddd4] text-[#65655f]">
                    <tr>
                      <th className="px-2 py-2 font-medium">Instancia</th>
                      <th className="px-2 py-2 font-medium">Status</th>
                      <th className="px-2 py-2 font-medium">Capacidade</th>
                      <th className="px-2 py-2 font-medium">Atribuidos</th>
                      <th className="px-2 py-2 font-medium">Saude</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.planChannels.map((row) => {
                      const health = row.healthSnapshot;
                      return (
                        <tr
                          key={row.id}
                          className="border-b border-[#f0efe8] text-[#24382b]"
                        >
                          <td className="px-2 py-2">
                            {row.channelAccount.name}
                          </td>
                          <td className="px-2 py-2">{row.channelAccount.status}</td>
                          <td className="px-2 py-2">
                            {health?.effectiveDailyLimit ??
                              row.assignedCapacity ??
                              row.dailyLimit}
                          </td>
                          <td className="px-2 py-2">
                            {row.assignedRecipients}
                          </td>
                          <td className="px-2 py-2 text-xs">
                            {health ? (
                              <>
                                {health.blocked ? 'Bloqueado' : 'Elegivel'} ·{' '}
                                {getPlanChannelStageLabel(health.stage)}
                                {health.reasons.length > 0
                                  ? ` · ${health.reasons.join(', ')}`
                                  : ''}
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {multiInstanceConsolidated ? (
            <section className="mt-6 rounded-md border border-[#deddd4] bg-white p-4">
              <h3 className="font-semibold text-[#151515]">
                Consolidado multi-instancia
              </h3>
              <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-[#65655f]">Instancias elegiveis</dt>
                  <dd>
                    {typeof multiInstanceConsolidated.eligibleInstances ===
                    'number'
                      ? multiInstanceConsolidated.eligibleInstances
                      : '—'}{' '}
                    /{' '}
                    {typeof multiInstanceConsolidated.selectedInstances ===
                    'number'
                      ? multiInstanceConsolidated.selectedInstances
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[#65655f]">Capacidade total</dt>
                  <dd>
                    {typeof multiInstanceConsolidated.totalCapacity === 'number'
                      ? multiInstanceConsolidated.totalCapacity
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[#65655f]">Publico elegivel</dt>
                  <dd>
                    {typeof multiInstanceConsolidated.totalEligibleAudience ===
                    'number'
                      ? multiInstanceConsolidated.totalEligibleAudience
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[#65655f]">Deficit / nao atribuidos</dt>
                  <dd>
                    {typeof multiInstanceConsolidated.capacityDeficit ===
                    'number'
                      ? multiInstanceConsolidated.capacityDeficit
                      : '—'}{' '}
                    /{' '}
                    {typeof multiInstanceConsolidated.unassignedRecipients ===
                    'number'
                      ? multiInstanceConsolidated.unassignedRecipients
                      : '—'}
                  </dd>
                </div>
              </dl>
              {showCapacityDeficitAlert ? (
                <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  Capacidade insuficiente para o publico elegivel.
                </p>
              ) : null}
            </section>
          ) : null}

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
          <DispatchPlanSimulation
            campaignId={campaignId}
            plan={plan}
            canWrite={canWrite}
            onPlanUpdated={onPlanUpdated}
          />
          <DispatchPlanApproval
            campaignId={campaignId}
            plan={plan}
            canWrite={canWrite}
            canApprove={canApprove}
            onPlanUpdated={onPlanUpdated}
          />
          </>
        ) : null}
      </div>
    </DashboardShell>
  );
}
