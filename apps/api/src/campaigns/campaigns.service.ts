import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../common/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { UpsertCandidateDto } from './dto/upsert-candidate.dto';

const campaignSelect = {
  id: true,
  organizationId: true,
  name: true,
  electionYear: true,
  office: true,
  territory: true,
  phase: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  candidate: {
    select: {
      id: true,
      name: true,
      party: true,
      office: true,
    },
  },
} as const;

const candidateSelect = {
  id: true,
  organizationId: true,
  campaignId: true,
  name: true,
  party: true,
  office: true,
  bio: true,
  toneOfVoice: true,
  mainProposals: true,
  restrictedTopics: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationAccess: OrganizationAccessService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, organizationId: string) {
    if (!organizationId) {
      throw new BadRequestException('organizationId e obrigatorio');
    }

    await this.organizationAccess.requireMembership(userId, organizationId);

    return this.prisma.campaign.findMany({
      where: { organizationId },
      select: campaignSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(userId: string, dto: CreateCampaignDto) {
    await this.organizationAccess.requireWriteAccess(userId, dto.organizationId);

    const campaign = await this.prisma.campaign.create({
      data: {
        organizationId: dto.organizationId,
        name: dto.name.trim(),
        electionYear: dto.electionYear,
        office: dto.office.trim(),
        territory: dto.territory?.trim() || null,
        phase: dto.phase,
        status: dto.status,
      },
      select: campaignSelect,
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId: campaign.id,
      actorUserId: userId,
      action: 'CAMPAIGN_CREATED',
      entityType: 'Campaign',
      entityId: campaign.id,
      metadata: {
        name: campaign.name,
        electionYear: campaign.electionYear,
        office: campaign.office,
        phase: campaign.phase,
        status: campaign.status,
      },
    });

    return campaign;
  }

  async getById(userId: string, campaignId: string) {
    const campaign = await this.getCampaignOrThrow(campaignId);
    await this.organizationAccess.requireMembership(userId, campaign.organizationId);
    return campaign;
  }

  async update(userId: string, campaignId: string, dto: UpdateCampaignDto) {
    const existing = await this.getCampaignOrThrow(campaignId);
    await this.organizationAccess.requireWriteAccess(userId, existing.organizationId);

    const campaign = await this.prisma.campaign.update({
      where: { id: campaignId },
      data: {
        name: dto.name?.trim(),
        electionYear: dto.electionYear,
        office: dto.office?.trim(),
        territory: dto.territory === undefined ? undefined : dto.territory?.trim() || null,
        phase: dto.phase,
        status: dto.status,
      },
      select: campaignSelect,
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId: campaign.id,
      actorUserId: userId,
      action: 'CAMPAIGN_UPDATED',
      entityType: 'Campaign',
      entityId: campaign.id,
      metadata: {
        changes: { ...dto },
      },
    });

    return campaign;
  }

  async getCandidate(userId: string, campaignId: string) {
    const campaign = await this.getCampaignOrThrow(campaignId);
    await this.organizationAccess.requireMembership(userId, campaign.organizationId);

    const candidate = await this.prisma.candidate.findUnique({
      where: { campaignId },
      select: candidateSelect,
    });

    return { candidate };
  }

  async upsertCandidate(userId: string, campaignId: string, dto: UpsertCandidateDto) {
    const campaign = await this.getCampaignOrThrow(campaignId);
    await this.organizationAccess.requireWriteAccess(userId, campaign.organizationId);

    const existing = await this.prisma.candidate.findUnique({
      where: { campaignId },
      select: { id: true },
    });

    const data = {
      organizationId: campaign.organizationId,
      campaignId,
      name: dto.name.trim(),
      party: dto.party?.trim() || null,
      office: dto.office?.trim() || null,
      bio: dto.bio?.trim() || null,
      toneOfVoice: dto.toneOfVoice?.trim() || null,
      mainProposals: dto.mainProposals ?? undefined,
      restrictedTopics: dto.restrictedTopics ?? undefined,
    };

    const candidate = existing
      ? await this.prisma.candidate.update({
          where: { campaignId },
          data,
          select: candidateSelect,
        })
      : await this.prisma.candidate.create({
          data,
          select: candidateSelect,
        });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId: campaign.id,
      actorUserId: userId,
      action: existing ? 'CANDIDATE_UPDATED' : 'CANDIDATE_CREATED',
      entityType: 'Candidate',
      entityId: candidate.id,
      metadata: {
        name: candidate.name,
        party: candidate.party,
        office: candidate.office,
      },
    });

    return candidate;
  }

  private async getCampaignOrThrow(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: campaignSelect,
    });

    if (!campaign) {
      throw new NotFoundException('Campanha nao encontrada');
    }

    return campaign;
  }
}
