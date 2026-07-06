import {
  IsEmail,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ContactStatus } from '@prisma/client';
import { IsValidPhone } from '../validators/is-valid-phone.validator';

export class CreateContactDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ValidateIf((dto: CreateContactDto) => !dto.email)
  @IsString()
  @IsValidPhone()
  phoneNumber?: string;

  @ValidateIf((dto: CreateContactDto) => !dto.phoneNumber)
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  neighborhood?: string;

  @IsOptional()
  @IsEnum(ContactStatus)
  status?: ContactStatus;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
