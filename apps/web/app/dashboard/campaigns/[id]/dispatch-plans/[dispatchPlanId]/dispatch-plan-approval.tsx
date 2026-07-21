'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ApiError,
  DispatchPlanItem,
  approveDispatchPlan,
  createDispatch,
  getStoredToken,
  rejectDispatchPlan,
} from '../../../../../../lib/api';
import {
  formatDurationSeconds,
  formatZonedDateTime,
} from '../../../../../../lib/dispatch-plans';

type Props = {
  campaignId: string;
  plan: DispatchPlanItem;
  canWrite: boolean;
  canApprove: boolean;
  onPlanUpdated: (plan: DispatchPlanItem) => void;
};

export function DispatchPlanApproval({
  campaignId,
  plan,
  canWrite,
  canApprove,
  onPlanUpdated,
}: Props) {
  const router = useRouter();
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [showCreateDispatchConfirm, setShowCreateDispatchConfirm] =
    useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const simulation = plan.simulationSnapshot;
  const approval = plan.approvalSnapshot;
  const canApproveAction =
    canApprove && (plan.allowedActions?.canApprove ?? false);
  const canRejectAction =
    canApprove && (plan.allowedActions?.canReject ?? false);
  const canCreateDispatchAction =
    canApprove && (plan.allowedActions?.canCreateDispatch ?? false);

  let guidance: string | null = null;
  if (plan.status === 'DRAFT') {
    guidance =
      'Conclua snapshot, blindagens e simulacao antes da aprovacao.';
  } else if (plan.status === 'BLOCKED') {
    guidance = 'Corrija as blindagens e revalide o Plano antes de aprovar.';
  } else if (plan.status === 'VALIDATED' && !plan.simulationIsCurrent) {
    guidance = 'Gere ou recalcule a simulacao atual antes de aprovar.';
  }

  async function onApprove() {
    const token = getStoredToken();
    if (!token) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await approveDispatchPlan(token, campaignId, plan.id);
      onPlanUpdated(updated);
      setShowApproveConfirm(false);
      setSuccess('Plano aprovado e tornado imutavel.');
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Nao foi possivel aprovar',
      );
    } finally {
      setLoading(false);
    }
  }

  async function onCreateDispatch() {
    const token = getStoredToken();
    if (!token) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await createDispatch(token, campaignId, plan.id);
      setShowCreateDispatchConfirm(false);
      router.push(
        `/dashboard/campaigns/${campaignId}/dispatches/${created.id}`,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(
          err.message ||
            'Ja existe um Disparo para este Plano. Abra a listagem de Disparos.',
        );
        setShowCreateDispatchConfirm(false);
      } else {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Nao foi possivel criar o Disparo',
        );
      }
    } finally {
      setLoading(false);
    }
  }

  async function onReject(event: FormEvent) {
    event.preventDefault();
    const token = getStoredToken();
    if (!token) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await rejectDispatchPlan(
        token,
        campaignId,
        plan.id,
        rejectReason.trim(),
      );
      onPlanUpdated(updated);
      setShowRejectForm(false);
      setSuccess('Plano rejeitado.');
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Nao foi possivel rejeitar',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-8 border-t border-[#deddd4] pt-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-[#65655f]">
          Etapa 5
        </p>
        <h3 className="mt-1 text-xl font-semibold text-[#151515]">Aprovacao</h3>
        <p className="mt-1 text-sm text-[#65655f]">
          Decisao final do Plano. Nenhuma mensagem sera enviada nesta etapa.
        </p>
      </div>

      {guidance ? (
        <p className="mt-4 rounded-md border border-[#deddd4] bg-white px-3 py-2 text-sm text-[#65655f]">
          {guidance}
        </p>
      ) : null}

      {plan.status === 'VALIDATED' && plan.simulationIsCurrent ? (
        <div className="mt-4 rounded-md border border-[#deddd4] bg-white p-4 text-sm text-[#24382b]">
          <h4 className="font-semibold">Resumo final</h4>
          <dl className="mt-3 grid gap-2 md:grid-cols-2">
            <div>
              <dt className="text-[#65655f]">Segmento</dt>
              <dd>{plan.segment.name}</dd>
            </div>
            <div>
              <dt className="text-[#65655f]">Canal</dt>
              <dd>
                {plan.channelAccount.name} · {plan.channelAccount.status}
              </dd>
            </div>
            <div>
              <dt className="text-[#65655f]">Avaliados / elegiveis / excluidos</dt>
              <dd>
                {plan.totalEvaluated} / {plan.totalEligible} /{' '}
                {plan.totalExcluded}
              </dd>
            </div>
            {simulation ? (
              <>
                <div>
                  <dt className="text-[#65655f]">Velocidade efetiva</dt>
                  <dd>
                    {simulation.estimates.effectiveMessagesPerMinute} msg/min
                  </dd>
                </div>
                <div>
                  <dt className="text-[#65655f]">Lotes</dt>
                  <dd>{simulation.estimates.totalBatches}</dd>
                </div>
                <div>
                  <dt className="text-[#65655f]">Duracao estimada</dt>
                  <dd>
                    {formatDurationSeconds(
                      simulation.estimates.estimatedCalendarDurationSeconds,
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[#65655f]">Inicio estimado</dt>
                  <dd>
                    {formatZonedDateTime(
                      simulation.estimates.estimatedStartAt,
                      simulation.configuration.timezone,
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[#65655f]">Fim estimado</dt>
                  <dd>
                    {formatZonedDateTime(
                      simulation.estimates.estimatedEndAt,
                      simulation.configuration.timezone,
                    )}
                  </dd>
                </div>
              </>
            ) : null}
          </dl>

          <div className="mt-4 flex flex-wrap gap-2">
            {canApproveAction ? (
              <button
                type="button"
                className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                disabled={loading}
                onClick={() => setShowApproveConfirm(true)}
              >
                Aprovar Plano
              </button>
            ) : null}
            {canRejectAction ? (
              <button
                type="button"
                className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-60"
                disabled={loading}
                onClick={() => setShowRejectForm(true)}
              >
                Rejeitar Plano
              </button>
            ) : null}
            {!canApprove && canWrite ? (
              <p className="text-sm text-[#65655f]">
                Seu papel pode preparar o Plano, mas nao aprova nem rejeita.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {showApproveConfirm ? (
        <div className="mt-4 rounded-md border border-[#24382b] bg-[#f7f6f1] p-4">
          <h4 className="font-semibold text-[#151515]">Confirmar aprovacao</h4>
          <p className="mt-2 text-sm text-[#24382b]">
            Plano <strong>{plan.name}</strong>. Ao aprovar, o publico, o canal,
            o conteudo, as blindagens e a simulacao serao considerados
            definitivos para este Plano. Nenhuma mensagem sera enviada nesta
            etapa.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              disabled={loading}
              onClick={onApprove}
            >
              {loading ? 'Aprovando...' : 'Confirmar aprovacao'}
            </button>
            <button
              type="button"
              className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm"
              disabled={loading}
              onClick={() => setShowApproveConfirm(false)}
            >
              Voltar
            </button>
          </div>
        </div>
      ) : null}

      {showRejectForm ? (
        <form
          className="mt-4 rounded-md border border-red-200 bg-red-50 p-4"
          onSubmit={onReject}
        >
          <h4 className="font-semibold text-red-800">Rejeitar Plano</h4>
          <label className="mt-3 block text-sm text-red-900">
            Motivo (10 a 500 caracteres)
            <textarea
              className="mt-1 w-full rounded-md border border-red-200 bg-white px-3 py-2"
              rows={4}
              minLength={10}
              maxLength={500}
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              required
            />
            <span className="mt-1 block text-xs">
              {rejectReason.trim().length}/500
            </span>
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="submit"
              className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              disabled={loading || rejectReason.trim().length < 10}
            >
              {loading ? 'Rejeitando...' : 'Confirmar rejeicao'}
            </button>
            <button
              type="button"
              className="rounded-md border border-red-300 px-4 py-2 text-sm"
              onClick={() => setShowRejectForm(false)}
            >
              Voltar
            </button>
          </div>
        </form>
      ) : null}

      {plan.status === 'APPROVED' && approval ? (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          <p className="font-semibold">Plano aprovado e imutavel.</p>
          <p className="mt-2">
            Aprovado em{' '}
            {plan.approvedAt
              ? new Date(plan.approvedAt).toLocaleString('pt-BR')
              : '—'}
            {plan.approvedBy ? ` por ${plan.approvedBy.name}` : ''}. Hash do
            conteudo: {approval.content.hash.slice(0, 12)}…
          </p>

          {canCreateDispatchAction ? (
            <div className="mt-4">
              <button
                type="button"
                className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                disabled={loading}
                onClick={() => setShowCreateDispatchConfirm(true)}
              >
                Criar Disparo
              </button>
            </div>
          ) : plan.existingDispatchId ? (
            <p className="mt-3">
              <a
                className="font-medium underline"
                href={`/dashboard/campaigns/${campaignId}/dispatches/${plan.existingDispatchId}`}
              >
                Abrir Disparo existente
              </a>
            </p>
          ) : !canApprove ? (
            <p className="mt-3 text-green-800">
              Apenas OWNER/ADMIN podem criar o Disparo. Voce pode visualizar o
              Plano.
            </p>
          ) : null}
        </div>
      ) : null}

      {showCreateDispatchConfirm ? (
        <div className="mt-4 rounded-md border border-[#24382b] bg-[#f7f6f1] p-4">
          <h4 className="font-semibold text-[#151515]">Confirmar criacao</h4>
          <p className="mt-2 text-sm text-[#24382b]">
            Este Disparo sera criado a partir do Plano aprovado e herdara seu
            publico, canal, conteudo e configuracao. Nenhuma mensagem sera
            enviada nesta etapa.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              disabled={loading}
              onClick={onCreateDispatch}
            >
              {loading ? 'Criando...' : 'Confirmar criacao'}
            </button>
            <button
              type="button"
              className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm"
              disabled={loading}
              onClick={() => setShowCreateDispatchConfirm(false)}
            >
              Voltar
            </button>
          </div>
        </div>
      ) : null}

      {plan.status === 'REJECTED' ? (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-semibold">Plano rejeitado</p>
          <p className="mt-2">{plan.rejectionReason}</p>
          <p className="mt-2 text-xs">
            {plan.rejectedAt
              ? new Date(plan.rejectedAt).toLocaleString('pt-BR')
              : ''}
            {plan.rejectedBy ? ` · ${plan.rejectedBy.name}` : ''}
          </p>
          <p className="mt-2">
            Crie um novo Plano para uma nova tentativa.
          </p>
        </div>
      ) : null}

      {plan.status === 'CANCELED' ? (
        <div className="mt-4 rounded-md border border-[#ddd] bg-[#f5f5f5] p-4 text-sm text-[#65655f]">
          <p className="font-semibold text-[#24382b]">Plano cancelado</p>
          <p className="mt-2">{plan.cancellationReason}</p>
          <p className="mt-2 text-xs">
            {plan.canceledAt
              ? new Date(plan.canceledAt).toLocaleString('pt-BR')
              : ''}
            {plan.canceledBy ? ` · ${plan.canceledBy.name}` : ''}
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="mt-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {success}
        </p>
      ) : null}
    </section>
  );
}
