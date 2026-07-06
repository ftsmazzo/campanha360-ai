function getApiUrl() {
  if (typeof window !== 'undefined') {
    return '/api';
  }

  return (
    process.env.API_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
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
