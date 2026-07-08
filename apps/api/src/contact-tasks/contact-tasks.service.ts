import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContactTaskStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../common/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContactTaskDto } from './dto/create-contact-task.dto';
import { UpdateContactTaskDto } from './dto/update-contact-task.dto';

const userSummarySelect = {
  id: true,
  name: true,
  email: true,
} satisfies Prisma.UserSelect;

const taskSelect = {
  id: true,
  organizationId: true,
  campaignId: true,
  contactId: true,
  title: true,
  description: true,
  status: true,
  dueAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: userSummarySelect },
  assignedTo: { select: userSummarySelect },
} satisfies Prisma.ContactTaskSelect;

@Injectable()
export class ContactTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationAccess: OrganizationAccessService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, campaignId: string, contactId: string) {
    const campaign = await this.getCampaignContext(userId, campaignId);
    await this.getContactOrThrow(contactId, campaign.organizationId, campaignId);

    return this.prisma.contactTask.findMany({
      where: {
        organizationId: campaign.organizationId,
        campaignId,
        contactId,
      },
      select: taskSelect,
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async create(
    userId: string,
    campaignId: string,
    contactId: string,
    dto: CreateContactTaskDto,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    await this.getContactOrThrow(contactId, campaign.organizationId, campaignId);
    await this.validateAssignee(dto.assignedToUserId, campaign.organizationId);

    const status = dto.status ?? ContactTaskStatus.OPEN;
    const task = await this.prisma.contactTask.create({
      data: {
        organizationId: campaign.organizationId,
        campaignId,
        contactId,
        createdByUserId: userId,
        assignedToUserId: dto.assignedToUserId ?? null,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        status,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        completedAt: status === ContactTaskStatus.DONE ? new Date() : null,
      },
      select: taskSelect,
    });

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action: 'CONTACT_TASK_CREATED',
      entityType: 'ContactTask',
      entityId: task.id,
      metadata: {
        contactId,
        title: task.title,
        status: task.status,
        assignedToUserId: task.assignedTo?.id ?? null,
      },
    });

    return task;
  }

  async update(
    userId: string,
    campaignId: string,
    contactId: string,
    taskId: string,
    dto: UpdateContactTaskDto,
  ) {
    const campaign = await this.getCampaignContext(userId, campaignId, true);
    await this.getContactOrThrow(contactId, campaign.organizationId, campaignId);
    const existing = await this.getTaskOrThrow(
      taskId,
      campaign.organizationId,
      campaignId,
      contactId,
    );

    if (dto.assignedToUserId) {
      await this.validateAssignee(dto.assignedToUserId, campaign.organizationId);
    }

    const nextStatus = dto.status ?? existing.status;
    const completedAt = this.resolveCompletedAt(existing.status, nextStatus, existing.completedAt);

    const task = await this.prisma.contactTask.update({
      where: { id: existing.id },
      data: {
        title: dto.title === undefined ? undefined : dto.title.trim(),
        description:
          dto.description === undefined ? undefined : dto.description?.trim() || null,
        assignedToUserId:
          dto.assignedToUserId === undefined ? undefined : dto.assignedToUserId || null,
        dueAt:
          dto.dueAt === undefined ? undefined : dto.dueAt ? new Date(dto.dueAt) : null,
        status: dto.status,
        completedAt,
      },
      select: taskSelect,
    });

    const action = this.resolveAuditAction(existing.status, task.status);

    await this.audit.log({
      organizationId: campaign.organizationId,
      campaignId,
      actorUserId: userId,
      action,
      entityType: 'ContactTask',
      entityId: task.id,
      metadata: {
        contactId,
        previousStatus: existing.status,
        status: task.status,
        changes: JSON.parse(JSON.stringify(dto)),
      },
    });

    return task;
  }

  private resolveCompletedAt(
    previousStatus: ContactTaskStatus,
    nextStatus: ContactTaskStatus,
    currentCompletedAt: Date | null,
  ) {
    if (nextStatus === ContactTaskStatus.DONE) {
      return currentCompletedAt ?? new Date();
    }

    if (previousStatus === ContactTaskStatus.DONE) {
      return null;
    }

    return currentCompletedAt;
  }

  private resolveAuditAction(
    previousStatus: ContactTaskStatus,
    nextStatus: ContactTaskStatus,
  ) {
    if (nextStatus === ContactTaskStatus.DONE && previousStatus !== ContactTaskStatus.DONE) {
      return 'CONTACT_TASK_COMPLETED';
    }

    if (
      nextStatus === ContactTaskStatus.CANCELED &&
      previousStatus !== ContactTaskStatus.CANCELED
    ) {
      return 'CONTACT_TASK_CANCELED';
    }

    return 'CONTACT_TASK_UPDATED';
  }

  private async validateAssignee(userId: string | undefined, organizationId: string) {
    if (!userId) return;

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

  private async getTaskOrThrow(
    taskId: string,
    organizationId: string,
    campaignId: string,
    contactId: string,
  ) {
    const task = await this.prisma.contactTask.findFirst({
      where: { id: taskId, organizationId, campaignId, contactId },
      select: { id: true, status: true, completedAt: true },
    });

    if (!task) {
      throw new NotFoundException('Tarefa nao encontrada');
    }

    return task;
  }
}
