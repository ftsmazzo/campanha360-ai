'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  DispatchPlanItem,
  DispatchPlanRecipientEligibilityStatus,
  DispatchPlanRecipientsResponse,
  DispatchPlanSnapshotSummary,
  fetchDispatchPlanRecipients,
  generateDispatchPlanSnapshot,
  getStoredToken,
} from '../../../../../../lib/api';
import { getRecipientEligibilityLabel } from '../../../../../../lib/dispatch-plans';

type EligibilityFilter =
  | DispatchPlanRecipientEligibilityStatus
  | 'EXCLUDED'
  | '';

const DISTRIBUTION_STATUSES: DispatchPlanRecipientEligibilityStatus[] = [
  'EXCLUDED_OPT_OUT',
  'EXCLUDED_BLOCKED',
  'EXCLUDED_DELETED',
  'EXCLUDED_INVALID_DESTINATION',
  'EXCLUDED_DUPLICATE',
  'EXCLUDED_NO_CHANNEL',
  'EXCLUDED_POLICY',
  'EXCLUDED_OTHER',
];

const FILTER_OPTIONS: Array<{ value: EligibilityFilter; label: string }> = [
  { value: '', label: 'Todos' },
  { value: 'ELIGIBLE', label: 'Elegiveis' },
  { value: 'EXCLUDED', label: 'Excluidos' },
  ...DISTRIBUTION_STATUSES.map((status) => ({
    value: status,
    label: getRecipientEligibilityLabel(status),
  })),
];

type Props = {
  campaignId: string;
  plan: DispatchPlanItem;
  canWrite: boolean;
  onSnapshotGenerated: (summary: DispatchPlanSnapshotSummary) => void;
};

