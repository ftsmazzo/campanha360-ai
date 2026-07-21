'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  ApiError,
  DispatchPlanItem,
  getStoredToken,
  simulateDispatchPlan,
} from '../../../../../../lib/api';
import {
  formatDurationSeconds,
  formatZonedDateTime,
  getLimitingFactorLabel,
  getWeekdayLabel,
} from '../../../../../../lib/dispatch-plans';

const DEFAULT_DAYS = [1, 2, 3, 4, 5, 6];

type Props = {
  campaignId: string;
  plan: DispatchPlanItem;
  canWrite: boolean;
  onPlanUpdated: (plan: DispatchPlanItem) => void;
};

export function DispatchPlanSimulation({
  campaignId,
  plan,
  canWrite,
  onPlanUpdated,
}: Props) {
  const existing = plan.simulationSnapshot;
  const [messagesPerMinute, setMessagesPerMinute] = useState(4);
  const [minDelaySeconds, setMinDelaySeconds] = useState(10);
  const [maxDelaySeconds, setMaxDelaySeconds] = useState(20);
  const [batchSize, setBatchSize] = useState(20);
  const [pauseBetweenBatchesSeconds, setPauseBetweenBatchesSeconds] =
    useState(120);
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [allowedStartTime, setAllowedStartTime] = useState('08:00');
  const [allowedEndTime, setAllowedEndTime] = useState('20:00');
  const [allowedDays, setAllowedDays] = useState<number[]>(DEFAULT_DAYS);
  const [plannedStartAt, setPlannedStartAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!existing) return;
    setMessagesPerMinute(existing.configuration.requestedMessagesPerMinute);
    setMinDelaySeconds(existing.configuration.minDelaySeconds);
    setMaxDelaySeconds(existing.configuration.maxDelaySeconds);
    setBatchSize(existing.configuration.batchSize);
    setPauseBetweenBatchesSeconds(
      existing.configuration.pauseBetweenBatchesSeconds,
    );
    setTimezone(existing.configuration.timezone);
    setAllowedStartTime(existing.configuration.allowedStartTime);
    setAllowedEndTime(existing.configuration.allowedEndTime);
    setAllowedDays(existing.configuration.allowedDays);
    setPlannedStartAt(
      existing.configuration.plannedStartAt
        ? existing.configuration.plannedStartAt.slice(0, 16)
        : '',
    );
  }, [existing]);

  const canSimulate =
    canWrite &&
    (plan.allowedActions?.canSimulate ??
      (plan.status === 'VALIDATED' &&
        plan.validationIsCurrent === true &&
        plan.totalEligible > 0));
  const hasSimulation = Boolean(existing);
  const blockedReason =
    plan.status !== 'VALIDATED'
      ? 'Valide o Plano antes de gerar a simulacao.'
      : plan.validationIsCurrent === false
        ? 'A validacao atual esta desatualizada. Revalide o Plano antes de simular.'
        : plan.totalEligible <= 0
          ? 'O publico elegivel precisa ser maior que zero.'
          : null;

  function toggleDay(day: number) {
    setAllowedDays((current) =>
      current.includes(day)
        ? current.filter((item) => item !== day)
        : [...current, day].sort((a, b) => a - b),
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSimulate) return;

    const token = getStoredToken();
    if (!token) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await simulateDispatchPlan(token, campaignId, plan.id, {
        messagesPerMinute,
        minDelaySeconds,
        maxDelaySeconds,
        batchSize,
        pauseBetweenBatchesSeconds,
        timezone,
        allowedStartTime,
        allowedEndTime,
        allowedDays,
        plannedStartAt: plannedStartAt
          ? new Date(plannedStartAt).toISOString()
          : undefined,
      });
      onPlanUpdated(result);
      setSuccess(
        result.recalculated
          ? 'Simulacao recalculada.'
          : 'Simulacao gerada com sucesso.',
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Nao foi possivel gerar a simulacao',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-8 border-t border-[#deddd4] pt-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-[#65655f]">
          Etapa 4
        </p>
        <h3 className="mt-1 text-xl font-semibold text-[#151515]">Simulacao</h3>
        <p className="mt-1 text-sm text-[#65655f]">
          Estimativa operacional da futura execucao. Nenhuma mensagem sera
          enviada.
        </p>
      </div>

      <p className="mt-4 rounded-md border border-[#e6d9a8] bg-[#fff8e1] px-3 py-2 text-sm text-[#6b5a1e]">
        Esta e apenas uma simulacao. Nenhuma mensagem sera enviada.
      </p>

      {blockedReason ? (
        <p className="mt-4 rounded-md border border-[#deddd4] bg-white px-3 py-2 text-sm text-[#65655f]">
          {blockedReason}
        </p>
      ) : (
        <form className="mt-4 space-y-4" onSubmit={onSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm text-[#24382b]">
              Mensagens por minuto
              <input
                className="mt-1 w-full rounded-md border border-[#c9c8c0] bg-white px-3 py-2"
                type="number"
                min={1}
                max={20}
                value={messagesPerMinute}
                onChange={(event) =>
                  setMessagesPerMinute(Number(event.target.value))
                }
                disabled={!canWrite || loading}
              />
            </label>
            <label className="block text-sm text-[#24382b]">
              Tamanho do lote
              <input
                className="mt-1 w-full rounded-md border border-[#c9c8c0] bg-white px-3 py-2"
                type="number"
                min={1}
                max={100}
                value={batchSize}
                onChange={(event) => setBatchSize(Number(event.target.value))}
                disabled={!canWrite || loading}
              />
            </label>
            <label className="block text-sm text-[#24382b]">
              Atraso minimo (s)
              <input
                className="mt-1 w-full rounded-md border border-[#c9c8c0] bg-white px-3 py-2"
                type="number"
                min={1}
                max={300}
                value={minDelaySeconds}
                onChange={(event) =>
                  setMinDelaySeconds(Number(event.target.value))
                }
                disabled={!canWrite || loading}
              />
            </label>
            <label className="block text-sm text-[#24382b]">
              Atraso maximo (s)
              <input
                className="mt-1 w-full rounded-md border border-[#c9c8c0] bg-white px-3 py-2"
                type="number"
                min={1}
                max={600}
                value={maxDelaySeconds}
                onChange={(event) =>
                  setMaxDelaySeconds(Number(event.target.value))
                }
                disabled={!canWrite || loading}
              />
            </label>
            <label className="block text-sm text-[#24382b]">
              Pausa entre lotes (s)
              <input
                className="mt-1 w-full rounded-md border border-[#c9c8c0] bg-white px-3 py-2"
                type="number"
                min={0}
                max={3600}
                value={pauseBetweenBatchesSeconds}
                onChange={(event) =>
                  setPauseBetweenBatchesSeconds(Number(event.target.value))
                }
                disabled={!canWrite || loading}
              />
            </label>
            <label className="block text-sm text-[#24382b]">
              Timezone
              <input
                className="mt-1 w-full rounded-md border border-[#c9c8c0] bg-white px-3 py-2"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                disabled={!canWrite || loading}
              />
            </label>
            <label className="block text-sm text-[#24382b]">
              Inicio da janela
              <input
                className="mt-1 w-full rounded-md border border-[#c9c8c0] bg-white px-3 py-2"
                type="time"
                value={allowedStartTime}
                onChange={(event) => setAllowedStartTime(event.target.value)}
                disabled={!canWrite || loading}
              />
            </label>
            <label className="block text-sm text-[#24382b]">
              Fim da janela
              <input
                className="mt-1 w-full rounded-md border border-[#c9c8c0] bg-white px-3 py-2"
                type="time"
                value={allowedEndTime}
                onChange={(event) => setAllowedEndTime(event.target.value)}
                disabled={!canWrite || loading}
              />
            </label>
            <label className="block text-sm text-[#24382b] md:col-span-2">
              Data/hora planejada (opcional)
              <input
                className="mt-1 w-full rounded-md border border-[#c9c8c0] bg-white px-3 py-2"
                type="datetime-local"
                value={plannedStartAt}
                onChange={(event) => setPlannedStartAt(event.target.value)}
                disabled={!canWrite || loading}
              />
            </label>
          </div>

          <fieldset className="text-sm text-[#24382b]">
            <legend className="font-medium">Dias permitidos</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                <label
                  key={day}
                  className="inline-flex items-center gap-2 rounded-md border border-[#c9c8c0] bg-white px-3 py-1"
                >
                  <input
                    type="checkbox"
                    checked={allowedDays.includes(day)}
                    onChange={() => toggleDay(day)}
                    disabled={!canWrite || loading}
                  />
                  {getWeekdayLabel(day)}
                </label>
              ))}
            </div>
          </fieldset>

          {canWrite ? (
            <button
              type="submit"
              className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              disabled={!canSimulate || loading || allowedDays.length === 0}
            >
              {loading
                ? 'Calculando...'
                : hasSimulation
                  ? 'Recalcular simulacao'
                  : 'Gerar simulacao'}
            </button>
          ) : (
            <p className="text-sm text-[#65655f]">
              Voce pode visualizar a simulacao, mas nao gera nem recalcula.
            </p>
          )}
        </form>
      )}

      {existing ? (
        <div className="mt-6 rounded-md border border-[#deddd4] bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-[#151515]">
              Resultado da simulacao
            </h4>
            <span
              className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
                plan.simulationIsCurrent
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : 'border-amber-200 bg-amber-50 text-amber-900'
              }`}
            >
              {plan.simulationIsCurrent ? 'Atual' : 'Desatualizada'}
            </span>
          </div>

          <dl className="mt-4 grid gap-3 text-sm text-[#24382b] md:grid-cols-2">
            <div>
              <dt className="text-[#65655f]">Publico elegivel</dt>
              <dd className="font-medium">{existing.audience.totalEligible}</dd>
            </div>
            <div>
              <dt className="text-[#65655f]">Velocidade solicitada</dt>
              <dd className="font-medium">
                {existing.configuration.requestedMessagesPerMinute} msg/min
              </dd>
            </div>
            <div>
              <dt className="text-[#65655f]">Velocidade efetiva</dt>
              <dd className="font-medium">
                {existing.estimates.effectiveMessagesPerMinute} msg/min
              </dd>
            </div>
            <div>
              <dt className="text-[#65655f]">Fator limitante</dt>
              <dd className="font-medium">
                {getLimitingFactorLabel(existing.estimates.limitingFactor)}
              </dd>
            </div>
            <div>
              <dt className="text-[#65655f]">Lotes / pausas</dt>
              <dd className="font-medium">
                {existing.estimates.totalBatches} /{' '}
                {existing.estimates.totalBatchPauses}
              </dd>
            </div>
            <div>
              <dt className="text-[#65655f]">Mensagens por hora</dt>
              <dd className="font-medium">
                {existing.estimates.estimatedMessagesPerHour}
              </dd>
            </div>
            <div>
              <dt className="text-[#65655f]">Duracao ativa</dt>
              <dd className="font-medium">
                {formatDurationSeconds(
                  existing.estimates.estimatedActiveDurationSeconds,
                )}
              </dd>
            </div>
            <div>
              <dt className="text-[#65655f]">Duracao de calendario</dt>
              <dd className="font-medium">
                {formatDurationSeconds(
                  existing.estimates.estimatedCalendarDurationSeconds,
                )}
              </dd>
            </div>
            <div>
              <dt className="text-[#65655f]">Inicio estimado</dt>
              <dd className="font-medium">
                {formatZonedDateTime(
                  existing.estimates.estimatedStartAt,
                  existing.configuration.timezone,
                )}
              </dd>
            </div>
            <div>
              <dt className="text-[#65655f]">Termino estimado</dt>
              <dd className="font-medium">
                {formatZonedDateTime(
                  existing.estimates.estimatedEndAt,
                  existing.configuration.timezone,
                )}
              </dd>
            </div>
            <div className="md:col-span-2">
              <dt className="text-[#65655f]">Dias da janela</dt>
              <dd className="font-medium">
                {existing.configuration.allowedDays
                  .map((day) => getWeekdayLabel(day))
                  .join(', ')}{' '}
                · {existing.configuration.allowedStartTime}–
                {existing.configuration.allowedEndTime} (
                {existing.configuration.timezone})
              </dd>
            </div>
          </dl>

          {existing.warnings.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {existing.warnings.map((warning) => (
                <li
                  key={warning.code}
                  className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                >
                  <span className="font-medium">{warning.code}</span>
                  <p className="mt-1">{warning.message}</p>
                </li>
              ))}
            </ul>
          ) : null}
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
