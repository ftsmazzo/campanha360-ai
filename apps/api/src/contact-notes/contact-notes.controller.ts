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
import { ContactNotesService } from './contact-notes.service';
import { CreateContactNoteDto } from './dto/create-contact-note.dto';
import { UpdateContactNoteDto } from './dto/update-contact-note.dto';

@Controller('campaigns/:campaignId/contacts/:contactId/notes')
@UseGuards(JwtAuthGuard)
export class ContactNotesController {
  constructor(private readonly contactNotesService: ContactNotesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.contactNotesService.list(user.id, campaignId, contactId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('contactId') contactId: string,
    @Body() dto: CreateContactNoteDto,
  ) {
    return this.contactNotesService.create(user.id, campaignId, contactId, dto);
  }

  @Put(':noteId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('contactId') contactId: string,
    @Param('noteId') noteId: string,
    @Body() dto: UpdateContactNoteDto,
  ) {
    return this.contactNotesService.update(user.id, campaignId, contactId, noteId, dto);
  }
}
