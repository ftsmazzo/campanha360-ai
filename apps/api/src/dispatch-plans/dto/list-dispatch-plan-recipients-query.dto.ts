import { DispatchPlanRecipientEligibilityStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

const ELIGIBILITY_FILTERS = [
  ...Object.values(DispatchPlanRecipientEligibilityStatus),
  'EXCLUDED',
] as const;

function parseInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export class ListDispatchPlanRecipientsQueryDto {
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
  @IsIn(ELIGIBILITY_FILTERS)
  eligibilityStatus?:
    | DispatchPlanRecipientEligibilityStatus
    | 'EXCLUDED';

  @IsOptional()
  @IsString()
  search?: string;
}
