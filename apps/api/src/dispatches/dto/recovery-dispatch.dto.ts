import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  DISPATCH_OPERATIONAL_REASON_MAX_LENGTH,
  DISPATCH_OPERATIONAL_REASON_MIN_LENGTH,
} from '../dispatch-operational.constants';

export class RecoverDispatchDto {
  @IsOptional()
  @IsIn(['SAFE_ONLY'])
  mode?: 'SAFE_ONLY';

  @IsString()
  @MinLength(DISPATCH_OPERATIONAL_REASON_MIN_LENGTH)
  @MaxLength(DISPATCH_OPERATIONAL_REASON_MAX_LENGTH)
  reason!: string;
}

export class RetryDispatchItemDto {
  @IsString()
  @MinLength(DISPATCH_OPERATIONAL_REASON_MIN_LENGTH)
  @MaxLength(DISPATCH_OPERATIONAL_REASON_MAX_LENGTH)
  reason!: string;
}

export class RetryFailedBatchDto {
  @IsString()
  @MinLength(DISPATCH_OPERATIONAL_REASON_MIN_LENGTH)
  @MaxLength(DISPATCH_OPERATIONAL_REASON_MAX_LENGTH)
  reason!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  itemIds?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxItems?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  errorCategories?: string[];
}

export class ResolveUnknownDto {
  @IsIn(['CONFIRMED_SENT', 'CONFIRMED_NOT_SENT', 'ABANDONED'])
  resolution!: 'CONFIRMED_SENT' | 'CONFIRMED_NOT_SENT' | 'ABANDONED';

  @IsString()
  @MinLength(DISPATCH_OPERATIONAL_REASON_MIN_LENGTH)
  @MaxLength(DISPATCH_OPERATIONAL_REASON_MAX_LENGTH)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  providerMessageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(DISPATCH_OPERATIONAL_REASON_MAX_LENGTH)
  evidence?: string;
}
