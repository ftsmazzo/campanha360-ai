import { ChannelType, ContactStatus } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SegmentFiltersDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagIds?: string[];

  @IsOptional()
  @IsEnum(ContactStatus)
  status?: ContactStatus;

  @IsOptional()
  @IsBoolean()
  includeOptOut?: boolean;

  @IsOptional()
  @IsEnum(ChannelType)
  channel?: ChannelType;
}

export class CreateSegmentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsObject()
  @ValidateNested()
  @Type(() => SegmentFiltersDto)
  filters!: SegmentFiltersDto;
}

export class UpdateSegmentDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SegmentFiltersDto)
  filters?: SegmentFiltersDto;
}

export class PreviewSegmentDto {
  @IsObject()
  @ValidateNested()
  @Type(() => SegmentFiltersDto)
  filters!: SegmentFiltersDto;
}
