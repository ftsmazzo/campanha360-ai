'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
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
  buildEvolutionWebhookUrl,
  configToText,
  getChannelAccountStatusLabel,
  listVisibleWhatsappEvolutionAccounts,
  parseConfig,
  toQrCodeImageSrc,
} from '../../../../../lib/channels';
import { canWriteRole, getOrganizationRole } from '../../../../../lib/roles';

type CardUiState = {
  preparing: boolean;
  loadingQr: boolean;
  refreshing: boolean;
  resetting: boolean;
  archiving: boolean;
  savingAdvanced: boolean;
  showAdvanced: boolean;
  qrBase64: string | null;
  message: string | null;
  error: string | null;
  evolutionState: string | null;
  advancedName: string;
  advancedExternalId: string;
  advancedConfig: string;
  webhookCopied: boolean;
};

const emptyCardState = (): CardUiState => ({
  preparing: false,
  loadingQr: false,
  refreshing: false,
  resetting: false,
  archiving: false,
  savingAdvanced: false,
  showAdvanced: false,
  qrBase64: null,
  message: null,
  error: null,
  evolutionState: null,
  advancedName: '',
  advancedExternalId: '',
  advancedConfig: '',
  webhookCopied: false,
});

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
  const [cardUi, setCardUi] = useState<Record<string, CardUiState>>({});
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createInstanceName, setCreateInstanceName] = useState('');
  const [creating, setCreating] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageSuccess, setPageSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const canWrite = campaign
    ? canWriteRole(getOrganizationRole(user?.memberships, campaign.organizationId))
    : false;

  const visibleAccounts = useMemo(
    () => listVisibleWhatsappEvolutionAccounts(accounts),
    [accounts],
  );

  function getCardState(accountId: string): CardUiState {
    return cardUi[accountId] ?? emptyCardState();
  }

  function patchCardState(accountId: string, patch: Partial<CardUiState>) {
    setCardUi((current) => ({
      ...current,
      [accountId]: {
        ...(current[accountId] ?? emptyCardState()),
        ...patch,
      },
    }));
  }

  function applyAccountUpdate(account: ChannelAccountItem) {
    setAccounts((current) => upsertAccount(current, account));
    if (account.provider === 'WHATSAPP_EVOLUTION' && account.status === 'CONNECTED') {
      patchCardState(account.id, { qrBase64: null });
    }
  }

  async function handleCopyWebhookUrl(accountId: string) {
    const url = buildEvolutionWebhookUrl(accountId);
    try {
      await navigator.clipboard.writeText(url);
      patchCardState(accountId, { webhookCopied: true });
      window.setTimeout(() => {
        patchCardState(accountId, { webhookCopied: false });
      }, 2000);
    } catch {
      patchCardState(accountId, {
        error: 'Nao foi possivel copiar a URL do webhook',
      });
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
        setPageError(
          err instanceof ApiError ? err.message : 'Nao foi possivel carregar canais',
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [campaignId, router]);

  function applyPrepareResult(
    accountId: string,
    result: Awaited<ReturnType<typeof prepareChannelEvolution>>,
  ) {
    applyAccountUpdate(result.channelAccount);

    const qr = result.evolution.qrcode;
    const hasQr = Boolean(qr?.base64);

    if (result.channelAccount.status === 'CONNECTED') {
      patchCardState(accountId, {
        qrBase64: null,
        evolutionState: result.evolution.state,
        message: 'WhatsApp conectado.',
        error: null,
      });
      return;
    }

    if (hasQr && qr?.base64) {
      patchCardState(accountId, {
        qrBase64: qr.base64,
        evolutionState: result.evolution.state,
        message: result.evolution.created
          ? 'Instancia criada. Escaneie o QR Code no WhatsApp do celular.'
          : 'QR Code disponivel. Escaneie no WhatsApp do celular.',
        error: null,
      });
      return;
    }

    if (!result.evolution.created) {
      patchCardState(accountId, {
        evolutionState: result.evolution.state,
        message:
          'A instancia ja existe, mas a Evolution nao retornou QR Code. Se necessario, reinicie a conexao.',
        error: null,
      });
      return;
    }

    patchCardState(accountId, {
      evolutionState: result.evolution.state,
      message:
        'Instancia criada, mas a Evolution nao retornou QR Code neste momento. Use Gerar QR Code.',
      error: null,
    });
  }

  async function handleCreateChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getStoredToken();
    if (!token || !canWrite || !createName.trim()) return;

    setCreating(true);
    setPageError(null);
    setPageSuccess(null);

    let created: ChannelAccountItem | null = null;

    try {
      created = await createChannelAccount(token, campaignId, {
        name: createName.trim(),
        provider: 'WHATSAPP_EVOLUTION',
        status: 'DISCONNECTED',
        externalAccountId: createInstanceName.trim() || undefined,
      });
      applyAccountUpdate(created);
      setCreateName('');
      setCreateInstanceName('');
      setShowCreateForm(false);
      patchCardState(created.id, {
        preparing: true,
        error: null,
        message: 'Canal criado. Preparando conexao Evolution...',
        qrBase64: null,
      });

      try {
        const prepared = await prepareChannelEvolution(token, campaignId, created.id);
        applyPrepareResult(created.id, prepared);
        setPageSuccess(`Canal "${created.name}" criado e preparado.`);
      } catch (prepareError) {
        const message =
          prepareError instanceof ApiError
            ? prepareError.message
            : 'Canal criado, mas a conexao Evolution nao foi preparada.';
        patchCardState(created.id, {
          error: `${message} Use Preparar conexao no card para tentar novamente.`,
          message: null,
          qrBase64: null,
        });
        setPageSuccess(
          `Canal "${created.name}" criado. A preparacao da conexao falhou — tente Preparar conexao no card.`,
        );
      } finally {
        patchCardState(created.id, { preparing: false });
      }
    } catch (err) {
      setPageError(
        err instanceof ApiError ? err.message : 'Nao foi possivel criar o canal WhatsApp',
      );
    } finally {
      setCreating(false);
    }
  }

  async function handlePrepare(account: ChannelAccountItem) {
    const token = getStoredToken();
    if (!token || !canWrite) return;

    patchCardState(account.id, {
      preparing: true,
      error: null,
      message: null,
      qrBase64: null,
    });

    try {
      const result = await prepareChannelEvolution(token, campaignId, account.id);
      applyPrepareResult(account.id, result);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Nao foi possivel preparar a conexao com a Evolution';
      patchCardState(account.id, { error: message });
      if (isInstanceNotFoundMessage(message)) {
        applyAccountUpdate({ ...account, status: 'DISCONNECTED' });
        patchCardState(account.id, { qrBase64: null });
      }
    } finally {
      patchCardState(account.id, { preparing: false });
    }
  }

  async function handleGenerateQr(account: ChannelAccountItem) {
    const token = getStoredToken();
    if (!token || !canWrite) return;

    patchCardState(account.id, {
      loadingQr: true,
      error: null,
      message: null,
    });

    try {
      const result = await fetchChannelEvolutionQrCode(token, campaignId, account.id);
      applyAccountUpdate(result.channelAccount);

      if (result.channelAccount.status === 'CONNECTED') {
        patchCardState(account.id, {
          qrBase64: null,
          message: 'WhatsApp conectado.',
        });
      } else if (result.evolution.qrcode.base64) {
        patchCardState(account.id, {
          qrBase64: result.evolution.qrcode.base64,
          message: 'QR Code gerado. Escaneie no WhatsApp do celular.',
        });
      } else {
        patchCardState(account.id, {
          qrBase64: null,
          message: 'Solicitacao enviada, mas a Evolution nao retornou QR Code neste momento.',
        });
      }
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Nao foi possivel gerar o QR Code na Evolution';
      patchCardState(account.id, { error: message, qrBase64: null });
      if (isInstanceNotFoundMessage(message)) {
        applyAccountUpdate({ ...account, status: 'DISCONNECTED' });
      }
    } finally {
      patchCardState(account.id, { loadingQr: false });
    }
  }

  async function handleRefresh(account: ChannelAccountItem) {
    const token = getStoredToken();
    if (!token || !canWrite) return;

    patchCardState(account.id, {
      refreshing: true,
      error: null,
      message: null,
    });

    try {
      const result = await fetchChannelEvolutionStatus(token, campaignId, account.id);
      applyAccountUpdate(result.channelAccount);
      if (result.channelAccount.status === 'CONNECTED') {
        patchCardState(account.id, {
          qrBase64: null,
          evolutionState: result.evolution.state,
          message: 'WhatsApp conectado.',
        });
      } else {
        patchCardState(account.id, {
          evolutionState: result.evolution.state,
          message: `Status atualizado: ${getChannelAccountStatusLabel(result.channelAccount.status)}.`,
        });
      }
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Nao foi possivel consultar o status na Evolution';
      patchCardState(account.id, { error: message });
      if (isInstanceNotFoundMessage(message)) {
        applyAccountUpdate({ ...account, status: 'DISCONNECTED' });
        patchCardState(account.id, { qrBase64: null });
      }
    } finally {
      patchCardState(account.id, { refreshing: false });
    }
  }

  async function handleRestart(account: ChannelAccountItem) {
    const token = getStoredToken();
    if (!token || !canWrite) return;

    patchCardState(account.id, {
      resetting: true,
      error: null,
      message: null,
      qrBase64: null,
      evolutionState: null,
    });

    try {
      const updated = await updateChannelAccount(token, campaignId, account.id, {
        externalAccountId: null,
        status: 'DISCONNECTED',
      });
      applyAccountUpdate(updated);
      patchCardState(account.id, {
        message:
          'Conexao reiniciada localmente. Clique em Preparar conexao para criar a instancia novamente.',
      });
    } catch (err) {
      patchCardState(account.id, {
        error:
          err instanceof ApiError
            ? err.message
            : 'Nao foi possivel reiniciar a conexao local',
      });
    } finally {
      patchCardState(account.id, { resetting: false });
    }
  }

  async function handleArchive(account: ChannelAccountItem) {
    const token = getStoredToken();
    if (!token || !canWrite) return;

    const confirmed = window.confirm(
      `Arquivar o canal "${account.name}"?\n\nEle sai do painel, mas a instancia na Evolution nao e excluida.`,
    );
    if (!confirmed) return;

    patchCardState(account.id, {
      archiving: true,
      error: null,
      message: null,
    });

    try {
      const updated = await updateChannelAccount(token, campaignId, account.id, {
        status: 'ARCHIVED',
      });
      applyAccountUpdate(updated);
      setPageSuccess(
        `Canal "${account.name}" arquivado. A instancia na Evolution continua existindo.`,
      );
    } catch (err) {
      patchCardState(account.id, {
        error: err instanceof ApiError ? err.message : 'Nao foi possivel arquivar o canal',
      });
    } finally {
      patchCardState(account.id, { archiving: false });
    }
  }

  async function openAdvanced(account: ChannelAccountItem) {
    const token = getStoredToken();
    if (!token || !canWrite) return;

    patchCardState(account.id, {
      showAdvanced: true,
      advancedName: account.name,
      advancedExternalId: account.externalAccountId ?? '',
      advancedConfig: '',
      error: null,
      message: null,
    });

    try {
      const full = await fetchChannelAccount(token, campaignId, account.id);
      patchCardState(account.id, {
        advancedConfig: configToText(full.config ?? null),
      });
    } catch (err) {
      patchCardState(account.id, {
        error:
          err instanceof ApiError
            ? err.message
            : 'Nao foi possivel carregar configuracoes avancadas',
      });
    }
  }

  async function handleAdvancedSave(account: ChannelAccountItem, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getStoredToken();
    if (!token || !canWrite) return;

    const state = getCardState(account.id);
    patchCardState(account.id, { savingAdvanced: true, error: null, message: null });

    try {
      let configValue: Record<string, unknown> | undefined;
      try {
        configValue = parseConfig(state.advancedConfig);
      } catch {
        throw new ApiError('Config deve ser um JSON valido', 400);
      }

      const updated = await updateChannelAccount(token, campaignId, account.id, {
        name: state.advancedName.trim(),
        externalAccountId: state.advancedExternalId.trim() || null,
        config: configValue ?? null,
      });
      applyAccountUpdate(updated);
      patchCardState(account.id, {
        showAdvanced: false,
        message: 'Configuracoes avancadas salvas.',
      });
    } catch (err) {
      patchCardState(account.id, {
        error:
          err instanceof ApiError
            ? err.message
            : 'Nao foi possivel salvar configuracoes avancadas',
      });
    } finally {
      patchCardState(account.id, { savingAdvanced: false });
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

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-[#151515]">Canais da campanha</h2>
            {campaign ? <p className="mt-2 text-sm text-[#65655f]">{campaign.name}</p> : null}
            <p className="mt-2 text-sm text-[#65655f]">
              Gerencie multiplos canais WhatsApp. Cada canal tem sua propria instancia e conexao.
            </p>
          </div>
          {canWrite ? (
            <button
              className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white"
              type="button"
              onClick={() => {
                setShowCreateForm((current) => !current);
                setPageError(null);
                setPageSuccess(null);
              }}
            >
              {showCreateForm ? 'Cancelar' : 'Novo canal WhatsApp'}
            </button>
          ) : null}
        </div>

        {pageError ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {pageError}
          </p>
        ) : null}
        {pageSuccess ? (
          <p className="rounded-md border border-[#d7e5d8] bg-[#eef2ea] px-3 py-2 text-sm text-[#47624f]">
            {pageSuccess}
          </p>
        ) : null}

        {showCreateForm && canWrite ? (
          <form
            className="space-y-4 rounded-md border border-[#deddd4] bg-white p-4"
            onSubmit={handleCreateChannel}
          >
            <h3 className="font-medium text-[#24382b]">Novo canal WhatsApp</h3>
            <label className="block">
              <span className="text-sm font-medium text-[#34342f]">Nome do canal</span>
              <input
                className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="Ex.: WhatsApp Atendimento"
                required
                minLength={2}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-[#34342f]">
                Nome da instancia Evolution (opcional)
              </span>
              <input
                className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                value={createInstanceName}
                onChange={(event) => setCreateInstanceName(event.target.value)}
                placeholder="Ex.: atendimento-campanha"
              />
              <span className="mt-1 block text-xs text-[#65655f]">
                Se ficar vazio, a instancia sera gerada a partir do nome do canal na preparacao.
              </span>
            </label>
            <button
              className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              type="submit"
              disabled={creating}
            >
              {creating ? 'Criando e conectando...' : 'Criar e conectar'}
            </button>
          </form>
        ) : null}

        {!canWrite ? (
          <p className="rounded-md border border-[#deddd4] bg-white p-4 text-sm text-[#65655f]">
            Seu perfil possui acesso somente leitura. Voce pode ver canais e status, mas nao criar ou
            conectar.
          </p>
        ) : null}

        <section className="space-y-4">
          {visibleAccounts.length === 0 ? (
            <div className="rounded-md border border-[#deddd4] bg-white p-4 text-sm text-[#65655f]">
              Nenhum canal WhatsApp ativo nesta campanha.
              {canWrite ? ' Clique em Novo canal WhatsApp para comecar.' : null}
            </div>
          ) : (
            visibleAccounts.map((account) => {
              const ui = getCardState(account.id);
              const isConnected = account.status === 'CONNECTED';
              const instanceMissing = isInstanceNotFoundMessage(ui.error);
              const showPrepare =
                !isConnected &&
                (account.status === 'DISCONNECTED' ||
                  account.status === 'ERROR' ||
                  instanceMissing);
              const showQrButton =
                !isConnected &&
                !instanceMissing &&
                (account.status === 'CONNECTING' ||
                  account.status === 'DISCONNECTED' ||
                  account.status === 'ERROR');
              const canShowQr =
                !isConnected &&
                ['CONNECTING', 'DISCONNECTED', 'ERROR'].includes(account.status) &&
                Boolean(ui.qrBase64);
              const qrImageSrc = ui.qrBase64 ? toQrCodeImageSrc(ui.qrBase64) : null;

              return (
                <article
                  key={account.id}
                  className="space-y-4 rounded-md border border-[#deddd4] bg-white p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium text-[#24382b]">{account.name}</h3>
                      <p className="mt-1 text-sm text-[#65655f]">
                        Status: {getChannelAccountStatusLabel(account.status)}
                      </p>
                      {account.externalAccountId ? (
                        <p className="mt-1 text-sm text-[#65655f]">
                          Instancia Evolution: {account.externalAccountId}
                        </p>
                      ) : (
                        <p className="mt-1 text-sm text-[#65655f]">
                          Instancia Evolution: sera definida na preparacao
                        </p>
                      )}
                      {ui.evolutionState ? (
                        <p className="mt-1 text-xs text-[#65655f]">
                          Estado Evolution: {ui.evolutionState}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-[#65655f]">
                        Criado em {formatDate(account.createdAt)}
                      </p>
                    </div>
                    {isConnected ? (
                      <span className="rounded-md border border-[#d7e5d8] bg-[#eef2ea] px-2 py-1 text-xs font-medium text-[#47624f]">
                        WhatsApp conectado
                      </span>
                    ) : null}
                  </div>

                  {ui.error ? (
                    <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                      {ui.error}
                    </p>
                  ) : null}
                  {ui.message ? (
                    <p className="rounded-md border border-[#d7e5d8] bg-[#eef2ea] px-3 py-2 text-sm text-[#47624f]">
                      {ui.message}
                    </p>
                  ) : null}
                  {instanceMissing ? (
                    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      A instancia nao foi encontrada na Evolution. Prepare a conexao novamente.
                    </p>
                  ) : null}

                  {canWrite ? (
                    <div className="flex flex-wrap gap-2">
                      {showPrepare ? (
                        <button
                          className="rounded-md bg-[#24382b] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                          type="button"
                          disabled={ui.preparing}
                          onClick={() => handlePrepare(account)}
                        >
                          {ui.preparing
                            ? 'Preparando...'
                            : instanceMissing
                              ? 'Preparar conexao novamente'
                              : 'Preparar conexao'}
                        </button>
                      ) : null}
                      {showQrButton ? (
                        <button
                          className="rounded-md border border-[#24382b] px-3 py-2 text-sm font-semibold text-[#24382b] disabled:opacity-60"
                          type="button"
                          disabled={ui.loadingQr}
                          onClick={() => handleGenerateQr(account)}
                        >
                          {ui.loadingQr ? 'Gerando QR...' : 'Gerar QR Code'}
                        </button>
                      ) : null}
                      <button
                        className="rounded-md border border-[#c9c8c0] px-3 py-2 text-sm font-medium text-[#24382b] disabled:opacity-60"
                        type="button"
                        disabled={ui.refreshing}
                        onClick={() => handleRefresh(account)}
                      >
                        {ui.refreshing ? 'Atualizando...' : 'Atualizar status'}
                      </button>
                      <button
                        className="rounded-md border border-amber-700 px-3 py-2 text-sm font-medium text-amber-900 disabled:opacity-60"
                        type="button"
                        disabled={ui.resetting}
                        onClick={() => handleRestart(account)}
                      >
                        {ui.resetting ? 'Reiniciando...' : 'Reiniciar conexao'}
                      </button>
                      <button
                        className="rounded-md border border-[#c9c8c0] px-3 py-2 text-sm font-medium text-[#65655f] disabled:opacity-60"
                        type="button"
                        disabled={ui.archiving}
                        onClick={() => handleArchive(account)}
                      >
                        {ui.archiving ? 'Arquivando...' : 'Arquivar canal'}
                      </button>
                      <button
                        className="rounded-md border border-dashed border-[#c9c8c0] px-3 py-2 text-sm font-medium text-[#65655f]"
                        type="button"
                        onClick={() =>
                          ui.showAdvanced
                            ? patchCardState(account.id, { showAdvanced: false })
                            : openAdvanced(account)
                        }
                      >
                        {ui.showAdvanced ? 'Ocultar avancado' : 'Configuracoes avancadas'}
                      </button>
                    </div>
                  ) : null}

                  {canShowQr && qrImageSrc ? (
                    <div className="space-y-2 rounded-md border border-[#eef2ea] bg-[#f7f7f5] p-4">
                      <h4 className="text-sm font-medium text-[#24382b]">QR Code deste canal</h4>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={qrImageSrc}
                        alt={`QR Code ${account.name}`}
                        className="mx-auto h-56 w-56 rounded-md border border-[#deddd4] bg-white p-2"
                      />
                      <p className="text-xs text-[#65655f]">
                        Abra o WhatsApp no celular, va em Aparelhos conectados e escaneie o QR Code.
                      </p>
                    </div>
                  ) : null}

                  <div className="space-y-2 rounded-md border border-[#e8e7df] bg-[#fafaf8] p-4">
                    <h4 className="text-sm font-medium text-[#24382b]">Webhook da Evolution</h4>
                    <p className="text-xs text-[#65655f]">
                      Configure manualmente este URL na Evolution para receber mensagens inbound.
                    </p>
                    <code className="block break-all rounded-md border border-[#deddd4] bg-white px-3 py-2 text-xs text-[#24382b]">
                      {buildEvolutionWebhookUrl(account.id)}
                    </code>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        className="rounded-md border border-[#24382b] px-3 py-1.5 text-sm font-medium text-[#24382b]"
                        type="button"
                        onClick={() => handleCopyWebhookUrl(account.id)}
                      >
                        {ui.webhookCopied ? 'URL copiada' : 'Copiar URL'}
                      </button>
                      <span className="text-xs text-[#65655f]">ID do canal: {account.id}</span>
                    </div>
                    <p className="text-xs text-[#65655f]">
                      Se <span className="font-medium">EVOLUTION_WEBHOOK_SECRET</span> estiver
                      configurado na API, na Evolution use em{' '}
                      <span className="font-medium">webhook.headers</span>:{' '}
                      <span className="font-medium">{`{ "jwt_key": "<mesmo secret>" }`}</span>.
                      A Evolution enviara <span className="font-medium">Authorization: Bearer</span>{' '}
                      (JWT). Alternativa: header{' '}
                      <span className="font-medium">x-evolution-webhook-secret</span>. O valor do
                      secret nao e exibido nesta tela.
                    </p>
                  </div>

                  {ui.showAdvanced && canWrite ? (
                    <form
                      className="space-y-3 rounded-md border border-dashed border-[#c9c8c0] bg-[#fafaf8] p-4"
                      onSubmit={(event) => handleAdvancedSave(account, event)}
                    >
                      <p className="text-sm text-[#65655f]">
                        Area tecnica. Nao e necessaria para o fluxo normal de conexao.
                      </p>
                      <label className="block">
                        <span className="text-sm font-medium text-[#34342f]">Nome</span>
                        <input
                          className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                          value={ui.advancedName}
                          onChange={(event) =>
                            patchCardState(account.id, { advancedName: event.target.value })
                          }
                          required
                          minLength={2}
                        />
                      </label>
                      <label className="block">
                        <span className="text-sm font-medium text-[#34342f]">
                          ID externo / instancia
                        </span>
                        <input
                          className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                          value={ui.advancedExternalId}
                          onChange={(event) =>
                            patchCardState(account.id, {
                              advancedExternalId: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="block">
                        <span className="text-sm font-medium text-[#34342f]">
                          Config JSON (opcional)
                        </span>
                        <textarea
                          className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2 font-mono text-sm"
                          rows={4}
                          value={ui.advancedConfig}
                          onChange={(event) =>
                            patchCardState(account.id, { advancedConfig: event.target.value })
                          }
                        />
                      </label>
                      <button
                        className="rounded-md bg-[#24382b] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                        type="submit"
                        disabled={ui.savingAdvanced}
                      >
                        {ui.savingAdvanced ? 'Salvando...' : 'Salvar avancado'}
                      </button>
                    </form>
                  ) : null}

                  <p className="text-xs text-[#65655f]">
                    Arquivar remove o canal deste painel, mas nao exclui a instancia na Evolution.
                  </p>
                </article>
              );
            })
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
