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
  data: unknown;

  constructor(message: string, status: number, data: unknown = null) {
    super(message);
    this.status = status;
    this.data = data;
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
    throw new ApiError(message, response.status, data);
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
  lastInteractionAt?: string | null;
  messageCount?: number;
  latestThreadId?: string | null;
  latestChannel?: string | null;
};

export type ContactListFilters = {
  q?: string;
  status?: string;
  operationalStatus?: string;
  assignedToUserId?: string;
  tagId?: string;
  hasOptOut?: boolean;
};

export function fetchContacts(
  token: string,
  campaignId: string,
  filters: ContactListFilters = {},
) {
  const params = new URLSearchParams();

  if (filters.q?.trim()) params.set('q', filters.q.trim());
  if (filters.status) params.set('status', filters.status);
  if (filters.operationalStatus) params.set('operationalStatus', filters.operationalStatus);
  if (filters.assignedToUserId) params.set('assignedToUserId', filters.assignedToUserId);
  if (filters.tagId) params.set('tagId', filters.tagId);
  if (filters.hasOptOut === true) params.set('hasOptOut', 'true');
  if (filters.hasOptOut === false) params.set('hasOptOut', 'false');

  const query = params.toString();
  const path = `/campaigns/${campaignId}/contacts${query ? `?${query}` : ''}`;

  return request<ContactItem[]>(path, {}, token);
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

export type ContactImportError = {
  lineNumber: number;
  reason: string;
};

export type ContactImportResult = {
  created: number;
  updated: number;
  ignored: number;
  errors: ContactImportError[];
  errorCount: number;
};

export function importContactsCsv(token: string, campaignId: string, csv: string) {
  return request<ContactImportResult>(
    `/campaigns/${campaignId}/contacts/import`,
    { method: 'POST', body: JSON.stringify({ csv }) },
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

export type ContactRemovalResult = {
  id: string;
  mode: 'soft' | 'hard';
  status: string;
  alreadyRemoved: boolean;
};

export function removeContact(token: string, campaignId: string, contactId: string) {
  return request<ContactRemovalResult>(
    `/campaigns/${campaignId}/contacts/${contactId}`,
    { method: 'DELETE' },
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

export function clearContactOptOut(token: string, campaignId: string, contactId: string) {
  return request<ContactItem>(
    `/campaigns/${campaignId}/contacts/${contactId}/opt-out`,
    { method: 'DELETE' },
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

export type SegmentFilters = {
  tagIds?: string[];
  status?: string | null;
  includeOptOut?: boolean;
  channel?: string | null;
};

export type SegmentContactPreview = {
  id: string;
  name: string | null;
  phoneNumber: string | null;
  email: string | null;
  status: string;
  channels: ContactChannelItem[];
  tags: ContactTagItem[];
};

export type SegmentItem = {
  id: string;
  organizationId: string;
  campaignId: string;
  name: string;
  description: string | null;
  filters: SegmentFilters;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  contactCount?: number;
  includeOptOutWarning?: boolean;
};

export type SegmentDetail = SegmentItem & {
  contacts: SegmentContactPreview[];
};

export type SegmentPreviewResult = {
  filters: SegmentFilters;
  contactCount: number;
  contacts: SegmentContactPreview[];
  includeOptOutWarning: boolean;
};

export function fetchSegments(token: string, campaignId: string) {
  return request<SegmentItem[]>(`/campaigns/${campaignId}/segments`, {}, token);
}

export function fetchSegment(token: string, campaignId: string, segmentId: string) {
  return request<SegmentDetail>(
    `/campaigns/${campaignId}/segments/${segmentId}`,
    {},
    token,
  );
}

export type SegmentPrevalidateAlert = {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
};

export type SegmentPrevalidateResult = {
  segmentId: string;
  segmentName: string;
  filters: SegmentFilters;
  totalGross: number;
  eligible: number;
  optOutOrBlocked: number;
  deleted: number;
  invalidPhone: number;
  duplicatePhone: number;
  missingCompatibleChannel: number;
  softLimit: number;
  whatsappChannelConnected: boolean;
  channelAccount: {
    id: string;
    name: string;
    provider: string;
    status: string;
  } | null;
  requiredChannel: string;
  truncated: boolean;
  alerts: SegmentPrevalidateAlert[];
  canDispatch: false;
};

export function prevalidateSegment(
  token: string,
  campaignId: string,
  segmentId: string,
) {
  return request<SegmentPrevalidateResult>(
    `/campaigns/${campaignId}/segments/${segmentId}/prevalidate`,
    {},
    token,
  );
}

export function previewSegment(
  token: string,
  campaignId: string,
  filters: SegmentFilters,
) {
  return request<SegmentPreviewResult>(
    `/campaigns/${campaignId}/segments/preview`,
    { method: 'POST', body: JSON.stringify({ filters }) },
    token,
  );
}

export function createSegment(
  token: string,
  campaignId: string,
  payload: { name: string; description?: string; filters: SegmentFilters },
) {
  return request<SegmentItem>(
    `/campaigns/${campaignId}/segments`,
    { method: 'POST', body: JSON.stringify(payload) },
    token,
  );
}

export function updateSegment(
  token: string,
  campaignId: string,
  segmentId: string,
  payload: { name?: string; description?: string; filters?: SegmentFilters },
) {
  return request<SegmentItem>(
    `/campaigns/${campaignId}/segments/${segmentId}`,
    { method: 'PUT', body: JSON.stringify(payload) },
    token,
  );
}

export function deleteSegment(token: string, campaignId: string, segmentId: string) {
  return request<{ success: boolean }>(
    `/campaigns/${campaignId}/segments/${segmentId}`,
    { method: 'DELETE' },
    token,
  );
}

export type DispatchPlanStatus =
  | 'DRAFT'
  | 'VALIDATING'
  | 'VALIDATED'
  | 'BLOCKED'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELED';

export type DispatchPlanRecipientEligibilityStatus =
  | 'ELIGIBLE'
  | 'EXCLUDED_OPT_OUT'
  | 'EXCLUDED_BLOCKED'
  | 'EXCLUDED_DELETED'
  | 'EXCLUDED_INVALID_DESTINATION'
  | 'EXCLUDED_DUPLICATE'
  | 'EXCLUDED_NO_CHANNEL'
  | 'EXCLUDED_POLICY'
  | 'EXCLUDED_OTHER';

export type DispatchPlanValidationCheck = {
  code: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  passed: boolean;
  title: string;
  message: string;
  details?: Record<string, unknown>;
};

export type DispatchPlanValidationSnapshot = {
  checkedAt: string;
  version: number;
  passed: boolean;
  summary: {
    errors: number;
    warnings: number;
    infos: number;
  };
  audience: {
    totalEvaluated: number;
    totalEligible: number;
    totalExcluded: number;
  };
  channel: {
    channelAccountId: string | null;
    provider: string | null;
    status: string | null;
  };
  checks: DispatchPlanValidationCheck[];
};

export type DispatchPlanAllowedActions = {
  canEdit: boolean;
  canCancel: boolean;
  canGenerateSnapshot: boolean;
  canRegenerateSnapshot?: boolean;
  canValidate: boolean;
  canReopen: boolean;
  canSimulate?: boolean;
  canRecalculateSimulation?: boolean;
  canApprove?: boolean;
  canReject?: boolean;
};

export type DispatchPlanApprovalSnapshot = {
  approvedAt: string;
  approvedVersion: number;
  approvedByUserId: string;
  plan: {
    dispatchPlanId: string;
    name: string;
    campaignId: string;
    segmentId: string;
    channelAccountId: string;
    channelType: string;
    channelProvider: string;
  };
  audience: {
    totalEvaluated: number;
    totalEligible: number;
    totalExcluded: number;
    snapshotCreatedAt: string | null;
  };
  validation: {
    validatedAt: string | null;
    validatedVersion: number | null;
    passed: boolean;
    errorCount: number;
    warningCount: number;
  };
  simulation: {
    simulatedAt: string | null;
    simulatedVersion: number | null;
    requestedMessagesPerMinute: number | null;
    effectiveMessagesPerMinute: number | null;
    totalBatches: number | null;
    estimatedActiveDurationSeconds: number | null;
    estimatedCalendarDurationSeconds: number | null;
    estimatedStartAt: string | null;
    estimatedEndAt: string | null;
    timezone: string | null;
  };
  content: {
    type: 'TEXT';
    length: number;
    hash: string;
    body: string;
  };
};

export type DispatchPlanSimulationWarning = {
  code: string;
  message: string;
};

export type DispatchPlanSimulationSnapshot = {
  simulatedAt: string;
  version: number;
  audience: {
    totalEligible: number;
  };
  configuration: {
    requestedMessagesPerMinute: number;
    minDelaySeconds: number;
    maxDelaySeconds: number;
    batchSize: number;
    pauseBetweenBatchesSeconds: number;
    timezone: string;
    allowedStartTime: string;
    allowedEndTime: string;
    allowedDays: number[];
    plannedStartAt: string | null;
  };
  estimates: {
    effectiveMessagesPerMinute: number;
    limitingFactor: 'RATE_LIMIT' | 'DELAY' | 'BOTH';
    totalBatches: number;
    totalBatchPauses: number;
    lastBatchSize?: number;
    estimatedActiveDurationSeconds: number;
    estimatedCalendarDurationSeconds: number;
    estimatedMessagesPerHour: number;
    estimatedStartAt: string;
    estimatedEndAt: string;
  };
  warnings: DispatchPlanSimulationWarning[];
};

export type SimulateDispatchPlanPayload = {
  messagesPerMinute?: number;
  minDelaySeconds?: number;
  maxDelaySeconds?: number;
  batchSize?: number;
  pauseBetweenBatchesSeconds?: number;
  timezone?: string;
  allowedStartTime?: string;
  allowedEndTime?: string;
  allowedDays?: number[];
  plannedStartAt?: string;
};

export type DispatchPlanItem = {
  id: string;
  organizationId: string;
  campaignId: string;
  segmentId: string;
  channelAccountId: string;
  name: string;
  description: string | null;
  channelType: string;
  content: string;
  status: DispatchPlanStatus;
  version: number;
  totalEvaluated: number;
  totalEligible: number;
  totalExcluded: number;
  snapshotCreatedAt: string | null;
  filtersSnapshot: SegmentFilters | null;
  validationSnapshot: DispatchPlanValidationSnapshot | null;
  validatedAt?: string | null;
  validatedVersion?: number | null;
  validationIsCurrent?: boolean;
  simulationSnapshot?: DispatchPlanSimulationSnapshot | null;
  simulatedAt?: string | null;
  simulatedVersion?: number | null;
  simulationIsCurrent?: boolean;
  approvalSnapshot?: DispatchPlanApprovalSnapshot | null;
  approvedAt?: string | null;
  approvedByUserId?: string | null;
  approvedBy?: { id: string; name: string } | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  rejectedBy?: { id: string; name: string } | null;
  canceledAt?: string | null;
  cancellationReason?: string | null;
  canceledBy?: { id: string; name: string } | null;
  planIsImmutable?: boolean;
  allowedActions?: DispatchPlanAllowedActions;
  recalculated?: boolean;
  byEligibilityStatus?: Record<
    DispatchPlanRecipientEligibilityStatus,
    number
  >;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  segment: {
    id: string;
    name: string;
  };
  channelAccount: {
    id: string;
    name: string;
    provider: string;
    status: string;
  };
  createdBy: {
    id: string;
    name: string;
    email: string;
  };
  passed?: boolean;
  summary?: {
    errors: number;
    warnings: number;
    infos: number;
  };
};

export type CreateDispatchPlanPayload = {
  name: string;
  description?: string;
  segmentId: string;
  channelAccountId: string;
  content: string;
};

export type UpdateDispatchPlanPayload = {
  name?: string;
  description?: string;
  segmentId?: string;
  channelAccountId?: string;
  content?: string;
};

export function fetchDispatchPlans(token: string, campaignId: string) {
  return request<DispatchPlanItem[]>(
    `/campaigns/${campaignId}/dispatch-plans`,
    {},
    token,
  );
}

export function fetchDispatchPlan(
  token: string,
  campaignId: string,
  dispatchPlanId: string,
) {
  return request<DispatchPlanItem>(
    `/campaigns/${campaignId}/dispatch-plans/${dispatchPlanId}`,
    {},
    token,
  );
}

export function createDispatchPlan(
  token: string,
  campaignId: string,
  payload: CreateDispatchPlanPayload,
) {
  return request<DispatchPlanItem>(
    `/campaigns/${campaignId}/dispatch-plans`,
    { method: 'POST', body: JSON.stringify(payload) },
    token,
  );
}

export function updateDispatchPlan(
  token: string,
  campaignId: string,
  dispatchPlanId: string,
  payload: UpdateDispatchPlanPayload,
) {
  return request<DispatchPlanItem>(
    `/campaigns/${campaignId}/dispatch-plans/${dispatchPlanId}`,
    { method: 'PUT', body: JSON.stringify(payload) },
    token,
  );
}

export function cancelDispatchPlan(
  token: string,
  campaignId: string,
  dispatchPlanId: string,
  reason: string,
) {
  return request<DispatchPlanItem>(
    `/campaigns/${campaignId}/dispatch-plans/${dispatchPlanId}/cancel`,
    { method: 'POST', body: JSON.stringify({ reason }) },
    token,
  );
}

export function approveDispatchPlan(
  token: string,
  campaignId: string,
  dispatchPlanId: string,
) {
  return request<DispatchPlanItem>(
    `/campaigns/${campaignId}/dispatch-plans/${dispatchPlanId}/approve`,
    { method: 'POST' },
    token,
  );
}

export function rejectDispatchPlan(
  token: string,
  campaignId: string,
  dispatchPlanId: string,
  reason: string,
) {
  return request<DispatchPlanItem>(
    `/campaigns/${campaignId}/dispatch-plans/${dispatchPlanId}/reject`,
    { method: 'POST', body: JSON.stringify({ reason }) },
    token,
  );
}

export function validateDispatchPlan(
  token: string,
  campaignId: string,
  dispatchPlanId: string,
) {
  return request<DispatchPlanItem>(
    `/campaigns/${campaignId}/dispatch-plans/${dispatchPlanId}/validate`,
    { method: 'POST' },
    token,
  );
}

export function reopenDispatchPlan(
  token: string,
  campaignId: string,
  dispatchPlanId: string,
) {
  return request<DispatchPlanItem>(
    `/campaigns/${campaignId}/dispatch-plans/${dispatchPlanId}/reopen`,
    { method: 'POST' },
    token,
  );
}

export function simulateDispatchPlan(
  token: string,
  campaignId: string,
  dispatchPlanId: string,
  payload: SimulateDispatchPlanPayload = {},
) {
  return request<DispatchPlanItem>(
    `/campaigns/${campaignId}/dispatch-plans/${dispatchPlanId}/simulate`,
    { method: 'POST', body: JSON.stringify(payload) },
    token,
  );
}

export type DispatchPlanSnapshotSummary = {
  dispatchPlanId: string;
  version: number;
  snapshotCreatedAt: string;
  totalEvaluated: number;
  totalEligible: number;
  totalExcluded: number;
  byEligibilityStatus: Record<
    DispatchPlanRecipientEligibilityStatus,
    number
  >;
  regenerated: boolean;
};

export type DispatchPlanRecipientItem = {
  id: string;
  contactId: string;
  destination: string;
  normalizedDestination: string;
  eligibilityStatus: DispatchPlanRecipientEligibilityStatus;
  exclusionReason: string | null;
  contactSnapshot: {
    name: string | null;
    originalPhone: string | null;
    normalizedPhone: string | null;
    city: string | null;
    neighborhood: string | null;
    operationalStatus: string;
    source: string | null;
    tags: Array<{ id: string; name: string; color: string | null }>;
    assignedTo: { id: string; name: string } | null;
  };
  consentSnapshot: Record<string, unknown> | null;
  optOutSnapshot: Record<string, unknown> | null;
  createdAt: string;
};

export type DispatchPlanRecipientsResponse = {
  recipients: DispatchPlanRecipientItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  totals: {
    totalEvaluated: number;
    totalEligible: number;
    totalExcluded: number;
    byEligibilityStatus: Record<
      DispatchPlanRecipientEligibilityStatus,
      number
    >;
  };
  filters: {
    eligibilityStatus:
      | DispatchPlanRecipientEligibilityStatus
      | 'EXCLUDED'
      | null;
    search: string | null;
  };
};

export function generateDispatchPlanSnapshot(
  token: string,
  campaignId: string,
  dispatchPlanId: string,
) {
  return request<DispatchPlanSnapshotSummary>(
    `/campaigns/${campaignId}/dispatch-plans/${dispatchPlanId}/snapshot`,
    { method: 'POST' },
    token,
  );
}

export function fetchDispatchPlanRecipients(
  token: string,
  campaignId: string,
  dispatchPlanId: string,
  filters: {
    page?: number;
    limit?: number;
    eligibilityStatus?:
      | DispatchPlanRecipientEligibilityStatus
      | 'EXCLUDED';
    search?: string;
  } = {},
) {
  const params = new URLSearchParams();
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.eligibilityStatus) {
    params.set('eligibilityStatus', filters.eligibilityStatus);
  }
  if (filters.search?.trim()) params.set('search', filters.search.trim());
  const query = params.toString();

  return request<DispatchPlanRecipientsResponse>(
    `/campaigns/${campaignId}/dispatch-plans/${dispatchPlanId}/recipients${query ? `?${query}` : ''}`,
    {},
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

export type ContactTimelineActor = {
  id: string;
  name: string;
  email: string;
};

export type ContactTimelineItem = {
  id: string;
  type: string;
  title: string;
  description?: string;
  actor?: ContactTimelineActor;
  occurredAt: string;
  metadata?: Record<string, unknown>;
};

export function fetchContactTimeline(
  token: string,
  campaignId: string,
  contactId: string,
) {
  return request<ContactTimelineItem[]>(
    `/campaigns/${campaignId}/contacts/${contactId}/timeline`,
    {},
    token,
  );
}

export type ChannelAccountItem = {
  id: string;
  organizationId: string;
  campaignId: string;
  provider: string;
  name: string;
  status: string;
  externalAccountId: string | null;
  config?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export function fetchChannelAccounts(token: string, campaignId: string) {
  return request<ChannelAccountItem[]>(
    `/campaigns/${campaignId}/channel-accounts`,
    {},
    token,
  );
}

export function fetchChannelAccount(
  token: string,
  campaignId: string,
  channelAccountId: string,
) {
  return request<ChannelAccountItem>(
    `/campaigns/${campaignId}/channel-accounts/${channelAccountId}`,
    {},
    token,
  );
}

export function createChannelAccount(
  token: string,
  campaignId: string,
  payload: {
    name: string;
    provider?: string;
    status?: string;
    externalAccountId?: string;
    config?: Record<string, unknown>;
  },
) {
  return request<ChannelAccountItem>(
    `/campaigns/${campaignId}/channel-accounts`,
    { method: 'POST', body: JSON.stringify(payload) },
    token,
  );
}

export function updateChannelAccount(
  token: string,
  campaignId: string,
  channelAccountId: string,
  payload: {
    name?: string;
    provider?: string;
    status?: string;
    externalAccountId?: string | null;
    config?: Record<string, unknown> | null;
  },
) {
  return request<ChannelAccountItem>(
    `/campaigns/${campaignId}/channel-accounts/${channelAccountId}`,
    { method: 'PUT', body: JSON.stringify(payload) },
    token,
  );
}

export type EvolutionPrepareResponse = {
  channelAccount: ChannelAccountItem;
  evolution: {
    instanceName: string;
    created: boolean;
    state: string | null;
    qrcode: {
      base64: string | null;
      code: string | null;
      pairingCode: string | null;
    } | null;
  };
  webhook?: {
    synced: boolean;
    authMode: 'jwt' | 'none' | null;
    message: string | null;
  };
};

export type EvolutionStatusResponse = {
  channelAccount: ChannelAccountItem;
  evolution: {
    instanceName: string;
    state: string;
  };
};

export type EvolutionQrCodeResponse = {
  channelAccount: ChannelAccountItem;
  evolution: {
    instanceName: string;
    qrcode: {
      base64: string | null;
      code: string | null;
      pairingCode: string | null;
    };
  };
};

export function prepareChannelEvolution(
  token: string,
  campaignId: string,
  channelAccountId: string,
) {
  return request<EvolutionPrepareResponse>(
    `/campaigns/${campaignId}/channel-accounts/${channelAccountId}/evolution/prepare`,
    { method: 'POST' },
    token,
  );
}

export function fetchChannelEvolutionStatus(
  token: string,
  campaignId: string,
  channelAccountId: string,
) {
  return request<EvolutionStatusResponse>(
    `/campaigns/${campaignId}/channel-accounts/${channelAccountId}/evolution/status`,
    {},
    token,
  );
}

export function fetchChannelEvolutionQrCode(
  token: string,
  campaignId: string,
  channelAccountId: string,
) {
  return request<EvolutionQrCodeResponse>(
    `/campaigns/${campaignId}/channel-accounts/${channelAccountId}/evolution/qrcode`,
    {},
    token,
  );
}

export type InboxThreadListItem = {
  id: string;
  organizationId: string;
  campaignId: string;
  contactId: string;
  channelAccountId: string | null;
  channel: string;
  status: string;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  contact: {
    id: string;
    name: string | null;
    phoneNumber: string | null;
    status: string;
    optOutActive: boolean;
    optOutReason?: 'BLOCKED' | 'OPT_OUT' | null;
  };
  channelAccount: {
    id: string;
    name: string;
    provider: string;
    status: string;
  } | null;
  lastMessage: {
    id: string;
    body: string | null;
    direction: string;
    status: string;
    createdAt: string;
    optOutActive: boolean;
  } | null;
};

export type InboxThreadDetail = {
  id: string;
  organizationId: string;
  campaignId: string;
  contactId: string;
  channelAccountId: string | null;
  channel: string;
  status: string;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  contact: {
    id: string;
    name: string | null;
    phoneNumber: string | null;
    email: string | null;
    status: string;
    operationalStatus: string;
    optOutActive: boolean;
    optOutReason?: 'BLOCKED' | 'OPT_OUT' | null;
  };
  channelAccount: {
    id: string;
    name: string;
    provider: string;
    status: string;
  } | null;
  messages: Array<{
    id: string;
    direction: string;
    body: string | null;
    status: string;
    provider: string;
    externalMessageId: string | null;
    createdAt: string;
    optOutActive: boolean;
  }>;
};

export function fetchInboxThreads(token: string, campaignId: string) {
  return request<InboxThreadListItem[]>(
    `/campaigns/${campaignId}/inbox/threads`,
    {},
    token,
  );
}

export function fetchInboxThread(
  token: string,
  campaignId: string,
  threadId: string,
) {
  return request<InboxThreadDetail>(
    `/campaigns/${campaignId}/inbox/threads/${threadId}`,
    {},
    token,
  );
}

export type InboxReplyResponse = {
  message: {
    id: string;
    direction: string;
    body: string | null;
    status: string;
    provider: string;
    externalMessageId: string | null;
    createdAt: string;
    optOutActive: boolean;
  };
  thread: {
    id: string;
    lastMessageAt: string;
  };
};

export function sendInboxReply(
  token: string,
  campaignId: string,
  threadId: string,
  body: string,
) {
  return request<InboxReplyResponse>(
    `/campaigns/${campaignId}/inbox/threads/${threadId}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({ body }),
    },
    token,
  );
}

export function retryInboxMessage(
  token: string,
  campaignId: string,
  threadId: string,
  messageId: string,
) {
  return request<InboxReplyResponse>(
    `/campaigns/${campaignId}/inbox/threads/${threadId}/messages/${messageId}/retry`,
    { method: 'POST' },
    token,
  );
}
