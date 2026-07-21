import { IsString, MaxLength, MinLength } from 'class-validator';
import {
  DISPATCH_PLAN_REASON_MAX_LENGTH,
  DISPATCH_PLAN_REASON_MIN_LENGTH,
} from '../dispatch-plan-approval.constants';

export class CancelDispatchPlanDto {
  @IsString()
  @MinLength(DISPATCH_PLAN_REASON_MIN_LENGTH)
  @MaxLength(DISPATCH_PLAN_REASON_MAX_LENGTH)
  reason!: string;
}
