'use client';

import { useState } from 'react';
import {
  ApiError,
  DispatchPlanItem,
  DispatchPlanValidationCheck,
  reopenDispatchPlan,
  validateDispatchPlan,
  getStoredToken,
} from '../../../../../../lib/api';
import {
  getDispatchPlanStatusLabel,
  getValidationSeverityLabel,
} from '../../../../../../lib/dispatch-plans';

type Props = {
  campaignId: string;
  plan: DispatchPlanItem;
  canWrite: boolean;
  onPlanUpdated: (plan: DispatchPlanItem) => void;
};

function severityClass(severity: string, passed: boolean): string {
  if (passed && severity !== 'ERROR') {
    return 'border-[#c9c8c0] bg-white text-[#24382b]';
  }
  if (severity === 'ERROR') {
    return 'border-red-200 bg-red-50 text-red-800';
  }
  if (severity === 'WARNING') {
    return 'border-amber-200 bg-amber-50 text-amber-900';
  }
  return 'border-[#d7e4dc] bg-[#f3f8f5] text-[#24382b]';
}

function CheckList({
  title,
  checks,
}: {
  title: string;
  checks: DispatchPlanValidationCheck[];
}) {
  if (checks.length === 0) return null;

  return (
    <div className="mt-4">
      <h4 className="text-sm font-semibold text-[#151515]">{title}</h4>
      <ul className="mt-2 space-y-2">
        {checks.map((check) => (
          <li
            key={check.code}
            className={`rounded-md border px-3 py-2 text-sm ${severityClass(check.severity, check.passed)}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{check.title}</span>
              <span className="text-xs uppercase tracking-wide">
                {getValidationSeverityLabel(check.severity)} ·{' '}
                {check.passed ? 'Passou' : 'Falhou'}
              </span>
            </div>
            <p className="mt-1">{check.message}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DispatchPlanValidation({
  campaignId,
  plan,
  canWrite,
  onPlanUpdated,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const snapshot = plan.validationSnapshot;
  const checks = snapshot?.checks ?? [];
  const errors = checks.filter((item) => item.severity === 'ERROR' && !item.passed);
  const warnings = checks.filter(
    (item) => item.severity === 'WARNING' && !item.passed,
  );
  const infos = checks.filter((item) => item.severity === 'INFO');

  const canValidate =
    canWrite &&
    (plan.allowedActions?.canValidate ??
      (plan.status === 'DRAFT' && Boolean(plan.snapshotCreatedAt)));
  const canReopen =
    canWrite &&
    (plan.allowedActions?.canReopen ??
      (plan.status === 'VALIDATED' || plan.status === 'BLOCKED'));
  const isValidating = plan.status === 'VALIDATING';
  const hasSnapshot = Boolean(plan.snapshotCreatedAt);

  async function handleValidate() {
    if (!canValidate || isValidating) return;
    if (
      !window.confirm(
        'Executar as blindagens avancadas deste Plano? Nada sera enviado.',
      )
    ) {
      return;
    }

    const token = getStoredToken();
    if (!token) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await validateDispatchPlan(
        token,
        campaignId,
        plan.id,
      );
      onPlanUpdated(result);
      setSuccess(
        result.passed
          ? 'Plano validado com sucesso.'
          : 'Validacao concluida com erros criticos. Plano bloqueado.',
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Nao foi possivel validar o plano',
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleReopen() {
    if (!canReopen || isValidating) return;
    if (
      !window.confirm(
        'Reabrir o Plano para edicao? A validacao atual sera invalidada.',
      )
    ) {
      return;
    }

    const token = getStoredToken();
    if (!token) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await reopenDispatchPlan(token, campaignId, plan.id);
      onPlanUpdated(updated);
      setSuccess('Plano reaberto como rascunho.');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Nao foi possivel reabrir o plano',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-8 border-t border-[#deddd4] pt-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-[#65655f]">
            Etapa 3
          </p>
          <h3 className="mt-1 text-xl font-semibold text-[#151515]">
            Blindagens
          </h3>
          <p className="mt-1 text-sm text-[#65655f]">
            Validacao tecnica obrigatoria do Plano. Nenhum envio e realizado
            nesta etapa.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {plan.status === 'DRAFT' ? (
            <button
              type="button"
              className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              disabled={!canValidate || loading || isValidating || !hasSnapshot}
              onClick={handleValidate}
            >
              {loading || isValidating ? 'Validando...' : 'Validar Plano'}
            </button>
          ) : null}
          {canReopen ? (
            <button
              type="button"
              className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm font-medium text-[#24382b] disabled:opacity-60"
              disabled={loading || isValidating}
              onClick={handleReopen}
            >
              {loading ? 'Reabrindo...' : 'Reabrir para edicao'}
            </button>
          ) : null}
        </div>
      </div>

      {!hasSnapshot && plan.status === 'DRAFT' ? (
        <p className="mt-4 rounded-md border border-[#e6d9a8] bg-[#fff8e1] px-3 py-2 text-sm text-[#6b5a1e]">
          Gere o snapshot do publico antes de validar o Plano.
        </p>
      ) : null}

      {isValidating ? (
        <p className="mt-4 rounded-md border border-[#c9d7ee] bg-[#eef4fc] px-3 py-2 text-sm text-[#1e3a5f]">
          Validacao em andamento. Aguarde a conclusao antes de outras acoes.
        </p>
      ) : null}

      {plan.status === 'VALIDATED' ? (
        <p className="mt-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          Blindagens aprovadas tecnicamente. Status:{' '}
          {getDispatchPlanStatusLabel(plan.status)}.
          {plan.validatedAt
            ? ` Validado em ${new Date(plan.validatedAt).toLocaleString('pt-BR')}.`
            : null}
          {plan.validatedVersion != null
            ? ` Versao validada: ${plan.validatedVersion}.`
            : null}
          {plan.validationIsCurrent === false
            ? ' A validacao nao corresponde mais a versao atual.'
            : null}
        </p>
      ) : null}

      {plan.status === 'BLOCKED' ? (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <p className="font-medium">
            Plano bloqueado por erros criticos nas blindagens.
          </p>
          <p className="mt-1">
            Corrija os problemas listados, reabra para edicao se necessario e
            valide novamente. Nada sera enviado enquanto o Plano estiver
            bloqueado.
          </p>
        </div>
      ) : null}

      {snapshot ? (
        <div className="mt-4 rounded-md border border-[#deddd4] bg-white p-4">
          <p className="text-sm text-[#65655f]">
            Resumo: {snapshot.summary.errors} erro(s),{' '}
            {snapshot.summary.warnings} aviso(s), {snapshot.summary.infos}{' '}
            info(s). Publico: {snapshot.audience.totalEvaluated} avaliados,{' '}
            {snapshot.audience.totalEligible} elegiveis,{' '}
            {snapshot.audience.totalExcluded} excluidos.
          </p>
          <CheckList title="Erros criticos" checks={errors} />
          <CheckList title="Avisos" checks={warnings} />
          <CheckList title="Informacoes" checks={infos} />
          {errors.length === 0 && warnings.length === 0 && infos.length === 0 ? (
            <CheckList title="Checks" checks={checks} />
          ) : null}
        </div>
      ) : plan.status === 'DRAFT' && hasSnapshot ? (
        <p className="mt-4 text-sm text-[#65655f]">
          Nenhuma validacao registrada ainda para este Plano.
        </p>
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
