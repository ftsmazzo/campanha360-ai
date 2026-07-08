import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../common/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContactNoteDto } from './dto/create-contact-note.dto';
import { UpdateContactNoteDto } from './dto/update-contact-note.dto';

const noteSelect = {
  id: true,
  organizationId: true,
  campaignId: true,
  contactId: true,
  body: true,
  createdAt: true,
  updatedAt: true,
  author: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
} satisfies Prisma.ContactNoteSelect;

@Injectable()
export class ContactNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationAccess: OrganizationAccessService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, campaignId: string, contactId: string) {
    const campaign = await this.getCampaignContext(userId, campaignId);
    await this.getContactOrThrow(contactId, campaign.organizationId, campaignId);

    return this.prisma.contactNote.findMany({
      where: {
        organizationId: campaign.organizationId,
        campaignId,
        contactId,
      },
      select: noteSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    userId: string,
    campaignId: string,
    contactId: string,
    dto: CreateContactNoteDto,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    await this.getContactOrThrow(contactId, campaign.organizationId, campaignId);

    const note = await this.prisma.contactNote.create({
      data: {
        organizationId: campaign.organizationId,
        campaignId,
        contactId,
        authorUserId: userId,
        body: dto.body.trim(),
      },
      select: noteSelect,
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'CONTACT_NOTE_CREATED',
      entityType: 'ContactNote',
      entityId: note.id,
      metadata: {
        contactId,
        authorUserId: userId,
      },
    });

    return note;
  }

  async update(
    userId: string,
    campaignId: string,
    contactId: string,
    noteId: string,
    dto: UpdateContactNoteDto,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    await this.getContactOrThrow(contactId, campaign.organizationId, campaignId);
    const existing = await this.getNoteOrThrow(
      noteId,
      campaign.organizationId,
      campaignId,
      contactId,
    );

    const note = await this.prisma.contactNote.update({
      where: { id: existing.id },
      data: { body: dto.body.trim() },
      select: noteSelect,
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'CONTACT_NOTE_UPDATED',
      entityType: 'ContactNote',
      entityId: note.id,
      metadata: {
        contactId,
        previousBodyLength: existing.body.length,
      },
    });

    return note;
  }

  private async getCampaignContext(
    userId: string,
    campaignId: string,
    requireWrite = false,
  ) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, organizationId: true },
    });

    if (!campaign) {
      throw new NotFoundException('Campanha nao encontrada');
    }

    if (requireWrite) {
      await this.organizationAccess.requireWriteAccess(userId, campaign.organizationId);
    } else {
      await this.organizationAccess.requireMembership(userId, campaign.organizationId);
    }

    return campaign;
  }

  private async getContactOrThrow(
    contactId: string,
    organizationId: string,
    campaignId: string,
  ) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, organizationId, campaignId },
      select: { id: true },
    });

    if (!contact) {
      throw new NotFoundException('Contato nao encontrado');
    }

    return contact;
  }

  private async getNoteOrThrow(
    noteId: string,
    organizationId: string,
    campaignId: string,
    contactId: string,
  ) {
    const note = await this.prisma.contactNote.findFirst({
      where: { id: noteId, organizationId, campaignId, contactId },
      select: { id: true, body: true },
    });

    if (!note) {
      throw new NotFoundException('Nota nao encontrada');
    }

    return note;
  }
}
