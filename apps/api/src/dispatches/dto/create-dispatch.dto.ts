import { IsString, MinLength } from 'class-validator';

export class CreateDispatchDto {
  @IsString()
  @MinLength(1)
  dispatchPlanId!: string;
}
