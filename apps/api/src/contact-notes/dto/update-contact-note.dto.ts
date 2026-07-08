import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateContactNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;
}
