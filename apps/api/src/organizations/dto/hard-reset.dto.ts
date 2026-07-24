import { IsIn, IsString, MinLength } from 'class-validator';

export const HARD_RESET_CONFIRMATION = 'HARD RESET';

export class HardResetDto {
  @IsString()
  @MinLength(1)
  @IsIn([HARD_RESET_CONFIRMATION], {
    message: `Confirmacao invalida. Digite exatamente: ${HARD_RESET_CONFIRMATION}`,
  })
  confirmation!: string;
}
