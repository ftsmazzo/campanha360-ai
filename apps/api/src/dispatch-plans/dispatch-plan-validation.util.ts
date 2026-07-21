import {
  CampaignStatus,
  ChannelAccountStatus,
  ChannelProvider,
  DispatchPlanStatus,
} from '@prisma/client';
import {
  DISPATCH_PLAN_CONTENT_MAX_LENGTH,
  DISPATCH_PLAN_CONTENT_WARN_RATIO,
  DISPATCH_PLAN_HIGH_EXCLUSION_RATIO,
  DISPATCH_PLAN_INITIAL_ELIGIBLE_LIMIT,
} from './dispatch-plan.constants';

export type ValidationSeverity = 'ERROR' | 'WARNING' | 'INFO';

export type ValidationCheck = {
  code: string;
  severity: ValidationSeverity;
  passed: boolean;
  title: string;
  message: string;
  details?: Record<string, unknown>;
};

export type ValidationSnapshot = {
  checkedAt: string;
  version: number;
  passed: boolean;
  summary: {
    errors: number;
    warnings: number;
    infos: number;
  };
  audience: {
    totalEvaluated: number;
    totalEligible: number;
    totalExcluded: number;
  };
  channel: {
    channelAccountId: string | null;
    provider: string | null;
    status: string | null;
  };
  checks: ValidationCheck[];
};

export type ValidationFacts = {
  planStatus: DispatchPlanStatus | string;
  planVersion: number;
  content: string;
  snapshotCreatedAt: Date | string | null;
  totalEvaluated: number;
  totalEligible: number;
  totalExcluded: number;
  segmentExists: boolean;
  segmentBelongsToCampaign: boolean;
  channelAccountId: string | null;
  channelExists: boolean;
  channelBelongsToCampaign: boolean;
  channelProvider: ChannelProvider | string | null;
  channelStatus: ChannelAccountStatus | string | null;
  campaignExists: boolean;
  campaignStatus: CampaignStatus | string | null;
  userCanValidate: boolean;
  recipientCount: number;
  eligibleCount: number;
  excludedCount: number;
  eligibleOptOutCount: number;
  eligibleBlockedCount: number;
  eligibleDeletedCount: number;
  eligibleInvalidDestinationCount: number;
  eligibleDuplicateDestinationCount: number;
  unnamedContactCount: number;
};

function check(input: ValidationCheck): ValidationCheck {
  return input;
}

