import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OrganizationAccessService } from '../common/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';

const TIMELINE_ACTIONS = [
  'CONTACT_CREATED',
  'CONTACT_UPDATED',
  'CONSENT_CREATED',
  'CONSENT_UPDATED',
  'OPT_OUT_CREATED',
  'CONTACT_TAG_APPLIED',
  'CONTACT_TAG_REMOVED',
  'CONTACT_NOTE_CREATED',
  'CONTACT_NOTE_UPDATED',
  'CONTACT_TASK_CREATED',
  'CONTACT_TASK_UPDATED',
  'CONTACT_TASK_COMPLETED',
  'CONTACT_TASK_CANCELED',
  'CONTACT_ASSIGNEE_UPDATED',
  'CONTACT_OPERATIONAL_STATUS_UPDATED',
] as const;

const CHANNEL_LABELS: Record<string, string> = {
  WHATSAPP: 'WhatsApp',
  EMAIL: 'E-mail',
  SMS: 'SMS',
  TELEGRAM: 'Telegram',
  INSTAGRAM: 'Instagram',
};

const CONSENT_STATUS_LABELS: Record<string, string> = {
  UNKNOWN: 'Desconhecido',
  GRANTED: 'Concedido',
  REVOKED: 'Revogado',
  OPT_OUT: 'Opt-out',
};

const OPERATIONAL_STATUS_LABELS: Record<string, string> = {
  NEW: 'Novo',
  IN_PROGRESS: 'Em andamento',
  SUPPORTER: 'Apoiador',
  UNDECIDED: 'Indeciso',
  OPPOSED: 'Opositor',
  INVALID: 'Invalido',
  ARCHIVED: 'Arquivado',
};

const TASK_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Aberta',
  IN_PROGRESS: 'Em andamento',
  DONE: 'Concluida',
  CANCELED: 'Cancelada',
};

const actorSelect = {
  id: true,
  name: true,
  email: true,
} satisfies Prisma.UserSelect;

type TimelineActor = {
  id: string;
  name: string;
  email: string;
};

export type ContactTimelineItem = {
  id: string;
  type: string;
  title: string;
  description?: string;
  actor?: TimelineActor;
  occurredAt: string;
  metadata?: Record<string, unknown>;
};

type TimelineEventDraft = {
  id: string;
  type: string;
  title: string;
  description?: string;
  actor?: TimelineActor;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
  coverageKey: string;
};

type AuditLogRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Prisma.JsonValue;
  createdAt: Date;
  actor: TimelineActor | null;
};

