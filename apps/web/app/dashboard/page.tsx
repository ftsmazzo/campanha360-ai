'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DashboardShell } from '../../components/dashboard-shell';
import {
  OrganizationSelector,
  resolveActiveOrganizationId,
} from '../../components/organization-selector';
import {
  ApiError,
  AuthUser,
  OrganizationItem,
  clearStoredToken,
  createOrganization,
  fetchMe,
  fetchOrganizations,
  getStoredToken,
} from '../../lib/api';
import { setActiveOrganizationId } from '../../lib/organization';

const plannedModules = ['Eleitores', 'Segmentos', 'Inbox', 'Canais', 'IA', 'Compliance'];

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationItem[]>([]);
  const [activeOrganizationId, setActiveOrganizationIdState] = useState<string | null>(null);
  const [orgName, setOrgName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    async function load() {
      const token = getStoredToken();
      if (!token) {
        router.replace('/login');
        return;
      }

      try {
        const [me, orgs] = await Promise.all([fetchMe(token), fetchOrganizations(token)]);
        setUser(me);
        setOrganizations(orgs);
        const activeId = resolveActiveOrganizationId(orgs);
        setActiveOrganizationIdState(activeId);
        if (activeId) setActiveOrganizationId(activeId);
      } catch {
        clearStoredToken();
        router.replace('/login');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [router]);

  async function handleCreateOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getStoredToken();
    if (!token) {
      router.replace('/login');
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const result = await createOrganization(token, { name: orgName });
      const orgs = await fetchOrganizations(token);
      setOrganizations(orgs);
      setActiveOrganizationIdState(result.organization.id);
      setActiveOrganizationId(result.organization.id);
      setOrgName('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel criar a organizacao');
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f7f5]">
        <p className="text-[#65655f]">Carregando painel...</p>
      </main>
    );
  }

  return (
    <DashboardShell userName={user?.name}>
      <div className="flex flex-col gap-8 lg:flex-row">
        <div className="flex-1">
          <h2 className="text-2xl font-semibold text-[#151515]">Organizacoes</h2>
          <p className="mt-2 text-sm text-[#65655f]">
            Selecione a organizacao ativa para operar campanhas e candidatos.
          </p>

          <div className="mt-6">
            <OrganizationSelector
              organizations={organizations}
              activeOrganizationId={activeOrganizationId}
              onChange={setActiveOrganizationIdState}
            />
          </div>

          {activeOrganizationId ? (
            <div className="mt-4">
              <Link
                className="inline-flex rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white"
                href="/dashboard/campaigns"
              >
                Gerenciar campanhas
              </Link>
            </div>
          ) : null}

          <form className="mt-6 rounded-md border border-[#deddd4] bg-white p-4" onSubmit={handleCreateOrganization}>
            <h3 className="font-medium text-[#24382b]">Nova organizacao</h3>
            <label className="mt-3 block">
              <span className="text-sm font-medium text-[#34342f]">Nome</span>
              <input
                className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                value={orgName}
                onChange={(event) => setOrgName(event.target.value)}
                minLength={2}
                required
              />
            </label>
            {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
            <button
              className="mt-4 rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              type="submit"
              disabled={creating}
            >
              {creating ? 'Criando...' : 'Criar organizacao'}
            </button>
          </form>

          <div className="mt-6 space-y-3">
            {organizations.map((item) => (
              <article
                key={item.membershipId}
                className={`rounded-md border bg-white p-4 ${
                  item.organization.id === activeOrganizationId
                    ? 'border-[#47624f]'
                    : 'border-[#deddd4]'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-medium text-[#151515]">{item.organization.name}</h3>
                    <p className="mt-1 text-sm text-[#65655f]">/{item.organization.slug}</p>
                  </div>
                  <span className="rounded-full bg-[#eef2ea] px-3 py-1 text-xs font-semibold uppercase text-[#47624f]">
                    {item.role}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <aside className="lg:w-80">
          <h2 className="text-lg font-semibold text-[#151515]">Proximos modulos</h2>
          <div className="mt-4 space-y-3">
            {plannedModules.map((item) => (
              <div key={item} className="rounded-md border border-[#deddd4] bg-white p-4">
                <p className="font-medium text-[#24382b]">{item}</p>
                <p className="mt-2 text-sm text-[#65655f]">Planejado para as proximas fases.</p>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </DashboardShell>
  );
}
