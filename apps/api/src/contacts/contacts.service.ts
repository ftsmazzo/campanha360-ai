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
import { buildContactInteractionMap } from './contact-interaction.util';
import {
  buildImportAuditMetadata,
  parseAndValidateImportCsv,
  resolveImportNameUpdate,
} from './contact-import.util';
import { resolveStatusAfterClearOptOut } from './contact-opt-out.util';
import {
  buildContactListAndClauses,
  normalizeTagName,
  resolveApplyContactTag,
  resolveRemoveContactTag,
} from './contact-tag.util';
import { CreateContactDto } from './dto/create-contact.dto';
import { CreateOptOutDto } from './dto/create-opt-out.dto';
import { ImportContactsDto } from './dto/import-contacts.dto';
import { ListContactsQueryDto } from './dto/list-contacts-query.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { UpdateContactOperationsDto } from './dto/update-contact-operations.dto';
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
  operationalStatus: true,
  assignedToUserId: true,
  createdAt: true,
  updatedAt: true,
  assignedTo: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
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
  tags: {
    select: {
      createdAt: true,
      tag: {
        select: {
          id: true,
          name: true,
          color: true,
          description: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.ContactSelect;

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationAccess: OrganizationAccessService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, campaignId: string, query: ListContactsQueryDto = {}) {
    const campaign = await this.getCampaignContext(userId, campaignId);

    if (query.tagId) {
      await this.validateCampaignTag(query.tagId, campaign.organizationId, campaignId);
    }

    if (query.assignedToUserId) {
      await this.validateOperationalAssignee(query.assignedToUserId, campaign.organizationId);
    }

    const where = this.buildListWhere(campaign.organizationId, campaignId, query);

    const contacts = await this.prisma.contact.findMany({
      where,
      select: contactSelect,
      orderBy: { createdAt: 'desc' },
    });

    return this.attachInteractionSummaries(
      contacts,
      campaign.organizationId,
      campaignId,
    );
  }

  async getById(userId: string, campaignId: string, contactId: string) {
    const campaign = await this.getCampaignContext(userId, campaignId);
    const contact = await this.getContactOrThrow(contactId, campaign.organizationId, campaignId);
    const [enriched] = await this.attachInteractionSummaries(
      [contact],
      campaign.organizationId,
      campaignId,
    );
    return enriched;
  }

  private async attachInteractionSummaries<T extends { id: string }>(
    contacts: T[],
    organizationId: string,
    campaignId: string,
  ) {
    if (contacts.length === 0) {
      return contacts.map((contact) => ({
        ...contact,
        lastInteractionAt: null as string | null,
        messageCount: 0,
        latestThreadId: null as string | null,
        latestChannel: null as string | null,
      }));
    }

    const contactIds = contacts.map((contact) => contact.id);

    const [threads, messageCounts] = await Promise.all([
      this.prisma.conversationThread.findMany({
        where: {
          organizationId,
          campaignId,
          contactId: { in: contactIds },
        },
        select: {
          id: true,
          contactId: true,
          lastMessageAt: true,
          channel: true,
        },
      }),
      this.prisma.message.groupBy({
        by: ['contactId'],
        where: {
          organizationId,
          campaignId,
          contactId: { in: contactIds },
        },
        _count: { _all: true },
      }),
    ]);

    const interactionMap = buildContactInteractionMap(
      threads,
      messageCounts.map((row) => ({
        contactId: row.contactId,
        count: row._count._all,
      })),
    );

    return contacts.map((contact) => {
      const summary = interactionMap.get(contact.id);
      return {
        ...contact,
        lastInteractionAt: summary?.lastInteractionAt ?? null,
        messageCount: summary?.messageCount ?? 0,
        latestThreadId: summary?.latestThreadId ?? null,
        latestChannel: summary?.latestChannel ?? null,
      };
    });
  }

  private buildListWhere(
    organizationId: string,
    campaignId: string,
    query: ListContactsQueryDto,
  ): Prisma.ContactWhereInput {
    return {
      AND: buildContactListAndClauses({
        organizationId,
        campaignId,
        q: query.q,
        tagId: query.tagId,
        status: query.status,
        operationalStatus: query.operationalStatus,
        assignedToUserId: query.assignedToUserId,
        hasOptOut: query.hasOptOut,
      }),
    };
  }

  private async validateCampaignTag(
    tagId: string,
    organizationId: string,
    campaignId: string,
  ) {
    const tag = await this.prisma.tag.findFirst({
      where: { id: tagId, organizationId, campaignId },
      select: { id: true },
    });

    if (!tag) {
      throw new BadRequestException('Tag invalida para esta campanha');
    }
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

  async importFromCsv(userId: string, campaignId: string, dto: ImportContactsDto) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    const parsed = parseAndValidateImportCsv(dto.csv);
    const structuralError = parsed.errors.find(
      (error) =>
        error.reason === 'CSV vazio' || error.reason === 'Coluna telefone obrigatoria ausente',
    );

    if (structuralError && parsed.rows.length === 0) {
      throw new BadRequestException(structuralError.reason);
    }

    if (parsed.rows.length > 1000) {
      throw new BadRequestException('Limite de 1000 contatos por importacao');
    }

    let created = 0;
    let updated = 0;
    const validationErrors = [...parsed.errors];
    let ignored = parsed.ignored;

    const tagCache = new Map<string, string>();

    for (const row of parsed.rows) {
      try {
        const existing = await this.findContactByNormalizedPhone(
          campaign.organizationId,
          campaignId,
          row.phone,
        );

        if (existing) {
          const nextName = resolveImportNameUpdate(row.name, existing.name);

          await this.prisma.$transaction(async (tx) => {
            await tx.contact.update({
              where: { id: existing.id },
              data: {
                name: nextName,
                phoneNumber: row.phone,
                // Importacao nunca altera status (preserva BLOCKED/opt-out).
                metadata: this.mergeImportMetadata(existing.metadata),
              },
            });

            await this.syncChannels(
              tx,
              existing.id,
              campaign.organizationId,
              campaignId,
              row.phone,
              existing.email,
            );

            if (row.note) {
              await tx.contactNote.create({
                data: {
                  organizationId: campaign.organizationId,
                  campaignId,
                  contactId: existing.id,
                  authorUserId: userId,
                  body: row.note,
                },
              });
            }

            await this.ensureImportTags(
              tx,
              campaign.organizationId,
              campaignId,
              existing.id,
              row.tagNames,
              tagCache,
            );
          });

          updated += 1;
          continue;
        }

        await this.prisma.$transaction(async (tx) => {
          const createdContact = await tx.contact.create({
            data: {
              organizationId: campaign.organizationId,
              campaignId,
              name: row.name,
              phoneNumber: row.phone,
              status: ContactStatus.ACTIVE,
              metadata: this.mergeImportMetadata(null),
            },
            select: { id: true },
          });

          await this.syncChannels(
            tx,
            createdContact.id,
            campaign.organizationId,
            campaignId,
            row.phone,
            null,
          );

          if (row.note) {
            await tx.contactNote.create({
              data: {
                organizationId: campaign.organizationId,
                campaignId,
                contactId: createdContact.id,
                authorUserId: userId,
                body: row.note,
              },
            });
          }

          await this.ensureImportTags(
            tx,
            campaign.organizationId,
            campaignId,
            createdContact.id,
            row.tagNames,
            tagCache,
          );
        });

        created += 1;
      } catch {
        validationErrors.push({
          lineNumber: row.lineNumber,
          reason: 'Falha ao importar linha',
        });
        ignored += 1;
      }
    }

    const summary = {
      created,
      updated,
      ignored,
      errors: validationErrors,
      errorCount: validationErrors.length,
    };

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'CONTACTS_IMPORTED',
      entityType: 'Campaign',
      entityId: campaignId,
      metadata: buildImportAuditMetadata({
        created,
        updated,
        ignored,
        errors: validationErrors.length,
        totalRows: parsed.rows.length + parsed.errors.length + parsed.ignored,
      }),
    });

    return summary;
  }

  private mergeImportMetadata(existing: unknown): Prisma.InputJsonValue {
    const base =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};

    return {
      ...base,
      lastImportSource: 'csv',
      lastImportedAt: new Date().toISOString(),
    } as Prisma.InputJsonValue;
  }

  private async findContactByNormalizedPhone(
    organizationId: string,
    campaignId: string,
    phone: string,
  ) {
    const byChannel = await this.prisma.contactChannel.findFirst({
      where: {
        organizationId,
        campaignId,
        channel: ChannelType.WHATSAPP,
        normalizedValue: phone,
      },
      select: {
        contact: {
          select: {
            id: true,
            name: true,
            email: true,
            status: true,
            metadata: true,
          },
        },
      },
    });

    if (byChannel?.contact) {
      return byChannel.contact;
    }

    return this.prisma.contact.findFirst({
      where: {
        organizationId,
        campaignId,
        phoneNumber: phone,
      },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        metadata: true,
      },
    });
  }

  private async ensureImportTags(
    tx: Prisma.TransactionClient,
    organizationId: string,
    campaignId: string,
    contactId: string,
    tagNames: string[],
    tagCache: Map<string, string>,
  ) {
    for (const rawName of tagNames) {
      const name = normalizeTagName(rawName);
      if (!name) continue;

      let tagId = tagCache.get(name.toLowerCase());

      if (!tagId) {
        const existingTag = await tx.tag.findFirst({
          where: {
            organizationId,
            campaignId,
            name: { equals: name, mode: 'insensitive' },
          },
          select: { id: true, name: true },
        });

        if (existingTag) {
          tagId = existingTag.id;
        } else {
          const createdTag = await tx.tag.create({
            data: {
              organizationId,
              campaignId,
              name,
            },
            select: { id: true },
          });
          tagId = createdTag.id;
        }

        tagCache.set(name.toLowerCase(), tagId);
      }

      const link = await tx.contactTag.findUnique({
        where: {
          contactId_tagId: { contactId, tagId },
        },
      });

      if (resolveApplyContactTag(Boolean(link)) === 'created') {
        await tx.contactTag.create({
          data: { contactId, tagId },
        });
      }
    }
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

    return this.getById(userId, campaignId, contactId);
  }

  async updateOperations(
    userId: string,
    campaignId: string,
    contactId: string,
    dto: UpdateContactOperationsDto,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    const existing = await this.getContactOrThrow(
      contactId,
      campaign.organizationId,
      campaignId,
    );

    if (dto.assignedToUserId) {
      await this.validateOperationalAssignee(dto.assignedToUserId, campaign.organizationId);
    }

    const nextAssignee =
      dto.assignedToUserId === undefined ? existing.assignedToUserId : dto.assignedToUserId;
    const nextOperationalStatus =
      dto.operationalStatus === undefined ? existing.operationalStatus : dto.operationalStatus;

    const contact = await this.prisma.contact.update({
      where: { id: contactId },
      data: {
        assignedToUserId:
          dto.assignedToUserId === undefined ? undefined : dto.assignedToUserId,
        operationalStatus: dto.operationalStatus,
      },
      select: contactSelect,
    });

    if (dto.assignedToUserId !== undefined && nextAssignee !== existing.assignedToUserId) {
      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'CONTACT_ASSIGNEE_UPDATED',
        entityType: 'Contact',
        entityId: contact.id,
        metadata: {
          previousAssignedToUserId: existing.assignedToUserId,
          assignedToUserId: nextAssignee,
        },
      });
    }

    if (
      dto.operationalStatus !== undefined &&
      nextOperationalStatus !== existing.operationalStatus
    ) {
      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'CONTACT_OPERATIONAL_STATUS_UPDATED',
        entityType: 'Contact',
        entityId: contact.id,
        metadata: {
          previousOperationalStatus: existing.operationalStatus,
          operationalStatus: nextOperationalStatus,
        },
      });
    }

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

  async clearOptOut(userId: string, campaignId: string, contactId: string) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    const existing = await this.getContactOrThrow(
      contactId,
      campaign.organizationId,
      campaignId,
    );

    const nextStatus = resolveStatusAfterClearOptOut(existing.status);

    await this.prisma.$transaction(async (tx) => {
      await tx.optOut.deleteMany({
        where: {
          organizationId: campaign.organizationId,
          campaignId,
          contactId,
        },
      });

      await tx.consent.updateMany({
        where: {
          organizationId: campaign.organizationId,
          campaignId,
          contactId,
          status: ConsentStatus.OPT_OUT,
        },
        data: {
          status: ConsentStatus.UNKNOWN,
          source: 'manual_clear',
          revokedAt: null,
        },
      });

      if (nextStatus) {
        await tx.contact.update({
          where: { id: contactId },
          data: { status: nextStatus },
        });
      }
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'OPT_OUT_CLEARED',
      entityType: 'Contact',
      entityId: contactId,
      metadata: {
        previousStatus: existing.status,
        status: nextStatus ?? existing.status,
        source: 'manual_clear',
      },
    });

    return this.getById(userId, campaignId, contactId);
  }

  async applyTag(
    userId: string,
    campaignId: string,
    contactId: string,
    tagId: string,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    await this.getContactOrThrow(contactId, campaign.organizationId, campaignId);

    const tag = await this.prisma.tag.findFirst({
      where: {
        id: tagId,
        organizationId: campaign.organizationId,
        campaignId,
      },
      select: { id: true, name: true },
    });

    if (!tag) {
      throw new NotFoundException('Tag nao encontrada');
    }

    const existing = await this.prisma.contactTag.findUnique({
      where: {
        contactId_tagId: { contactId, tagId },
      },
    });

    if (resolveApplyContactTag(Boolean(existing)) === 'created') {
      await this.prisma.contactTag.create({
        data: { contactId, tagId },
      });

      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'CONTACT_TAG_APPLIED',
        entityType: 'ContactTag',
        entityId: contactId,
        metadata: {
          contactId,
          tagId,
          tagName: tag.name,
        },
      });
    }

    return this.getById(userId, campaignId, contactId);
  }

  async removeTag(
    userId: string,
    campaignId: string,
    contactId: string,
    tagId: string,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    await this.getContactOrThrow(contactId, campaign.organizationId, campaignId);

    const tag = await this.prisma.tag.findFirst({
      where: {
        id: tagId,
        organizationId: campaign.organizationId,
        campaignId,
      },
      select: { id: true, name: true },
    });

    if (!tag) {
      throw new NotFoundException('Tag nao encontrada');
    }

    const existing = await this.prisma.contactTag.findUnique({
      where: {
        contactId_tagId: { contactId, tagId },
      },
    });

    if (resolveRemoveContactTag(Boolean(existing)) === 'removed') {
      await this.prisma.contactTag.delete({
        where: {
          contactId_tagId: { contactId, tagId },
        },
      });

      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'CONTACT_TAG_REMOVED',
        entityType: 'ContactTag',
        entityId: contactId,
        metadata: {
          contactId,
          tagId,
          tagName: tag.name,
        },
      });
    }

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

  private async validateOperationalAssignee(userId: string, organizationId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: { userId, organizationId },
      },
      select: { id: true },
    });

    if (!membership) {
      throw new BadRequestException('Responsavel deve ser membro da organizacao');
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
        isPrimary: true,
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
