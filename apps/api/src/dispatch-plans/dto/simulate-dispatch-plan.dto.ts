import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { DISPATCH_SIMULATION_LIMITS } from '../dispatch-plan-simulation.constants';

export class SimulateDispatchPlanDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(DISPATCH_SIMULATION_LIMITS.messagesPerMinute.min)
  @Max(DISPATCH_SIMULATION_LIMITS.messagesPerMinute.max)
  messagesPerMinute?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(DISPATCH_SIMULATION_LIMITS.minDelaySeconds.min)
  @Max(DISPATCH_SIMULATION_LIMITS.minDelaySeconds.max)
  minDelaySeconds?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(DISPATCH_SIMULATION_LIMITS.maxDelaySeconds.min)
  @Max(DISPATCH_SIMULATION_LIMITS.maxDelaySeconds.max)
  maxDelaySeconds?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(DISPATCH_SIMULATION_LIMITS.batchSize.min)
  @Max(DISPATCH_SIMULATION_LIMITS.batchSize.max)
  batchSize?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(DISPATCH_SIMULATION_LIMITS.pauseBetweenBatchesSeconds.min)
  @Max(DISPATCH_SIMULATION_LIMITS.pauseBetweenBatchesSeconds.max)
  pauseBetweenBatchesSeconds?: number;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  allowedStartTime?: string;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  allowedEndTime?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  allowedDays?: number[];

  @IsOptional()
  @IsString()
  plannedStartAt?: string;
}
