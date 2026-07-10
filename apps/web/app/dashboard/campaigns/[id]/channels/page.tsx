'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DashboardShell } from '../../../../../components/dashboard-shell';
import {
  ApiError,
  AuthUser,
  CampaignItem,
  ChannelAccountItem,
  clearStoredToken,
  createChannelAccount,
  fetchCampaign,
  fetchChannelAccount,
  fetchChannelAccounts,
  fetchMe,
  getStoredToken,
  updateChannelAccount,
} from '../../../../../lib/api';
import {
  CHANNEL_ACCOUNT_STATUSES,
  CHANNEL_PROVIDERS,
  configToText,
  getChannelAccountStatusLabel,
  getChannelProviderLabel,
  parseConfig,
} from '../../../../../lib/channels';
import { canWriteRole, getOrganizationRole } from '../../../../../lib/roles';

function formatDate(value: string) {
  return new Date(value).toLocaleString('pt-BR');
}

export default function CampaignChannelsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const campaignId = params.id;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [campaign, setCampaign] = useState<CampaignItem | null>(null);
  const [accounts, setAccounts] = useState<ChannelAccountItem[]>([]);
  const [name, setName] = useState('');
  const [provider, setProvider] = useState('WHATSAPP_EVOLUTION');
  const [status, setStatus] = useState('DISCONNECTED');
  const [externalAccountId, setExternalAccountId] = useState('');
  const [config, setConfig] = useState('');
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canWrite = campaign
    ? canWriteRole(getOrganizationRole(user?.memberships, campaign.organizationId))
    : false;

  function resetForm() {
    setName('');
    setProvider('WHATSAPP_EVOLUTION');
    setStatus('DISCONNECTED');
    setExternalAccountId('');
    setConfig('');
    setEditingAccountId(null);
  }

  async function startEdit(account: ChannelAccountItem) {
    const token = getStoredToken();
    if (!token || !canWrite) return;

    setEditingAccountId(account.id);
    setName(account.name);
    setProvider(account.provider);
    setStatus(account.status);
    setExternalAccountId(account.externalAccountId ?? '');
    setConfig('');
    setError(null);
    setSuccess(null);

    try {
      const full = await fetchChannelAccount(token, campaignId, account.id);
      setConfig(configToText(full.config ?? null));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Nao foi possivel carregar a config da conta de canal',
      );
    }
  }

  useEffect(() => {
    async function load() {
      const token = getStoredToken();
      if (!token) {
        router.replace('/login');
        return;
      }

      try {
        const [me, campaignItem, accountItems] = await Promise.all([
          fetchMe(token),
          fetchCampaign(token, campaignId),
          fetchChannelAccounts(token, campaignId),
        ]);
        setUser(me);
        setCampaign(campaignItem);
        setAccounts(accountItems);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearStoredToken();
          router.replace('/login');
          return;
        }
        setError(
          err instanceof ApiError ? err.message : 'Nao foi possivel carregar contas de canal',
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [campaignId, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getStoredToken();
    if (!token || !canWrite) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      let configValue: Record<string, unknown> | undefined;
      try {
        configValue = parseConfig(config);
      } catch {
        throw new ApiError('Config deve ser um JSON valido', 400);
      }

      const payload = {
        name,
        provider,
        status,
        externalAccountId: externalAccountId.trim() || undefined,
        config: configValue,
      };

      if (editingAccountId) {
        const updated = await updateChannelAccount(token, campaignId, editingAccountId, {
          ...payload,
          externalAccountId: externalAccountId.trim() || null,
          config: configValue ?? null,
        });
        setAccounts((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
        setSuccess('Conta de canal atualizada com sucesso.');
      } else {
        const created = await createChannelAccount(token, campaignId, payload);
        setAccounts((current) =>
          [...current, created].sort((left, right) => left.name.localeCompare(right.name)),
        );
        setSuccess('Conta de canal criada com sucesso.');
      }
      resetForm();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel salvar a conta de canal');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f7f5]">
        <p className="text-[#65655f]">Carregando canais...</p>
      </main>
    );
  }

  return (
    <DashboardShell userName={user?.name}>
      <div className="max-w-3xl space-y-6">
        <Link className="text-sm text-[#24382b] underline" href={`/dashboard/campaigns/${campaignId}`}>
          Voltar para campanha
        </Link>

        <div>
          <h2 className="text-2xl font-semibold text-[#151515]">Canais da campanha</h2>
          {campaign ? <p className="mt-2 text-sm text-[#65655f]">{campaign.name}</p> : null}
          <p className="mt-2 text-sm text-[#65655f]">
            Cadastre contas de canal para futura integracao com provedores externos.
          </p>
        </div>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {success ? <p className="text-sm text-[#47624f]">{success}</p> : null}

        {canWrite ? (
          <form className="space-y-4 rounded-md border border-[#deddd4] bg-white p-4" onSubmit={handleSubmit}>
            <h3 className="font-medium text-[#24382b]">
              {editingAccountId ? 'Editar conta de canal' : 'Nova conta de canal'}
            </h3>
            <label className="block">
              <span className="text-sm font-medium text-[#34342f]">Nome</span>
              <input
                className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                minLength={2}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-[#34342f]">Provider</span>
              <select
                className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
              >
                {CHANNEL_PROVIDERS.map((item) => (
                  <option key={item.value} value={item.value} disabled={!item.available}>
                    {item.label}
                    {!item.available ? ' (em breve)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-[#34342f]">Status</span>
              <select
                className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                {CHANNEL_ACCOUNT_STATUSES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-[#34342f]">ID externo (opcional)</span>
              <input
                className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                value={externalAccountId}
                onChange={(event) => setExternalAccountId(event.target.value)}
                placeholder="Ex.: nome da instancia Evolution"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-[#34342f]">Config JSON (opcional)</span>
              <textarea
                className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2 font-mono text-sm"
                rows={5}
                value={config}
                onChange={(event) => setConfig(event.target.value)}
                placeholder={'{\n  "baseUrl": "https://..."\n}'}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                type="submit"
                disabled={saving}
              >
                {saving
                  ? 'Salvando...'
                  : editingAccountId
                    ? 'Salvar conta'
                    : 'Criar conta'}
              </button>
              {editingAccountId ? (
                <button
                  className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm font-medium text-[#24382b]"
                  type="button"
                  onClick={resetForm}
                >
                  Cancelar edicao
                </button>
              ) : null}
            </div>
          </form>
        ) : (
          <p className="rounded-md border border-[#deddd4] bg-white p-4 text-sm text-[#65655f]">
            Seu perfil possui acesso somente leitura. Contas de canal podem ser visualizadas, mas nao
            editadas.
          </p>
        )}

        <section className="space-y-3 rounded-md border border-[#deddd4] bg-white p-4">
          <h3 className="font-medium text-[#24382b]">Contas cadastradas</h3>
          {accounts.length === 0 ? (
            <p className="text-sm text-[#65655f]">Nenhuma conta de canal cadastrada nesta campanha.</p>
          ) : (
            <ul className="space-y-3">
              {accounts.map((account) => (
                <li
                  key={account.id}
                  className="flex flex-col gap-3 rounded-md border border-[#eef2ea] bg-[#f7f7f5] p-3 md:flex-row md:items-start md:justify-between"
                >
                  <div>
                    <p className="font-medium text-[#24382b]">{account.name}</p>
                    <p className="mt-1 text-sm text-[#65655f]">
                      {getChannelProviderLabel(account.provider)} ·{' '}
                      {getChannelAccountStatusLabel(account.status)}
                    </p>
                    {account.externalAccountId ? (
                      <p className="mt-1 text-sm text-[#65655f]">
                        ID externo: {account.externalAccountId}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-[#65655f]">
                      Criada em {formatDate(account.createdAt)}
                    </p>
                  </div>
                  {canWrite ? (
                    <button
                      className="self-start text-sm font-medium text-[#24382b] underline"
                      type="button"
                      onClick={() => startEdit(account)}
                    >
                      Editar
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
