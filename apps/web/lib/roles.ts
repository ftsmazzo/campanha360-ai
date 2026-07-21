const WRITE_ROLES = new Set(['OWNER', 'ADMIN', 'MANAGER']);
const APPROVE_ROLES = new Set(['OWNER', 'ADMIN']);

export function canWriteRole(role?: string | null) {
  return role ? WRITE_ROLES.has(role) : false;
}

export function canApproveRole(role?: string | null) {
  return role ? APPROVE_ROLES.has(role) : false;
}

export function getOrganizationRole(
  memberships: Array<{ role: string; organization: { id: string } }> | undefined,
  organizationId: string,
) {
  return memberships?.find((item) => item.organization.id === organizationId)?.role ?? null;
}
