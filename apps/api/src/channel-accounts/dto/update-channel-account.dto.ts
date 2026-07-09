import { ChannelAccountStatus, ChannelProvider } from '@prisma/client';
import { IsEnum, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateChannelAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEnum(ChannelProvider)
  provider?: ChannelProvider;

  @IsOptional()
  @IsEnum(ChannelAccountStatus)
  status?: ChannelAccountStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalAccountId?: string | null;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown> | null;
}
