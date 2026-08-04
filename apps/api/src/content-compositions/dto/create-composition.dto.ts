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
} from 'class-validator';

export class CreateCompositionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(3500)
  baseBody!: string;

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
}

export class ApproveCompositionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class PreviewCompositionDto {
  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  dispatchId?: string;
}