export function DispatchPlanAudience({
  campaignId,
  plan,
  canWrite,
  onSnapshotGenerated,
}: Props) {
  const [data, setData] = useState<DispatchPlanRecipientsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [eligibilityStatus, setEligibilityStatus] =
    useState<EligibilityFilter>('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadRecipients = useCallback(async () => {
    if (!plan.snapshotCreatedAt) {
      setData(null);
      return;
    }

    const token = getStoredToken();
    if (!token) return;

    setLoading(true);
    setError(null);
    try {
      const response = await fetchDispatchPlanRecipients(
        token,
        campaignId,
        plan.id,
        {
          page,
          limit: 20,
          eligibilityStatus: eligibilityStatus || undefined,
          search: search || undefined,
        },
      );
      setData(response);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Nao foi possivel carregar os recipients',
      );
    } finally {
      setLoading(false);
    }
  }, [campaignId, eligibilityStatus, page, plan.id, plan.snapshotCreatedAt, search]);

  useEffect(() => {
    loadRecipients();
  }, [loadRecipients]);

  async function handleGenerate() {
    const isRegeneration = Boolean(plan.snapshotCreatedAt);
    if (
      isRegeneration &&
      !window.confirm(
        'Regenerar o snapshot substituirá atomicamente todos os recipients atuais. Continuar?',
      )
    ) {
      return;
    }

    const token = getStoredToken();
    if (!token) return;

    setGenerating(true);
    setError(null);
    setSuccess(null);
    try {
      const summary = await generateDispatchPlanSnapshot(
        token,
        campaignId,
        plan.id,
      );
      onSnapshotGenerated(summary);
      setPage(1);
      setEligibilityStatus('');
      setSearch('');
      setSearchInput('');
      setSuccess(
        summary.regenerated
          ? 'Snapshot regenerado com sucesso'
          : 'Snapshot gerado com sucesso',
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Nao foi possivel gerar o snapshot',
      );
    } finally {
      setGenerating(false);
    }
  }

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  const counts = data?.totals.byEligibilityStatus ?? plan.byEligibilityStatus;

  return (
    <section className="mt-6 rounded-md border border-[#deddd4] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[#65655f]">
            Etapa Público
          </p>
          <h3 className="mt-1 text-lg font-semibold text-[#24382b]">
            Snapshot do público
          </h3>
          <p className="mt-1 text-sm text-[#65655f]">
            O público só muda por uma geração ou regeneração explícita.
          </p>
        </div>
        {canWrite && plan.status === 'DRAFT' ? (
          <button
            className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            type="button"
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating
              ? 'Gerando...'
              : plan.snapshotCreatedAt
                ? 'Regenerar snapshot'
                : 'Gerar snapshot do público'}
          </button>
        ) : null}
      </div>

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

      {!plan.snapshotCreatedAt ? (
        <p className="mt-4 text-sm text-[#65655f]">
          Nenhum snapshot gerado. O segmento continua dinâmico até esta ação.
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-5">
            {[
              ['Avaliados', plan.totalEvaluated],
              ['Elegiveis', plan.totalEligible],
              ['Excluidos', plan.totalExcluded],
              [
                'Snapshot',
                new Date(plan.snapshotCreatedAt).toLocaleString('pt-BR'),
              ],
              ['Versao', plan.version],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-md border border-[#deddd4] bg-[#f7f6f1] p-3"
              >
                <p className="text-xs text-[#65655f]">{label}</p>
                <p className="mt-1 font-semibold text-[#151515]">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <h4 className="text-sm font-medium text-[#24382b]">
              Distribuicao das exclusoes
            </h4>
            <div className="mt-2 flex flex-wrap gap-2">
              {DISTRIBUTION_STATUSES.map((status) => (
                <span
                  key={status}
                  className="rounded-md border border-[#deddd4] px-2 py-1 text-xs text-[#65655f]"
                >
                  {getRecipientEligibilityLabel(status)}: {counts?.[status] ?? 0}
                </span>
              ))}
            </div>
          </div>

          <form
            className="mt-5 flex flex-wrap items-end gap-3"
            onSubmit={handleSearch}
          >
            <label className="text-sm text-[#24382b]">
              Elegibilidade
              <select
                className="mt-1 block rounded-md border border-[#c9c8c0] bg-white px-3 py-2"
                value={eligibilityStatus}
                onChange={(event) => {
                  setEligibilityStatus(
                    event.target.value as EligibilityFilter,
                  );
                  setPage(1);
                }}
              >
                {FILTER_OPTIONS.map((option) => (
                  <option key={option.value || 'all'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-64 flex-1 text-sm text-[#24382b]">
              Buscar por contato ou telefone
              <input
                className="mt-1 block w-full rounded-md border border-[#c9c8c0] bg-white px-3 py-2"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Nome ou destino"
              />
            </label>
            <button
              className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm font-medium text-[#24382b]"
              type="submit"
            >
              Buscar
            </button>
          </form>

          {loading ? (
            <p className="mt-4 text-sm text-[#65655f]">Carregando público...</p>
          ) : null}

          {!loading && data ? (
            <>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#deddd4] text-[#65655f]">
                      <th className="px-2 py-2 font-medium">Contato</th>
                      <th className="px-2 py-2 font-medium">Destino</th>
                      <th className="px-2 py-2 font-medium">Elegibilidade</th>
                      <th className="px-2 py-2 font-medium">Motivo</th>
                      <th className="px-2 py-2 font-medium">Snapshot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recipients.map((recipient) => (
                      <tr
                        key={recipient.id}
                        className="border-b border-[#efeee8] text-[#151515]"
                      >
                        <td className="px-2 py-2">
                          {recipient.contactSnapshot.name || 'Sem nome'}
                        </td>
                        <td className="px-2 py-2">
                          {recipient.destination || 'Sem telefone'}
                        </td>
                        <td className="px-2 py-2">
                          {getRecipientEligibilityLabel(
                            recipient.eligibilityStatus,
                          )}
                        </td>
                        <td className="px-2 py-2 text-[#65655f]">
                          {recipient.exclusionReason || '—'}
                        </td>
                        <td className="px-2 py-2 text-[#65655f]">
                          {new Date(recipient.createdAt).toLocaleString('pt-BR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.recipients.length === 0 ? (
                  <p className="py-4 text-sm text-[#65655f]">
                    Nenhum recipient encontrado para os filtros.
                  </p>
                ) : null}
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 text-sm">
                <span className="text-[#65655f]">
                  Página {data.pagination.page} de {data.pagination.totalPages} ·{' '}
                  {data.pagination.total} resultado(s)
                </span>
                <div className="flex gap-2">
                  <button
                    className="rounded-md border border-[#c9c8c0] px-3 py-1 disabled:opacity-50"
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((current) => current - 1)}
                  >
                    Anterior
                  </button>
                  <button
                    className="rounded-md border border-[#c9c8c0] px-3 py-1 disabled:opacity-50"
                    type="button"
                    disabled={page >= data.pagination.totalPages}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    Proxima
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </>
      )}

      <p className="mt-4 rounded-md border border-[#e6d9a8] bg-[#fff8e1] px-3 py-2 text-sm text-[#6b5a1e]">
        Este snapshot não envia mensagens, não cria jobs e não chama a Evolution.
      </p>
    </section>
  );
}
