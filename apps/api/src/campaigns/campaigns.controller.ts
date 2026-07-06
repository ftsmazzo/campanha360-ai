import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { UpsertCandidateDto } from './dto/upsert-candidate.dto';

@Controller('campaigns')
@UseGuards(JwtAuthGuard)
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('organizationId') organizationId: string) {
    return this.campaignsService.list(user.id, organizationId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCampaignDto) {
    return this.campaignsService.create(user.id, dto);
  }

  @Get(':id')
  getById(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.campaignsService.getById(user.id, id);
  }

  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.campaignsService.update(user.id, id, dto);
  }

  @Get(':id/candidate')
  getCandidate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.campaignsService.getCandidate(user.id, id);
  }

  @Put(':id/candidate')
  upsertCandidate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpsertCandidateDto,
  ) {
    return this.campaignsService.upsertCandidate(user.id, id, dto);
  }
}
