import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { CampaignPhase, CampaignStatus } from '@prisma/client';

export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2100)
  electionYear?: number;

  @IsOptional()
  @IsString()
  @MinLength(2)
  office?: string;

  @IsOptional()
  @IsString()
  territory?: string;

  @IsOptional()
  @IsEnum(CampaignPhase)
  phase?: CampaignPhase;

  @IsOptional()
  @IsEnum(CampaignStatus)
  status?: CampaignStatus;
}
