import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../common/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { normalizeTagName } from '../contacts/contact-tag.util';

const tagSelect = {
  id: true,
  organizationId: true,
  campaignId: true,
  name: true,
  color: true,
  description: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TagSelect;

@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationAccess: OrganizationAccessService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, campaignId: string) {
    const campaign = await this.getCampaignContext(userId, campaignId);

    return this.prisma.tag.findMany({
      where: {
        organizationId: campaign.organizationId,
        campaignId,
      },
      select: tagSelect,
      orderBy: { name: 'asc' },
    });
  }

  async create(userId: string, campaignId: string, dto: CreateTagDto) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    const name = normalizeTagName(dto.name);

    try {
      const tag = await this.prisma.tag.create({
        data: {
          organizationId: campaign.organizationId,
          campaignId,
          name,
          color: dto.color?.trim() || null,
          description: dto.description?.trim() || null,
        },
        select: tagSelect,
      });

      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'TAG_CREATED',
        entityType: 'Tag',
        entityId: tag.id,
        metadata: {
          name: tag.name,
          color: tag.color,
        },
      });

      return tag;
    } catch (error) {
      this.handleUniqueNameError(error);
      throw error;
    }
  }

  async update(
    userId: string,
    campaignId: string,
    tagId: string,
    dto: UpdateTagDto,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    const existing = await this.getTagOrThrow(tagId, campaign.organizationId, campaignId);

    try {
      const tag = await this.prisma.tag.update({
        where: { id: existing.id },
        data: {
          name: dto.name === undefined ? undefined : normalizeTagName(dto.name),
          color: dto.color === undefined ? undefined : dto.color?.trim() || null,
          description:
            dto.description === undefined ? undefined : dto.description?.trim() || null,
        },
        select: tagSelect,
      });

      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'TAG_UPDATED',
        entityType: 'Tag',
        entityId: tag.id,
        metadata: { changes: JSON.parse(JSON.stringify(dto)) },
      });

      return tag;
    } catch (error) {
      this.handleUniqueNameError(error);
      throw error;
    }
  }

  async remove(userId: string, campaignId: string, tagId: string) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    const existing = await this.getTagOrThrow(tagId, campaign.organizationId, campaignId);

    await this.prisma.$transaction([
      this.prisma.contactTag.deleteMany({ where: { tagId: existing.id } }),
      this.prisma.tag.delete({ where: { id: existing.id } }),
    ]);

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'TAG_DELETED',
      entityType: 'Tag',
      entityId: existing.id,
      metadata: { name: existing.name },
    });

    return { success: true };
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

  private async getTagOrThrow(
    tagId: string,
    organizationId: string,
    campaignId: string,
  ) {
    const tag = await this.prisma.tag.findFirst({
      where: { id: tagId, organizationId, campaignId },
      select: tagSelect,
    });

    if (!tag) {
      throw new NotFoundException('Tag nao encontrada');
    }

    return tag;
  }

  private handleUniqueNameError(error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Ja existe uma tag com este nome nesta campanha');
    }
  }
}