export function buildValidationChecks(facts: ValidationFacts): ValidationCheck[] {
  const contentLength = facts.content?.trim().length ?? 0;
  const warnContentAt = Math.floor(
    DISPATCH_PLAN_CONTENT_MAX_LENGTH * DISPATCH_PLAN_CONTENT_WARN_RATIO,
  );
  const exclusionRatio =
    facts.totalEvaluated > 0 ? facts.totalExcluded / facts.totalEvaluated : 0;

  const checks: ValidationCheck[] = [
    check({
      code: 'PLAN_IS_DRAFT',
      severity: 'ERROR',
      passed: facts.planStatus === DispatchPlanStatus.DRAFT || facts.planStatus === 'DRAFT',
      title: 'Plano em rascunho',
      message:
        facts.planStatus === DispatchPlanStatus.DRAFT || facts.planStatus === 'DRAFT'
          ? 'O Plano esta em DRAFT e pode ser validado.'
          : 'Somente Planos em DRAFT podem iniciar validacao.',
    }),
    check({
      code: 'SNAPSHOT_EXISTS',
      severity: 'ERROR',
      passed: Boolean(facts.snapshotCreatedAt),
      title: 'Snapshot disponivel',
      message: facts.snapshotCreatedAt
        ? 'O Plano possui publico congelado.'
        : 'Gere o snapshot do publico antes de validar.',
    }),
    check({
      code: 'SNAPSHOT_VERSION_CURRENT',
      severity: 'INFO',
      passed: Boolean(facts.snapshotCreatedAt),
      title: 'Versao do snapshot',
      message: `Validacao vinculada a versao ${facts.planVersion} do Plano.`,
      details: { version: facts.planVersion },
    }),
    check({
      code: 'AUDIENCE_NOT_EMPTY',
      severity: 'ERROR',
      passed: facts.totalEvaluated > 0 && facts.recipientCount > 0,
      title: 'Publico avaliado',
      message:
        facts.totalEvaluated > 0 && facts.recipientCount > 0
          ? `Publico avaliado: ${facts.totalEvaluated} contato(s).`
          : 'O snapshot nao possui contatos avaliados.',
    }),
    check({
      code: 'ELIGIBLE_AUDIENCE_NOT_EMPTY',
      severity: 'ERROR',
      passed: facts.totalEligible > 0 && facts.eligibleCount > 0,
      title: 'Publico elegivel',
      message:
        facts.totalEligible > 0 && facts.eligibleCount > 0
          ? `Publico elegivel: ${facts.totalEligible} contato(s).`
          : 'O publico elegivel esta vazio.',
    }),
    check({
      code: 'SNAPSHOT_TOTALS_CONSISTENT',
      severity: 'ERROR',
      passed:
        facts.totalEvaluated === facts.totalEligible + facts.totalExcluded &&
        facts.totalEvaluated >= 0 &&
        facts.totalEligible >= 0 &&
        facts.totalExcluded >= 0,
      title: 'Totais do Plano consistentes',
      message:
        facts.totalEvaluated === facts.totalEligible + facts.totalExcluded
          ? 'Os totais do Plano estao consistentes.'
          : 'Os totais do Plano nao batem entre avaliados, elegiveis e excluidos.',
    }),
    check({
      code: 'SEGMENT_EXISTS',
      severity: 'ERROR',
      passed: facts.segmentExists,
      title: 'Segmento existente',
      message: facts.segmentExists
        ? 'O segmento vinculado existe.'
        : 'O segmento vinculado nao foi encontrado.',
    }),
    check({
      code: 'SEGMENT_BELONGS_TO_CAMPAIGN',
      severity: 'ERROR',
      passed: facts.segmentBelongsToCampaign,
      title: 'Segmento da campanha',
      message: facts.segmentBelongsToCampaign
        ? 'O segmento pertence a campanha do Plano.'
        : 'O segmento nao pertence a esta campanha.',
    }),
    check({
      code: 'CHANNEL_EXISTS',
      severity: 'ERROR',
      passed: facts.channelExists,
      title: 'Canal existente',
      message: facts.channelExists
        ? 'O canal vinculado existe.'
        : 'O canal vinculado nao foi encontrado.',
    }),
    check({
      code: 'CHANNEL_BELONGS_TO_CAMPAIGN',
      severity: 'ERROR',
      passed: facts.channelBelongsToCampaign,
      title: 'Canal da campanha',
      message: facts.channelBelongsToCampaign
        ? 'O canal pertence a campanha do Plano.'
        : 'O canal nao pertence a esta campanha.',
    }),
    check({
      code: 'CHANNEL_PROVIDER_SUPPORTED',
      severity: 'ERROR',
      passed:
        facts.channelProvider === ChannelProvider.WHATSAPP_EVOLUTION ||
        facts.channelProvider === 'WHATSAPP_EVOLUTION',
      title: 'Provider suportado',
      message:
        facts.channelProvider === ChannelProvider.WHATSAPP_EVOLUTION ||
        facts.channelProvider === 'WHATSAPP_EVOLUTION'
          ? 'Provider WhatsApp Evolution suportado.'
          : 'Provider do canal nao e suportado nesta etapa.',
    }),
    check({
      code: 'CHANNEL_NOT_ARCHIVED',
      severity: 'ERROR',
      passed:
        facts.channelStatus !== ChannelAccountStatus.ARCHIVED &&
        facts.channelStatus !== 'ARCHIVED',
      title: 'Canal nao arquivado',
      message:
        facts.channelStatus !== ChannelAccountStatus.ARCHIVED &&
        facts.channelStatus !== 'ARCHIVED'
          ? 'O canal nao esta arquivado.'
          : 'Canal arquivado nao pode ser usado.',
    }),
    check({
      code: 'CHANNEL_CONNECTED',
      severity: 'ERROR',
      passed:
        facts.channelStatus === ChannelAccountStatus.CONNECTED ||
        facts.channelStatus === 'CONNECTED',
      title: 'Canal conectado',
      message:
        facts.channelStatus === ChannelAccountStatus.CONNECTED ||
        facts.channelStatus === 'CONNECTED'
          ? 'O canal esta CONNECTED.'
          : 'O canal precisa estar CONNECTED para validar o Plano.',
    }),
    check({
      code: 'CONTENT_NOT_EMPTY',
      severity: 'ERROR',
      passed: contentLength > 0,
      title: 'Conteudo preenchido',
      message:
        contentLength > 0
          ? 'O conteudo textual esta preenchido.'
          : 'O conteudo textual esta vazio.',
    }),
    check({
      code: 'CONTENT_LENGTH_VALID',
      severity: 'ERROR',
      passed:
        contentLength > 0 && contentLength <= DISPATCH_PLAN_CONTENT_MAX_LENGTH,
      title: 'Tamanho do conteudo',
      message:
        contentLength === 0
          ? 'Conteudo vazio nao atende ao limite obrigatorio.'
          : contentLength <= DISPATCH_PLAN_CONTENT_MAX_LENGTH
            ? `Conteudo com ${contentLength} caractere(s), dentro do limite de ${DISPATCH_PLAN_CONTENT_MAX_LENGTH}.`
            : `Conteudo com ${contentLength} caracteres ultrapassa o limite de ${DISPATCH_PLAN_CONTENT_MAX_LENGTH}.`,
      details: {
        length: contentLength,
        max: DISPATCH_PLAN_CONTENT_MAX_LENGTH,
      },
    }),
    check({
      code: 'RECIPIENTS_EXIST',
      severity: 'ERROR',
      passed: facts.recipientCount > 0,
      title: 'Recipients persistidos',
      message:
        facts.recipientCount > 0
          ? `${facts.recipientCount} recipient(s) persistido(s).`
          : 'Nao ha recipients persistidos no Plano.',
    }),
    check({
      code: 'NO_ELIGIBLE_OPT_OUT',
      severity: 'ERROR',
      passed: facts.eligibleOptOutCount === 0,
      title: 'Sem opt-out elegivel',
      message:
        facts.eligibleOptOutCount === 0
          ? 'Nenhum opt-out esta marcado como elegivel.'
          : `${facts.eligibleOptOutCount} recipient(s) com opt-out estao ELIGIBLE.`,
    }),
    check({
      code: 'NO_ELIGIBLE_BLOCKED',
      severity: 'ERROR',
      passed: facts.eligibleBlockedCount === 0,
      title: 'Sem bloqueados elegiveis',
      message:
        facts.eligibleBlockedCount === 0
          ? 'Nenhum contato BLOCKED esta marcado como elegivel.'
          : `${facts.eligibleBlockedCount} contato(s) BLOCKED estao ELIGIBLE.`,
    }),
    check({
      code: 'NO_ELIGIBLE_DELETED',
      severity: 'ERROR',
      passed: facts.eligibleDeletedCount === 0,
      title: 'Sem removidos elegiveis',
      message:
        facts.eligibleDeletedCount === 0
          ? 'Nenhum contato DELETED esta marcado como elegivel.'
          : `${facts.eligibleDeletedCount} contato(s) DELETED estao ELIGIBLE.`,
    }),
    check({
      code: 'NO_ELIGIBLE_INVALID_DESTINATION',
      severity: 'ERROR',
      passed: facts.eligibleInvalidDestinationCount === 0,
      title: 'Destinos elegiveis validos',
      message:
        facts.eligibleInvalidDestinationCount === 0
          ? 'Todos os destinos elegiveis sao validos.'
          : `${facts.eligibleInvalidDestinationCount} destino(s) invalidos estao ELIGIBLE.`,
    }),
    check({
      code: 'ELIGIBLE_DESTINATIONS_UNIQUE',
      severity: 'ERROR',
      passed: facts.eligibleDuplicateDestinationCount === 0,
      title: 'Destinos elegiveis unicos',
      message:
        facts.eligibleDuplicateDestinationCount === 0
          ? 'Nao ha destinos duplicados entre elegiveis.'
          : `${facts.eligibleDuplicateDestinationCount} destino(s) normalizado(s) duplicado(s) entre ELIGIBLE.`,
    }),
    check({
      code: 'RECIPIENT_TOTALS_MATCH_PLAN',
      severity: 'ERROR',
      passed:
        facts.recipientCount === facts.totalEvaluated &&
        facts.eligibleCount === facts.totalEligible &&
        facts.excludedCount === facts.totalExcluded,
      title: 'Totais alinhados aos recipients',
      message:
        facts.recipientCount === facts.totalEvaluated &&
        facts.eligibleCount === facts.totalEligible &&
        facts.excludedCount === facts.totalExcluded
          ? 'Os totais do Plano batem com os recipients persistidos.'
          : 'Os totais do Plano nao batem com a contagem dos recipients.',
    }),
    check({
      code: 'CAMPAIGN_EXISTS',
      severity: 'ERROR',
      passed: facts.campaignExists,
      title: 'Campanha existente',
      message: facts.campaignExists
        ? 'A campanha existe.'
        : 'A campanha nao foi encontrada.',
    }),
    check({
      code: 'CAMPAIGN_AVAILABLE',
      severity: 'ERROR',
      passed:
        facts.campaignExists &&
        facts.campaignStatus !== CampaignStatus.ARCHIVED &&
        facts.campaignStatus !== 'ARCHIVED',
      title: 'Campanha disponivel',
      message:
        facts.campaignStatus !== CampaignStatus.ARCHIVED &&
        facts.campaignStatus !== 'ARCHIVED'
          ? 'A campanha esta disponivel para planejamento.'
          : 'Campanha arquivada nao pode validar Plano.',
    }),
    check({
      code: 'USER_CAN_VALIDATE',
      severity: 'ERROR',
      passed: facts.userCanValidate,
      title: 'Permissao de validacao',
      message: facts.userCanValidate
        ? 'Usuario autorizado a validar o Plano.'
        : 'Usuario sem permissao para validar.',
    }),
    check({
      code: 'VOLUME_WITHIN_INITIAL_LIMIT',
      severity: 'ERROR',
      passed: facts.totalEligible <= DISPATCH_PLAN_INITIAL_ELIGIBLE_LIMIT,
      title: 'Volume dentro do limite inicial',
      message:
        facts.totalEligible <= DISPATCH_PLAN_INITIAL_ELIGIBLE_LIMIT
          ? `Volume elegivel (${facts.totalEligible}) dentro do limite inicial de ${DISPATCH_PLAN_INITIAL_ELIGIBLE_LIMIT}.`
          : `Volume elegivel (${facts.totalEligible}) ultrapassa o limite inicial de ${DISPATCH_PLAN_INITIAL_ELIGIBLE_LIMIT}.`,
      details: {
        totalEligible: facts.totalEligible,
        limit: DISPATCH_PLAN_INITIAL_ELIGIBLE_LIMIT,
      },
    }),
    check({
      code: 'CONTENT_NEAR_LIMIT',
      severity: 'WARNING',
      passed: !(
        contentLength > warnContentAt &&
        contentLength <= DISPATCH_PLAN_CONTENT_MAX_LENGTH
      ),
      title: 'Conteudo proximo do limite',
      message:
        contentLength > warnContentAt &&
        contentLength <= DISPATCH_PLAN_CONTENT_MAX_LENGTH
          ? `Conteudo com ${contentLength} caracteres esta proximo do limite de ${DISPATCH_PLAN_CONTENT_MAX_LENGTH}.`
          : 'Conteudo sem alerta de proximidade do limite.',
    }),
    check({
      code: 'HIGH_EXCLUSION_RATIO',
      severity: 'WARNING',
      passed: !(
        facts.totalEvaluated > 0 &&
        exclusionRatio >= DISPATCH_PLAN_HIGH_EXCLUSION_RATIO
      ),
      title: 'Percentual de excluidos',
      message:
        facts.totalEvaluated > 0 &&
        exclusionRatio >= DISPATCH_PLAN_HIGH_EXCLUSION_RATIO
          ? `${Math.round(exclusionRatio * 100)}% do publico foi excluido no snapshot.`
          : 'Percentual de excluidos dentro do esperado.',
    }),
    check({
      code: 'MANY_UNNAMED_CONTACTS',
      severity: 'WARNING',
      passed: !(
        facts.eligibleCount > 0 &&
        facts.unnamedContactCount / Math.max(facts.eligibleCount, 1) >= 0.3
      ),
      title: 'Contatos sem nome',
      message:
        facts.eligibleCount > 0 &&
        facts.unnamedContactCount / Math.max(facts.eligibleCount, 1) >= 0.3
          ? `${facts.unnamedContactCount} elegivel(is) sem nome no snapshot.`
          : 'Quantidade de elegiveis sem nome dentro do esperado.',
    }),
    check({
      code: 'AUDIENCE_TOTALS_INFO',
      severity: 'INFO',
      passed: true,
      title: 'Resumo do publico',
      message: `Avaliados: ${facts.totalEvaluated}; elegiveis: ${facts.totalEligible}; excluidos: ${facts.totalExcluded}.`,
    }),
    check({
      code: 'CHANNEL_INFO',
      severity: 'INFO',
      passed: true,
      title: 'Canal selecionado',
      message: `Canal ${facts.channelProvider ?? 'desconhecido'} com status ${facts.channelStatus ?? 'desconhecido'}.`,
    }),
    check({
      code: 'SNAPSHOT_DATE_INFO',
      severity: 'INFO',
      passed: true,
      title: 'Data do snapshot',
      message: facts.snapshotCreatedAt
        ? `Snapshot em ${new Date(facts.snapshotCreatedAt).toISOString()}.`
        : 'Snapshot ainda nao gerado.',
    }),
    check({
      code: 'PLAN_VERSION_INFO',
      severity: 'INFO',
      passed: true,
      title: 'Versao do Plano',
      message: `Versao atual do Plano: ${facts.planVersion}.`,
    }),
  ];

  return checks;
}