function asMetadata(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function truncateText(value: string, max = 120) {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}...`;
}

function channelLabel(channel: unknown) {
  if (typeof channel !== 'string') return 'Canal';
  return CHANNEL_LABELS[channel] ?? channel;
}

function consentStatusLabel(status: unknown) {
  if (typeof status !== 'string') return 'Status';
  return CONSENT_STATUS_LABELS[status] ?? status;
}

function operationalStatusLabel(status: unknown) {
  if (typeof status !== 'string') return 'Status';
  return OPERATIONAL_STATUS_LABELS[status] ?? status;
}

function taskStatusLabel(status: unknown) {
  if (typeof status !== 'string') return 'Status';
  return TASK_STATUS_LABELS[status] ?? status;
}

function actionToType(action: string) {
  switch (action) {
    case 'CONTACT_CREATED':
      return 'contact.created';
    case 'CONTACT_UPDATED':
      return 'contact.updated';
    case 'CONSENT_CREATED':
      return 'consent.created';
    case 'CONSENT_UPDATED':
      return 'consent.updated';
    case 'OPT_OUT_CREATED':
      return 'opt_out.created';
    case 'CONTACT_TAG_APPLIED':
      return 'tag.applied';
    case 'CONTACT_TAG_REMOVED':
      return 'tag.removed';
    case 'CONTACT_NOTE_CREATED':
      return 'note.created';
    case 'CONTACT_NOTE_UPDATED':
      return 'note.updated';
    case 'CONTACT_TASK_CREATED':
      return 'task.created';
    case 'CONTACT_TASK_UPDATED':
      return 'task.updated';
    case 'CONTACT_TASK_COMPLETED':
      return 'task.completed';
    case 'CONTACT_TASK_CANCELED':
      return 'task.canceled';
    case 'CONTACT_ASSIGNEE_UPDATED':
      return 'operations.assignee_updated';
    case 'CONTACT_OPERATIONAL_STATUS_UPDATED':
      return 'operations.status_updated';
    default:
      return action.toLowerCase();
  }
}

function auditCoverageKey(action: string, entityId: string | null, metadata: Record<string, unknown>) {
  if (action === 'OPT_OUT_CREATED') {
    const channel = metadata.channel ?? 'ALL';
    return `${action}:${String(channel)}`;
  }

  if (action === 'CONTACT_TAG_APPLIED' || action === 'CONTACT_TAG_REMOVED') {
    return `${action}:${entityId ?? 'contact'}:${String(metadata.tagId ?? '')}`;
  }

  return `${action}:${entityId ?? ''}`;
}

@Injectable()
export class ContactTimelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationAccess: OrganizationAccessService,
  ) {}

  async getTimeline(
    userId: string,
    campaignId: string,
    contactId: string,
  ): Promise<ContactTimelineItem[]> {
    const campaign = await this.getCampaignContext(userId, campaignId);
    const contact = await this.getContactOrThrow(
      contactId,
      campaign.organizationId,
      campaignId,
    );

    const [
      auditLogs,
      consents,
      optOuts,
      contactTags,
      notes,
      tasks,
    ] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: {
          organizationId: campaign.organizationId,
          campaignId,
          action: { in: [...TIMELINE_ACTIONS] },
          OR: [
            { entityId: contactId },
            { metadata: { path: ['contactId'], equals: contactId } },
          ],
        },
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          metadata: true,
          createdAt: true,
          actor: { select: actorSelect },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.consent.findMany({
        where: {
          organizationId: campaign.organizationId,
          campaignId,
          contactId,
        },
        select: {
          id: true,
          channel: true,
          status: true,
          source: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.optOut.findMany({
        where: {
          organizationId: campaign.organizationId,
          campaignId,
          contactId,
        },
        select: {
          id: true,
          channel: true,
          reason: true,
          source: true,
          createdAt: true,
        },
      }),
      this.prisma.contactTag.findMany({
        where: { contactId },
        select: {
          createdAt: true,
          tag: { select: { id: true, name: true } },
        },
      }),
      this.prisma.contactNote.findMany({
        where: {
          organizationId: campaign.organizationId,
          campaignId,
          contactId,
        },
        select: {
          id: true,
          body: true,
          createdAt: true,
          updatedAt: true,
          author: { select: actorSelect },
        },
      }),
      this.prisma.contactTask.findMany({
        where: {
          organizationId: campaign.organizationId,
          campaignId,
          contactId,
        },
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          completedAt: true,
          createdBy: { select: actorSelect },
        },
      }),
    ]);

    const noteById = new Map(notes.map((note) => [note.id, note]));
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const userIds = this.collectUserIds(auditLogs);
    const usersById = await this.loadUsersById(userIds);

    const covered = new Set<string>();
    const events: TimelineEventDraft[] = [];

    for (const log of auditLogs) {
      const metadata = asMetadata(log.metadata);
      covered.add(auditCoverageKey(log.action, log.entityId, metadata));
      events.push(
        this.mapAuditLog(log, {
          noteById,
          taskById,
          usersById,
          contactName: contact.name,
        }),
      );
    }

    this.addEntityFallbacks(events, covered, {
      contact,
      consents,
      optOuts,
      contactTags,
      notes,
      tasks,
    });

    events.sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime());

    return events.map((event) => ({
      id: event.id,
      type: event.type,
      title: event.title,
      description: event.description,
      actor: event.actor,
      occurredAt: event.occurredAt.toISOString(),
      metadata: event.metadata,
    }));
  }

  private mapAuditLog(
    log: AuditLogRow,
    context: {
      noteById: Map<string, { body: string }>;
      taskById: Map<string, { title: string }>;
      usersById: Map<string, TimelineActor>;
      contactName: string | null;
    },
  ): TimelineEventDraft {
    const metadata = asMetadata(log.metadata);
    const type = actionToType(log.action);
    const actor = log.actor ?? undefined;
    let title = 'Evento do contato';
    let description: string | undefined;

    switch (log.action) {
      case 'CONTACT_CREATED':
        title = 'Contato criado';
        description = context.contactName
          ? `Cadastro de ${context.contactName}`
          : 'Cadastro inicial do contato';
        break;
      case 'CONTACT_UPDATED':
        title = 'Dados do contato atualizados';
        description = this.describeContactChanges(metadata);
        break;
      case 'CONSENT_CREATED':
        title = 'Consentimento registrado';
        description = `${channelLabel(metadata.channel)} · ${consentStatusLabel(metadata.status)}`;
        break;
      case 'CONSENT_UPDATED':
        title = 'Consentimento atualizado';
        description = `${channelLabel(metadata.channel)} · ${consentStatusLabel(metadata.status)}`;
        break;
      case 'OPT_OUT_CREATED':
        title = 'Opt-out registrado';
        description = this.describeOptOut(metadata);
        break;
      case 'CONTACT_TAG_APPLIED':
        title = 'Tag aplicada';
        description =
          typeof metadata.tagName === 'string'
            ? metadata.tagName
            : 'Tag vinculada ao contato';
        break;
      case 'CONTACT_TAG_REMOVED':
        title = 'Tag removida';
        description =
          typeof metadata.tagName === 'string'
            ? metadata.tagName
            : 'Tag desvinculada do contato';
        break;
      case 'CONTACT_NOTE_CREATED':
        title = 'Nota interna criada';
        description = this.describeNote(log.entityId, context.noteById);
        break;
      case 'CONTACT_NOTE_UPDATED':
        title = 'Nota interna editada';
        description = this.describeNote(log.entityId, context.noteById);
        break;
      case 'CONTACT_TASK_CREATED':
        title = 'Tarefa criada';
        description = this.describeTask(log.entityId, metadata, context.taskById);
        break;
      case 'CONTACT_TASK_UPDATED':
        title = 'Tarefa atualizada';
        description = this.describeTask(log.entityId, metadata, context.taskById);
        break;
      case 'CONTACT_TASK_COMPLETED':
        title = 'Tarefa concluida';
        description = this.describeTask(log.entityId, metadata, context.taskById);
        break;
      case 'CONTACT_TASK_CANCELED':
        title = 'Tarefa cancelada';
        description = this.describeTask(log.entityId, metadata, context.taskById);
        break;
      case 'CONTACT_ASSIGNEE_UPDATED':
        title = 'Responsavel alterado';
        description = this.describeAssigneeChange(metadata, context.usersById);
        break;
      case 'CONTACT_OPERATIONAL_STATUS_UPDATED':
        title = 'Status operacional alterado';
        description = `${operationalStatusLabel(metadata.previousOperationalStatus)} → ${operationalStatusLabel(metadata.operationalStatus)}`;
        break;
      default:
        break;
    }

    return {
      id: `audit-${log.id}`,
      type,
      title,
      description,
      actor,
      occurredAt: log.createdAt,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      coverageKey: auditCoverageKey(log.action, log.entityId, metadata),
    };
  }

  private addEntityFallbacks(
    events: TimelineEventDraft[],
    covered: Set<string>,
    data: {
      contact: { id: string; name: string | null; createdAt: Date };
      consents: Array<{
        id: string;
        channel: string;
        status: string;
        source: string | null;
        createdAt: Date;
        updatedAt: Date;
      }>;
      optOuts: Array<{
        id: string;
        channel: string | null;
        reason: string | null;
        source: string | null;
        createdAt: Date;
      }>;
      contactTags: Array<{
        createdAt: Date;
        tag: { id: string; name: string };
      }>;
      notes: Array<{
        id: string;
        body: string;
        createdAt: Date;
        updatedAt: Date;
        author: TimelineActor;
      }>;
      tasks: Array<{
        id: string;
        title: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        completedAt: Date | null;
        createdBy: TimelineActor;
      }>;
    },
  ) {
    const creationKey = `CONTACT_CREATED:${data.contact.id}`;
    if (!covered.has(creationKey)) {
      events.push({
        id: `contact-created-${data.contact.id}`,
        type: 'contact.created',
        title: 'Contato criado',
        description: data.contact.name
          ? `Cadastro de ${data.contact.name}`
          : 'Cadastro inicial do contato',
        occurredAt: data.contact.createdAt,
        coverageKey: creationKey,
      });
      covered.add(creationKey);
    }

    for (const consent of data.consents) {
      const createdKey = `CONSENT_CREATED:${consent.id}`;
      if (!covered.has(createdKey)) {
        events.push({
          id: `consent-created-${consent.id}`,
          type: 'consent.created',
          title: 'Consentimento registrado',
          description: `${channelLabel(consent.channel)} · ${consentStatusLabel(consent.status)}`,
          occurredAt: consent.createdAt,
          metadata: {
            channel: consent.channel,
            status: consent.status,
            source: consent.source,
          },
          coverageKey: createdKey,
        });
        covered.add(createdKey);
      }

      const updatedKey = `CONSENT_UPDATED:${consent.id}`;
      if (
        consent.updatedAt.getTime() - consent.createdAt.getTime() > 1000 &&
        !covered.has(updatedKey)
      ) {
        events.push({
          id: `consent-updated-${consent.id}`,
          type: 'consent.updated',
          title: 'Consentimento atualizado',
          description: `${channelLabel(consent.channel)} · ${consentStatusLabel(consent.status)}`,
          occurredAt: consent.updatedAt,
          metadata: {
            channel: consent.channel,
            status: consent.status,
            source: consent.source,
          },
          coverageKey: updatedKey,
        });
        covered.add(updatedKey);
      }
    }

    for (const optOut of data.optOuts) {
      const channel = optOut.channel ?? 'ALL';
      const key = `OPT_OUT_CREATED:${channel}`;
      if (covered.has(key)) continue;

      events.push({
        id: `opt-out-${optOut.id}`,
        type: 'opt_out.created',
        title: 'Opt-out registrado',
        description: this.describeOptOut({
          channel,
          reason: optOut.reason,
          source: optOut.source,
        }),
        occurredAt: optOut.createdAt,
        metadata: {
          channel,
          reason: optOut.reason,
          source: optOut.source,
        },
        coverageKey: key,
      });
      covered.add(key);
    }

    for (const contactTag of data.contactTags) {
      const key = `CONTACT_TAG_APPLIED:${data.contact.id}:${contactTag.tag.id}`;
      if (covered.has(key)) continue;

      events.push({
        id: `tag-applied-${contactTag.tag.id}`,
        type: 'tag.applied',
        title: 'Tag aplicada',
        description: contactTag.tag.name,
        occurredAt: contactTag.createdAt,
        metadata: {
          tagId: contactTag.tag.id,
          tagName: contactTag.tag.name,
        },
        coverageKey: key,
      });
      covered.add(key);
    }

    for (const note of data.notes) {
      const createdKey = `CONTACT_NOTE_CREATED:${note.id}`;
      if (!covered.has(createdKey)) {
        events.push({
          id: `note-created-${note.id}`,
          type: 'note.created',
          title: 'Nota interna criada',
          description: truncateText(note.body),
          actor: note.author,
          occurredAt: note.createdAt,
          coverageKey: createdKey,
        });
        covered.add(createdKey);
      }

      const updatedKey = `CONTACT_NOTE_UPDATED:${note.id}`;
      if (
        note.updatedAt.getTime() - note.createdAt.getTime() > 1000 &&
        !covered.has(updatedKey)
      ) {
        events.push({
          id: `note-updated-${note.id}`,
          type: 'note.updated',
          title: 'Nota interna editada',
          description: truncateText(note.body),
          actor: note.author,
          occurredAt: note.updatedAt,
          coverageKey: updatedKey,
        });
        covered.add(updatedKey);
      }
    }

    for (const task of data.tasks) {
      const createdKey = `CONTACT_TASK_CREATED:${task.id}`;
      if (!covered.has(createdKey)) {
        events.push({
          id: `task-created-${task.id}`,
          type: 'task.created',
          title: 'Tarefa criada',
          description: `${task.title} · ${taskStatusLabel(task.status)}`,
          actor: task.createdBy,
          occurredAt: task.createdAt,
          coverageKey: createdKey,
        });
        covered.add(createdKey);
      }

      const completedKey = `CONTACT_TASK_COMPLETED:${task.id}`;
      if (task.completedAt && !covered.has(completedKey)) {
        events.push({
          id: `task-completed-${task.id}`,
          type: 'task.completed',
          title: 'Tarefa concluida',
          description: task.title,
          actor: task.createdBy,
          occurredAt: task.completedAt,
          coverageKey: completedKey,
        });
        covered.add(completedKey);
      }

      const canceledKey = `CONTACT_TASK_CANCELED:${task.id}`;
      if (task.status === 'CANCELED' && !covered.has(canceledKey)) {
        events.push({
          id: `task-canceled-${task.id}`,
          type: 'task.canceled',
          title: 'Tarefa cancelada',
          description: task.title,
          actor: task.createdBy,
          occurredAt: task.updatedAt,
          coverageKey: canceledKey,
        });
        covered.add(canceledKey);
      }

      const updatedKey = `CONTACT_TASK_UPDATED:${task.id}`;
      if (
        task.updatedAt.getTime() - task.createdAt.getTime() > 1000 &&
        !covered.has(updatedKey) &&
        !covered.has(completedKey) &&
        !covered.has(canceledKey)
      ) {
        events.push({
          id: `task-updated-${task.id}`,
          type: 'task.updated',
          title: 'Tarefa atualizada',
          description: `${task.title} · ${taskStatusLabel(task.status)}`,
          actor: task.createdBy,
          occurredAt: task.updatedAt,
          coverageKey: updatedKey,
        });
        covered.add(updatedKey);
      }
    }
  }

  private describeContactChanges(metadata: Record<string, unknown>) {
    const changes = metadata.changes;
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      return 'Campos do cadastro foram atualizados';
    }

    const fields = Object.keys(changes as Record<string, unknown>);
    if (fields.length === 0) return 'Campos do cadastro foram atualizados';
    return `Campos alterados: ${fields.join(', ')}`;
  }

  private describeOptOut(metadata: Record<string, unknown>) {
    const parts = [channelLabel(metadata.channel)];
    if (typeof metadata.reason === 'string' && metadata.reason.trim()) {
      parts.push(metadata.reason.trim());
    }
    if (typeof metadata.source === 'string' && metadata.source.trim()) {
      parts.push(`fonte ${metadata.source.trim()}`);
    }
    return parts.join(' · ');
  }

  private describeNote(
    noteId: string | null,
    noteById: Map<string, { body: string }>,
  ) {
    if (!noteId) return undefined;
    const note = noteById.get(noteId);
    return note ? truncateText(note.body) : undefined;
  }

  private describeTask(
    taskId: string | null,
    metadata: Record<string, unknown>,
    taskById: Map<string, { title: string }>,
  ) {
    const titleFromEntity = taskId ? taskById.get(taskId)?.title : undefined;
    const title =
      titleFromEntity ??
      (typeof metadata.title === 'string' ? metadata.title : undefined);
    const status =
      typeof metadata.status === 'string' ? taskStatusLabel(metadata.status) : undefined;

    if (title && status) return `${title} · ${status}`;
    return title ?? status;
  }

  private describeAssigneeChange(
    metadata: Record<string, unknown>,
    usersById: Map<string, TimelineActor>,
  ) {
    const previousId =
      typeof metadata.previousAssignedToUserId === 'string'
        ? metadata.previousAssignedToUserId
        : null;
    const nextId =
      typeof metadata.assignedToUserId === 'string' ? metadata.assignedToUserId : null;
    const previousName = previousId ? usersById.get(previousId)?.name ?? 'Sem responsavel' : 'Sem responsavel';
    const nextName = nextId ? usersById.get(nextId)?.name ?? 'Sem responsavel' : 'Sem responsavel';
    return `${previousName} → ${nextName}`;
  }

  private collectUserIds(logs: AuditLogRow[]) {
    const ids = new Set<string>();

    for (const log of logs) {
      const metadata = asMetadata(log.metadata);
      if (typeof metadata.previousAssignedToUserId === 'string') {
        ids.add(metadata.previousAssignedToUserId);
      }
      if (typeof metadata.assignedToUserId === 'string') {
        ids.add(metadata.assignedToUserId);
      }
    }

    return [...ids];
  }

  private async loadUsersById(userIds: string[]) {
    const usersById = new Map<string, TimelineActor>();
    if (userIds.length === 0) return usersById;

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: actorSelect,
    });

    for (const user of users) {
      usersById.set(user.id, user);
    }

    return usersById;
  }

  private async getCampaignContext(userId: string, campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, organizationId: true },
    });

    if (!campaign) {
      throw new NotFoundException('Campanha nao encontrada');
    }

    await this.organizationAccess.requireMembership(userId, campaign.organizationId);
    return campaign;
  }

  private async getContactOrThrow(
    contactId: string,
    organizationId: string,
    campaignId: string,
  ) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, organizationId, campaignId },
      select: { id: true, name: true, createdAt: true },
    });

    if (!contact) {
      throw new NotFoundException('Contato nao encontrado');
    }

    return contact;
  }
}
