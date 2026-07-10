import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EvolutionService } from './evolution.service';

@Controller('campaigns/:campaignId/channel-accounts/:channelAccountId/evolution')
@UseGuards(JwtAuthGuard)
export class EvolutionController {
  constructor(private readonly evolutionService: EvolutionService) {}

  @Get('status')
  getStatus(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('channelAccountId') channelAccountId: string,
  ) {
    return this.evolutionService.getStatus(user.id, campaignId, channelAccountId);
  }

  @Post('prepare')
  prepare(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('channelAccountId') channelAccountId: string,
  ) {
    return this.evolutionService.prepare(user.id, campaignId, channelAccountId);
  }

  @Get('qrcode')
  getQrCode(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('channelAccountId') channelAccountId: string,
  ) {
    return this.evolutionService.getQrCode(user.id, campaignId, channelAccountId);
  }
}
