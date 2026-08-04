'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CampaignNav } from '../../../../../components/campaign-nav';
import { DashboardShell } from '../../../../../components/dashboard-shell';
import {
  ApiError,
  AuthUser,
  CampaignItem,
  ContentCompositionItem,
  clearStoredToken,
  createContentComposition,
  fetchCampaign,
  fetchContentCompositions,
  fetchMe,
  getStoredToken,
} from '../../../../../lib/api';
import { canWriteRole, getOrganizationRole } from '../../../../../lib/roles';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  READY_FOR_REVIEW: 'Pronto para revisao',
  APPROVED: 'Aprovado',
  ARCHIVED: 'Arquivado',
};

export default function ContentCompositionsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const campaignId = params.id;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [campaign, setCampaign] = useState<CampaignItem | null>(null);
  const [items, setItems] = useState<ContentCompositionItem[]>([]);
  const [name, setName] = useState('');
  const [baseBody, setBaseBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canWrite = campaign
    ? canWriteRole(getOrganizationRole(user?.memberships, campaign.organizationId))
    : false;

  useEffect(() => {
    async function load() {
      const token = getStoredToken();
      if (!token) {
        router.replace('/login');
        return;
      }

      try {
        const [me, campaignItem, compositions] = await Promise.all([
          fetchMe(token),
          fetchCampaign(token, campaignId),
          fetchContentCompositions(token, campaignId),
        ]);
        setUser(me);
        setCampaign(campaignItem);
        setItems(compositions);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearStoredToken();
          router.replace('/login');
          return;
        }
        setError(
          err instanceof ApiError
            ? err.message
            : 'Nao foi possivel carregar composicoes',
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [campaignId, router]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!canWrite) return;
    const token = getStoredToken();
    if (!token) {
      router.replace('/login');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const created = await createContentComposition(token, campaignId, {
        name: name.trim(),
        baseBody: baseBody.trim(),
      });
      setItems((current) => [created, ...current]);
      setName('');
      setBaseBody('');
      setSuccess('Composicao criada.');
      router.push(
        `/dashboard/campaigns/${campaignId}/content-compositions/${created.id}`,
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Nao foi possivel criar a composicao',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <DashboardShell userName={user?.name}>
      <div>
        <CampaignNav campaignId={campaignId} campaignName={campaign?.name} />
        <div className="rounded-md border border-[#deddd4] bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-[#151515]">Mensagem</h2>
            <p className="mt-2 max-w-2xl text-sm text-[#65655f]">
              Prepare o texto, revise e aprove. Sem aprovacao, nao ha envio.
            </p>
          </div>
        </div>

        {loading ? (
          <p className="mt-6 text-sm text-[#65655f]">Carregando...</p>
        ) : null}
        {error ? (
          <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="mt-6 rounded-md border border-[#c9d9c4] bg-[#eef5ea] px-3 py-2 text-sm text-[#47624f]">
            {success}
          </p>
        ) : null}

        {canWrite ? (
          <form
            className="mt-6 space-y-3 rounded-md border border-[#deddd4] bg-white p-4"
            onSubmit={handleCreate}
          >
            <h3 className="font-semibold text-[#151515]">Nova composicao</h3>
            <label className="block text-sm text-[#24382b]">
              Nome
              <input
                className="mt-1 w-full rounded-md border border-[#c9c8c0] bg-white px-3 py-2"
                value={name}
                onChange={(event) => setName(event.target.value)}
                minLength={2}
                maxLength={120}
                required
              />
            </label>
            <label className="block text-sm text-[#24382b]">
              Mensagem-base
              <textarea
                className="mt-1 w-full rounded-md border border-[#c9c8c0] bg-white px-3 py-2"
                value={baseBody}
                onChange={(event) => setBaseBody(event.target.value)}
                minLength={1}
                maxLength={3500}
                rows={4}
                required
              />
            </label>
            <button
              className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              type="submit"
              disabled={saving}
            >
              {saving ? 'Criando...' : 'Criar e abrir editor'}
            </button>
          </form>
        ) : null}

        <ul className="mt-6 space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#deddd4] bg-white px-4 py-3"
            >
              <div>
                <p className="font-medium text-[#151515]">{item.name}</p>
                <p className="mt-1 text-xs text-[#65655f]">
                  {STATUS_LABELS[item.status] ?? item.status} · v{item.version} ·{' '}
                  {item.counts.BODY} corpos · {item.counts.GREETING} saudacoes ·{' '}
                  {item.counts.CLOSING} fechamentos
                </p>
              </div>
              <Link
                className="rounded-md border border-[#c9c8c0] px-3 py-1.5 text-sm font-medium text-[#24382b]"
                href={`/dashboard/campaigns/${campaignId}/content-compositions/${item.id}`}
              >
                Abrir editor
              </Link>
            </li>
          ))}
          {!loading && items.length === 0 ? (
            <li className="text-sm text-[#65655f]">
              Nenhuma composicao ainda.
            </li>
          ) : null}
        </ul>
        </div>
      </div>
    </DashboardShell>
  );
}
