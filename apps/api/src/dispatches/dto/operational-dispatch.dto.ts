import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import {
  DISPATCH_OPERATIONAL_REASON_MAX_LENGTH,
  DISPATCH_OPERATIONAL_REASON_MIN_LENGTH,
} from '../dispatch-operational.constants';

export class PauseDispatchDto {
  @IsOptional()
  @IsString()
  @MaxLength(DISPATCH_OPERATIONAL_REASON_MAX_LENGTH)
  reason?: string;
}

export class CancelDispatchDto {
  @IsString()
  @MinLength(DISPATCH_OPERATIONAL_REASON_MIN_LENGTH)
  @MaxLength(DISPATCH_OPERATIONAL_REASON_MAX_LENGTH)
  reason!: string;
}

export class EmergencyStopDispatchDto {
  @IsString()
  @MinLength(DISPATCH_OPERATIONAL_REASON_MIN_LENGTH)
  @MaxLength(DISPATCH_OPERATIONAL_REASON_MAX_LENGTH)
  reason!: string;
}
