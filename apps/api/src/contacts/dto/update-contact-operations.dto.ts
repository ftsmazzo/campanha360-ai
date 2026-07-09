import { ContactOperationalStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, ValidateIf } from 'class-validator';

export class UpdateContactOperationsDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  assignedToUserId?: string | null;

  @IsOptional()
  @IsEnum(ContactOperationalStatus)
  operationalStatus?: ContactOperationalStatus;
}
