import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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

  @IsOptional()
  @IsString()
  @MinLength(1)
  channelAccountId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content?: string;
}
