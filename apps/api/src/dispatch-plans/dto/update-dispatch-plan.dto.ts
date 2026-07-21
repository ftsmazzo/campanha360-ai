import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ProtectionProfile } from '@prisma/client';
import { DispatchPlanChannelInputDto } from './create-dispatch-plan.dto';

export class UpdateDispatchPlanDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  segmentId?: string;

  /** Compatibilidade: canal primario unico. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  channelAccountId?: string;

  /** Substitui o pool de instancias do Plano. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DispatchPlanChannelInputDto)
  channels?: DispatchPlanChannelInputDto[];

  @IsOptional()
  @IsEnum(ProtectionProfile)
  protectionProfile?: ProtectionProfile;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content?: string;
}
