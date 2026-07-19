import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SendInboxReplyDto } from './dto/send-inbox-reply.dto';
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

  @Post('threads/:threadId/messages')
  sendReply(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('threadId') threadId: string,
    @Body() dto: SendInboxReplyDto,
  ) {
    return this.inboxService.sendReply(user.id, campaignId, threadId, dto.body);
  }

  @Post('threads/:threadId/messages/:messageId/retry')
  retryMessage(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('threadId') threadId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.inboxService.retryMessage(user.id, campaignId, threadId, messageId);
  }
}
