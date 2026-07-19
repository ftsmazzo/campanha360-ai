'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ContactSection } from '../../../../../../components/contact-section';
import { TagBadge } from '../../../../../../components/tag-badge';
import { DashboardShell } from '../../../../../../components/dashboard-shell';
import {
  ApiError,
  AuthUser,
  CampaignItem,
  CampaignMemberItem,
  ContactItem,
  ContactNoteItem,
  ContactTaskItem,
  ContactTimelineItem,
  TagItem,
  applyContactTag,
  clearStoredToken,
  createContactNote,
  createContactOptOut,
  createContactTask,
  fetchCampaign,
  fetchCampaignMembers,
  fetchContact,
  fetchContactNotes,
  fetchContactTasks,
  fetchContactTimeline,
  fetchMe,
  fetchTags,
  getStoredToken,
  removeContactTag,
  updateContact,
  updateContactNote,
  updateContactOperations,
  updateContactTask,
  upsertContactConsent,
} from '../../../../../../lib/api';
import { getPhaseLabel, getStatusLabel } from '../../../../../../lib/campaigns';
import {
  CONSENT_STATUSES,
  CONTACT_CHANNELS,
  CONTACT_STATUSES,
  getChannelLabel,
  getConsentStatusLabel,
  getContactStatusLabel,
  hasOptOut,
} from '../../../../../../lib/contacts';
import { canWriteRole, getOrganizationRole } from '../../../../../../lib/roles';
import {
  CONTACT_OPERATIONAL_STATUSES,
  getOperationalStatusLabel,
} from '../../../../../../lib/operational';
import { CONTACT_TASK_STATUSES, getTaskStatusLabel, isTaskOpen } from '../../../../../../lib/tasks';
import { getContactTags } from '../../../../../../lib/tags';
import { getTimelineTypeLabel, hasMeaningfulTimelineEvents } from '../../../../../../lib/timeline';

function metadataToText(value: Record<string, unknown> | null) {
  if (!value) return '';
  return JSON.stringify(value, null, 2);
}

function parseMetadata(value: string) {
  if (!value.trim()) return undefined;
  return JSON.parse(value) as Record<string, unknown>;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('pt-BR');
}

function toDateInputValue(value: string | null) {
  if (!value) return '';
  return value.slice(0, 10);
}

function ContactBreadcrumb({
  campaignId,
  campaignName,
  contactName,
}: {
  campaignId: string;
  campaignName?: string;
  contactName: string;
}) {
  return (
    <nav aria-label="Navegacao" className="flex flex-wrap items-center gap-2 text-sm text-[#65655f]">
      <Link className="underline hover:text-[#24382b]" href="/dashboard/campaigns">
        Campanhas
      </Link>
      <span aria-hidden="true">/</span>
      <Link className="underline hover:text-[#24382b]" href={`/dashboard/campaigns/${campaignId}`}>
        {campaignName ?? 'Campanha'}
      </Link>
      <span aria-hidden="true">/</span>
      <Link className="underline hover:text-[#24382b]" href={`/dashboard/campaigns/${campaignId}/contacts`}>
        Contatos
      </Link>
      <span aria-hidden="true">/</span>
      <span className="font-medium text-[#151515]">{contactName}</span>
    </nav>
  );
}

