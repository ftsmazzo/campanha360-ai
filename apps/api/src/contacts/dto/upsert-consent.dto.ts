import {
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { ChannelType, ConsentStatus } from '@prisma/client';

export class UpsertConsentDto {
  @IsEnum(ChannelType)
  channel!: ChannelType;

  @IsEnum(ConsentStatus)
  status!: ConsentStatus;

  @IsOptional()
  @IsString()
  @MinLength(2)
  source?: string;

  @IsOptional()
  @IsString()
  consentText?: string;
}
