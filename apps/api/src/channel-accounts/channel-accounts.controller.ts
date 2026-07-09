import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelAccountsService } from './channel-accounts.service';
import { CreateChannelAccountDto } from './dto/create-channel-account.dto';
import { UpdateChannelAccountDto } from './dto/update-channel-account.dto';

@Controller('campaigns/:campaignId/channel-accounts')
@UseGuards(JwtAuthGuard)
export class ChannelAccountsController {
  constructor(private readonly channelAccountsService: ChannelAccountsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('campaignId') campaignId: string) {
    return this.channelAccountsService.list(user.id, campaignId);
  }

  @Get(':channelAccountId')
  getById(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('channelAccountId') channelAccountId: string,
  ) {
    return this.channelAccountsService.getById(user.id, campaignId, channelAccountId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Body() dto: CreateChannelAccountDto,
  ) {
    return this.channelAccountsService.create(user.id, campaignId, dto);
  }

  @Put(':channelAccountId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('channelAccountId') channelAccountId: string,
    @Body() dto: UpdateChannelAccountDto,
  ) {
    return this.channelAccountsService.update(user.id, campaignId, channelAccountId, dto);
  }
}
