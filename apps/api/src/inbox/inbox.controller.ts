import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { InboxService } from './inbox.service';

@Controller('campaigns/:campaignId/inbox')
@UseGuards(JwtAuthGuard)
export class InboxController {
  constructor(private readonly inboxService: InboxService) {}

  @Get('threads')
  listThreads(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
  ) {
    return this.inboxService.listThreads(user.id, campaignId);
  }

  @Get('threads/:threadId')
  getThread(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('threadId') threadId: string,
  ) {
    return this.inboxService.getThread(user.id, campaignId, threadId);
  }
}
