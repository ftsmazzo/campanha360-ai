'use client';

import { OrganizationItem } from '../lib/api';
import { getActiveOrganizationId, setActiveOrganizationId } from '../lib/organization';

type OrganizationSelectorProps = {
  organizations: OrganizationItem[];
  activeOrganizationId: string | null;
  onChange: (organizationId: string) => void;
};

export function OrganizationSelector({
  organizations,
  activeOrganizationId,
  onChange,
}: OrganizationSelectorProps) {
  if (organizations.length === 0) {
    return (
      <p className="text-sm text-[#65655f]">
        Crie uma organizacao antes de gerenciar campanhas.
      </p>
    );
  }

  return (
    <label className="block max-w-md">
      <span className="text-sm font-medium text-[#34342f]">Organizacao ativa</span>
      <select
        className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
        value={activeOrganizationId ?? ''}
        onChange={(event) => {
          const organizationId = event.target.value;
          setActiveOrganizationId(organizationId);
          onChange(organizationId);
        }}
      >
        <option value="" disabled>
          Selecione uma organizacao
        </option>
        {organizations.map((item) => (
          <option key={item.organization.id} value={item.organization.id}>
            {item.organization.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function resolveActiveOrganizationId(organizations: OrganizationItem[]) {
  const stored = getActiveOrganizationId();
  if (stored && organizations.some((item) => item.organization.id === stored)) {
    return stored;
  }
  return organizations[0]?.organization.id ?? null;
}
