import { DispatchItemStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

function parseInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export class ListDispatchItemsQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseInteger(value, 1))
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(({ value }) => parseInteger(value, 20))
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @IsEnum(DispatchItemStatus)
  status?: DispatchItemStatus;

  @IsOptional()
  @IsString()
  search?: string;
}