export default function ContactDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string; contactId: string }>();
  const campaignId = params.id;
  const contactId = params.contactId;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [campaign, setCampaign] = useState<CampaignItem | null>(null);
  const [contact, setContact] = useState<ContactItem | null>(null);
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [metadata, setMetadata] = useState('');
  const [consentChannel, setConsentChannel] = useState('WHATSAPP');
  const [consentStatus, setConsentStatus] = useState('UNKNOWN');
  const [consentSource, setConsentSource] = useState('manual');
  const [consentText, setConsentText] = useState('');
  const [optOutReason, setOptOutReason] = useState('');
  const [campaignTags, setCampaignTags] = useState<TagItem[]>([]);
  const [selectedTagId, setSelectedTagId] = useState('');
  const [notes, setNotes] = useState<ContactNoteItem[]>([]);
  const [noteBody, setNoteBody] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<ContactTaskItem[]>([]);
  const [timeline, setTimeline] = useState<ContactTimelineItem[]>([]);
  const [members, setMembers] = useState<CampaignMemberItem[]>([]);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskAssigneeId, setTaskAssigneeId] = useState('');
  const [taskDueAt, setTaskDueAt] = useState('');
  const [taskStatus, setTaskStatus] = useState('OPEN');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [operationalAssigneeId, setOperationalAssigneeId] = useState('');
  const [operationalStatus, setOperationalStatus] = useState('NEW');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingConsent, setSavingConsent] = useState(false);
  const [savingOptOut, setSavingOptOut] = useState(false);
  const [savingTag, setSavingTag] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  const [savingOperations, setSavingOperations] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function fillContact(item: ContactItem) {
    setContact(item);
    setName(item.name ?? '');
    setPhoneNumber(item.phoneNumber ?? '');
    setEmail(item.email ?? '');
    setCity(item.city ?? '');
    setNeighborhood(item.neighborhood ?? '');
    setStatus(item.status);
    setOperationalAssigneeId(item.assignedTo?.id ?? '');
    setOperationalStatus(item.operationalStatus ?? 'NEW');
    setMetadata(metadataToText(item.metadata));
    const latestConsent = item.consents[0];
    if (latestConsent) {
      setConsentChannel(latestConsent.channel);
      setConsentStatus(latestConsent.status);
      setConsentSource(latestConsent.source ?? 'manual');
      setConsentText(latestConsent.consentText ?? '');
    }
  }

  async function refreshTimeline(token: string) {
    const timelineItems = await fetchContactTimeline(token, campaignId, contactId);
    setTimeline(timelineItems);
  }

  useEffect(() => {
    async function load() {
      const token = getStoredToken();
      if (!token) {
        router.replace('/login');
        return;
      }

      try {
        const [me, campaignItem, contactItem, tagItems, noteItems, taskItems, memberItems, timelineItems] =
          await Promise.all([
          fetchMe(token),
          fetchCampaign(token, campaignId),
          fetchContact(token, campaignId, contactId),
          fetchTags(token, campaignId),
          fetchContactNotes(token, campaignId, contactId),
          fetchContactTasks(token, campaignId, contactId),
          fetchCampaignMembers(token, campaignId),
          fetchContactTimeline(token, campaignId, contactId),
        ]);
        setUser(me);
        setCampaign(campaignItem);
        setCampaignTags(tagItems);
        setNotes(noteItems);
        setTasks(taskItems);
        setTimeline(timelineItems);
        setMembers(memberItems);
        fillContact(contactItem);
      } catch {
        clearStoredToken();
        router.replace('/login');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [campaignId, contactId, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getStoredToken();
    if (!token) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      let metadataValue: Record<string, unknown> | undefined;
      try {
        metadataValue = parseMetadata(metadata);
      } catch {
        throw new ApiError('Metadata deve ser um JSON valido', 400);
      }

      const updated = await updateContact(token, campaignId, contactId, {
        name,
        phoneNumber,
        email,
        city,
        neighborhood,
        status,
        metadata: metadataValue,
      });
      fillContact(updated);
      await refreshTimeline(token);
      setSuccess('Contato atualizado com sucesso.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel atualizar o contato');
    } finally {
      setSaving(false);
    }
  }

  async function handleConsentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getStoredToken();
    if (!token) return;

    setSavingConsent(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await upsertContactConsent(token, campaignId, contactId, {
        channel: consentChannel,
        status: consentStatus,
        source: consentSource,
        consentText: consentText || undefined,
      });
      fillContact(updated);
      await refreshTimeline(token);
      setSuccess('Consentimento salvo com sucesso.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel salvar o consentimento');
    } finally {
      setSavingConsent(false);
    }
  }

  async function handleOptOut() {
    const token = getStoredToken();
    if (!token) return;

    setSavingOptOut(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await createContactOptOut(token, campaignId, contactId, {
        channel: consentChannel,
        reason: optOutReason || undefined,
        source: 'manual',
      });
      fillContact(updated);
      await refreshTimeline(token);
      setSuccess('Opt-out registrado com sucesso.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel registrar opt-out');
    } finally {
      setSavingOptOut(false);
    }
  }

  async function handleApplyTag() {
    const token = getStoredToken();
    if (!token || !selectedTagId) return;

    setSavingTag(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await applyContactTag(token, campaignId, contactId, selectedTagId);
      fillContact(updated);
      await refreshTimeline(token);
      setSelectedTagId('');
      setSuccess('Tag aplicada com sucesso.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel aplicar a tag');
    } finally {
      setSavingTag(false);
    }
  }

  async function handleRemoveTag(tagId: string) {
    const token = getStoredToken();
    if (!token) return;

    setSavingTag(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await removeContactTag(token, campaignId, contactId, tagId);
      fillContact(updated);
      await refreshTimeline(token);
      setSuccess('Tag removida com sucesso.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel remover a tag');
    } finally {
      setSavingTag(false);
    }
  }

  function resetNoteForm() {
    setNoteBody('');
    setEditingNoteId(null);
  }

  function startEditNote(note: ContactNoteItem) {
    setEditingNoteId(note.id);
    setNoteBody(note.body);
    setError(null);
    setSuccess(null);
  }

  async function handleNoteSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getStoredToken();
    if (!token || !noteBody.trim()) return;

    setSavingNote(true);
    setError(null);
    setSuccess(null);

    try {
      if (editingNoteId) {
        const updated = await updateContactNote(token, campaignId, contactId, editingNoteId, {
          body: noteBody,
        });
        setNotes((current) =>
          current
            .map((item) => (item.id === updated.id ? updated : item))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
        );
        setSuccess('Nota atualizada com sucesso.');
      } else {
        const created = await createContactNote(token, campaignId, contactId, {
          body: noteBody,
        });
        setNotes((current) => [created, ...current]);
        setSuccess('Nota registrada com sucesso.');
      }
      resetNoteForm();
      await refreshTimeline(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel salvar a nota');
    } finally {
      setSavingNote(false);
    }
  }

  function resetTaskForm() {
    setTaskTitle('');
    setTaskDescription('');
    setTaskAssigneeId('');
    setTaskDueAt('');
    setTaskStatus('OPEN');
    setEditingTaskId(null);
  }

  function startEditTask(task: ContactTaskItem) {
    setEditingTaskId(task.id);
    setTaskTitle(task.title);
    setTaskDescription(task.description ?? '');
    setTaskAssigneeId(task.assignedTo?.id ?? '');
    setTaskDueAt(toDateInputValue(task.dueAt));
    setTaskStatus(task.status);
    setError(null);
    setSuccess(null);
  }

  function replaceTask(updated: ContactTaskItem) {
    setTasks((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
  }

  async function handleTaskSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getStoredToken();
    if (!token || !taskTitle.trim()) return;

    setSavingTask(true);
    setError(null);
    setSuccess(null);

    const payload = {
      title: taskTitle,
      description: taskDescription || undefined,
      assignedToUserId: taskAssigneeId || undefined,
      dueAt: taskDueAt || undefined,
      status: taskStatus,
    };

    try {
      if (editingTaskId) {
        const updated = await updateContactTask(token, campaignId, contactId, editingTaskId, {
          ...payload,
          assignedToUserId: taskAssigneeId || null,
          dueAt: taskDueAt || null,
        });
        replaceTask(updated);
        setSuccess('Tarefa atualizada com sucesso.');
      } else {
        const created = await createContactTask(token, campaignId, contactId, payload);
        setTasks((current) => [created, ...current]);
        setSuccess('Tarefa criada com sucesso.');
      }
      resetTaskForm();
      await refreshTimeline(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel salvar a tarefa');
    } finally {
      setSavingTask(false);
    }
  }

  async function handleCompleteTask(taskId: string) {
    const token = getStoredToken();
    if (!token) return;

    setSavingTask(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await updateContactTask(token, campaignId, contactId, taskId, {
        status: 'DONE',
      });
      replaceTask(updated);
      await refreshTimeline(token);
      setSuccess('Tarefa concluida com sucesso.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel concluir a tarefa');
    } finally {
      setSavingTask(false);
    }
  }

  async function handleCancelTask(taskId: string) {
    const token = getStoredToken();
    if (!token) return;

    setSavingTask(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await updateContactTask(token, campaignId, contactId, taskId, {
        status: 'CANCELED',
      });
      replaceTask(updated);
      await refreshTimeline(token);
      setSuccess('Tarefa cancelada com sucesso.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel cancelar a tarefa');
    } finally {
      setSavingTask(false);
    }
  }

  async function handleOperationsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getStoredToken();
    if (!token) return;

    setSavingOperations(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await updateContactOperations(token, campaignId, contactId, {
        assignedToUserId: operationalAssigneeId || null,
        operationalStatus,
      });
      fillContact(updated);
      await refreshTimeline(token);
      setSuccess('Operacao do contato atualizada com sucesso.');
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Nao foi possivel atualizar a operacao do contato',
      );
    } finally {
      setSavingOperations(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f7f5]">
        <p className="text-[#65655f]">Carregando contato...</p>
      </main>
    );
  }

  if (!contact) return null;

  const displayName = contact.name?.trim() || 'Contato sem nome';
  const contactHasOptOut = hasOptOut(contact);
  const contactTags = getContactTags(contact);
  const appliedTagIds = new Set(contactTags.map((tag) => tag.id));
  const availableTags = campaignTags.filter((tag) => !appliedTagIds.has(tag.id));
  const canWrite = campaign
    ? canWriteRole(getOrganizationRole(user?.memberships, campaign.organizationId))
    : false;

  return (
    <DashboardShell userName={user?.name}>
      <div className="space-y-6">
        <ContactBreadcrumb
          campaignId={campaignId}
          campaignName={campaign?.name}
          contactName={displayName}
        />

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-[#151515]">Visao 360 do contato</h2>
            <p className="mt-1 text-sm text-[#65655f]">
              Central de informacoes e acoes do eleitor nesta campanha.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="rounded-md border border-[#24382b] px-3 py-2 text-sm font-medium text-[#24382b] hover:bg-[#eef2ea]"
              href={`/dashboard/campaigns/${campaignId}/contacts`}
            >
              Voltar para contatos
            </Link>
            {contact.latestThreadId ? (
              <Link
                className="rounded-md bg-[#24382b] px-3 py-2 text-sm font-semibold text-white"
                href={`/dashboard/campaigns/${campaignId}/inbox?thread=${contact.latestThreadId}`}
              >
                Abrir conversa
              </Link>
            ) : null}
            {campaign ? (
              <Link
                className="rounded-md border border-[#d7d6cd] px-3 py-2 text-sm font-medium text-[#65655f] hover:bg-[#f7f7f5]"
                href={`/dashboard/campaigns/${campaignId}`}
              >
                Ir para campanha
              </Link>
            ) : null}
          </div>
        </div>

        {contactHasOptOut ? (
          <div
            className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-red-900"
            role="alert"
          >
            <p className="font-semibold">Contato com opt-out ativo</p>
            <p className="mt-1 text-sm">
              Este contato nao deve receber novos envios nos canais com opt-out registrado.
            </p>
          </div>
        ) : null}

        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {success ? <p className="text-sm text-[#47624f]">{success}</p> : null}

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <ContactSection title="Dados basicos">
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-[#65655f]">Nome</dt>
                  <dd className="mt-1 text-sm text-[#151515]">{contact.name?.trim() || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-[#65655f]">Status tecnico</dt>
                  <dd className="mt-1">
                    <span className="inline-flex rounded-full bg-[#eef2ea] px-2 py-1 text-xs font-medium text-[#47624f]">
                      {getContactStatusLabel(contact.status)}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-[#65655f]">Telefone</dt>
                  <dd className="mt-1 text-sm text-[#151515]">{contact.phoneNumber?.trim() || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-[#65655f]">E-mail</dt>
                  <dd className="mt-1 text-sm text-[#151515]">{contact.email?.trim() || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-[#65655f]">Cidade</dt>
                  <dd className="mt-1 text-sm text-[#151515]">{contact.city?.trim() || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-[#65655f]">Bairro</dt>
                  <dd className="mt-1 text-sm text-[#151515]">{contact.neighborhood?.trim() || '—'}</dd>
                </div>
              </dl>
              {contact.metadata ? (
                <div className="mt-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-[#65655f]">Metadata</p>
                  <pre className="mt-1 overflow-x-auto rounded-md bg-[#f7f7f5] p-3 font-mono text-xs text-[#34342f]">
                    {metadataToText(contact.metadata)}
                  </pre>
                </div>
              ) : null}
            </ContactSection>

            <ContactSection
              title="Operacao do contato"
              description="Responsavel e status operacional do relacionamento."
            >
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-[#65655f]">
                    Status operacional
                  </dt>
                  <dd className="mt-1">
                    <span className="inline-flex rounded-full bg-[#eef2ea] px-2 py-1 text-xs font-medium text-[#47624f]">
                      {getOperationalStatusLabel(contact.operationalStatus)}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-[#65655f]">
                    Responsavel
                  </dt>
                  <dd className="mt-1 text-sm text-[#151515]">
                    {contact.assignedTo?.name ?? 'Sem responsavel'}
                  </dd>
                </div>
              </dl>
            </ContactSection>

            {campaign ? (
              <ContactSection
                title="Campanha relacionada"
                description="Contexto da campanha em que este contato esta cadastrado."
              >
                <dl className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-[#65655f]">Nome</dt>
                    <dd className="mt-1 text-sm font-medium text-[#151515]">{campaign.name}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-[#65655f]">Fase</dt>
                    <dd className="mt-1 text-sm text-[#151515]">{getPhaseLabel(campaign.phase)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-[#65655f]">Status</dt>
                    <dd className="mt-1 text-sm text-[#151515]">{getStatusLabel(campaign.status)}</dd>
                  </div>
                </dl>
                <Link
                  className="mt-4 inline-block text-sm font-medium text-[#24382b] underline"
                  href={`/dashboard/campaigns/${campaignId}`}
                >
                  Abrir campanha
                </Link>
              </ContactSection>
            ) : null}

            <ContactSection
              title="Canais do contato"
              description="Canais sincronizados a partir dos dados cadastrais."
            >
              {contact.channels.length > 0 ? (
                <ul className="space-y-2">
                  {contact.channels.map((channel) => (
                    <li
                      key={channel.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#eef2ea] bg-[#f7f7f5] px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium text-[#24382b]">{getChannelLabel(channel.channel)}</p>
                        <p className="text-sm text-[#65655f]">{channel.value}</p>
                      </div>
                      {channel.isPrimary ? (
                        <span className="rounded-full bg-[#eef2ea] px-2 py-1 text-xs font-medium text-[#47624f]">
                          Principal
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-[#65655f]">Nenhum canal sincronizado ainda.</p>
              )}
            </ContactSection>

            <ContactSection
              title="Consentimentos"
              description="Historico de consentimento por canal."
            >
              {contact.consents.length > 0 ? (
                <ul className="space-y-2">
                  {contact.consents.map((consent) => (
                    <li
                      key={consent.id}
                      className="rounded-md border border-[#eef2ea] bg-[#f7f7f5] px-3 py-2 text-sm text-[#34342f]"
                    >
                      <p className="font-medium text-[#24382b]">
                        {getChannelLabel(consent.channel)} · {getConsentStatusLabel(consent.status)}
                      </p>
                      <p className="mt-1 text-[#65655f]">
                        {consent.source ? `Origem: ${consent.source}` : 'Origem nao informada'}
                        {consent.collectedAt ? ` · ${formatDate(consent.collectedAt)}` : ''}
                      </p>
                      {consent.consentText ? (
                        <p className="mt-1 text-[#65655f]">{consent.consentText}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-[#65655f]">Nenhum consentimento registrado.</p>
              )}
            </ContactSection>

            <ContactSection
              title="Opt-out"
              description="Registros de exclusao de comunicacao por canal."
              className={contactHasOptOut ? 'border-red-300 bg-red-50' : ''}
            >
              {contact.optOuts.length > 0 ? (
                <ul className="space-y-2">
                  {contact.optOuts.map((optOut) => (
                    <li
                      key={optOut.id}
                      className="rounded-md border border-red-200 bg-white px-3 py-2 text-sm text-red-900"
                    >
                      <p className="font-medium">
                        {optOut.channel ? getChannelLabel(optOut.channel) : 'Geral'} · opt-out registrado
                      </p>
                      <p className="mt-1 text-red-800">
                        {optOut.reason ? `Motivo: ${optOut.reason}` : 'Motivo nao informado'}
                        {optOut.createdAt ? ` · ${formatDate(optOut.createdAt)}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : contact.consents.some((consent) => consent.status === 'OPT_OUT') ? (
                <p className="text-sm font-medium text-red-800">
                  Consentimento marcado como opt-out em pelo menos um canal.
                </p>
              ) : contact.status === 'BLOCKED' ? (
                <p className="text-sm font-medium text-red-800">
                  Contato bloqueado — tratado como opt-out operacional.
                </p>
              ) : (
                <p className="text-sm text-[#65655f]">Nenhum opt-out registrado.</p>
              )}
            </ContactSection>

            <ContactSection
              title="Tags"
              description="Classificacao e segmentacao do contato nesta campanha."
            >
              {contactTags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {contactTags.map((tag) => (
                    <TagBadge
                      key={tag.id}
                      tag={tag}
                      removable={canWrite}
                      onRemove={canWrite ? () => handleRemoveTag(tag.id) : undefined}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[#65655f]">Nenhuma tag aplicada a este contato.</p>
              )}
              <Link
                className="mt-4 inline-block text-sm font-medium text-[#24382b] underline"
                href={`/dashboard/campaigns/${campaignId}/tags`}
              >
                Gerenciar tags da campanha
              </Link>
            </ContactSection>

            <ContactSection
              title="Notas internas"
              description="Observacoes internas da equipe. Nao sao enviadas ao contato."
            >
              {notes.length > 0 ? (
                <ul className="space-y-3">
                  {notes.map((note) => (
                    <li
                      key={note.id}
                      className="rounded-md border border-[#eef2ea] bg-[#f7f7f5] px-3 py-3 text-sm text-[#34342f]"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-[#24382b]">{note.author.name}</p>
                        <p className="text-xs text-[#65655f]">
                          {formatDate(note.createdAt)}
                          {note.updatedAt !== note.createdAt ? ' · editada' : ''}
                        </p>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap">{note.body}</p>
                      {canWrite ? (
                        <button
                          className="mt-3 text-xs font-medium text-[#24382b] underline"
                          type="button"
                          onClick={() => startEditNote(note)}
                        >
                          Editar nota
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-[#65655f]">Nenhuma nota interna registrada.</p>
              )}
            </ContactSection>

            <ContactSection
              title="Tarefas e follow-ups"
              description="Pendencias operacionais vinculadas a este contato."
            >
              {tasks.length > 0 ? (
                <ul className="space-y-3">
                  {tasks.map((task) => (
                    <li
                      key={task.id}
                      className="rounded-md border border-[#eef2ea] bg-[#f7f7f5] px-3 py-3 text-sm text-[#34342f]"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-[#24382b]">{task.title}</p>
                          <p className="mt-1 text-xs text-[#65655f]">
                            {getTaskStatusLabel(task.status)}
                            {task.assignedTo ? ` · ${task.assignedTo.name}` : ''}
                            {task.dueAt ? ` · prevista ${formatDate(task.dueAt)}` : ''}
                          </p>
                        </div>
                        <span className="rounded-full bg-[#eef2ea] px-2 py-1 text-xs font-medium text-[#47624f]">
                          {getTaskStatusLabel(task.status)}
                        </span>
                      </div>
                      {task.description ? (
                        <p className="mt-2 whitespace-pre-wrap text-[#65655f]">{task.description}</p>
                      ) : null}
                      <p className="mt-2 text-xs text-[#65655f]">
                        Criada por {task.createdBy.name} em {formatDate(task.createdAt)}
                        {task.completedAt ? ` · concluida em ${formatDate(task.completedAt)}` : ''}
                      </p>
                      {canWrite ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {isTaskOpen(task.status) ? (
                            <>
                              <button
                                className="text-xs font-medium text-[#24382b] underline"
                                type="button"
                                onClick={() => startEditTask(task)}
                              >
                                Editar
                              </button>
                              <button
                                className="text-xs font-medium text-[#47624f] underline"
                                type="button"
                                disabled={savingTask}
                                onClick={() => handleCompleteTask(task.id)}
                              >
                                Concluir
                              </button>
                              <button
                                className="text-xs font-medium text-red-800 underline"
                                type="button"
                                disabled={savingTask}
                                onClick={() => handleCancelTask(task.id)}
                              >
                                Cancelar
                              </button>
                            </>
                          ) : (
                            <button
                              className="text-xs font-medium text-[#24382b] underline"
                              type="button"
                              onClick={() => startEditTask(task)}
                            >
                              Editar
                            </button>
                          )}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-[#65655f]">Nenhuma tarefa registrada.</p>
              )}
            </ContactSection>
            <ContactSection
              title="Timeline"
              description="Historico operacional do contato nesta campanha."
            >
              {hasMeaningfulTimelineEvents(timeline) ? (
                <ul className="space-y-3">
                  {timeline.map((event) => (
                    <li
                      key={event.id}
                      className="rounded-md border border-[#eef2ea] bg-[#f7f7f5] px-3 py-3 text-sm text-[#34342f]"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-[#24382b]">{event.title}</p>
                          <p className="mt-1 text-xs text-[#65655f]">
                            {getTimelineTypeLabel(event.type)}
                            {event.actor ? ` · ${event.actor.name}` : ''}
                          </p>
                        </div>
                        <time
                          className="text-xs text-[#65655f]"
                          dateTime={event.occurredAt}
                        >
                          {formatDate(event.occurredAt)}
                        </time>
                      </div>
                      {event.description ? (
                        <p className="mt-2 whitespace-pre-wrap text-[#65655f]">{event.description}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-[#65655f]">
                  Nenhuma atividade operacional registrada alem da criacao do contato.
                </p>
              )}
            </ContactSection>
          </div>

          <div className="space-y-6">
            {canWrite ? (
              <form
                className="space-y-4 rounded-md border border-[#deddd4] bg-white p-4"
                onSubmit={handleOperationsSubmit}
              >
                <div>
                  <h3 className="font-medium text-[#24382b]">Operacao do contato</h3>
                  <p className="mt-1 text-sm text-[#65655f]">
                    Defina responsavel e status operacional do relacionamento.
                  </p>
                </div>
                <label className="block">
                  <span className="text-sm font-medium text-[#34342f]">Responsavel</span>
                  <select
                    className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                    value={operationalAssigneeId}
                    onChange={(event) => setOperationalAssigneeId(event.target.value)}
                  >
                    <option value="">Sem responsavel</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[#34342f]">Status operacional</span>
                  <select
                    className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                    value={operationalStatus}
                    onChange={(event) => setOperationalStatus(event.target.value)}
                  >
                    {CONTACT_OPERATIONAL_STATUSES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="w-full rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  type="submit"
                  disabled={savingOperations}
                >
                  {savingOperations ? 'Salvando...' : 'Salvar operacao'}
                </button>
              </form>
            ) : null}

            <form className="space-y-4 rounded-md border border-[#deddd4] bg-white p-4" onSubmit={handleSubmit}>
              <div>
                <h3 className="font-medium text-[#24382b]">Editar contato</h3>
                <p className="mt-1 text-sm text-[#65655f]">Atualize os dados cadastrais do eleitor.</p>
              </div>
              <label className="block">
                <span className="text-sm font-medium text-[#34342f]">Nome</span>
                <input
                  className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-[#34342f]">Telefone</span>
                <input
                  className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-[#34342f]">E-mail</span>
                <input
                  className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-[#34342f]">Cidade</span>
                <input
                  className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-[#34342f]">Bairro</span>
                <input
                  className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                  value={neighborhood}
                  onChange={(e) => setNeighborhood(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-[#34342f]">Status</span>
                <select
                  className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {CONTACT_STATUSES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-[#34342f]">Metadata (JSON)</span>
                <textarea
                  className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2 font-mono text-sm"
                  rows={4}
                  value={metadata}
                  onChange={(e) => setMetadata(e.target.value)}
                />
              </label>
              <button
                className="w-full rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                type="submit"
                disabled={saving}
              >
                {saving ? 'Salvando...' : 'Salvar contato'}
              </button>
            </form>

            <form
              className="space-y-4 rounded-md border border-[#deddd4] bg-white p-4"
              onSubmit={handleConsentSubmit}
            >
              <div>
                <h3 className="font-medium text-[#24382b]">Registrar consentimento</h3>
                <p className="mt-1 text-sm text-[#65655f]">Atualize o consentimento por canal.</p>
              </div>
              <label className="block">
                <span className="text-sm font-medium text-[#34342f]">Canal</span>
                <select
                  className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                  value={consentChannel}
                  onChange={(e) => setConsentChannel(e.target.value)}
                >
                  {CONTACT_CHANNELS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-[#34342f]">Status</span>
                <select
                  className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                  value={consentStatus}
                  onChange={(e) => setConsentStatus(e.target.value)}
                >
                  {CONSENT_STATUSES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-[#34342f]">Origem</span>
                <input
                  className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                  value={consentSource}
                  onChange={(e) => setConsentSource(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-[#34342f]">Texto do consentimento</span>
                <textarea
                  className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                  rows={3}
                  value={consentText}
                  onChange={(e) => setConsentText(e.target.value)}
                />
              </label>
              <button
                className="w-full rounded-md border border-[#24382b] px-4 py-2 text-sm font-semibold text-[#24382b] disabled:opacity-60"
                type="submit"
                disabled={savingConsent}
              >
                {savingConsent ? 'Salvando...' : 'Salvar consentimento'}
              </button>
            </form>

            {canWrite ? (
              <section className="space-y-4 rounded-md border border-[#deddd4] bg-white p-4">
                <div>
                  <h3 className="font-medium text-[#24382b]">Aplicar tag</h3>
                  <p className="mt-1 text-sm text-[#65655f]">
                    Selecione uma tag da campanha para classificar este contato.
                  </p>
                </div>
                {availableTags.length > 0 ? (
                  <>
                    <label className="block">
                      <span className="text-sm font-medium text-[#34342f]">Tag</span>
                      <select
                        className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                        value={selectedTagId}
                        onChange={(event) => setSelectedTagId(event.target.value)}
                      >
                        <option value="">Selecione uma tag</option>
                        {availableTags.map((tag) => (
                          <option key={tag.id} value={tag.id}>
                            {tag.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="w-full rounded-md border border-[#24382b] px-4 py-2 text-sm font-semibold text-[#24382b] disabled:opacity-60"
                      type="button"
                      disabled={savingTag || !selectedTagId}
                      onClick={handleApplyTag}
                    >
                      {savingTag ? 'Aplicando...' : 'Aplicar tag'}
                    </button>
                  </>
                ) : (
                  <p className="text-sm text-[#65655f]">
                    {campaignTags.length === 0
                      ? 'Nenhuma tag cadastrada nesta campanha.'
                      : 'Todas as tags da campanha ja estao aplicadas a este contato.'}
                  </p>
                )}
              </section>
            ) : null}

            {canWrite ? (
              <form
                className="space-y-4 rounded-md border border-[#deddd4] bg-white p-4"
                onSubmit={handleTaskSubmit}
              >
                <div>
                  <h3 className="font-medium text-[#24382b]">
                    {editingTaskId ? 'Editar tarefa' : 'Nova tarefa'}
                  </h3>
                  <p className="mt-1 text-sm text-[#65655f]">
                    Follow-up operacional interno para este contato.
                  </p>
                </div>
                <label className="block">
                  <span className="text-sm font-medium text-[#34342f]">Titulo</span>
                  <input
                    className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                    value={taskTitle}
                    onChange={(event) => setTaskTitle(event.target.value)}
                    required
                    minLength={2}
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[#34342f]">Descricao</span>
                  <textarea
                    className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                    rows={3}
                    value={taskDescription}
                    onChange={(event) => setTaskDescription(event.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[#34342f]">Responsavel</span>
                  <select
                    className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                    value={taskAssigneeId}
                    onChange={(event) => setTaskAssigneeId(event.target.value)}
                  >
                    <option value="">Sem responsavel</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[#34342f]">Data prevista</span>
                  <input
                    className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                    type="date"
                    value={taskDueAt}
                    onChange={(event) => setTaskDueAt(event.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[#34342f]">Status</span>
                  <select
                    className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                    value={taskStatus}
                    onChange={(event) => setTaskStatus(event.target.value)}
                  >
                    {CONTACT_TASK_STATUSES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    type="submit"
                    disabled={savingTask || !taskTitle.trim()}
                  >
                    {savingTask
                      ? 'Salvando...'
                      : editingTaskId
                        ? 'Salvar tarefa'
                        : 'Criar tarefa'}
                  </button>
                  {editingTaskId ? (
                    <button
                      className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm font-medium text-[#24382b]"
                      type="button"
                      onClick={resetTaskForm}
                    >
                      Cancelar
                    </button>
                  ) : null}
                </div>
              </form>
            ) : null}

            {canWrite ? (
              <form
                className="space-y-4 rounded-md border border-[#deddd4] bg-white p-4"
                onSubmit={handleNoteSubmit}
              >
                <div>
                  <h3 className="font-medium text-[#24382b]">
                    {editingNoteId ? 'Editar nota interna' : 'Nova nota interna'}
                  </h3>
                  <p className="mt-1 text-sm text-[#65655f]">
                    Registro visivel apenas para a equipe da campanha.
                  </p>
                </div>
                <label className="block">
                  <span className="text-sm font-medium text-[#34342f]">Observacao</span>
                  <textarea
                    className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                    rows={5}
                    value={noteBody}
                    onChange={(event) => setNoteBody(event.target.value)}
                    required
                    minLength={1}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    type="submit"
                    disabled={savingNote || !noteBody.trim()}
                  >
                    {savingNote
                      ? 'Salvando...'
                      : editingNoteId
                        ? 'Salvar nota'
                        : 'Registrar nota'}
                  </button>
                  {editingNoteId ? (
                    <button
                      className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm font-medium text-[#24382b]"
                      type="button"
                      onClick={resetNoteForm}
                    >
                      Cancelar
                    </button>
                  ) : null}
                </div>
              </form>
            ) : null}

            <section className="rounded-md border border-[#deddd4] bg-white p-4">
              <h3 className="font-medium text-[#24382b]">Registrar opt-out</h3>
              <p className="mt-1 text-sm text-[#65655f]">
                Registra opt-out no canal selecionado e bloqueia o contato para envios futuros.
              </p>
              <label className="mt-4 block">
                <span className="text-sm font-medium text-[#34342f]">Motivo</span>
                <input
                  className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                  value={optOutReason}
                  onChange={(e) => setOptOutReason(e.target.value)}
                />
              </label>
              <button
                className="mt-4 w-full rounded-md bg-red-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                type="button"
                disabled={savingOptOut || contactHasOptOut}
                onClick={handleOptOut}
              >
                {savingOptOut ? 'Registrando...' : 'Registrar opt-out'}
              </button>
            </section>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
