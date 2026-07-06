import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChannelType,
  ConsentStatus,
  ContactStatus,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { normalizePhone } from '../common/phone.util';
import { OrganizationAccessService } from '../common/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { CreateOptOutDto } from './dto/create-opt-out.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { UpsertConsentDto } from './dto/upsert-consent.dto';

const contactSelect = {
  id: true,
  organizationId: true,
  campaignId: true,
  name: true,
  phoneNumber: true,
  email: true,
  city: true,
  neighborhood: true,
  metadata: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  channels: {
    select: {
      id: true,
      channel: true,
      value: true,
      normalizedValue: true,
      isPrimary: true,
      status: true,
    },
    orderBy: { createdAt: 'asc' as const },
  },
  consents: {
    select: {
      id: true,
      channel: true,
      status: true,
      source: true,
      consentText: true,
      collectedAt: true,
      revokedAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' as const },
  },
  optOuts: {
    select: {
      id: true,
      channel: true,
      reason: true,
      source: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' as const },
  },
} satisfies Prisma.ContactSelect;

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationAccess: OrganizationAccessService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, campaignId: string) {
    const campaign = await this.getCampaignContext(userId, campaignId);

    return this.prisma.contact.findMany({
      where: {
        organizationId: campaign.organizationId,
        campaignId,
      },
      select: contactSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(userId: string, campaignId: string, dto: CreateContactDto) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    this.ensureContactIdentifier(dto.phoneNumber, dto.email);

    const phoneNumber = dto.phoneNumber?.trim() || null;
    const email = dto.email?.trim().toLowerCase() || null;

    const contact = await this.prisma.$transaction(async (tx) => {
      const created = await tx.contact.create({
        data: {
          organizationId: campaign.organizationId,
          campaignId,
          name: dto.name?.trim() || null,
          phoneNumber,
          email,
          city: dto.city?.trim() || null,
          neighborhood: dto.neighborhood?.trim() || null,
          status: dto.status ?? ContactStatus.ACTIVE,
          metadata: dto.metadata as Prisma.InputJsonValue | undefined,
        },
        select: contactSelect,
      });

      await this.syncChannels(tx, created.id, campaign.organizationId, campaignId, phoneNumber, email);
      return this.getContactInTransaction(tx, created.id, campaign.organizationId, campaignId);
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'CONTACT_CREATED',
      entityType: 'Contact',
      entityId: contact.id,
      metadata: {
        name: contact.name,
        phoneNumber: contact.phoneNumber,
        email: contact.email,
        status: contact.status,
      },
    });

    return contact;
  }

  async getById(userId: string, campaignId: string, contactId: string) {
    const campaign = await this.getCampaignContext(userId, campaignId);
    return this.getContactOrThrow(contactId, campaign.organizationId, campaignId);
  }

  async update(
    userId: string,
    campaignId: string,
    contactId: string,
    dto: UpdateContactDto,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    const existing = await this.getContactOrThrow(contactId, campaign.organizationId, campaignId);

    const phoneNumber =
      dto.phoneNumber === undefined ? existing.phoneNumber : dto.phoneNumber.trim() || null;
    const email =
      dto.email === undefined ? existing.email : dto.email.trim().toLowerCase() || null;

    if (!phoneNumber && !email) {
      throw new BadRequestException('Informe telefone ou e-mail');
    }

    const contact = await this.prisma.$transaction(async (tx) => {
      await tx.contact.update({
        where: { id: contactId },
        data: {
          name: dto.name === undefined ? undefined : dto.name?.trim() || null,
          phoneNumber,
          email,
          city: dto.city === undefined ? undefined : dto.city?.trim() || null,
          neighborhood:
            dto.neighborhood === undefined ? undefined : dto.neighborhood?.trim() || null,
          status: dto.status,
          metadata:
            dto.metadata === undefined
              ? undefined
              : (dto.metadata as Prisma.InputJsonValue | undefined),
        },
      });

      await this.syncChannels(
        tx,
        contactId,
        campaign.organizationId,
        campaignId,
        phoneNumber,
        email,
      );

      return this.getContactInTransaction(tx, contactId, campaign.organizationId, campaignId);
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'CONTACT_UPDATED',
      entityType: 'Contact',
      entityId: contact.id,
      metadata: { changes: JSON.parse(JSON.stringify(dto)) },
    });

    return contact;
  }

  async upsertConsent(
    userId: string,
    campaignId: string,
    contactId: string,
    dto: UpsertConsentDto,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    await this.getContactOrThrow(contactId, campaign.organizationId, campaignId);

    const now = new Date();
    const existing = await this.prisma.consent.findFirst({
      where: {
        organizationId: campaign.organizationId,
        campaignId,
        contactId,
        channel: dto.channel,
      },
      orderBy: { createdAt: 'desc' },
    });

    const consent = existing
      ? await this.prisma.consent.update({
          where: { id: existing.id },
          data: {
            status: dto.status,
            source: dto.source?.trim() || 'manual',
            consentText: dto.consentText?.trim() || null,
            collectedAt:
              dto.status === ConsentStatus.GRANTED
                ? existing.collectedAt ?? now
                : existing.collectedAt,
            revokedAt:
              dto.status === ConsentStatus.REVOKED || dto.status === ConsentStatus.OPT_OUT
                ? now
                : null,
          },
        })
      : await this.prisma.consent.create({
          data: {
            organizationId: campaign.organizationId,
            campaignId,
            contactId,
            channel: dto.channel,
            status: dto.status,
            source: dto.source?.trim() || 'manual',
            consentText: dto.consentText?.trim() || null,
            collectedAt: dto.status === ConsentStatus.GRANTED ? now : null,
            revokedAt:
              dto.status === ConsentStatus.REVOKED || dto.status === ConsentStatus.OPT_OUT
                ? now
                : null,
          },
        });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: existing ? 'CONSENT_UPDATED' : 'CONSENT_CREATED',
      entityType: 'Consent',
      entityId: consent.id,
      metadata: {
        contactId,
        channel: dto.channel,
        status: dto.status,
        source: consent.source,
      },
    });

    return this.getById(userId, campaignId, contactId);
  }

  async createOptOut(
    userId: string,
    campaignId: string,
    contactId: string,
    dto: CreateOptOutDto,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    await this.getContactOrThrow(contactId, campaign.organizationId, campaignId);

    const source = dto.source?.trim() || 'manual';
    const channels = dto.channel ? [dto.channel] : [ChannelType.WHATSAPP, ChannelType.EMAIL];

    await this.prisma.$transaction(async (tx) => {
      await tx.optOut.create({
        data: {
          organizationId: campaign.organizationId,
          campaignId,
          contactId,
          channel: dto.channel ?? null,
          reason: dto.reason?.trim() || null,
          source,
        },
      });

      for (const channel of channels) {
        const existing = await tx.consent.findFirst({
          where: {
            organizationId: campaign.organizationId,
            campaignId,
            contactId,
            channel,
          },
          orderBy: { createdAt: 'desc' },
        });

        if (existing) {
          await tx.consent.update({
            where: { id: existing.id },
            data: {
              status: ConsentStatus.OPT_OUT,
              source,
              revokedAt: new Date(),
            },
          });
        } else {
          await tx.consent.create({
            data: {
              organizationId: campaign.organizationId,
              campaignId,
              contactId,
              channel,
              status: ConsentStatus.OPT_OUT,
              source,
              revokedAt: new Date(),
            },
          });
        }
      }

      await tx.contact.update({
        where: { id: contactId },
        data: { status: ContactStatus.BLOCKED },
      });
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'OPT_OUT_CREATED',
      entityType: 'OptOut',
      entityId: contactId,
      metadata: {
        channel: dto.channel ?? 'ALL',
        reason: dto.reason ?? null,
        source,
      },
    });

    return this.getById(userId, campaignId, contactId);
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
      select: contactSelect,
    });

    if (!contact) {
      throw new NotFoundException('Contato nao encontrado');
    }

    return contact;
  }

  private async getContactInTransaction(
    tx: Prisma.TransactionClient,
    contactId: string,
    organizationId: string,
    campaignId: string,
  ) {
    const contact = await tx.contact.findFirst({
      where: { id: contactId, organizationId, campaignId },
      select: contactSelect,
    });

    if (!contact) {
      throw new NotFoundException('Contato nao encontrado');
    }

    return contact;
  }

  private ensureContactIdentifier(phoneNumber?: string, email?: string) {
    if (!phoneNumber?.trim() && !email?.trim()) {
      throw new BadRequestException('Informe telefone ou e-mail');
    }
  }

  private async syncChannels(
    tx: Prisma.TransactionClient,
    contactId: string,
    organizationId: string,
    campaignId: string,
    phoneNumber: string | null,
    email: string | null,
  ) {
    if (phoneNumber) {
      await this.upsertChannel(tx, {
        contactId,
        organizationId,
        campaignId,
        channel: ChannelType.WHATSAPP,
        value: phoneNumber,
        normalizedValue: normalizePhone(phoneNumber),
        isPrimary: !email,
      });
    } else {
      await tx.contactChannel.deleteMany({
        where: { contactId, channel: ChannelType.WHATSAPP },
      });
    }

    if (email) {
      await this.upsertChannel(tx, {
        contactId,
        organizationId,
        campaignId,
        channel: ChannelType.EMAIL,
        value: email,
        normalizedValue: email.toLowerCase(),
        isPrimary: !phoneNumber,
      });
    } else {
      await tx.contactChannel.deleteMany({
        where: { contactId, channel: ChannelType.EMAIL },
      });
    }
  }

  private async upsertChannel(
    tx: Prisma.TransactionClient,
    input: {
      contactId: string;
      organizationId: string;
      campaignId: string;
      channel: ChannelType;
      value: string;
      normalizedValue: string;
      isPrimary: boolean;
    },
  ) {
    const existing = await tx.contactChannel.findFirst({
      where: {
        contactId: input.contactId,
        channel: input.channel,
      },
    });

    if (existing) {
      await tx.contactChannel.update({
        where: { id: existing.id },
        data: {
          value: input.value,
          normalizedValue: input.normalizedValue,
          isPrimary: input.isPrimary,
          status: 'ACTIVE',
        },
      });
      return;
    }

    await tx.contactChannel.create({
      data: {
        organizationId: input.organizationId,
        campaignId: input.campaignId,
        contactId: input.contactId,
        channel: input.channel,
        value: input.value,
        normalizedValue: input.normalizedValue,
        isPrimary: input.isPrimary,
        status: 'ACTIVE',
      },
    });
  }
}
