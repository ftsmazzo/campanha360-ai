/**
 * Limite inicial de contatos elegíveis por Plano (Épico 08.3 / homologação).
 * Acima deste valor a blindagem VOLUME_WITHIN_INITIAL_LIMIT falha como ERROR.
 * Diferente do soft-limit da pré-validação 07.1 (alerta apenas).
 */
export const DISPATCH_PLAN_INITIAL_ELIGIBLE_LIMIT = 100;

/** Limite máximo de caracteres do conteúdo textual do Plano (alinhado ao DTO). */
export const DISPATCH_PLAN_CONTENT_MAX_LENGTH = 4000;

/** Aviso quando o conteúdo chega a este percentual do limite. */
export const DISPATCH_PLAN_CONTENT_WARN_RATIO = 0.9;

/** Percentual de excluídos acima do qual gera WARNING. */
export const DISPATCH_PLAN_HIGH_EXCLUSION_RATIO = 0.5;
