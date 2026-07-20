import { IsString, MaxLength, MinLength } from 'class-validator';

export class ImportContactsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2_000_000)
  csv!: string;
}
