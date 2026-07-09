function getApiUrl() {
  return (
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.API_PUBLIC_URL ||
    'http://localhost:3001'
  );
}

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  status: string;
  createdAt: string;
  memberships?: Array<{
    id: string;
    role: string;
    organization: {
      id: string;
      name: string;
      slug: string;
      status: string;
    };
  }>;
};

export type OrganizationItem = {
  membershipId: string;
  role: string;
  joinedAt: string;
  organization: {
    id: string;
    name: string;
    slug: string;
    status: string;
    createdAt: string;
  };
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers);

  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${getApiUrl()}${path}`, {
    ...options,
    headers,
  });

  const raw = await response.text();
  let data: unknown = null;

  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const payload = data as { message?: string | string[] } | null;
    const message =
      typeof payload?.message === 'string'
        ? payload.message
        : Array.isArray(payload?.message)
          ? payload.message.join(', ')
          : raw || 'Erro na requisicao';
    throw new ApiError(message, response.status);
  }

  return data as T;
}

export function getStoredToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('campanha360_token');
}

export function setStoredToken(token: string) {
  localStorage.setItem('campanha360_token', token);
}

export function clearStoredToken() {
  localStorage.removeItem('campanha360_token');
}

export function registerUser(payload: { name: string; email: string; password: string }) {
  return request<{ accessToken: string; user: AuthUser }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function loginUser(payload: { email: string; password: string }) {
  return request<{ accessToken: string; user: AuthUser }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchMe(token: string) {
  return request<AuthUser>('/auth/me', {}, token);
}

export function fetchOrganizations(token: string) {
  return request<OrganizationItem[]>('/organizations', {}, token);
}

export function createOrganization(token: string, payload: { name: string; slug?: string }) {
  return request<{ organization: OrganizationItem['organization']; membership: { id: string; role: string } }>(
    '/organizations',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  );
}

export type CampaignItem = {
  id: string;
  organizationId: string;
  name: string;
  electionYear: number;
  office: string;
  territory: string | null;
  phase: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  candidate: {
    id: string;
    name: string;
    party: string | null;
    office: string | null;
  } | null;
};

export type CandidateItem = {
  id: string;
  organizationId: string;
  campaignId: string;
  name: string;
  party: string | null;
  office: string | null;
  bio: string | null;
  toneOfVoice: string | null;
  mainProposals: string[] | null;
  restrictedTopics: string[] | null;
  createdAt: string;
  updatedAt: string;
};

export function fetchCampaigns(token: string, organizationId: string) {
  return request<CampaignItem[]>(`/campaigns?organizationId=${encodeURIComponent(organizationId)}`, {}, token);
}

export function fetchCampaign(token: string, campaignId: string) {
  return request<CampaignItem>(`/campaigns/${campaignId}`, {}, token);
}

export function createCampaign(
  token: string,
  payload: {
    organizationId: string;
    name: string;
    electionYear: number;
    office: string;
    territory?: string;
    phase?: string;
    status?: string;
  },
) {
  return request<CampaignItem>('/campaigns', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function updateCampaign(
  token: string,
  campaignId: string,
  payload: {
    name?: string;
    electionYear?: number;
    office?: string;
    territory?: string;
    phase?: string;
    status?: string;
  },
) {
  return request<CampaignItem>(`/campaigns/${campaignId}`, { method: 'PUT', body: JSON.stringify(payload) }, token);
}

export function fetchCandidate(token: string, campaignId: string) {
  return request<{ candidate: CandidateItem | null }>(`/campaigns/${campaignId}/candidate`, {}, token);
}

export function upsertCandidate(
  token: string,
  campaignId: string,
  payload: {
    name: string;
    party?: string;
    office?: string;
    bio?: string;
    toneOfVoice?: string;
    mainProposals?: string[];
    restrictedTopics?: string[];
  },
) {
  return request<CandidateItem>(`/campaigns/${campaignId}/candidate`, { method: 'PUT', body: JSON.stringify(payload) }, token);
}

export type ContactChannelItem = {
  id: string;
  channel: string;
  value: string;
  normalizedValue: string;
  isPrimary: boolean;
  status: string;
};

export type ConsentItem = {
  id: string;
  channel: string;
  status: string;
  source: string | null;
  consentText: string | null;
  collectedAt: string | null;
  revokedAt: string | null;
  updatedAt: string;
};

export type OptOutItem = {
  id: string;
  channel: string | null;
  reason: string | null;
  source: string | null;
  createdAt: string;
};

export type TagItem = {
  id: string;
  organizationId: string;
  campaignId: string;
  name: string;
  color: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ContactTagItem = {
  createdAt: string;
  tag: Pick<TagItem, 'id' | 'name' | 'color' | 'description'>;
};

export type ContactUserSummary = {
  id: string;
  name: string;
  email: string;
};

export type ContactItem = {
  id: string;
  organizationId: string;
  campaignId: string;
  name: string | null;
  phoneNumber: string | null;
  email: string | null;
  city: string | null;
  neighborhood: string | null;
  metadata: Record<string, unknown> | null;
  status: string;
  operationalStatus: string;
  assignedToUserId: string | null;
  assignedTo: ContactUserSummary | null;
  createdAt: string;
  updatedAt: string;
  channels: ContactChannelItem[];
  consents: ConsentItem[];
  optOuts: OptOutItem[];
  tags: ContactTagItem[];
};

export function fetchContacts(token: string, campaignId: string) {
  return request<ContactItem[]>(`/campaigns/${campaignId}/contacts`, {}, token);
}

export function fetchContact(token: string, campaignId: string, contactId: string) {
  return request<ContactItem>(`/campaigns/${campaignId}/contacts/${contactId}`, {}, token);
}

export function createContact(
  token: string,
  campaignId: string,
  payload: {
    name?: string;
    phoneNumber?: string;
    email?: string;
    city?: string;
    neighborhood?: string;
    status?: string;
    metadata?: Record<string, unknown>;
  },
) {
  return request<ContactItem>(
    `/campaigns/${campaignId}/contacts`,
    { method: 'POST', body: JSON.stringify(payload) },
    token,
  );
}

export function updateContact(
  token: string,
  campaignId: string,
  contactId: string,
  payload: {
    name?: string;
    phoneNumber?: string;
    email?: string;
    city?: string;
    neighborhood?: string;
    status?: string;
    metadata?: Record<string, unknown>;
  },
) {
  return request<ContactItem>(
    `/campaigns/${campaignId}/contacts/${contactId}`,
    { method: 'PUT', body: JSON.stringify(payload) },
    token,
  );
}

export function updateContactOperations(
  token: string,
  campaignId: string,
  contactId: string,
  payload: {
    assignedToUserId?: string | null;
    operationalStatus?: string;
  },
) {
  return request<ContactItem>(
    `/campaigns/${campaignId}/contacts/${contactId}/operations`,
    { method: 'PUT', body: JSON.stringify(payload) },
    token,
  );
}

export function upsertContactConsent(
  token: string,
  campaignId: string,
  contactId: string,
  payload: {
    channel: string;
    status: string;
    source?: string;
    consentText?: string;
  },
) {
  return request<ContactItem>(
    `/campaigns/${campaignId}/contacts/${contactId}/consents`,
    { method: 'PUT', body: JSON.stringify(payload) },
    token,
  );
}

export function createContactOptOut(
  token: string,
  campaignId: string,
  contactId: string,
  payload: {
    channel?: string;
    reason?: string;
    source?: string;
  },
) {
  return request<ContactItem>(
    `/campaigns/${campaignId}/contacts/${contactId}/opt-out`,
    { method: 'POST', body: JSON.stringify(payload) },
    token,
  );
}

export function fetchTags(token: string, campaignId: string) {
  return request<TagItem[]>(`/campaigns/${campaignId}/tags`, {}, token);
}

export function createTag(
  token: string,
  campaignId: string,
  payload: { name: string; color?: string; description?: string },
) {
  return request<TagItem>(
    `/campaigns/${campaignId}/tags`,
    { method: 'POST', body: JSON.stringify(payload) },
    token,
  );
}

export function updateTag(
  token: string,
  campaignId: string,
  tagId: string,
  payload: { name?: string; color?: string; description?: string },
) {
  return request<TagItem>(
    `/campaigns/${campaignId}/tags/${tagId}`,
    { method: 'PUT', body: JSON.stringify(payload) },
    token,
  );
}

export function deleteTag(token: string, campaignId: string, tagId: string) {
  return request<{ success: boolean }>(
    `/campaigns/${campaignId}/tags/${tagId}`,
    { method: 'DELETE' },
    token,
  );
}

export function applyContactTag(
  token: string,
  campaignId: string,
  contactId: string,
  tagId: string,
) {
  return request<ContactItem>(
    `/campaigns/${campaignId}/contacts/${contactId}/tags/${tagId}`,
    { method: 'POST' },
    token,
  );
}

export function removeContactTag(
  token: string,
  campaignId: string,
  contactId: string,
  tagId: string,
) {
  return request<ContactItem>(
    `/campaigns/${campaignId}/contacts/${contactId}/tags/${tagId}`,
    { method: 'DELETE' },
    token,
  );
}

export type ContactNoteAuthor = {
  id: string;
  name: string;
  email: string;
};

export type ContactNoteItem = {
  id: string;
  organizationId: string;
  campaignId: string;
  contactId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  author: ContactNoteAuthor;
};

export function fetchContactNotes(token: string, campaignId: string, contactId: string) {
  return request<ContactNoteItem[]>(
    `/campaigns/${campaignId}/contacts/${contactId}/notes`,
    {},
    token,
  );
}

export function createContactNote(
  token: string,
  campaignId: string,
  contactId: string,
  payload: { body: string },
) {
  return request<ContactNoteItem>(
    `/campaigns/${campaignId}/contacts/${contactId}/notes`,
    { method: 'POST', body: JSON.stringify(payload) },
    token,
  );
}

export function updateContactNote(
  token: string,
  campaignId: string,
  contactId: string,
  noteId: string,
  payload: { body: string },
) {
  return request<ContactNoteItem>(
    `/campaigns/${campaignId}/contacts/${contactId}/notes/${noteId}`,
    { method: 'PUT', body: JSON.stringify(payload) },
    token,
  );
}

export type CampaignMemberItem = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type ContactTaskUser = ContactUserSummary;

export type ContactTaskItem = {
  id: string;
  organizationId: string;
  campaignId: string;
  contactId: string;
  title: string;
  description: string | null;
  status: string;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: ContactTaskUser;
  assignedTo: ContactUserSummary | null;
};

export function fetchCampaignMembers(token: string, campaignId: string) {
  return request<CampaignMemberItem[]>(`/campaigns/${campaignId}/members`, {}, token);
}

export function fetchContactTasks(token: string, campaignId: string, contactId: string) {
  return request<ContactTaskItem[]>(
    `/campaigns/${campaignId}/contacts/${contactId}/tasks`,
    {},
    token,
  );
}

export function createContactTask(
  token: string,
  campaignId: string,
  contactId: string,
  payload: {
    title: string;
    description?: string;
    assignedToUserId?: string;
    dueAt?: string;
    status?: string;
  },
) {
  return request<ContactTaskItem>(
    `/campaigns/${campaignId}/contacts/${contactId}/tasks`,
    { method: 'POST', body: JSON.stringify(payload) },
    token,
  );
}

export function updateContactTask(
  token: string,
  campaignId: string,
  contactId: string,
  taskId: string,
  payload: {
    title?: string;
    description?: string;
    assignedToUserId?: string | null;
    dueAt?: string | null;
    status?: string;
  },
) {
  return request<ContactTaskItem>(
    `/campaigns/${campaignId}/contacts/${contactId}/tasks/${taskId}`,
    { method: 'PUT', body: JSON.stringify(payload) },
    token,
  );
}
