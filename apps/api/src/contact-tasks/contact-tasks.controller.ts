import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ContactTasksService } from './contact-tasks.service';
import { CreateContactTaskDto } from './dto/create-contact-task.dto';
import { UpdateContactTaskDto } from './dto/update-contact-task.dto';

@Controller('campaigns/:campaignId/contacts/:contactId/tasks')
@UseGuards(JwtAuthGuard)
export class ContactTasksController {
  constructor(private readonly contactTasksService: ContactTasksService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.contactTasksService.list(user.id, campaignId, contactId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('contactId') contactId: string,
    @Body() dto: CreateContactTaskDto,
  ) {
    return this.contactTasksService.create(user.id, campaignId, contactId, dto);
  }

  @Put(':taskId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('contactId') contactId: string,
    @Param('taskId') taskId: string,
    @Body() dto: UpdateContactTaskDto,
  ) {
    return this.contactTasksService.update(user.id, campaignId, contactId, taskId, dto);
  }
}
