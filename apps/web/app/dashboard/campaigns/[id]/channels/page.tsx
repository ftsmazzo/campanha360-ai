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
  fetchChannelEvolutionQrCode,
  fetchChannelEvolutionStatus,
  fetchMe,
  getStoredToken,
  prepareChannelEvolution,
  updateChannelAccount,
} from '../../../../../lib/api';
import {
  CHANNEL_ACCOUNT_STATUSES,
  CHANNEL_PROVIDERS,
  configToText,
  getActiveWhatsappEvolutionAccount,
  getChannelAccountStatusLabel,
  getChannelProviderLabel,
  parseConfig,
  toQrCodeImageSrc,
} from '../../../../../lib/channels';
import { canWriteRole, getOrganizationRole } from '../../../../../lib/roles';

const DEFAULT_WHATSAPP_ACCOUNT_NAME = 'WhatsApp da campanha';

function formatDate(value: string) {
  return new Date(value).toLocaleString('pt-BR');
}

function isInstanceNotFoundMessage(message: string | null | undefined) {
  if (!message) return false;
  return /instancia evolution nao encontrada/i.test(message);
}

function upsertAccount(list: ChannelAccountItem[], account: ChannelAccountItem) {
  const exists = list.some((item) => item.id === account.id);
  const next = exists
    ? list.map((item) => (item.id === account.id ? { ...item, ...account } : item))
    : [...list, account];
  return next.sort((left, right) => left.name.localeCompare(right.name));
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [loadingQr, setLoadingQr] = useState(false);
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [evolutionState, setEvolutionState] = useState<string | null>(null);

  const canWrite = campaign
    ? canWriteRole(getOrganizationRole(user?.memberships, campaign.organizationId))
    : false;

  const whatsappAccount = getActiveWhatsappEvolutionAccount(accounts);
  const qrImageSrc = qrBase64 ? toQrCodeImageSrc(qrBase64) : null;

  function resetForm() {
    setName('');
    setProvider('WHATSAPP_EVOLUTION');
    setStatus('DISCONNECTED');
    setExternalAccountId('');
    setConfig('');
    setEditingAccountId(null);
  }

  function clearQrState() {
    setQrBase64(null);
    setPairingCode(null);
  }

  function applyAccountUpdate(account: ChannelAccountItem) {
    setAccounts((current) => upsertAccount(current, account));
    if (account.provider === 'WHATSAPP_EVOLUTION' && account.status === 'CONNECTED') {
      clearQrState();
    }
  }

  function handleInstanceMissingLocally() {
    if (!whatsappAccount) return;
    applyAccountUpdate({
      ...whatsappAccount,
      status: 'DISCONNECTED',
    });
    clearQrState();
    setEvolutionState(null);
  }

  async function startEdit(account: ChannelAccountItem) {
    const token = getStoredToken();
    if (!token || !canWrite) return;

    setShowAdvanced(true);
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

  async function handleConnectWhatsapp() {
    const token = getStoredToken();
    if (!token || !canWrite) return;

    setConnecting(true);
    setError(null);
    setSuccess(null);
    clearQrState();

    try {
      const created = await createChannelAccount(token, campaignId, {
        name: DEFAULT_WHATSAPP_ACCOUNT_NAME,
        provider: 'WHATSAPP_EVOLUTION',
        status: 'DISCONNECTED',
      });
      applyAccountUpdate(created);
      setSuccess('WhatsApp preparado para conexao. Clique em Preparar conexao para continuar.');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Nao foi possivel criar a conta WhatsApp da campanha',
      );
    } finally {
      setConnecting(false);
    }
  }

  async function handlePrepareConnection() {
    const token = getStoredToken();
    if (!token || !canWrite || !whatsappAccount) return;

    setPreparing(true);
    setError(null);
    setSuccess(null);
    clearQrState();

    try {
      const result = await prepareChannelEvolution(token, campaignId, whatsappAccount.id);
      applyAccountUpdate(result.channelAccount);
      setEvolutionState(result.evolution.state);

      const qr = result.evolution.qrcode;
      const hasQr = Boolean(qr?.base64 || qr?.pairingCode);

      if (result.channelAccount.status === 'CONNECTED') {
        clearQrState();
        setSuccess('WhatsApp conectado.');
      } else if (hasQr && qr) {
        setQrBase64(qr.base64);
        setPairingCode(qr.pairingCode);
        setSuccess(
          result.evolution.created
            ? 'Instancia criada. Escaneie o QR Code no WhatsApp do celular.'
            : 'QR Code disponivel. Escaneie no WhatsApp do celular.',
        );
      } else if (!result.evolution.created) {
        setSuccess(
          'A instancia ja existe, mas a Evolution nao retornou QR Code. Se necessario, reinicie a conexao.',
        );
      } else {
        setSuccess(
          'Instancia Evolution criada, mas a Evolution nao retornou QR Code neste momento. Tente Gerar QR Code.',
        );
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Nao foi possivel preparar a conexao com a Evolution',
      );
    } finally {
      setPreparing(false);
    }
  }

  async function handleRestartConnection() {
    const token = getStoredToken();
    if (!token || !canWrite || !whatsappAccount) return;

    setResetting(true);
    setError(null);
    setSuccess(null);
    clearQrState();
    setEvolutionState(null);

    try {
      const updated = await updateChannelAccount(token, campaignId, whatsappAccount.id, {
        externalAccountId: null,
        status: 'DISCONNECTED',
      });
      applyAccountUpdate(updated);
      setSuccess(
        'Conexao reiniciada localmente. Clique em Preparar conexao para criar a instancia novamente.',
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Nao foi possivel reiniciar a conexao local',
      );
    } finally {
      setResetting(false);
    }
  }

  async function handleGenerateQrCode() {
    const token = getStoredToken();
    if (!token || !canWrite || !whatsappAccount) return;

    setLoadingQr(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await fetchChannelEvolutionQrCode(token, campaignId, whatsappAccount.id);
      applyAccountUpdate(result.channelAccount);
      setQrBase64(result.evolution.qrcode.base64);
      setPairingCode(result.evolution.qrcode.pairingCode);

      if (result.channelAccount.status === 'CONNECTED') {
        clearQrState();
        setSuccess('WhatsApp conectado.');
      } else if (
        !result.evolution.qrcode.base64 &&
        !result.evolution.qrcode.pairingCode
      ) {
        setSuccess('Solicitacao enviada, mas a Evolution nao retornou QR Code neste momento.');
      } else {
        setSuccess('QR Code gerado. Escaneie no WhatsApp do celular.');
      }
    } catch (err) {
      clearQrState();
      const message =
        err instanceof ApiError
          ? err.message
          : 'Nao foi possivel gerar o QR Code na Evolution';
      setError(message);
      if (isInstanceNotFoundMessage(message)) {
        handleInstanceMissingLocally();
      }
    } finally {
      setLoadingQr(false);
    }
  }

  async function handleRefreshStatus() {
    const token = getStoredToken();
    if (!token || !canWrite || !whatsappAccount) return;

    setRefreshingStatus(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await fetchChannelEvolutionStatus(token, campaignId, whatsappAccount.id);
      applyAccountUpdate(result.channelAccount);
      setEvolutionState(result.evolution.state);
      if (result.channelAccount.status === 'CONNECTED') {
        clearQrState();
        setSuccess('WhatsApp conectado.');
      } else {
        setSuccess(
          `Status atualizado: ${getChannelAccountStatusLabel(result.channelAccount.status)}.`,
        );
      }
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Nao foi possivel consultar o status na Evolution';
      setError(message);
      if (isInstanceNotFoundMessage(message)) {
        handleInstanceMissingLocally();
      }
    } finally {
      setRefreshingStatus(false);
    }
  }

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
        applyAccountUpdate(updated);
        setSuccess('Conta de canal atualizada com sucesso.');
      } else {
        const created = await createChannelAccount(token, campaignId, payload);
        applyAccountUpdate(created);
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

  const instanceNotFound = isInstanceNotFoundMessage(error);
  const isConnected = whatsappAccount?.status === 'CONNECTED';
  const canShowQrPanel =
    Boolean(whatsappAccount) &&
    ['CONNECTING', 'DISCONNECTED', 'ERROR'].includes(whatsappAccount?.status ?? '');
  const shortPairingCode =
    pairingCode && pairingCode.trim().length > 0 && pairingCode.trim().length <= 16
      ? pairingCode.trim()
      : null;
  const showPrepare =
    Boolean(whatsappAccount) &&
    !isConnected &&
    (whatsappAccount?.status === 'DISCONNECTED' ||
      whatsappAccount?.status === 'ERROR' ||
      instanceNotFound);
  const showQrButton =
    Boolean(whatsappAccount) &&
    !instanceNotFound &&
    !isConnected &&
    (whatsappAccount?.status === 'CONNECTING' ||
      whatsappAccount?.status === 'DISCONNECTED' ||
      whatsappAccount?.status === 'ERROR');
  const prepareLabel = instanceNotFound ? 'Preparar conexao novamente' : 'Preparar conexao';

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
            Conecte o WhatsApp da campanha de forma simples, sem configurar detalhes tecnicos.
          </p>
        </div>

        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="rounded-md border border-[#d7e5d8] bg-[#eef2ea] px-3 py-2 text-sm text-[#47624f]">
            {success}
          </p>
        ) : null}

        <section className="space-y-4 rounded-md border border-[#deddd4] bg-white p-4">
          <div>
            <h3 className="font-medium text-[#24382b]">WhatsApp</h3>
            <p className="mt-1 text-sm text-[#65655f]">
              Fluxo principal para conectar o WhatsApp via Evolution.
            </p>
          </div>

          {!whatsappAccount ? (
            <div className="space-y-3">
              <p className="text-sm text-[#65655f]">
                Nenhum WhatsApp ativo nesta campanha.
              </p>
              {canWrite ? (
                <button
                  className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  type="button"
                  disabled={connecting}
                  onClick={handleConnectWhatsapp}
                >
                  {connecting ? 'Criando...' : 'Conectar WhatsApp'}
                </button>
              ) : (
                <p className="text-sm text-[#65655f]">
                  Seu perfil possui acesso somente leitura.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border border-[#eef2ea] bg-[#f7f7f5] px-3 py-3">
                <p className="font-medium text-[#24382b]">{whatsappAccount.name}</p>
                <p className="mt-1 text-sm text-[#65655f]">
                  Status: {getChannelAccountStatusLabel(whatsappAccount.status)}
                </p>
                {evolutionState ? (
                  <p className="mt-1 text-xs text-[#65655f]">
                    Estado Evolution: {evolutionState}
                  </p>
                ) : null}
                {whatsappAccount.externalAccountId ? (
                  <p className="mt-1 text-xs text-[#65655f]">
                    Instancia: {whatsappAccount.externalAccountId}
                  </p>
                ) : null}
              </div>

              {isConnected ? (
                <p className="rounded-md border border-[#d7e5d8] bg-[#eef2ea] px-3 py-2 text-sm font-medium text-[#47624f]">
                  WhatsApp conectado.
                </p>
              ) : null}

              {instanceNotFound ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  A instancia nao foi encontrada na Evolution. Prepare a conexao novamente.
                </p>
              ) : null}

              {canWrite ? (
                <div className="flex flex-wrap gap-2">
                  {showPrepare ? (
                    <button
                      className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                      type="button"
                      disabled={preparing}
                      onClick={handlePrepareConnection}
                    >
                      {preparing ? 'Preparando...' : prepareLabel}
                    </button>
                  ) : null}
                  {showQrButton ? (
                    <button
                      className="rounded-md border border-[#24382b] px-4 py-2 text-sm font-semibold text-[#24382b] disabled:opacity-60"
                      type="button"
                      disabled={loadingQr}
                      onClick={handleGenerateQrCode}
                    >
                      {loadingQr ? 'Gerando QR...' : 'Gerar QR Code'}
                    </button>
                  ) : null}
                  <button
                    className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm font-medium text-[#24382b] disabled:opacity-60"
                    type="button"
                    disabled={refreshingStatus}
                    onClick={handleRefreshStatus}
                  >
                    {refreshingStatus ? 'Atualizando...' : 'Atualizar status'}
                  </button>
                  <button
                    className="rounded-md border border-amber-700 px-4 py-2 text-sm font-medium text-amber-900 disabled:opacity-60"
                    type="button"
                    disabled={resetting}
                    onClick={handleRestartConnection}
                  >
                    {resetting ? 'Reiniciando...' : 'Reiniciar conexao'}
                  </button>
                </div>
              ) : (
                <p className="text-sm text-[#65655f]">
                  Visualizacao somente leitura. Acoes de conexao exigem OWNER, ADMIN ou MANAGER.
                </p>
              )}

              {canShowQrPanel && (qrImageSrc || shortPairingCode) ? (
                <div className="space-y-3 rounded-md border border-[#eef2ea] bg-[#f7f7f5] p-4">
                  <h4 className="text-sm font-medium text-[#24382b]">Conexao WhatsApp</h4>
                  {qrImageSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={qrImageSrc}
                      alt="QR Code WhatsApp"
                      className="mx-auto h-56 w-56 rounded-md border border-[#deddd4] bg-white p-2"
                    />
                  ) : null}
                  {shortPairingCode ? (
                    <p className="text-sm text-[#34342f]">
                      Pairing code: <span className="font-mono">{shortPairingCode}</span>
                    </p>
                  ) : null}
                  <p className="text-xs text-[#65655f]">
                    Abra o WhatsApp no celular, va em Aparelhos conectados e escaneie o QR Code.
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </section>

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
                      Editar avancado
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-4 rounded-md border border-dashed border-[#c9c8c0] bg-[#fafaf8] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-medium text-[#65655f]">Configuracoes avancadas</h3>
              <p className="mt-1 text-sm text-[#65655f]">
                Area tecnica para provider, status, ID externo e config JSON. Nao e o fluxo normal de
                conexao do WhatsApp.
              </p>
            </div>
            <button
              className="rounded-md border border-[#c9c8c0] px-3 py-1.5 text-sm font-medium text-[#24382b]"
              type="button"
              onClick={() => setShowAdvanced((current) => !current)}
            >
              {showAdvanced ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>

          {showAdvanced ? (
            canWrite ? (
              <form className="space-y-4 rounded-md border border-[#deddd4] bg-white p-4" onSubmit={handleSubmit}>
                <h4 className="font-medium text-[#24382b]">
                  {editingAccountId ? 'Editar conta de canal' : 'Nova conta de canal'}
                </h4>
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
                    placeholder={'{\n  "instanceName": "minha-instancia"\n}'}
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
              <p className="text-sm text-[#65655f]">
                Seu perfil possui acesso somente leitura. Configuracoes avancadas nao podem ser
                editadas.
              </p>
            )
          ) : null}
        </section>
      </div>
    </DashboardShell>
  );
}
