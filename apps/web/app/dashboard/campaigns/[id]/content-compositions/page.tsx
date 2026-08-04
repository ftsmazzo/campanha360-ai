'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            : 'Nao foi possivel carregar mensagens',
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [campaignId, router]);

  async function handleCreateInvite() {
    if (!canWrite) return;
    const token = getStoredToken();
    if (!token) {
      router.replace('/login');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const created = await createContentComposition(token, campaignId, {
        preset: 'invite',
      });
      router.push(
        `/dashboard/campaigns/${campaignId}/content-compositions/${created.id}`,
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Nao foi possivel criar o convite inicial',
      );
      setSaving(false);
    }
  }

  return (
    <DashboardShell userName={user?.name}>
      <div>
        <CampaignNav campaignId={campaignId} campaignName={campaign?.name} />
        <div className="rounded-md border border-[#deddd4] bg-white p-6">
          <div>
            <h2 className="text-2xl font-semibold text-[#151515]">Mensagem</h2>
            <p className="mt-2 max-w-2xl text-sm text-[#65655f]">
              Crie um convite inicial com a IA, revise as variacoes e aprove. Sem
              aprovacao, nao ha envio.
            </p>
          </div>

          {loading ? (
            <p className="mt-6 text-sm text-[#65655f]">Carregando...</p>
          ) : null}
          {error ? (
            <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          {!loading && items.length === 0 && canWrite ? (
            <div className="mt-6 rounded-md border border-[#deddd4] bg-[#fafaf8] p-5">
              <h3 className="font-semibold text-[#151515]">Convite inicial</h3>
              <p className="mt-2 text-sm text-[#65655f]">
                Usa os dados do candidato, gera 3 a 5 variacoes (saudacao, corpo e
                fechamento) e voce revisa antes de aprovar. O tom e de convite para
                receber conteudos — nao de pedido de voto.
              </p>
              <button
                type="button"
                className="mt-4 rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                disabled={saving}
                onClick={() => void handleCreateInvite()}
              >
                {saving ? 'Criando...' : 'Criar convite inicial'}
              </button>
            </div>
          ) : null}

          {!loading && items.length === 0 && !canWrite ? (
            <p className="mt-6 text-sm text-[#65655f]">
              Nenhuma mensagem ainda. Voce nao tem permissao para criar.
            </p>
          ) : null}

          {items.length > 0 ? (
            <ul className="mt-6 space-y-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#deddd4] bg-white px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-[#151515]">{item.name}</p>
                    <p className="mt-1 text-xs text-[#65655f]">
                      {STATUS_LABELS[item.status] ?? item.status}
                      {(item.generationSets?.length ?? 0) > 0
                        ? ` · ${item.generationSets!.length} variacao(oes)`
                        : ''}
                    </p>
                  </div>
                  <Link
                    className="rounded-md bg-[#24382b] px-3 py-1.5 text-sm font-semibold text-white"
                    href={`/dashboard/campaigns/${campaignId}/content-compositions/${item.id}`}
                  >
                    {item.status === 'APPROVED' ? 'Abrir' : 'Continuar'}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}

          {canWrite && items.length > 0 ? (
            <button
              type="button"
              className="mt-4 rounded-md border border-[#c9c8c0] px-4 py-2 text-sm font-medium text-[#24382b] disabled:opacity-60"
              disabled={saving}
              onClick={() => void handleCreateInvite()}
            >
              {saving ? 'Criando...' : 'Novo convite inicial'}
            </button>
          ) : null}
        </div>
      </div>
    </DashboardShell>
  );
}
