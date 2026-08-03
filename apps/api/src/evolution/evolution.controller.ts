import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EvolutionLifecycleService } from './evolution-lifecycle.service';
import { EvolutionService } from './evolution.service';

@Controller('campaigns/:campaignId/channel-accounts/:channelAccountId/evolution')
@UseGuards(JwtAuthGuard)
export class EvolutionController {
  constructor(
    private readonly evolutionService: EvolutionService,
    private readonly lifecycle: EvolutionLifecycleService,
  ) {}

  @Get('status')
  getStatus(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('channelAccountId') channelAccountId: string,
  ) {
    return this.lifecycle.getInstanceState(user.id, campaignId, channelAccountId);
  }

  /** @deprecated Preferir create-instance / link-instance. Mantido como sync. */
  @Post('prepare')
  prepare(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('channelAccountId') channelAccountId: string,
  ) {
    return this.evolutionService.prepare(user.id, campaignId, channelAccountId);
  }

  @Post('create-instance')
  createInstance(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('channelAccountId') channelAccountId: string,
    @Body() body: { instanceName?: string; confirmCreate?: boolean },
  ) {
    return this.lifecycle.createInstance(user.id, campaignId, channelAccountId, body ?? {});
  }

  @Post('preview-link')
  previewLink(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('channelAccountId') channelAccountId: string,
    @Body() body: { instanceName: string },
  ) {
    return this.lifecycle.previewLink(user.id, campaignId, channelAccountId, body);
  }

  @Post('link-instance')
  linkInstance(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('channelAccountId') channelAccountId: string,
    @Body() body: { instanceName: string; confirmLink?: boolean },
  ) {
    return this.lifecycle.linkInstance(user.id, campaignId, channelAccountId, body);
  }

  @Post('reconnect')
  reconnect(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('channelAccountId') channelAccountId: string,
  ) {
    return this.lifecycle.reconnect(user.id, campaignId, channelAccountId);
  }

  @Post('restart')
  restart(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('channelAccountId') channelAccountId: string,
  ) {
    return this.lifecycle.restart(user.id, campaignId, channelAccountId);
  }

  @Post('reset-session')
  resetSession(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('channelAccountId') channelAccountId: string,
    @Body() body: { confirmReset?: boolean },
  ) {
    return this.lifecycle.resetSession(user.id, campaignId, channelAccountId, body ?? {});
  }

  @Get('qrcode')
  getQrCode(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('channelAccountId') channelAccountId: string,
  ) {
    return this.lifecycle.requestQrCode(user.id, campaignId, channelAccountId);
  }
}
