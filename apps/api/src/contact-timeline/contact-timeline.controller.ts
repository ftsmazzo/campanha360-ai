import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ContactTimelineService } from './contact-timeline.service';

@Controller('campaigns/:campaignId/contacts/:contactId/timeline')
@UseGuards(JwtAuthGuard)
export class ContactTimelineController {
  constructor(private readonly contactTimelineService: ContactTimelineService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.contactTimelineService.getTimeline(user.id, campaignId, contactId);
  }
}
