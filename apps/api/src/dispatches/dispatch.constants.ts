import { DISPATCH_PLAN_INITIAL_ELIGIBLE_LIMIT } from '../dispatch-plans/dispatch-plan.constants';

/** Teto técnico de materialização (alinhado ao limite de elegíveis do Plano). */
export const DISPATCH_PREPARE_MAX_ITEMS = DISPATCH_PLAN_INITIAL_ELIGIBLE_LIMIT;

/** Tentativas máximas conservadoras por item (retry operacional em etapas futuras). */
export const DISPATCH_ITEM_DEFAULT_MAX_ATTEMPTS = 3;
