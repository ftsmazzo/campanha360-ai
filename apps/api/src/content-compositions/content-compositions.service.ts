import { createHash } from 'node:crypto';
import {
  CONTENT_LIMITS,
  CONTENT_PROMPT_VERSION,
  CONTENT_VARIABLE_CATALOG,
  CONTENT_AI_ELECTORAL_SETS_EXAMPLE,
  CONTENT_AI_SETS_JSON_SCHEMA,
  CONTENT_AI_SETS_JSON_SCHEMA_NAME,
  assessContentRepetition,
  assessEditorialQuality,
  buildAiSetsValidationLogMeta,
  buildContentAiFormatCorrectionUserMessage,
  classifyContentSimilarity,
  contentAiModelSupportsJsonSchema,
  countTheoreticalCombinations,
  extractContentVariableKeys,
  formatAiSetsValidationUserMessages,
  formatSensitiveAttributeUserMessage,
  getContentAiConfig,
  groupVariantsByGenerationSet,
  hashNormalizedContent,
  isAllowedContentVariable,
  isContentAiEnabled,
  isContentCombinationMode,
  isContentPersonalizationPlacement,
  isStructuralAiSetsFailure,
  marketingBriefQualityHints,
  parseAiSetsRawContent,
  parseMarketingBrief,
  scanMarketingBriefForSensitive,
  selectAndRenderComposition,
  validateAiSetsPayload,
  validateCompositionCoherence,
  variantRequiresVariables,
  type ContentAiGenerationMode,
  type ContentCompositionSnapshotV1,
  type ContentMarketingBrief,
  type ValidateAiSetsResult,
} from '@campanha360/shared';
import { Injectable, Logger } from '@nestjs/common';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ContentCompositionStatus,
  ContentVariantSource,
  ContentVariantType,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../common/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApproveCompositionDto } from './dto/approve-composition.dto';
import { ApproveGenerationSetDto } from './dto/approve-generation-set.dto';
import { CreateCompositionDto } from './dto/create-composition.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { GenerateAiVariantsDto } from './dto/generate-ai-variants.dto';
import { PreviewCompositionDto } from './dto/preview-composition.dto';
import { UpdateCompositionDto } from './dto/update-composition.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import {
  assertActiveVariantLimits,
  buildCompositionSnapshotFromRows,
  parseFallbacks,
  validateVariantText,
} from './content-composition.util';

const compositionInclude = {
  variants: { orderBy: [{ type: 'asc' as const }, { order: 'asc' as const }, { id: 'asc' as const }] },
} satisfies Prisma.ContentCompositionInclude;

