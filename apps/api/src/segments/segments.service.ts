import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../common/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateSegmentDto,
  PreviewSegmentDto,
  UpdateSegmentDto,
} from './dto/segment.dto';
import {
  buildSegmentContactWhere,
  normalizeSegmentFilters,
  segmentRequiresOptOutWarning,
} from './segment-filters.util';

const segmentSelect = {
  id: true,
  organizationId: true,
  campaignId: true,
  name: true,
  description: true,
  filters: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SegmentSelect;

const previewContactSelect = {
  id: true,
  name: true,
  phoneNumber: true,
  email: true,
  status: true,
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
  },
} satisfies Prisma.ContactSelect;

@Injectable()
export class SegmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationAccess: OrganizationAccessService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, campaignId: string) {
    const campaign = await this.getCampaignContext(userId, campaignId);
    const segments = await this.prisma.segment.findMany({
      where: {
        organizationId: campaign.organizationId,
        campaignId,
      },
      select: segmentSelect,
      orderBy: { name: 'asc' },
    });

    const withCounts = await Promise.all(
      segments.map(async (segment) => {
        const filters = normalizeSegmentFilters(
          segment.filters as Record<string, unknown>,
        );
        const count = await this.prisma.contact.count({
          where: buildSegmentContactWhere(
            campaign.organizationId,
            campaignId,
            filters,
          ),
        });
        return {
          ...segment,
          contactCount: count,
          includeOptOutWarning: segmentRequiresOptOutWarning(filters),
        };
      }),
    );

    return withCounts;
  }

  async getById(userId: string, campaignId: string, segmentId: string) {
    const campaign = await this.getCampaignContext(userId, campaignId);
    const segment = await this.getSegmentOrThrow(
      segmentId,
      campaign.organizationId,
      campaignId,
    );
    const filters = normalizeSegmentFilters(
      segment.filters as Record<string, unknown>,
    );
    const where = buildSegmentContactWhere(
      campaign.organizationId,
      campaignId,
      filters,
    );

    const [contactCount, contacts] = await Promise.all([
      this.prisma.contact.count({ where }),
      this.prisma.contact.findMany({
        where,
        select: previewContactSelect,
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);

    return {
      ...segment,
      contactCount,
      contacts,
      includeOptOutWarning: segmentRequiresOptOutWarning(filters),
    };
  }

  async preview(userId: string, campaignId: string, dto: PreviewSegmentDto) {
    const campaign = await this.getCampaignContext(userId, campaignId);
    const filters = normalizeSegmentFilters(dto.filters);
    await this.validateTagIds(filters.tagIds, campaign.organizationId, campaignId);

    const where = buildSegmentContactWhere(
      campaign.organizationId,
      campaignId,
      filters,
    );

    const [contactCount, contacts] = await Promise.all([
      this.prisma.contact.count({ where }),
      this.prisma.contact.findMany({
        where,
        select: previewContactSelect,
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    return {
      filters,
      contactCount,
      contacts,
      includeOptOutWarning: segmentRequiresOptOutWarning(filters),
    };
  }

  async create(userId: string, campaignId: string, dto: CreateSegmentDto) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    const filters = normalizeSegmentFilters(dto.filters);
    await this.validateTagIds(filters.tagIds, campaign.organizationId, campaignId);

    try {
      const segment = await this.prisma.segment.create({
        data: {
          organizationId: campaign.organizationId,
          campaignId,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          filters: filters as unknown as Prisma.InputJsonValue,
          createdByUserId: userId,
        },
        select: segmentSelect,
      });

      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'SEGMENT_CREATED',
        entityType: 'Segment',
        entityId: segment.id,
        metadata: {
          name: segment.name,
          includeOptOut: filters.includeOptOut,
          tagCount: filters.tagIds.length,
        },
      });

      const count = await this.prisma.contact.count({
        where: buildSegmentContactWhere(
          campaign.organizationId,
          campaignId,
          filters,
        ),
      });

      return {
        ...segment,
        contactCount: count,
        includeOptOutWarning: segmentRequiresOptOutWarning(filters),
      };
    } catch (error) {
      this.handleUniqueNameError(error);
      throw error;
    }
  }

  async update(
    userId: string,
    campaignId: string,
    segmentId: string,
    dto: UpdateSegmentDto,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    const existing = await this.getSegmentOrThrow(
      segmentId,
      campaign.organizationId,
      campaignId,
    );

    const nextFilters =
      dto.filters === undefined
        ? normalizeSegmentFilters(existing.filters as Record<string, unknown>)
        : normalizeSegmentFilters(dto.filters);

    if (dto.filters !== undefined) {
      await this.validateTagIds(
        nextFilters.tagIds,
        campaign.organizationId,
        campaignId,
      );
    }

    try {
      const segment = await this.prisma.segment.update({
        where: { id: existing.id },
        data: {
          name: dto.name === undefined ? undefined : dto.name.trim(),
          description:
            dto.description === undefined
              ? undefined
              : dto.description?.trim() || null,
          filters:
            dto.filters === undefined
              ? undefined
              : (nextFilters as unknown as Prisma.InputJsonValue),
        },
        select: segmentSelect,
      });

      await this.audit.log({
        organizationId: campaign.organizationId,
        campaignId,
        actorUserId: userId,
        action: 'SEGMENT_UPDATED',
        entityType: 'Segment',
        entityId: segment.id,
        metadata: {
          name: segment.name,
          includeOptOut: nextFilters.includeOptOut,
        },
      });

      const count = await this.prisma.contact.count({
        where: buildSegmentContactWhere(
          campaign.organizationId,
          campaignId,
          nextFilters,
        ),
      });

      return {
        ...segment,
        contactCount: count,
        includeOptOutWarning: segmentRequiresOptOutWarning(nextFilters),
      };
    } catch (error) {
      this.handleUniqueNameError(error);
      throw error;
    }
  }

  async remove(userId: string, campaignId: string, segmentId: string) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    const existing = await this.getSegmentOrThrow(
      segmentId,
      campaign.organizationId,
      campaignId,
    );

    await this.prisma.segment.delete({ where: { id: existing.id } });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'SEGMENT_DELETED',
      entityType: 'Segment',
      entityId: existing.id,
      metadata: { name: existing.name },
    });

    return { success: true };
  }

  private async validateTagIds(
    tagIds: string[],
    organizationId: string,
    campaignId: string,
  ) {
    if (tagIds.length === 0) return;

    const tags = await this.prisma.tag.findMany({
      where: {
        id: { in: tagIds },
        organizationId,
        campaignId,
      },
      select: { id: true },
    });

    if (tags.length !== tagIds.length) {
      throw new BadRequestException('Uma ou mais tags sao invalidas para esta campanha');
    }
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

  private async getSegmentOrThrow(
    segmentId: string,
    organizationId: string,
    campaignId: string,
  ) {
    const segment = await this.prisma.segment.findFirst({
      where: { id: segmentId, organizationId, campaignId },
      select: segmentSelect,
    });

    if (!segment) {
      throw new NotFoundException('Segmento nao encontrado');
    }

    return segment;
  }

  private handleUniqueNameError(error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Ja existe um segmento com este nome nesta campanha');
    }
  }
}
