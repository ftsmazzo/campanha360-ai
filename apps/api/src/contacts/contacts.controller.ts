import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ContactsService } from './contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { CreateOptOutDto } from './dto/create-opt-out.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { UpdateContactOperationsDto } from './dto/update-contact-operations.dto';
import { UpsertConsentDto } from './dto/upsert-consent.dto';

@Controller('campaigns/:campaignId/contacts')
@UseGuards(JwtAuthGuard)
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('campaignId') campaignId: string) {
    return this.contactsService.list(user.id, campaignId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Body() dto: CreateContactDto,
  ) {
    return this.contactsService.create(user.id, campaignId, dto);
  }

  @Get(':contactId')
  getById(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.contactsService.getById(user.id, campaignId, contactId);
  }

  @Put(':contactId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('contactId') contactId: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.contactsService.update(user.id, campaignId, contactId, dto);
  }

  @Put(':contactId/operations')
  updateOperations(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('contactId') contactId: string,
    @Body() dto: UpdateContactOperationsDto,
  ) {
    return this.contactsService.updateOperations(user.id, campaignId, contactId, dto);
  }

  @Put(':contactId/consents')
  upsertConsent(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('contactId') contactId: string,
    @Body() dto: UpsertConsentDto,
  ) {
    return this.contactsService.upsertConsent(user.id, campaignId, contactId, dto);
  }

  @Post(':contactId/opt-out')
  createOptOut(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('contactId') contactId: string,
    @Body() dto: CreateOptOutDto,
  ) {
    return this.contactsService.createOptOut(user.id, campaignId, contactId, dto);
  }

  @Post(':contactId/tags/:tagId')
  applyTag(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('contactId') contactId: string,
    @Param('tagId') tagId: string,
  ) {
    return this.contactsService.applyTag(user.id, campaignId, contactId, tagId);
  }

  @Delete(':contactId/tags/:tagId')
  removeTag(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('contactId') contactId: string,
    @Param('tagId') tagId: string,
  ) {
    return this.contactsService.removeTag(user.id, campaignId, contactId, tagId);
  }
}
