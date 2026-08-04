import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ProtectionProfile } from '@prisma/client';

export class DispatchPlanChannelInputDto {
  @IsString()
  @MinLength(1)
  channelAccountId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  priority?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  weight?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  dailyLimit?: number;
}

export class CreateDispatchPlanDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsString()
  @MinLength(1)
  segmentId!: string;

  /** Compatibilidade: canal primario unico. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  channelAccountId?: string;

  /** Pool multi-instancia. Se omitido, usa channelAccountId. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DispatchPlanChannelInputDto)
  channels?: DispatchPlanChannelInputDto[];

  @IsOptional()
  @IsEnum(ProtectionProfile)
  protectionProfile?: ProtectionProfile;

  /** Default true em todos os perfis. false exige aceite explicito. */
  @IsOptional()
  @IsBoolean()
  validateWhatsAppNumber?: boolean;

  /** Obrigatorio quando validateWhatsAppNumber=false. */
  @IsOptional()
  @IsBoolean()
  validateWhatsAppNumberDisableAcknowledged?: boolean;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;

  /** Composicao textual opcional (09.7.1). Deve estar APPROVED para aprovar o plano. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  contentCompositionId?: string;
}