export function summarizeValidationChecks(checks: ValidationCheck[]) {
  let errors = 0;
  let warnings = 0;
  let infos = 0;

  for (const item of checks) {
    if (item.severity === 'ERROR' && !item.passed) errors += 1;
    if (item.severity === 'WARNING' && !item.passed) warnings += 1;
    if (item.severity === 'INFO') infos += 1;
  }

  return {
    errors,
    warnings,
    infos,
    passed: errors === 0,
  };
}

export function buildValidationSnapshot(input: {
  checkedAt: Date;
  version: number;
  facts: ValidationFacts;
}): ValidationSnapshot {
  const checks = buildValidationChecks(input.facts);
  const summary = summarizeValidationChecks(checks);

  return {
    checkedAt: input.checkedAt.toISOString(),
    version: input.version,
    passed: summary.passed,
    summary: {
      errors: summary.errors,
      warnings: summary.warnings,
      infos: summary.infos,
    },
    audience: {
      totalEvaluated: input.facts.totalEvaluated,
      totalEligible: input.facts.totalEligible,
      totalExcluded: input.facts.totalExcluded,
    },
    channel: {
      channelAccountId: input.facts.channelAccountId,
      provider: input.facts.channelProvider
        ? String(input.facts.channelProvider)
        : null,
      status: input.facts.channelStatus
        ? String(input.facts.channelStatus)
        : null,
    },
    checks,
  };
}

export function resolveValidationFinalStatus(passed: boolean): DispatchPlanStatus {
  return passed ? DispatchPlanStatus.VALIDATED : DispatchPlanStatus.BLOCKED;
}

export function canReopenDispatchPlan(status: DispatchPlanStatus | string): boolean {
  return (
    status === DispatchPlanStatus.VALIDATED ||
    status === 'VALIDATED' ||
    status === DispatchPlanStatus.BLOCKED ||
    status === 'BLOCKED'
  );
}

export function isValidationCurrent(input: {
  validationSnapshot: unknown;
  validatedVersion: number | null | undefined;
  planVersion: number;
}): boolean {
  if (!input.validationSnapshot || input.validatedVersion == null) return false;
  return input.validatedVersion === input.planVersion;
}
