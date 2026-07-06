import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';

export class UpsertCandidateDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  party?: string;

  @IsOptional()
  @IsString()
  office?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsString()
  toneOfVoice?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mainProposals?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  restrictedTopics?: string[];
}
