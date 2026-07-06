const ACTIVE_ORG_KEY = 'campanha360_active_organization_id';

export function getActiveOrganizationId() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACTIVE_ORG_KEY);
}

export function setActiveOrganizationId(organizationId: string) {
  localStorage.setItem(ACTIVE_ORG_KEY, organizationId);
}

export function clearActiveOrganizationId() {
  localStorage.removeItem(ACTIVE_ORG_KEY);
}