@Injectable()
export class ContentCompositionsService {
  private readonly logger = new Logger(ContentCompositionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationAccess: OrganizationAccessService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, campaignId: string) {
    const campaign = await this.getCampaignContext(userId, campaignId);
    const rows = await this.prisma.contentComposition.findMany({
      where: {
        organizationId: campaign.organizationId,
        campaignId,
        status: { not: ContentCompositionStatus.ARCHIVED },
      },
      include: compositionInclude,
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((row) => this.toDto(row));
  }

  async get(userId: string, campaignId: string, compositionId: string) {
    const campaign = await this.getCampaignContext(userId, campaignId);
    const row = await this.getCompositionOrThrow(
      compositionId,
      campaign.organizationId,
      campaignId,
    );
    return this.toDto(row);
  }

  async catalog(userId: string, campaignId: string) {
    await this.getCampaignContext(userId, campaignId);
    const ai = getContentAiConfig();
    return {
      variables: CONTENT_VARIABLE_CATALOG,
      limits: CONTENT_LIMITS,
      ai: {
        enabled: ai.enabled,
        model: ai.enabled ? ai.model : null,
        maxVariants: ai.maxVariants,
      },
    };
  }

  async create(userId: string, campaignId: string, dto: CreateCompositionDto) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    const name = dto.name.trim();
    const baseText = dto.baseBody.trim();
    validateVariantText(baseText, ContentVariantType.BODY);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const composition = await tx.contentComposition.create({
          data: {
            organizationId: campaign.organizationId,
            campaignId,
            name,
            status: ContentCompositionStatus.DRAFT,
            version: 1,
            blockSeparator: dto.blockSeparator?.trim() || CONTENT_LIMITS.BLOCK_SEPARATOR_DEFAULT,
            fallbacks: (dto.fallbacks ?? {}) as Prisma.InputJsonValue,
            createdByUserId: userId,
          },
        });

        await tx.contentVariant.create({
          data: {
            organizationId: campaign.organizationId,
            campaignId,
            compositionId: composition.id,
            type: ContentVariantType.BODY,
            source: ContentVariantSource.BASE,
            text: baseText,
            normalizedTextHash: hashNormalizedContent(baseText),
            enabled: true,
            order: 0,
            requiresVariables: variantRequiresVariables(baseText),
            reviewPending: false,
          },
        });

        return tx.contentComposition.findUniqueOrThrow({
          where: { id: composition.id },
          include: compositionInclude,
        });
      });

      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'CONTENT_COMPOSITION_CREATED',
        entityType: 'ContentComposition',
        entityId: created.id,
        metadata: {
          name: created.name,
          version: created.version,
          baseHash: hashNormalizedContent(baseText),
        },
      });

      return this.toDto(created);
    } catch (error) {
      this.handleUniqueNameError(error);
      throw error;
    }
  }

  async update(
    userId: string,
    campaignId: string,
    compositionId: string,
    dto: UpdateCompositionDto,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    const existing = await this.getCompositionOrThrow(
      compositionId,
      campaign.organizationId,
      campaignId,
    );
    this.assertEditable(existing.status);

    const briefUpdate =
      dto.marketingBrief === undefined
        ? undefined
        : (parseMarketingBrief(dto.marketingBrief) as unknown as Prisma.InputJsonValue);
    const placement =
      dto.personalizationPlacement === undefined
        ? undefined
        : isContentPersonalizationPlacement(dto.personalizationPlacement)
          ? dto.personalizationPlacement
          : undefined;
    const combinationMode =
      dto.combinationMode === undefined
        ? undefined
        : isContentCombinationMode(dto.combinationMode)
          ? dto.combinationMode
          : undefined;

    const updated = await this.prisma.contentComposition.update({
      where: { id: existing.id },
      data: {
        name: dto.name === undefined ? undefined : dto.name.trim(),
        blockSeparator:
          dto.blockSeparator === undefined
            ? undefined
            : dto.blockSeparator.trim() || CONTENT_LIMITS.BLOCK_SEPARATOR_DEFAULT,
        fallbacks:
          dto.fallbacks === undefined
            ? undefined
            : (dto.fallbacks as Prisma.InputJsonValue),
        marketingBrief: briefUpdate,
        personalizationPlacement: placement,
        combinationMode,
        version: { increment: 1 },
        status: ContentCompositionStatus.DRAFT,
        approvedAt: null,
        approvedByUserId: null,
      },
      include: compositionInclude,
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'CONTENT_VARIANT_UPDATED',
      entityType: 'ContentComposition',
      entityId: updated.id,
      metadata: { version: updated.version, fields: Object.keys(dto) },
    });

    return this.toDto(updated);
  }

  async addVariant(
    userId: string,
    campaignId: string,
    compositionId: string,
    dto: CreateVariantDto,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    const existing = await this.getCompositionOrThrow(
      compositionId,
      campaign.organizationId,
      campaignId,
    );
    this.assertEditable(existing.status);

    const text = dto.text.trim();
    validateVariantText(text, dto.type);
    const requires = dto.requiresVariables?.length
      ? dto.requiresVariables.filter(isAllowedContentVariable)
      : variantRequiresVariables(text);

    const type = dto.type as ContentVariantType;
    const enabled = dto.enabled !== false;
    const activeOfType = existing.variants.filter(
      (v) => v.type === type && v.enabled,
    ).length;
    if (enabled) {
      assertActiveVariantLimits(type, activeOfType + 1);
    }

    const hash = hashNormalizedContent(text);
    if (
      existing.variants.some(
        (v) => v.type === type && v.normalizedTextHash === hash,
      )
    ) {
      throw new BadRequestException('Duplicata exata de variante no mesmo grupo');
    }

    const maxOrder = existing.variants
      .filter((v) => v.type === type)
      .reduce((m, v) => Math.max(m, v.order), -1);

    const variant = await this.prisma.$transaction(async (tx) => {
      const created = await tx.contentVariant.create({
        data: {
          organizationId: campaign.organizationId,
          campaignId,
          compositionId: existing.id,
          type,
          source: ContentVariantSource.MANUAL,
          text,
          normalizedTextHash: hash,
          enabled,
          order: maxOrder + 1,
          requiresVariables: requires,
          reviewPending: false,
        },
      });
      await tx.contentComposition.update({
        where: { id: existing.id },
        data: {
          version: { increment: 1 },
          status: ContentCompositionStatus.DRAFT,
          approvedAt: null,
          approvedByUserId: null,
        },
      });
      return created;
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'CONTENT_VARIANT_CREATED',
      entityType: 'ContentVariant',
      entityId: variant.id,
      metadata: {
        compositionId: existing.id,
        type: variant.type,
        source: variant.source,
        hash: variant.normalizedTextHash,
      },
    });

    return this.get(userId, campaignId, compositionId);
  }

  async updateVariant(
    userId: string,
    campaignId: string,
    compositionId: string,
    variantId: string,
    dto: UpdateVariantDto,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    const existing = await this.getCompositionOrThrow(
      compositionId,
      campaign.organizationId,
      campaignId,
    );
    this.assertEditable(existing.status);
    const variant = existing.variants.find((v) => v.id === variantId);
    if (!variant) throw new NotFoundException('Variante nao encontrada');

    const nextText = dto.text === undefined ? variant.text : dto.text.trim();
    if (dto.text !== undefined) validateVariantText(nextText, variant.type);

    const nextEnabled = dto.enabled === undefined ? variant.enabled : dto.enabled;
    if (nextEnabled && !variant.enabled) {
      const active = existing.variants.filter(
        (v) => v.type === variant.type && v.enabled && v.id !== variant.id,
      ).length;
      assertActiveVariantLimits(variant.type, active + 1);
    }

    if (variant.source === ContentVariantSource.BASE && dto.enabled === false) {
      throw new BadRequestException('Mensagem-base BODY nao pode ser desativada');
    }

    const requires =
      dto.requiresVariables !== undefined
        ? dto.requiresVariables.filter(isAllowedContentVariable)
        : variantRequiresVariables(
            nextText,
            Array.isArray(variant.requiresVariables)
              ? (variant.requiresVariables as string[])
              : null,
          );

    const hash = hashNormalizedContent(nextText);
    if (
      existing.variants.some(
        (v) =>
          v.id !== variant.id &&
          v.type === variant.type &&
          v.normalizedTextHash === hash,
      )
    ) {
      throw new BadRequestException('Duplicata exata de variante no mesmo grupo');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.contentVariant.update({
        where: { id: variant.id },
        data: {
          text: nextText,
          normalizedTextHash: hash,
          enabled: nextEnabled,
          requiresVariables: requires,
          reviewPending:
            dto.reviewPending === undefined
              ? variant.source === ContentVariantSource.AI_GENERATED &&
                dto.enabled === true
                ? false
                : undefined
              : dto.reviewPending,
        },
      });
      await tx.contentComposition.update({
        where: { id: existing.id },
        data: {
          version: { increment: 1 },
          status: ContentCompositionStatus.DRAFT,
          approvedAt: null,
          approvedByUserId: null,
        },
      });
    });

    const action =
      dto.enabled === true
        ? 'CONTENT_VARIANT_ENABLED'
        : dto.enabled === false
          ? 'CONTENT_VARIANT_DISABLED'
          : 'CONTENT_VARIANT_UPDATED';

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action,
      entityType: 'ContentVariant',
      entityId: variant.id,
      metadata: { compositionId, hash },
    });

    return this.get(userId, campaignId, compositionId);
  }

  async removeVariant(
    userId: string,
    campaignId: string,
    compositionId: string,
    variantId: string,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    const existing = await this.getCompositionOrThrow(
      compositionId,
      campaign.organizationId,
      campaignId,
    );
    this.assertEditable(existing.status);
    const variant = existing.variants.find((v) => v.id === variantId);
    if (!variant) throw new NotFoundException('Variante nao encontrada');
    if (variant.source === ContentVariantSource.BASE) {
      throw new BadRequestException('Mensagem-base nao pode ser excluida');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.contentVariant.delete({ where: { id: variant.id } });
      await tx.contentComposition.update({
        where: { id: existing.id },
        data: {
          version: { increment: 1 },
          status: ContentCompositionStatus.DRAFT,
          approvedAt: null,
          approvedByUserId: null,
        },
      });
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'CONTENT_VARIANT_DISABLED',
      entityType: 'ContentVariant',
      entityId: variantId,
      metadata: { compositionId, deleted: true },
    });

    return this.get(userId, campaignId, compositionId);
  }

  async generateAiVariants(
    userId: string,
    campaignId: string,
    compositionId: string,
    dto: GenerateAiVariantsDto,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    const existing = await this.getCompositionOrThrow(
      compositionId,
      campaign.organizationId,
      campaignId,
    );
    this.assertEditable(existing.status);

    const ai = getContentAiConfig();
    if (!ai.enabled) {
      throw new ServiceUnavailableException(
        'Geracao por IA indisponivel (CONTENT_AI_ENABLED=false). O editor manual continua disponivel.',
      );
    }
    if (!ai.apiKey) {
      throw new ServiceUnavailableException(
        'Geracao por IA sem chave configurada (CONTENT_AI_API_KEY / OPENAI_API_KEY).',
      );
    }

    const base = existing.variants.find(
      (v) =>
        v.type === ContentVariantType.BODY &&
        v.source === ContentVariantSource.BASE,
    );
    if (!base) throw new BadRequestException('Mensagem-base BODY ausente');

    const mode: ContentAiGenerationMode = dto.mode ?? 'FULL_SETS';
    const brief = parseMarketingBrief(existing.marketingBrief);
    if (dto.objective?.trim()) brief.objective = dto.objective.trim();
    if (dto.tone?.trim()) brief.tone = dto.tone.trim();
    if (dto.maxChars) brief.maxLength = dto.maxChars;
    if (
      isContentPersonalizationPlacement(existing.personalizationPlacement)
    ) {
      brief.personalizationPlacement = existing.personalizationPlacement;
    }

    const hints = marketingBriefQualityHints(brief);
    if (dto.requireRecommendedBrief && !hints.readyForGeneration) {
      throw new BadRequestException(
        `Briefing incompleto. Preencha: ${hints.missingRecommended.join(', ')}`,
      );
    }

    const briefSensitive = scanMarketingBriefForSensitive(brief);
    if (briefSensitive) {
      throw new BadRequestException(
        formatSensitiveAttributeUserMessage(briefSensitive),
      );
    }

    const placement = brief.personalizationPlacement ?? 'GREETING';
    const generationId = `ai_${Date.now().toString(36)}`;
    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'CONTENT_AI_GENERATION_REQUESTED',
      entityType: 'ContentComposition',
      entityId: existing.id,
      metadata: {
        generationId,
        model: ai.model,
        mode,
        promptVersion: CONTENT_PROMPT_VERSION,
        placement,
        briefHints: hints,
      },
    });

    try {
      const maxAttempts =
        ai.formatRetryEnabled &&
        (mode === 'FULL_SETS' || mode === 'IMPROVE_CURRENT')
          ? 1 + ai.formatMaxRetries
          : 1;

      let validated: ValidateAiSetsResult | null = null;
      let lastStructuralFailure: Extract<ValidateAiSetsResult, { ok: false }> | null =
        null;
      let lastCallMeta: {
        httpStatus: number;
        finishReason: string | null;
        rawExcerpt: string;
        attempt: number;
        usedJsonSchema: boolean;
      } | null = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const call = await this.callContentAiMarketing({
          mode,
          baseText: base.text,
          brief,
          campaignName: campaign.name,
          existingBlocks:
            mode === 'IMPROVE_CURRENT'
              ? {
                  greetings: existing.variants
                    .filter((v) => v.type === 'GREETING' && v.enabled)
                    .map((v) => v.text)
                    .slice(0, 3),
                  bodies: existing.variants
                    .filter((v) => v.type === 'BODY' && v.enabled)
                    .map((v) => v.text)
                    .slice(0, 3),
                  closings: existing.variants
                    .filter((v) => v.type === 'CLOSING' && v.enabled)
                    .map((v) => v.text)
                    .slice(0, 3),
                }
              : undefined,
          model: ai.model,
          apiKey: ai.apiKey,
          baseUrl: ai.baseUrl,
          timeoutMs: ai.timeoutMs,
          maxOutputChars: ai.maxOutputChars,
          maxInputChars: ai.maxInputChars,
          jsonSchemaEnabled: ai.jsonSchemaEnabled,
          formatCorrection:
            attempt > 1 && lastStructuralFailure
              ? buildContentAiFormatCorrectionUserMessage(
                  lastStructuralFailure.structureDiagnostics,
                )
              : undefined,
        });

        lastCallMeta = {
          httpStatus: call.httpStatus,
          finishReason: call.finishReason,
          rawExcerpt: call.rawExcerpt,
          attempt,
          usedJsonSchema: call.usedJsonSchema,
        };

        await this.audit.log({
          organizationId: campaign.organizationId,
          campaignId,
          actorUserId: userId,
          action:
            attempt === 1
              ? 'CONTENT_AI_GENERATION_ATTEMPT'
              : 'CONTENT_AI_FORMAT_RETRY',
          entityType: 'ContentComposition',
          entityId: existing.id,
          metadata: {
            generationId,
            model: ai.model,
            mode,
            promptVersion: CONTENT_PROMPT_VERSION,
            attempt,
            httpStatus: call.httpStatus,
            finishReason: call.finishReason,
            usedJsonSchema: call.usedJsonSchema,
            payloadHash: call.payloadHash,
          },
        });

        validated = (() => {
          const raw = call.payload;
          if (
            raw &&
            typeof raw === 'object' &&
            !Array.isArray(raw) &&
            '__parseError' in (raw as Record<string, unknown>)
          ) {
            const reason =
              (raw as { __parseError?: string }).__parseError === 'INVALID_JSON'
                ? ('INVALID_JSON' as const)
                : ('RESPONSE_NOT_JSON' as const);
            return {
              ok: false as const,
              errors: [reason],
              diagnostics: [],
              structureDiagnostics: [
                {
                  code: 'AI_SETS_PAYLOAD_INVALID' as const,
                  reason,
                },
              ],
              detectedFormat: 'E_NOT_JSON' as const,
              payloadHash: call.payloadHash,
            };
          }
          return validateAiSetsPayload(call.payload, {
            baseBody: base.text,
            placement,
            protectedFacts: brief.protectedFacts ?? [],
            mode,
          });
        })();

        if (validated.ok) break;

        lastStructuralFailure = validated;
        const canRetry =
          attempt < maxAttempts &&
          isStructuralAiSetsFailure(validated.structureDiagnostics) &&
          validated.diagnostics.length === 0;

        const includeDevExcerpt =
          process.env.NODE_ENV !== 'production' ||
          process.env.CONTENT_AI_LOG_EXCERPT === 'true';

        this.logger.warn(
          JSON.stringify(
            buildAiSetsValidationLogMeta({
              generationId,
              model: ai.model,
              mode,
              promptVersion: CONTENT_PROMPT_VERSION,
              httpStatus: call.httpStatus,
              finishReason: call.finishReason,
              detectedFormat: validated.detectedFormat,
              payloadHash: validated.payloadHash,
              structureDiagnostics: validated.structureDiagnostics,
              sets: [],
              rawExcerptDevOnly: call.rawExcerpt,
              includeDevExcerpt,
            }),
          ),
        );

        if (!canRetry) break;
      }

      if (!validated || !validated.ok) {
        const structureMsgs = formatAiSetsValidationUserMessages(
          validated?.structureDiagnostics ?? [],
        );
        const sensitiveMsgs = (validated?.diagnostics ?? []).map((d) =>
          formatSensitiveAttributeUserMessage(d),
        );
        const otherErrors = (validated?.errors ?? []).filter(
          (e) =>
            !e.startsWith('SENSITIVE_ATTRIBUTE') &&
            e !== 'SET_BLOCKS_INVALID' &&
            !structureMsgs.some((m) => m.includes(e)),
        );
        const parts = [...structureMsgs, ...sensitiveMsgs, ...otherErrors];
        const message =
          parts.length > 0
            ? parts.join(' ')
            : 'A resposta da IA e invalida. Nenhuma versão foi salva. Tente gerar novamente.';

        await this.audit.log({
          organizationId: campaign.organizationId,
          campaignId,
          actorUserId: userId,
          action: 'CONTENT_AI_GENERATION_VALIDATION_FAILED',
          entityType: 'ContentComposition',
          entityId: existing.id,
          metadata: buildAiSetsValidationLogMeta({
            generationId,
            model: ai.model,
            mode,
            promptVersion: CONTENT_PROMPT_VERSION,
            httpStatus: lastCallMeta?.httpStatus,
            finishReason: lastCallMeta?.finishReason,
            detectedFormat: validated?.detectedFormat,
            payloadHash: validated?.payloadHash,
            structureDiagnostics: validated?.structureDiagnostics ?? [],
            includeDevExcerpt: false,
          }) as Prisma.InputJsonValue,
        });

        throw new BadRequestException(message);
      }

      const toSave = validated.sets.slice(0, CONTENT_LIMITS.MAX_AI_VARIANTS);
      const maxOrder = {
        BODY: existing.variants
          .filter((v) => v.type === 'BODY')
          .reduce((m, v) => Math.max(m, v.order), -1),
        GREETING: existing.variants
          .filter((v) => v.type === 'GREETING')
          .reduce((m, v) => Math.max(m, v.order), -1),
        CLOSING: existing.variants
          .filter((v) => v.type === 'CLOSING')
          .reduce((m, v) => Math.max(m, v.order), -1),
      };

      await this.prisma.$transaction(async (tx) => {
        let i = 0;
        for (const set of toSave) {
          i += 1;
          const setId = `${generationId}_set${i}`;
          const quality = assessEditorialQuality({
            greeting: set.greeting.text,
            body: set.body.text,
            closing: set.closing.text,
            brief,
          });
          const blocks: Array<{
            type: ContentVariantType;
            text: string;
            requiresVariables: string[];
          }> = [];
          if (mode === 'FULL_SETS' || mode === 'IMPROVE_CURRENT') {
            blocks.push(
              {
                type: ContentVariantType.GREETING,
                text: set.greeting.text,
                requiresVariables:
                  set.greeting.requiresVariables ??
                  variantRequiresVariables(set.greeting.text),
              },
              {
                type: ContentVariantType.BODY,
                text: set.body.text,
                requiresVariables:
                  set.body.requiresVariables ??
                  variantRequiresVariables(set.body.text),
              },
              {
                type: ContentVariantType.CLOSING,
                text: set.closing.text,
                requiresVariables:
                  set.closing.requiresVariables ??
                  variantRequiresVariables(set.closing.text),
              },
            );
          } else if (mode === 'GREETING_ONLY') {
            blocks.push({
              type: ContentVariantType.GREETING,
              text: set.greeting.text,
              requiresVariables:
                set.greeting.requiresVariables ??
                variantRequiresVariables(set.greeting.text),
            });
          } else if (mode === 'BODY_ONLY') {
            blocks.push({
              type: ContentVariantType.BODY,
              text: set.body.text,
              requiresVariables:
                set.body.requiresVariables ??
                variantRequiresVariables(set.body.text),
            });
          } else if (mode === 'CLOSING_ONLY') {
            blocks.push({
              type: ContentVariantType.CLOSING,
              text: set.closing.text,
              requiresVariables:
                set.closing.requiresVariables ??
                variantRequiresVariables(set.closing.text),
            });
          }

          for (const block of blocks) {
            maxOrder[block.type] += 1;
            await tx.contentVariant.create({
              data: {
                organizationId: campaign.organizationId,
                campaignId,
                compositionId: existing.id,
                type: block.type,
                source: ContentVariantSource.AI_GENERATED,
                text: block.text,
                normalizedTextHash: hashNormalizedContent(block.text),
                enabled: false,
                order: maxOrder[block.type],
                requiresVariables: block.requiresVariables,
                reviewPending: true,
                aiGenerationId: generationId,
                aiSummaryOfChanges: set.summaryOfChanges || null,
                generationSetId: setId,
                tone: brief.tone ?? null,
                formality: brief.formality ?? null,
                personalizationPlacement: placement,
                marketingAngle: set.marketingAngle || null,
                compatibleGroup: setId,
              },
            });
          }
          void quality;
        }

        await tx.contentComposition.update({
          where: { id: existing.id },
          data: {
            version: { increment: 1 },
            status: ContentCompositionStatus.READY_FOR_REVIEW,
            approvedAt: null,
            approvedByUserId: null,
            marketingBrief: brief as unknown as Prisma.InputJsonValue,
            personalizationPlacement: placement,
            combinationMode:
              existing.combinationMode === 'MIX_AND_MATCH'
                ? 'MIX_AND_MATCH'
                : 'LOCKED_SETS',
          },
        });
      });

      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'CONTENT_AI_GENERATION_COMPLETED',
        entityType: 'ContentComposition',
        entityId: existing.id,
        metadata: {
          generationId,
          model: ai.model,
          mode,
          setCount: toSave.length,
          promptVersion: CONTENT_PROMPT_VERSION,
        },
      });

      return this.get(userId, campaignId, compositionId);
    } catch (error) {
      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'CONTENT_AI_GENERATION_FAILED',
        entityType: 'ContentComposition',
        entityId: existing.id,
        metadata: {
          generationId,
          mode,
          reason:
            error instanceof Error ? error.message.slice(0, 200) : 'unknown',
        },
      });
      throw error;
    }
  }

  async approveGenerationSet(
    userId: string,
    campaignId: string,
    compositionId: string,
    dto: ApproveGenerationSetDto,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    const existing = await this.getCompositionOrThrow(
      compositionId,
      campaign.organizationId,
      campaignId,
    );
    this.assertEditable(existing.status);
    const setId = dto.generationSetId.trim();
    const members = existing.variants.filter((v) => v.generationSetId === setId);
    if (members.length === 0) {
      throw new NotFoundException('Conjunto de geracao nao encontrado');
    }
    const enable = dto.enable !== false;

    if (enable) {
      for (const type of [
        ContentVariantType.BODY,
        ContentVariantType.GREETING,
        ContentVariantType.CLOSING,
      ] as const) {
        const enabling = members.filter((m) => m.type === type).length;
        if (!enabling) continue;
        const active = existing.variants.filter(
          (v) =>
            v.type === type &&
            v.enabled &&
            v.generationSetId !== setId,
        ).length;
        assertActiveVariantLimits(type, active + enabling);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.contentVariant.updateMany({
        where: {
          compositionId: existing.id,
          generationSetId: setId,
        },
        data: {
          enabled: enable,
          reviewPending: enable ? false : true,
        },
      });
      await tx.contentComposition.update({
        where: { id: existing.id },
        data: {
          version: { increment: 1 },
          status: ContentCompositionStatus.READY_FOR_REVIEW,
          approvedAt: null,
          approvedByUserId: null,
        },
      });
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: enable ? 'CONTENT_VARIANT_ENABLED' : 'CONTENT_VARIANT_DISABLED',
      entityType: 'ContentComposition',
      entityId: existing.id,
      metadata: { generationSetId: setId, memberCount: members.length },
    });

    return this.get(userId, campaignId, compositionId);
  }

  async markReadyForReview(
    userId: string,
    campaignId: string,
    compositionId: string,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    const existing = await this.getCompositionOrThrow(
      compositionId,
      campaign.organizationId,
      campaignId,
    );
    this.assertEditable(existing.status);
    const bodies = existing.variants.filter(
      (v) => v.type === ContentVariantType.BODY && v.enabled,
    );
    if (bodies.length < 1) {
      throw new BadRequestException('Ao menos 1 BODY ativo e obrigatorio');
    }
    const pendingAi = existing.variants.filter(
      (v) => v.source === ContentVariantSource.AI_GENERATED && v.reviewPending && v.enabled,
    );
    if (pendingAi.length > 0) {
      throw new BadRequestException(
        'Variantes de IA ativadas ainda pendentes de revisao',
      );
    }

    const updated = await this.prisma.contentComposition.update({
      where: { id: existing.id },
      data: { status: ContentCompositionStatus.READY_FOR_REVIEW },
      include: compositionInclude,
    });
    return this.toDto(updated);
  }

  async approve(
    userId: string,
    campaignId: string,
    compositionId: string,
    _dto: ApproveCompositionDto,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId);
    await this.organizationAccess.requireApproveAccess(
      userId,
      campaign.organizationId,
    );
    const existing = await this.getCompositionOrThrow(
      compositionId,
      campaign.organizationId,
      campaignId,
    );
    if (
      existing.status !== ContentCompositionStatus.DRAFT &&
      existing.status !== ContentCompositionStatus.READY_FOR_REVIEW
    ) {
      throw new ConflictException('Composicao nao esta apta para aprovacao');
    }

    const enabledBodies = existing.variants.filter(
      (v) => v.type === ContentVariantType.BODY && v.enabled,
    );
    if (enabledBodies.length < 1) {
      throw new BadRequestException('Ao menos 1 BODY ativo e obrigatorio');
    }
    assertActiveVariantLimits(
      ContentVariantType.BODY,
      enabledBodies.length,
    );
    assertActiveVariantLimits(
      ContentVariantType.GREETING,
      existing.variants.filter((v) => v.type === 'GREETING' && v.enabled).length,
    );
    assertActiveVariantLimits(
      ContentVariantType.CLOSING,
      existing.variants.filter((v) => v.type === 'CLOSING' && v.enabled).length,
    );

    const pendingAi = existing.variants.filter(
      (v) =>
        v.source === ContentVariantSource.AI_GENERATED &&
        v.enabled &&
        v.reviewPending,
    );
    if (pendingAi.length > 0) {
      throw new BadRequestException(
        'Nenhuma variante de IA habilitada pode entrar sem revisao/aprovacao explicita',
      );
    }

    for (const v of existing.variants.filter((x) => x.enabled)) {
      validateVariantText(v.text, v.type);
    }

    const approvedAt = new Date();
    const updated = await this.prisma.contentComposition.update({
      where: { id: existing.id },
      data: {
        status: ContentCompositionStatus.APPROVED,
        approvedAt,
        approvedByUserId: userId,
      },
      include: compositionInclude,
    });

    const snapshot = this.buildSnapshot(updated, approvedAt, userId);

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'CONTENT_COMPOSITION_APPROVED',
      entityType: 'ContentComposition',
      entityId: updated.id,
      metadata: {
        version: updated.version,
        compositionSnapshotHash: snapshot.compositionSnapshotHash,
        enabledCounts: this.countEnabled(updated.variants),
      },
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'CONTENT_SNAPSHOT_CREATED',
      entityType: 'ContentComposition',
      entityId: updated.id,
      metadata: {
        compositionSnapshotHash: snapshot.compositionSnapshotHash,
        version: snapshot.compositionVersion,
      },
    });

    return { ...this.toDto(updated), snapshot };
  }

  async preview(
    userId: string,
    campaignId: string,
    compositionId: string,
    dto: PreviewCompositionDto,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId);
    const existing = await this.getCompositionOrThrow(
      compositionId,
      campaign.organizationId,
      campaignId,
    );

    const approvedAt = existing.approvedAt ?? new Date();
    const snapshot = this.buildSnapshot(
      existing,
      approvedAt,
      existing.approvedByUserId ?? userId,
    );

    const contacts = await this.prisma.contact.findMany({
      where: {
        organizationId: campaign.organizationId,
        campaignId,
        status: { not: 'DELETED' },
        ...(dto.contactId ? { id: dto.contactId } : {}),
      },
      take: dto.contactId ? 1 : 40,
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, city: true, metadata: true },
    });

    const withName = contacts.filter((c) => c.name?.trim());
    const withoutName = contacts.filter((c) => !c.name?.trim());
    const sample = dto.contactId
      ? contacts
      : [
          ...withName.slice(0, 3),
          ...withoutName.slice(0, 2),
          ...contacts.slice(0, 5),
        ]
          .filter(
            (c, i, arr) => arr.findIndex((x) => x.id === c.id) === i,
          )
          .slice(0, 5);

    const dispatchId = dto.dispatchId?.trim() || `preview:${existing.id}`;
    const previews = sample.map((contact) => {
      const companyName = extractCompanyFromMetadata(contact.metadata);
      const rendered = selectAndRenderComposition({
        snapshot,
        dispatchId,
        dispatchItemId: `preview:${contact.id}`,
        contactId: contact.id,
        contact: {
          name: contact.name,
          companyName,
          city: contact.city,
        },
      });
      return {
        contactId: contact.id,
        contactName: contact.name,
        greetingVariantId: rendered.greetingVariantId,
        bodyVariantId: rendered.bodyVariantId,
        closingVariantId: rendered.closingVariantId,
        generationSetId: rendered.generationSetId,
        renderedText: rendered.renderedText,
        renderedTextHash: rendered.renderedTextHash,
        personalizationStatus: rendered.personalizationStatus,
        personalizationPlacement: snapshot.personalizationPlacement ?? null,
        coherenceAlerts: rendered.coherenceAlerts,
        resolvedVariables: rendered.render.resolvedVariables,
        missingVariables: rendered.missingVariables,
        usedFallbacks: rendered.usedFallbacks,
        length: rendered.renderedText.length,
        valid: rendered.valid,
        errors: rendered.errors,
      };
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'CONTENT_PREVIEW_RENDERED',
      entityType: 'ContentComposition',
      entityId: existing.id,
      metadata: {
        sampleSize: previews.length,
        compositionVersion: snapshot.compositionVersion,
        compositionSnapshotHash: snapshot.compositionSnapshotHash,
      },
    });

    const enabled = this.countEnabled(existing.variants);
    return {
      notice:
        'O preview usa o mesmo algoritmo deterministico do envio.',
      compositionId: existing.id,
      compositionVersion: existing.version,
      compositionSnapshotHash: snapshot.compositionSnapshotHash,
      counts: {
        greetings: enabled.GREETING,
        bodies: enabled.BODY,
        closings: enabled.CLOSING,
        theoreticalCombinations: countTheoreticalCombinations({
          greetingCount: enabled.GREETING,
          bodyCount: enabled.BODY,
          closingCount: enabled.CLOSING,
        }),
      },
      previews,
    };
  }

  async similarityReport(
    userId: string,
    campaignId: string,
    compositionId: string,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId);
    const existing = await this.getCompositionOrThrow(
      compositionId,
      campaign.organizationId,
      campaignId,
    );
    const bodies = existing.variants.filter(
      (v) => v.type === ContentVariantType.BODY,
    );
    const base = bodies.find((v) => v.source === ContentVariantSource.BASE);
    const alerts: Array<{
      variantId: string;
      against: string;
      score: number;
      alert: string | null;
    }> = [];

    for (const v of bodies) {
      if (!base || v.id === base.id) continue;
      const a = assessContentRepetition({
        currentContent: v.text,
        recentContents: [base.text],
        thresholdPercentage: 70,
      });
      alerts.push({
        variantId: v.id,
        against: 'BASE',
        score: a.repetitionScore,
        alert: classifyContentSimilarity(a.repetitionScore),
      });
    }

    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = assessContentRepetition({
          currentContent: bodies[i]!.text,
          recentContents: [bodies[j]!.text],
          thresholdPercentage: 70,
        });
        alerts.push({
          variantId: bodies[i]!.id,
          against: bodies[j]!.id,
          score: a.repetitionScore,
          alert: classifyContentSimilarity(a.repetitionScore),
        });
      }
    }

    const recentPlans = await this.prisma.dispatchPlan.findMany({
      where: {
        organizationId: campaign.organizationId,
        campaignId,
        status: { in: ['APPROVED', 'EXPIRED'] },
      },
      orderBy: { approvedAt: 'desc' },
      take: 20,
      select: { content: true },
    });
    const recentContents = recentPlans
      .map((p) => (typeof p.content === 'string' ? p.content : ''))
      .filter(Boolean);
    if (base && recentContents.length) {
      const a = assessContentRepetition({
        currentContent: base.text,
        recentContents,
        thresholdPercentage: 70,
      });
      alerts.push({
        variantId: base.id,
        against: 'RECENT_CAMPAIGNS',
        score: a.repetitionScore,
        alert:
          classifyContentSimilarity(a.repetitionScore) === 'DUPLICATA_EXATA'
            ? 'CONTEUDO_RECENTE_REPETIDO'
            : a.exceedsThreshold
              ? 'CONTEUDO_RECENTE_REPETIDO'
              : classifyContentSimilarity(a.repetitionScore),
      });
    }

    return { alerts };
  }

  buildSnapshotFromApproved(
    composition: Prisma.ContentCompositionGetPayload<{
      include: typeof compositionInclude;
    }>,
  ): ContentCompositionSnapshotV1 {
    if (composition.status !== ContentCompositionStatus.APPROVED) {
      throw new BadRequestException('Composicao precisa estar APPROVED');
    }
    return this.buildSnapshot(
      composition,
      composition.approvedAt ?? new Date(),
      composition.approvedByUserId ?? composition.createdByUserId,
    );
  }

  private buildSnapshot(
    composition: Prisma.ContentCompositionGetPayload<{
      include: typeof compositionInclude;
    }>,
    approvedAt: Date,
    approvedByUserId: string,
  ): ContentCompositionSnapshotV1 {
    const enabledOnly = composition.variants.filter((v) => {
      if (!v.enabled) return false;
      if (v.source === ContentVariantSource.AI_GENERATED && v.reviewPending) {
        return false;
      }
      return true;
    });
    return buildCompositionSnapshotFromRows({
      composition: {
        id: composition.id,
        name: composition.name,
        version: composition.version,
        blockSeparator: composition.blockSeparator,
        fallbacks: parseFallbacks(composition.fallbacks),
        marketingBrief: parseMarketingBrief(composition.marketingBrief),
        personalizationPlacement: composition.personalizationPlacement,
        combinationMode: composition.combinationMode,
      },
      variants: enabledOnly.map((v) => ({
        id: v.id,
        type: v.type,
        source: v.source,
        text: v.text,
        normalizedTextHash: v.normalizedTextHash,
        enabled: v.enabled,
        order: v.order,
        requiresVariables: Array.isArray(v.requiresVariables)
          ? (v.requiresVariables as string[])
          : variantRequiresVariables(v.text),
        generationSetId: v.generationSetId,
        tone: v.tone,
        formality: v.formality,
        personalizationPlacement: v.personalizationPlacement,
        marketingAngle: v.marketingAngle,
        compatibleGroup: v.compatibleGroup,
      })),
      approvedAt,
      approvedByUserId,
      aiMeta: {
        promptVersion: CONTENT_PROMPT_VERSION,
        approvedSetIds: [
          ...new Set(
            enabledOnly
              .map((v) => v.generationSetId)
              .filter((id): id is string => Boolean(id)),
          ),
        ],
      },
    });
  }

  private countEnabled(
    variants: Array<{ type: ContentVariantType; enabled: boolean }>,
  ) {
    return {
      BODY: variants.filter((v) => v.type === 'BODY' && v.enabled).length,
      GREETING: variants.filter((v) => v.type === 'GREETING' && v.enabled).length,
      CLOSING: variants.filter((v) => v.type === 'CLOSING' && v.enabled).length,
    };
  }

  private toDto(
    row: Prisma.ContentCompositionGetPayload<{ include: typeof compositionInclude }>,
  ) {
    const enabled = this.countEnabled(row.variants);
    const brief = parseMarketingBrief(row.marketingBrief);
    const setMap = groupVariantsByGenerationSet(row.variants);
    const generationSets = [...setMap.entries()].map(([generationSetId, members]) => {
      const greeting = members.find((m) => m.type === 'GREETING');
      const body = members.find((m) => m.type === 'BODY');
      const closing = members.find((m) => m.type === 'CLOSING');
      const quality = assessEditorialQuality({
        greeting: greeting?.text,
        body: body?.text ?? '',
        closing: closing?.text,
        brief,
      });
      const coherenceAlerts = validateCompositionCoherence({
        greeting: greeting?.text,
        body: body?.text ?? '',
        closing: closing?.text,
        placement: isContentPersonalizationPlacement(row.personalizationPlacement)
          ? row.personalizationPlacement
          : 'GREETING',
      });
      return {
        generationSetId,
        marketingAngle: body?.marketingAngle ?? greeting?.marketingAngle ?? null,
        reviewPending: members.some((m) => m.reviewPending),
        enabled: members.every((m) => m.enabled),
        greeting: greeting
          ? { id: greeting.id, text: greeting.text, enabled: greeting.enabled }
          : null,
        body: body ? { id: body.id, text: body.text, enabled: body.enabled } : null,
        closing: closing
          ? { id: closing.id, text: closing.text, enabled: closing.enabled }
          : null,
        quality,
        coherenceAlerts,
      };
    });

    return {
      id: row.id,
      organizationId: row.organizationId,
      campaignId: row.campaignId,
      name: row.name,
      status: row.status,
      version: row.version,
      blockSeparator: row.blockSeparator,
      fallbacks: parseFallbacks(row.fallbacks),
      marketingBrief: brief,
      marketingBriefHints: marketingBriefQualityHints(brief),
      personalizationPlacement: row.personalizationPlacement,
      combinationMode: row.combinationMode,
      approvedAt: row.approvedAt,
      approvedByUserId: row.approvedByUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      counts: {
        ...enabled,
        theoreticalCombinations:
          row.combinationMode === 'LOCKED_SETS'
            ? Math.max(
                1,
                [...setMap.keys()].filter((id) => {
                  const m = setMap.get(id) ?? [];
                  return m.some((v) => v.type === 'BODY' && v.enabled);
                }).length || enabled.BODY,
              )
            : countTheoreticalCombinations({
                greetingCount: enabled.GREETING,
                bodyCount: enabled.BODY,
                closingCount: enabled.CLOSING,
              }),
      },
      aiEnabled: isContentAiEnabled(),
      generationSets,
      variants: row.variants.map((v) => ({
        id: v.id,
        type: v.type,
        source: v.source,
        text: v.text,
        normalizedTextHash: v.normalizedTextHash,
        enabled: v.enabled,
        order: v.order,
        requiresVariables: Array.isArray(v.requiresVariables)
          ? v.requiresVariables
          : variantRequiresVariables(v.text),
        reviewPending: v.reviewPending,
        aiGenerationId: v.aiGenerationId,
        aiSummaryOfChanges: v.aiSummaryOfChanges,
        generationSetId: v.generationSetId,
        tone: v.tone,
        formality: v.formality,
        personalizationPlacement: v.personalizationPlacement,
        marketingAngle: v.marketingAngle,
        compatibleGroup: v.compatibleGroup,
        variablesDetected: extractContentVariableKeys(v.text),
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
      })),
    };
  }

  private assertEditable(status: ContentCompositionStatus | string) {
    if (
      status === ContentCompositionStatus.ARCHIVED ||
      status === 'ARCHIVED'
    ) {
      throw new ConflictException('Composicao arquivada nao pode ser editada');
    }
  }

  private async callContentAiMarketing(input: {
    mode: ContentAiGenerationMode;
    baseText: string;
    brief: ContentMarketingBrief;
    campaignName: string;
    existingBlocks?: {
      greetings: string[];
      bodies: string[];
      closings: string[];
    };
    model: string;
    apiKey: string;
    baseUrl: string;
    timeoutMs: number;
    maxOutputChars: number;
    maxInputChars: number;
    jsonSchemaEnabled?: boolean;
    formatCorrection?: string;
  }): Promise<{
    payload: unknown;
    httpStatus: number;
    finishReason: string | null;
    rawExcerpt: string;
    payloadHash: string;
    usedJsonSchema: boolean;
  }> {
    const allowed = CONTENT_VARIABLE_CATALOG.map((v) => v.token).join(', ');
    const placement = input.brief.personalizationPlacement ?? 'GREETING';
    const placementRules =
      placement === 'GREETING'
        ? '{{firstName}} apenas na saudacao; corpo e fechamento sem nome.'
        : placement === 'BODY'
          ? 'Saudacao neutra; {{firstName}} no corpo no maximo uma vez; fechamento neutro.'
          : 'Nenhuma variante usa variavel de nome.';

    const wantsSets =
      input.mode === 'FULL_SETS' || input.mode === 'IMPROVE_CURRENT';
    const useJsonSchema =
      Boolean(input.jsonSchemaEnabled) &&
      wantsSets &&
      contentAiModelSupportsJsonSchema(input.model);

    const system = [
      'Voce e redatora de comunicacao eleitoral responsavel para WhatsApp.',
      'Candidato neste produto significa candidato ELEITORAL (cargo disputado), nunca candidato a emprego ou recrutamento.',
      'Crie texto claro, relevante ao eleitorado, com proposta concreta e CTA de escuta/participacao.',
      'Nao invente pesquisa, percentual, alianca, link, escassez ou promessas ilegais.',
      'Nao infira dados sensiveis (saude, religiao, raca, orientacao sexual, renda individual).',
      'Nao finja conhecimento individual do destinatario alem das variaveis permitidas.',
      `Variaveis permitidas: ${allowed}.`,
      `Posicionamento da personalizacao: ${placement}. ${placementRules}`,
      'Caracteristicas no briefing sao CONTEXTO COLETIVO do publico/eleitorado, nao dados individuais.',
      'Retorne SOMENTE JSON valido. Sem markdown. Sem texto antes ou depois.',
      wantsSets
        ? [
            'FULL_SETS exige 1 a 3 itens em sets.',
            'Cada set DEVE ter greeting, body e closing como objetos { "text": string nao vazia, "requiresVariables": string[] }.',
            'Saudacao curta; corpo completo com mensagem eleitoral; fechamento com CTA coerente.',
            'Nao coloque o corpo dentro da saudacao. Nao deixe campos vazios.',
            'preservedFacts deve ser true.',
            `Exemplo apenas de estrutura: ${JSON.stringify(CONTENT_AI_ELECTORAL_SETS_EXAMPLE)}`,
          ].join(' ')
        : 'Responda SOMENTE JSON: {"variants":[{"text":"...","summaryOfChanges":"...","preservedFacts":true}]} (bloco unico conforme o modo).',
      `promptVersion=${CONTENT_PROMPT_VERSION}`,
    ].join(' ');

    const protectedFacts = (input.brief.protectedFacts ?? []).join(' | ');
    const userParts = [
      `Modo: ${input.mode}`,
      `Campanha eleitoral: ${input.campaignName}`,
      `Objetivo: ${input.brief.objective ?? ''}`,
      `Proposta/oferta politica: ${input.brief.offerName ?? ''} — ${input.brief.offerDescription ?? ''}`,
      `Publico/eleitorado: ${input.brief.targetAudience ?? ''}`,
      `Caracteristicas coletivas do eleitorado: ${input.brief.candidateCharacteristics ?? ''}`,
      `Contexto coletivo: ${JSON.stringify(input.brief.collectiveContext ?? {})}`,
      `Dores/preocupacoes: ${input.brief.painPoints ?? ''}`,
      `Beneficio/proposta principal: ${input.brief.primaryBenefit ?? ''}`,
      `Propostas secundarias: ${input.brief.secondaryBenefits ?? ''}`,
      `Diferenciais: ${input.brief.differentiators ?? ''}`,
      `CTA: ${input.brief.callToAction ?? ''}`,
      `Tom: ${input.brief.tone ?? ''}; Formalidade: ${input.brief.formality ?? ''}`,
      `Idioma: ${input.brief.language ?? 'pt-BR'}`,
      `MaxLength: ${input.brief.maxLength ?? 800}`,
      `Fatos protegidos (preservar): ${protectedFacts}`,
      `Proibicoes: ${(input.brief.forbiddenClaims ?? []).join(' | ')}`,
      `Instrucoes: ${input.brief.additionalInstructions ?? ''}`,
      `Mensagem-base BODY:\n${input.baseText.slice(0, input.maxInputChars)}`,
    ];
    if (input.existingBlocks) {
      userParts.push(
        `Blocos atuais greeting: ${JSON.stringify(input.existingBlocks.greetings)}`,
        `Blocos atuais body: ${JSON.stringify(input.existingBlocks.bodies)}`,
        `Blocos atuais closing: ${JSON.stringify(input.existingBlocks.closings)}`,
      );
    }
    if (input.formatCorrection?.trim()) {
      userParts.push(input.formatCorrection.trim());
    }

    const responseFormat = useJsonSchema
      ? {
          type: 'json_schema' as const,
          json_schema: {
            name: CONTENT_AI_SETS_JSON_SCHEMA_NAME,
            strict: true,
            schema: CONTENT_AI_SETS_JSON_SCHEMA,
          },
        }
      : { type: 'json_object' as const };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      let res = await fetch(`${input.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: input.model,
          temperature: 0.7,
          response_format: responseFormat,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userParts.join('\n') },
          ],
        }),
        signal: controller.signal,
      });

      let usedJsonSchema = useJsonSchema;
      // Fallback se o provedor rejeitar json_schema
      if (!res.ok && useJsonSchema && (res.status === 400 || res.status === 422)) {
        usedJsonSchema = false;
        res = await fetch(`${input.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${input.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: input.model,
            temperature: 0.7,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: userParts.join('\n') },
            ],
          }),
          signal: controller.signal,
        });
      }

      if (!res.ok) {
        throw new ServiceUnavailableException(
          `Falha no provedor de IA (HTTP ${res.status})`,
        );
      }
      const json = (await res.json()) as {
        choices?: Array<{
          finish_reason?: string;
          message?: { content?: string };
        }>;
      };
      const content = json.choices?.[0]?.message?.content ?? '';
      const finishReason = json.choices?.[0]?.finish_reason ?? null;
      if (content.length > input.maxOutputChars) {
        throw new BadRequestException('Resposta da IA excede limite de saida');
      }

      const parsed = parseAiSetsRawContent(content);
      if (!parsed.ok) {
        return {
          payload: { __parseError: parsed.reason },
          httpStatus: res.status,
          finishReason,
          rawExcerpt: parsed.sanitizedExcerpt,
          payloadHash: 'parse-failed',
          usedJsonSchema,
        };
      }

      // Marca formato markdown no payload via wrapper interno nao persistido
      const payload =
        parsed.fromMarkdown &&
        parsed.value &&
        typeof parsed.value === 'object' &&
        !Array.isArray(parsed.value)
          ? parsed.value
          : parsed.value;

      const payloadHash = createHash('sha256')
        .update(content, 'utf8')
        .digest('hex')
        .slice(0, 16);

      return {
        payload,
        httpStatus: res.status,
        finishReason,
        rawExcerpt: content.slice(0, 200),
        payloadHash,
        usedJsonSchema,
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException(
        error instanceof Error
          ? `Falha na geracao por IA: ${error.message.slice(0, 160)}`
          : 'Falha na geracao por IA',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async getCompositionOrThrow(
    compositionId: string,
    organizationId: string,
    campaignId: string,
  ) {
    const row = await this.prisma.contentComposition.findFirst({
      where: { id: compositionId, organizationId, campaignId },
      include: compositionInclude,
    });
    if (!row) throw new NotFoundException('Composicao nao encontrada');
    return row;
  }

  private async getCampaignContext(
    userId: string,
    campaignId: string,
    requireWrite = false,
  ) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, organizationId: true, name: true },
    });
    if (!campaign) throw new NotFoundException('Campanha nao encontrada');
    if (requireWrite) {
      await this.organizationAccess.requireWriteAccess(
        userId,
        campaign.organizationId,
      );
    } else {
      await this.organizationAccess.requireMembership(
        userId,
        campaign.organizationId,
      );
    }
    return campaign;
  }

  private handleUniqueNameError(error: unknown): void {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Ja existe composicao com este nome');
    }
  }
}

function extractCompanyFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as Record<string, unknown>;
  for (const key of ['companyName', 'company', 'empresa']) {
    if (typeof m[key] === 'string' && m[key].trim()) return String(m[key]).trim();
  }
  return null;
}
