'use client';

import { DispatchPlanItem } from '../../../../../../lib/api';

type StepState =
  | 'pending'
  | 'done'
  | 'blocked'
  | 'approved'
  | 'rejected'
  | 'canceled';

function stepClass(state: StepState): string {
  switch (state) {
    case 'done':
    case 'approved':
      return 'border-green-200 bg-green-50 text-green-800';
    case 'blocked':
    case 'rejected':
      return 'border-red-200 bg-red-50 text-red-800';
    case 'canceled':
      return 'border-[#ddd] bg-[#f5f5f5] text-[#65655f]';
    default:
      return 'border-[#c9c8c0] bg-white text-[#65655f]';
  }
}

function label(state: StepState): string {
  switch (state) {
    case 'done':
      return 'Concluido';
    case 'blocked':
      return 'Bloqueado';
    case 'approved':
      return 'Aprovado';
    case 'rejected':
      return 'Rejeitado';
    case 'canceled':
      return 'Cancelado';
    default:
      return 'Pendente';
  }
}

export function DispatchPlanProgress({ plan }: { plan: DispatchPlanItem }) {
  const config: StepState =
    plan.status === 'CANCELED'
      ? 'canceled'
      : plan.status === 'REJECTED'
        ? 'rejected'
        : 'done';

  const audience: StepState = !plan.snapshotCreatedAt
    ? plan.status === 'CANCELED'
      ? 'canceled'
      : 'pending'
    : plan.status === 'CANCELED'
      ? 'canceled'
      : 'done';

  const validation: StepState =
    plan.status === 'BLOCKED'
      ? 'blocked'
      : plan.validationIsCurrent
        ? 'done'
        : plan.status === 'CANCELED'
          ? 'canceled'
          : plan.status === 'REJECTED'
            ? 'rejected'
            : 'pending';

  const simulation: StepState = plan.simulationIsCurrent
    ? 'done'
    : plan.status === 'CANCELED'
      ? 'canceled'
      : plan.status === 'REJECTED'
        ? 'rejected'
        : 'pending';

  const approval: StepState =
    plan.status === 'APPROVED'
      ? 'approved'
      : plan.status === 'REJECTED'
        ? 'rejected'
        : plan.status === 'CANCELED'
          ? 'canceled'
          : 'pending';

  const steps: Array<{ title: string; state: StepState }> = [
    { title: 'Configuracao', state: config },
    { title: 'Publico', state: audience },
    { title: 'Blindagens', state: validation },
    { title: 'Simulacao', state: simulation },
    { title: 'Aprovacao', state: approval },
  ];

  return (
    <div className="mt-4 grid gap-2 md:grid-cols-5">
      {steps.map((step) => (
        <div
          key={step.title}
          className={`rounded-md border px-3 py-2 text-sm ${stepClass(step.state)}`}
        >
          <p className="font-medium">{step.title}</p>
          <p className="mt-1 text-xs uppercase tracking-wide">
            {label(step.state)}
          </p>
        </div>
      ))}
    </div>
  );
}
