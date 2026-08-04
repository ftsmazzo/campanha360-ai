'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CampaignNav } from '../../../../../components/campaign-nav';
import { DashboardShell } from '../../../../../components/dashboard-shell';
import {
  ApiError,
  AuthUser,
  CampaignItem,
  ChannelAccountItem,
  clearStoredToken,
  createChannelAccount,
  createEvolutionInstance,
  fetchCampaign,
  fetchChannelAccount,
  fetchChannelAccounts,
  fetchChannelEvolutionQrCode,
  fetchChannelEvolutionStatus,
  fetchMe,
  getStoredToken,
  linkEvolutionInstance,
  prepareChannelEvolution,
  previewEvolutionLink,
  reconnectEvolutionInstance,
  recordChannelPlatformRestriction,
  clearChannelPlatformRestriction,
  resetEvolutionSession,
  restartEvolutionInstance,
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
  const [createMode, setCreateMode] = useState<'CREATE' | 'LINK'>('CREATE');
  const [linkPreview, setLinkPreview] = useState<string | null>(null);
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
    const webhookNote = result.webhook?.message
      ? ` ${result.webhook.message}`
      : '';

    if (result.channelAccount.status === 'CONNECTED') {
      patchCardState(accountId, {
        qrBase64: null,
        evolutionState: result.evolution.state,
        message: `WhatsApp conectado.${webhookNote}`,
        error: result.webhook && !result.webhook.synced ? result.webhook.message : null,
      });
      return;
    }

    if (hasQr && qr?.base64) {
      patchCardState(accountId, {
        qrBase64: qr.base64,
        evolutionState: result.evolution.state,
        message: `${
          result.evolution.created
            ? 'Instancia criada. Escaneie o QR Code no WhatsApp do celular.'
            : 'QR Code disponivel. Escaneie no WhatsApp do celular.'
        }${webhookNote}`,
        error: result.webhook && !result.webhook.synced ? result.webhook.message : null,
      });
      return;
    }

    if (!result.evolution.created) {
      patchCardState(accountId, {
        evolutionState: result.evolution.state,
        message: `A instancia ja existe, mas a Evolution nao retornou QR Code. Se necessario, reinicie a conexao.${webhookNote}`,
        error: result.webhook && !result.webhook.synced ? result.webhook.message : null,
      });
      return;
    }

    patchCardState(accountId, {
      evolutionState: result.evolution.state,
      message: `Instancia criada, mas a Evolution nao retornou QR Code neste momento. Use Gerar QR Code.${webhookNote}`,
      error: result.webhook && !result.webhook.synced ? result.webhook.message : null,
    });
  }

  async function handleCreateChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getStoredToken();
    if (!token || !canWrite || !createName.trim()) return;
    if (!createInstanceName.trim()) {
      setPageError('Informe o nome da instancia Evolution.');
      return;
    }

    setCreating(true);
    setPageError(null);
    setPageSuccess(null);
    setLinkPreview(null);

    try {
      const instanceName = createInstanceName.trim();
      const created = await createChannelAccount(token, campaignId, {
        name: createName.trim(),
        provider: 'WHATSAPP_EVOLUTION',
        status: 'DISCONNECTED',
        externalAccountId: instanceName,
      });
      applyAccountUpdate(created);
      const mode = createMode;
      setCreateName('');
      setCreateInstanceName('');
      setShowCreateForm(false);
      patchCardState(created.id, {
        preparing: true,
        error: null,
        message:
          mode === 'CREATE'
            ? 'Canal criado. Criando instancia na Evolution...'
            : 'Canal criado. Consultando instancia existente...',
        qrBase64: null,
      });

      try {
        if (mode === 'CREATE') {
          const prepared = await createEvolutionInstance(token, campaignId, created.id, {
            instanceName,
            confirmCreate: true,
          });
          applyPrepareResult(created.id, prepared);
          setPageSuccess(`Canal "${created.name}" criado (nova instancia).`);
        } else {
          const preview = await previewEvolutionLink(token, campaignId, created.id, {
            instanceName,
          });
          setLinkPreview(
            `Encontrada: ${preview.preview.instanceName} · estado ${preview.preview.remoteConnectionState}` +
              (preview.preview.ownerLast4 ? ` · owner ***${preview.preview.ownerLast4}` : '') +
              '. Confirmando vinculacao...',
          );
          const linked = await linkEvolutionInstance(token, campaignId, created.id, {
            instanceName,
            confirmLink: true,
          });
          applyPrepareResult(created.id, linked);
          setPageSuccess(
            `Canal "${created.name}" vinculado a instancia existente (sem QR se ja CONNECTED).`,
          );
        }
      } catch (prepareError) {
        const message =
          prepareError instanceof ApiError
            ? prepareError.message
            : 'Canal criado, mas a Evolution nao concluiu o provisionamento.';
        patchCardState(created.id, {
          error: message,
          message: null,
          qrBase64: null,
        });
        setPageSuccess(`Canal "${created.name}" criado. Conclua criar/vincular no card.`);
      } finally {
        patchCardState(created.id, { preparing: false });
        setLinkPreview(null);
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
          message: result.evolution.message ?? 'WhatsApp conectado.',
        });
      } else if (result.evolution.qrcode?.base64) {
        patchCardState(account.id, {
          qrBase64: result.evolution.qrcode.base64,
          message: 'QR Code gerado. Escaneie no WhatsApp do celular.',
        });
      } else {
        patchCardState(account.id, {
          qrBase64: null,
          message:
            result.evolution.message ??
            'Solicitacao enviada, mas a Evolution nao retornou QR Code neste momento.',
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
      const remote =
        result.evolution.normalizedConnectionState ??
        result.evolution.rawStateSafe ??
        result.evolution.state ??
        '—';
      if (result.channelAccount.status === 'CONNECTED') {
        patchCardState(account.id, {
          qrBase64: null,
          evolutionState: remote,
          message: `WhatsApp conectado. Remoto: ${remote}.`,
        });
      } else {
        patchCardState(account.id, {
          evolutionState: remote,
          message: `Status: ${getChannelAccountStatusLabel(result.channelAccount.status)} · remoto ${remote}` +
            (result.recommendedAction ? ` · acao: ${result.recommendedAction}` : ''),
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
    });

    try {
      const result = await restartEvolutionInstance(token, campaignId, account.id);
      applyAccountUpdate(result.channelAccount);
      patchCardState(account.id, {
        message: `Restart solicitado. Estado: ${String(result.evolution.normalizedConnectionState ?? '—')}`,
        evolutionState: String(result.evolution.normalizedConnectionState ?? ''),
      });
    } catch (err) {
      patchCardState(account.id, {
        error: err instanceof ApiError ? err.message : 'Falha ao reiniciar instancia',
      });
    } finally {
      patchCardState(account.id, { resetting: false });
    }
  }

  async function handleReconnect(account: ChannelAccountItem) {
    const token = getStoredToken();
    if (!token || !canWrite) return;
    patchCardState(account.id, { preparing: true, error: null, message: null });
    try {
      const result = await reconnectEvolutionInstance(token, campaignId, account.id);
      applyAccountUpdate(result.channelAccount);
      patchCardState(account.id, {
        message: result.success
          ? 'Reconexao bem-sucedida.'
          : `Reconexao nao restaurou CONNECTED (${String(result.evolution.normalizedConnectionState ?? '—')}).`,
        qrBase64: null,
      });
    } catch (err) {
      patchCardState(account.id, {
        error: err instanceof ApiError ? err.message : 'Falha ao reconectar',
      });
    } finally {
      patchCardState(account.id, { preparing: false });
    }
  }

  async function handleResetSession(account: ChannelAccountItem) {
    const token = getStoredToken();
    if (!token || !canWrite) return;
    const ok = window.confirm(
      'Reset destrutivo: a sessao atual sera apagada e um novo QR sera necessario. O dispositivo podera precisar ser revinculado. Continuar?',
    );
    if (!ok) return;
    patchCardState(account.id, { resetting: true, error: null, message: null, qrBase64: null });
    try {
      const result = await resetEvolutionSession(token, campaignId, account.id, {
        confirmReset: true,
      });
      applyAccountUpdate(result.channelAccount);
      patchCardState(account.id, {
        qrBase64: result.evolution.qrcode?.base64 ?? null,
        message: 'Sessao resetada. Escaneie o novo QR Code.',
      });
    } catch (err) {
      patchCardState(account.id, {
        error: err instanceof ApiError ? err.message : 'Falha no reset de sessao',
      });
    } finally {
      patchCardState(account.id, { resetting: false });
    }
  }

  async function handleRecordPlatformRestriction(account: ChannelAccountItem) {
    const token = getStoredToken();
    if (!token || !canWrite) return;
    const hoursRaw = window.prompt(
      'Prazo em horas a partir de agora (ex.: 5). Deixe vazio se nao houver prazo explicito.',
      '5',
    );
    if (hoursRaw === null) return;
    let restrictedUntil: string | null = null;
    if (hoursRaw.trim()) {
      const hours = Number(hoursRaw);
      if (!Number.isFinite(hours) || hours <= 0) {
        patchCardState(account.id, { error: 'Prazo invalido.' });
        return;
      }
      restrictedUntil = new Date(Date.now() + hours * 3600_000).toISOString();
    }
    const reasonSafe =
      window.prompt(
        'Motivo seguro (sem telefone/segredos). Ex.: WhatsApp informou bloqueio de vinculacao por suspeita de spam.',
        account.platformRestrictionReasonSafe ??
          'Restricao de vinculacao informada no aplicativo (suspeita de spam / cooldown).',
      ) ?? '';
    const ok = window.confirm(
      'Registrar restricao da plataforma? A conta saira do pool operacional imediatamente.',
    );
    if (!ok) return;
    patchCardState(account.id, { preparing: true, error: null });
    try {
      const result = await recordChannelPlatformRestriction(token, campaignId, account.id, {
        status: 'DEVICE_LINKING_RESTRICTED',
        restrictedUntil,
        reasonSafe: reasonSafe.trim() || null,
        confirm: true,
        source: 'MANUAL',
      });
      applyAccountUpdate(result.channelAccount);
      patchCardState(account.id, { message: result.message, qrBase64: null });
    } catch (err) {
      patchCardState(account.id, {
        error: err instanceof ApiError ? err.message : 'Falha ao registrar restricao',
      });
    } finally {
      patchCardState(account.id, { preparing: false });
    }
  }

  async function handleUpdateRestrictionDeadline(account: ChannelAccountItem) {
    const token = getStoredToken();
    if (!token || !canWrite) return;
    const hoursRaw = window.prompt('Novo prazo em horas a partir de agora:', '5');
    if (hoursRaw === null) return;
    const hours = Number(hoursRaw);
    if (!Number.isFinite(hours) || hours <= 0) {
      patchCardState(account.id, { error: 'Prazo invalido.' });
      return;
    }
    const ok = window.confirm('Atualizar prazo da restricao?');
    if (!ok) return;
    try {
      const result = await recordChannelPlatformRestriction(token, campaignId, account.id, {
        status:
          (account.platformRestrictionStatus as
            | 'DEVICE_LINKING_RESTRICTED'
            | 'PLATFORM_RESTRICTED'
            | 'MANUAL_COOLDOWN_REQUIRED') || 'DEVICE_LINKING_RESTRICTED',
        restrictedUntil: new Date(Date.now() + hours * 3600_000).toISOString(),
        reasonSafe: account.platformRestrictionReasonSafe ?? null,
        confirm: true,
        source: 'MANUAL',
      });
      applyAccountUpdate(result.channelAccount);
      patchCardState(account.id, { message: 'Prazo da restricao atualizado.' });
    } catch (err) {
      patchCardState(account.id, {
        error: err instanceof ApiError ? err.message : 'Falha ao atualizar prazo',
      });
    }
  }

  async function handleClearPlatformRestriction(account: ChannelAccountItem) {
    const token = getStoredToken();
    if (!token || !canWrite) return;
    const deadlinePassed =
      !account.platformRestrictedUntil ||
      new Date(account.platformRestrictedUntil).getTime() <= Date.now();
    let adminOverride = false;
    if (!deadlinePassed) {
      adminOverride = window.confirm(
        'O prazo ainda nao encerrou. Confirmar override administrativo para limpar mesmo assim?',
      );
      if (!adminOverride) return;
    } else {
      const ok = window.confirm(
        'Limpar restricao? Exige Evolution CONNECTED e sessao utilizavel apos sincronizacao.',
      );
      if (!ok) return;
    }
    patchCardState(account.id, { preparing: true, error: null });
    try {
      const result = await clearChannelPlatformRestriction(token, campaignId, account.id, {
        confirm: true,
        adminOverrideDeadline: adminOverride || undefined,
      });
      applyAccountUpdate(result.channelAccount);
      patchCardState(account.id, {
        message: result.readiness.ready
          ? 'Restricao limpa. Conta pronta operacionalmente.'
          : `Restricao limpa. Readiness: ${result.readiness.reason ?? 'pendente'}.`,
      });
    } catch (err) {
      patchCardState(account.id, {
        error: err instanceof ApiError ? err.message : 'Falha ao limpar restricao',
      });
    } finally {
      patchCardState(account.id, { preparing: false });
    }
  }

  async function handleClearLocalBinding(account: ChannelAccountItem) {
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
        <CampaignNav campaignId={campaignId} campaignName={campaign?.name} />

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-[#151515]">WhatsApp</h2>
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
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-[#34342f]">Modo de provisionamento</legend>
              <label className="flex items-center gap-2 text-sm text-[#34342f]">
                <input
                  type="radio"
                  name="createMode"
                  checked={createMode === 'CREATE'}
                  onChange={() => setCreateMode('CREATE')}
                />
                Criar nova instancia (falha se o nome ja existir na Evolution)
              </label>
              <label className="flex items-center gap-2 text-sm text-[#34342f]">
                <input
                  type="radio"
                  name="createMode"
                  checked={createMode === 'LINK'}
                  onChange={() => setCreateMode('LINK')}
                />
                Vincular instancia existente (exige confirmacao; sem QR se ja CONNECTED)
              </label>
            </fieldset>
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
                Nome da instancia Evolution
              </span>
              <input
                className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                value={createInstanceName}
                onChange={(event) => setCreateInstanceName(event.target.value)}
                placeholder="Ex.: wp01"
                required
              />
            </label>
            {linkPreview ? (
              <p className="text-sm text-[#47624f]">{linkPreview}</p>
            ) : null}
            <button
              className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              type="submit"
              disabled={creating}
            >
              {creating
                ? createMode === 'LINK'
                  ? 'Vinculando...'
                  : 'Criando...'
                : createMode === 'LINK'
                  ? 'Criar canal e vincular'
                  : 'Criar canal e nova instancia'}
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
              const hasPlatformRestriction =
                Boolean(account.platformRestrictionStatus) &&
                account.platformRestrictionStatus !== 'NONE';
              const restrictionDeadlinePassed =
                hasPlatformRestriction &&
                account.platformRestrictedUntil &&
                new Date(account.platformRestrictedUntil).getTime() <= Date.now();
              const actionsBlockedByRestriction = hasPlatformRestriction;
              const remote = account.remoteConnectionState ?? null;
              const showReconnect =
                !actionsBlockedByRestriction &&
                (remote === 'DISCONNECTED_WITH_SESSION' ||
                  remote === 'DISCONNECTED_UNKNOWN_SESSION');
              const showRestartRemote =
                !actionsBlockedByRestriction &&
                (remote === 'RESTART_REQUIRED' || showReconnect);
              const showResetSession =
                !actionsBlockedByRestriction &&
                (remote === 'LOGGED_OUT' ||
                  remote === 'DEVICE_REMOVED' ||
                  remote === 'SESSION_INVALID' ||
                  remote === 'DISCONNECTED_WITH_SESSION' ||
                  remote === 'QR_REQUIRED');
              const showQrButton =
                !actionsBlockedByRestriction &&
                !isConnected &&
                !instanceMissing &&
                (remote === 'QR_REQUIRED' ||
                  remote === 'CREATED' ||
                  remote === 'LOGGED_OUT' ||
                  remote === 'DEVICE_REMOVED' ||
                  account.status === 'CONNECTING');
              const showPrepare =
                !actionsBlockedByRestriction &&
                !isConnected &&
                (!account.provisioningMode ||
                  remote === 'NOT_FOUND' ||
                  remote === 'REMOVED' ||
                  instanceMissing);
              const canShowQr =
                !isConnected && Boolean(ui.qrBase64);
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
                        Status local: {getChannelAccountStatusLabel(account.status)}
                      </p>
                      <p className="mt-1 text-sm text-[#65655f]">
                        Modo:{' '}
                        {account.provisioningMode === 'LINKED'
                          ? 'Vinculada da Evolution'
                          : account.provisioningMode === 'CREATED'
                            ? 'Criada pelo Campanha360'
                            : '—'}
                      </p>
                      {account.externalAccountId ? (
                        <p className="mt-1 text-sm text-[#65655f]">
                          Instancia: {account.externalAccountId}
                          {account.remoteOwnerLast4
                            ? ` · owner ***${account.remoteOwnerLast4}`
                            : ''}
                        </p>
                      ) : (
                        <p className="mt-1 text-sm text-[#65655f]">
                          Instancia Evolution: ainda nao provisionada
                        </p>
                      )}
                      <p className="mt-1 text-xs text-[#65655f]">
                        Remoto: {account.remoteConnectionState ?? '—'} · Sessao:{' '}
                        {account.sessionState ?? '—'}
                        {account.statusReason ? ` · reason ${account.statusReason}` : ''}
                      </p>
                      <p className="mt-1 text-xs text-[#65655f]">
                        Fonte: {account.lastStateSource ?? '—'}
                        {account.lastRemoteVerificationAt
                          ? ` · verificado ${formatDate(account.lastRemoteVerificationAt)}`
                          : ''}
                        {account.operationInProgress
                          ? ` · operacao ${account.operationInProgress}`
                          : ''}
                      </p>
                      {ui.evolutionState ? (
                        <p className="mt-1 text-xs text-[#65655f]">
                          Ultimo estado consultado: {ui.evolutionState}
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
                  {account.reconnectErrorSafe ? (
                    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      {account.reconnectErrorSafe}
                    </p>
                  ) : null}

                  {hasPlatformRestriction ? (
                    <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                      <p className="font-semibold">Restricao da plataforma</p>
                      <p>Tipo: {account.platformRestrictionStatus}</p>
                      <p>
                        Inicio:{' '}
                        {account.platformRestrictedAt
                          ? formatDate(account.platformRestrictedAt)
                          : '—'}
                      </p>
                      <p>
                        Termino informado:{' '}
                        {account.platformRestrictedUntil
                          ? formatDate(account.platformRestrictedUntil)
                          : '—'}
                        {account.platformRestrictedUntil
                          ? restrictionDeadlinePassed
                            ? ' · prazo encerrado — faca verificacao manual'
                            : ` · restante ~${Math.max(
                                0,
                                Math.ceil(
                                  (new Date(account.platformRestrictedUntil).getTime() -
                                    Date.now()) /
                                    3600_000,
                                ),
                              )}h`
                          : ''}
                      </p>
                      <p>Origem: {account.platformRestrictionSource ?? '—'}</p>
                      <p>
                        Motivo: {account.platformRestrictionReasonSafe ?? '—'}
                      </p>
                      <p>
                        Revisao manual:{' '}
                        {account.requiresManualReview ? 'pendente' : 'nao'}
                      </p>
                      <p className="font-medium">
                        Nao tente reconectar ou gerar QR repetidamente. Aguarde o
                        prazo informado no aplicativo e faca nova verificacao
                        manual.
                      </p>
                    </div>
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
                          {ui.preparing ? 'Preparando...' : 'Sincronizar / preparar'}
                        </button>
                      ) : null}
                      {showReconnect ? (
                        <button
                          className="rounded-md bg-[#24382b] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                          type="button"
                          disabled={ui.preparing}
                          onClick={() => handleReconnect(account)}
                        >
                          {ui.preparing ? 'Reconectando...' : 'Tentar reconectar'}
                        </button>
                      ) : null}
                      {showRestartRemote ? (
                        <button
                          className="rounded-md border border-amber-700 px-3 py-2 text-sm font-medium text-amber-900 disabled:opacity-60"
                          type="button"
                          disabled={ui.resetting}
                          onClick={() => handleRestart(account)}
                        >
                          {ui.resetting ? 'Reiniciando...' : 'Reiniciar instancia'}
                        </button>
                      ) : null}
                      {showQrButton ? (
                        <button
                          className="rounded-md border border-[#24382b] px-3 py-2 text-sm font-semibold text-[#24382b] disabled:opacity-60"
                          type="button"
                          disabled={ui.loadingQr}
                          onClick={() => handleGenerateQr(account)}
                        >
                          {ui.loadingQr ? 'Gerando QR...' : 'Mostrar / atualizar QR'}
                        </button>
                      ) : null}
                      {showResetSession ? (
                        <button
                          className="rounded-md border border-red-700 px-3 py-2 text-sm font-medium text-red-800 disabled:opacity-60"
                          type="button"
                          disabled={ui.resetting}
                          onClick={() => handleResetSession(account)}
                        >
                          {ui.resetting ? 'Resetando...' : 'Resetar sessao e gerar novo QR'}
                        </button>
                      ) : null}
                      <button
                        className="rounded-md border border-[#c9c8c0] px-3 py-2 text-sm font-medium text-[#24382b] disabled:opacity-60"
                        type="button"
                        disabled={ui.refreshing}
                        onClick={() => handleRefresh(account)}
                      >
                        {ui.refreshing ? 'Atualizando...' : 'Sincronizar estado'}
                      </button>
                      {!hasPlatformRestriction ? (
                        <button
                          className="rounded-md border border-amber-700 px-3 py-2 text-sm font-medium text-amber-900 disabled:opacity-60"
                          type="button"
                          disabled={ui.preparing}
                          onClick={() => handleRecordPlatformRestriction(account)}
                        >
                          Registrar restricao
                        </button>
                      ) : (
                        <>
                          <button
                            className="rounded-md border border-amber-700 px-3 py-2 text-sm font-medium text-amber-900"
                            type="button"
                            onClick={() => handleUpdateRestrictionDeadline(account)}
                          >
                            Atualizar prazo
                          </button>
                          <button
                            className="rounded-md border border-[#24382b] px-3 py-2 text-sm font-semibold text-[#24382b] disabled:opacity-60"
                            type="button"
                            disabled={ui.preparing}
                            onClick={() => handleClearPlatformRestriction(account)}
                          >
                            Limpar restricao
                          </button>
                        </>
                      )}
                      <button
                        className="rounded-md border border-[#c9c8c0] px-3 py-2 text-sm font-medium text-[#65655f] disabled:opacity-60"
                        type="button"
                        disabled={ui.resetting}
                        onClick={() => handleClearLocalBinding(account)}
                      >
                        Limpar vinculo local
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
                      Ao preparar a conexao, a API sincroniza este URL na Evolution. Se{' '}
                      <span className="font-medium">EVOLUTION_WEBHOOK_SECRET</span> estiver
                      configurado, tambem envia <span className="font-medium">jwt_key</span> para a
                      Evolution autenticar com <span className="font-medium">Authorization: Bearer</span>.
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
                      Diagnostico: abra{' '}
                      <span className="font-medium">
                        {buildEvolutionWebhookUrl(account.id)}/health
                      </span>{' '}
                      no navegador. O valor do secret nao e exibido nesta tela.
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
