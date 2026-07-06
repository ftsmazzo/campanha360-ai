const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

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

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      typeof data.message === 'string'
        ? data.message
        : Array.isArray(data.message)
          ? data.message.join(', ')
          : 'Erro na requisicao';
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
