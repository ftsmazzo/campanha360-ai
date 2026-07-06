import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { ChannelType } from '@prisma/client';

export class CreateOptOutDto {
  @IsOptional()
  @IsEnum(ChannelType)
  channel?: ChannelType;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  source?: string;
}
