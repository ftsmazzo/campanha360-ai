import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateCompositionDto {
  /** Atalho operacional: preenche base + briefing a partir do candidato. */
  @IsOptional()
  @IsIn(['invite'])
  preset?: 'invite';

  @ValidateIf((dto: CreateCompositionDto) => dto.preset !== 'invite')
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ValidateIf((dto: CreateCompositionDto) => dto.preset !== 'invite')
  @IsString()
  @MinLength(1)
  @MaxLength(3500)
  baseBody?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  intention?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  blockSeparator?: string;

  @IsOptional()
  @IsObject()
  fallbacks?: Record<string, string>;
}

export class UpdateCompositionDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  blockSeparator?: string;

  @IsOptional()
  @IsObject()
  fallbacks?: Record<string, string>;

  @IsOptional()
  @IsObject()
  marketingBrief?: Record<string, unknown>;

  @IsOptional()
  @IsIn(['GREETING', 'BODY', 'NONE'])
  personalizationPlacement?: 'GREETING' | 'BODY' | 'NONE';

  @IsOptional()
  @IsIn(['LOCKED_SETS', 'MIX_AND_MATCH'])
  combinationMode?: 'LOCKED_SETS' | 'MIX_AND_MATCH';
}

export class CreateVariantDto {
  @IsIn(['BODY', 'GREETING', 'CLOSING'])
  type!: 'BODY' | 'GREETING' | 'CLOSING';

  @IsString()
  @MinLength(1)
  @MaxLength(3500)
  text!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  requiresVariables?: string[];
}

export class UpdateVariantDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(3500)
  text?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  reviewPending?: boolean;

  @IsOptional()
  requiresVariables?: string[];
}

export class GenerateAiVariantsDto {
  @IsOptional()
  @IsIn([
    'FULL_SETS',
    'GREETING_ONLY',
    'BODY_ONLY',
    'CLOSING_ONLY',
    'IMPROVE_CURRENT',
  ])
  mode?:
    | 'FULL_SETS'
    | 'GREETING_ONLY'
    | 'BODY_ONLY'
    | 'CLOSING_ONLY'
    | 'IMPROVE_CURRENT';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  objective?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  tone?: string;

  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(3500)
  maxChars?: number;

  /** Se true, exige campos recomendados do briefing. */
  @IsOptional()
  @IsBoolean()
  requireRecommendedBrief?: boolean;

  /** Intenção curta do fluxo Convite inicial (grava em additionalInstructions). */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  intention?: string;
}

export class ApproveCompositionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class ApproveGenerationSetDto {
  @IsString()
  @MinLength(1)
  generationSetId!: string;

  @IsOptional()
  @IsBoolean()
  enable?: boolean;
}

export class PreviewCompositionDto {
  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  dispatchId?: string;
}
