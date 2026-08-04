'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DashboardShell } from '../../../../../../components/dashboard-shell';
import {
  ApiError,
  AuthUser,
  CampaignItem,
  ContentCompositionCatalog,
  ContentCompositionItem,
  ContentCompositionPreviewResult,
  ContentVariantItem,
  ContentVariantType,
  approveContentComposition,
  approveContentGenerationSet,
  clearStoredToken,
  createContentVariant,
  deleteContentVariant,
  fetchCampaign,
  fetchContentComposition,
  fetchContentCompositionCatalog,
  fetchMe,
  generateContentAiVariants,
  getStoredToken,
  previewContentComposition,
  updateContentComposition,
  updateContentVariant,
  type ContentMarketingBrief,
} from '../../../../../../lib/api';
import {
  canApproveRole,
  canWriteRole,
  getOrganizationRole,
} from '../../../../../../lib/roles';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  READY_FOR_REVIEW: 'Pronto para revisao',
  APPROVED: 'Aprovado',
  ARCHIVED: 'Arquivado',
};

const TYPE_LABELS: Record<ContentVariantType, string> = {
  GREETING: 'Saudacoes',
  BODY: 'Corpos',
  CLOSING: 'Fechamentos',
};

const VARIABLE_CHIPS = [
  { label: 'Nome', token: '{{firstName}}' },
  { label: 'Nome completo', token: '{{fullName}}' },
  { label: 'Empresa', token: '{{companyName}}' },
  { label: 'Cidade', token: '{{city}}' },
];

const EMPTY_BRIEF: ContentMarketingBrief = {
  objective: '',
  offerDescription: '',
  targetAudience: '',
  candidateCharacteristics: '',
  painPoints: '',
  primaryBenefit: '',
  differentiators: '',
  callToAction: '',
  tone: 'profissional e natural',
  protectedFacts: [],
  additionalInstructions: '',
  personalizationPlacement: 'GREETING',
};

export default function ContentCompositionEditorPage() {
  const router = useRouter();
  const params = useParams<{ id: string; compositionId: string }>();
  const campaignId = params.id;
  const compositionId = params.compositionId;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [campaign, setCampaign] = useState<CampaignItem | null>(null);
  const [composition, setComposition] = useState<ContentCompositionItem | null>(
    null,
  );
  const [catalog, setCatalog] = useState<ContentCompositionCatalog | null>(null);
  const [name, setName] = useState('');
  const [baseText, setBaseText] = useState('');
  const [draftByType, setDraftByType] = useState<Record<ContentVariantType, string>>(
    { GREETING: '', BODY: '', CLOSING: '' },
  );
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [preview, setPreview] = useState<ContentCompositionPreviewResult | null>(
    null,
  );
  const [brief, setBrief] = useState<ContentMarketingBrief>(EMPTY_BRIEF);
  const [combinationMode, setCombinationMode] = useState<
    'LOCKED_SETS' | 'MIX_AND_MATCH'
  >('LOCKED_SETS');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canWrite = campaign
    ? canWriteRole(getOrganizationRole(user?.memberships, campaign.organizationId))
    : false;
  const canApprove = campaign
    ? canApproveRole(
        getOrganizationRole(user?.memberships, campaign.organizationId),
      )
    : false;

  const editable =
    canWrite && composition != null && composition.status !== 'ARCHIVED';

  const baseVariant = useMemo(
    () =>
      composition?.variants.find(
        (v) => v.type === 'BODY' && v.source === 'BASE',
      ) ?? null,
    [composition],
  );

  const variantsByType = useMemo(() => {
    const groups: Record<ContentVariantType, ContentVariantItem[]> = {
      GREETING: [],
      BODY: [],
      CLOSING: [],
    };
    for (const variant of composition?.variants ?? []) {
      groups[variant.type].push(variant);
    }
    return groups;
  }, [composition]);

  function applyComposition(item: ContentCompositionItem) {
    setComposition(item);
    setName(item.name);
    const base =
      item.variants.find((v) => v.type === 'BODY' && v.source === 'BASE') ??
      null;
    setBaseText(base?.text ?? '');
    setBrief({
      ...EMPTY_BRIEF,
      ...(item.marketingBrief ?? {}),
      personalizationPlacement:
        (item.personalizationPlacement as ContentMarketingBrief['personalizationPlacement']) ||
        item.marketingBrief?.personalizationPlacement ||
        'GREETING',
    });
    setCombinationMode(
      item.combinationMode === 'MIX_AND_MATCH' ? 'MIX_AND_MATCH' : 'LOCKED_SETS',
    );
  }

  useEffect(() => {
    async function load() {
      const token = getStoredToken();
      if (!token) {
        router.replace('/login');
        return;
      }

      try {
        const [me, campaignItem, item, catalogItem] = await Promise.all([
          fetchMe(token),
          fetchCampaign(token, campaignId),
          fetchContentComposition(token, campaignId, compositionId),
          fetchContentCompositionCatalog(token, campaignId),
        ]);
        setUser(me);
        setCampaign(campaignItem);
        applyComposition(item);
        setCatalog(catalogItem);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearStoredToken();
          router.replace('/login');
          return;
        }
        setError(
          err instanceof ApiError
            ? err.message
            : 'Nao foi possivel carregar a composicao',
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [campaignId, compositionId, router]);

  function insertVariable(token: string) {
    if (!editable) return;
    if (editingVariantId) {
      setEditingText((current) => `${current}${token}`);
      return;
    }
    setBaseText((current) => `${current}${token}`);
  }

  async function withToken<T>(fn: (token: string) => Promise<T>) {
    const token = getStoredToken();
    if (!token) {
      router.replace('/login');
      return null;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      return await fn(token);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearStoredToken();
        router.replace('/login');
        return null;
      }
      setError(
        err instanceof ApiError ? err.message : 'Operacao falhou',
      );
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveMeta(event: FormEvent) {
    event.preventDefault();
    if (!editable) return;
    const updated = await withToken((token) =>
      updateContentComposition(token, campaignId, compositionId, {
        name: name.trim(),
      }),
    );
    if (updated) {
      applyComposition(updated);
      setSuccess('Nome salvo.');
    }
  }

  async function saveBase() {
    if (!editable || !baseVariant) return;
    const updated = await withToken((token) =>
      updateContentVariant(token, campaignId, compositionId, baseVariant.id, {
        text: baseText.trim(),
      }),
    );
    if (updated) {
      applyComposition(updated);
      setSuccess('Mensagem-base salva.');
    }
  }

  async function addVariant(type: ContentVariantType) {
    if (!editable) return;
    const text = draftByType[type].trim();
    if (!text) {
      setError('Informe o texto da variante.');
      return;
    }
    const updated = await withToken((token) =>
      createContentVariant(token, campaignId, compositionId, {
        type,
        text,
        enabled: true,
      }),
    );
    if (updated) {
      applyComposition(updated);
      setDraftByType((current) => ({ ...current, [type]: '' }));
      setSuccess('Variante adicionada.');
    }
  }

  async function saveEditingVariant() {
    if (!editable || !editingVariantId) return;
    const updated = await withToken((token) =>
      updateContentVariant(token, campaignId, compositionId, editingVariantId, {
        text: editingText.trim(),
      }),
    );
    if (updated) {
      applyComposition(updated);
      setEditingVariantId(null);
      setEditingText('');
      setSuccess('Variante atualizada.');
    }
  }

  async function toggleEnabled(variant: ContentVariantItem) {
    if (!editable || variant.source === 'BASE') return;
    const updated = await withToken((token) =>
      updateContentVariant(token, campaignId, compositionId, variant.id, {
        enabled: !variant.enabled,
        ...(variant.source === 'AI_GENERATED' && !variant.enabled
          ? { reviewPending: false }
          : {}),
      }),
    );
    if (updated) {
      applyComposition(updated);
      setSuccess(variant.enabled ? 'Variante desativada.' : 'Variante ativada.');
    }
  }

  async function removeVariant(variant: ContentVariantItem) {
    if (!editable || variant.source === 'BASE') return;
    if (!window.confirm('Remover esta variante?')) return;
    const updated = await withToken((token) =>
      deleteContentVariant(token, campaignId, compositionId, variant.id),
    );
    if (updated) {
      applyComposition(updated);
      setSuccess('Variante removida.');
    }
  }

  async function onGenerateAi(
    mode:
      | 'FULL_SETS'
      | 'GREETING_ONLY'
      | 'BODY_ONLY'
      | 'CLOSING_ONLY' = 'FULL_SETS',
  ) {
    if (!editable || !composition?.aiEnabled) return;
    const updated = await withToken((token) =>
      generateContentAiVariants(token, campaignId, compositionId, {
        mode,
        requireRecommendedBrief: mode === 'FULL_SETS',
      }),
    );
    if (updated) {
      applyComposition(updated);
      setSuccess(
        mode === 'FULL_SETS'
          ? '3 mensagens completas geradas (revisao pendente). Nada foi enviado.'
          : 'Sugestoes de IA geradas (desativadas ate revisao).',
      );
    }
  }

  async function onSaveBrief() {
    if (!editable) return;
    const updated = await withToken((token) =>
      updateContentComposition(token, campaignId, compositionId, {
        marketingBrief: {
          ...brief,
          protectedFacts: (brief.protectedFacts ?? [])
            .map((l) => String(l).trim())
            .filter(Boolean),
        },
        personalizationPlacement: brief.personalizationPlacement ?? 'GREETING',
        combinationMode,
      }),
    );
    if (updated) {
      applyComposition(updated);
      setSuccess('Contexto da IA salvo.');
    }
  }

  async function onApproveSet(generationSetId: string) {
    if (!editable) return;
    const updated = await withToken((token) =>
      approveContentGenerationSet(token, campaignId, compositionId, {
        generationSetId,
        enable: true,
      }),
    );
    if (updated) {
      applyComposition(updated);
      setSuccess('Conjunto aprovado e ativado.');
    }
  }

  async function onDiscardSet(generationSetId: string) {
    if (!editable || !composition) return;
    if (!window.confirm('Descartar este conjunto gerado?')) return;
    const members = composition.variants.filter(
      (v) => v.generationSetId === generationSetId,
    );
    let updated: ContentCompositionItem | null = composition;
    for (const member of members) {
      updated = await withToken((token) =>
        deleteContentVariant(token, campaignId, compositionId, member.id),
      );
    }
    if (updated) {
      applyComposition(updated);
      setSuccess('Conjunto descartado.');
    }
  }

  async function onPreview() {
    const result = await withToken((token) =>
      previewContentComposition(token, campaignId, compositionId, {}),
    );
    if (result) {
      setPreview(result);
      setSuccess(null);
    }
  }

  async function onApprove() {
    if (!canApprove || !composition) return;
    if (
      !window.confirm(
        'Aprovar esta composicao? O snapshot aprovado sera usado nos disparos vinculados.',
      )
    ) {
      return;
    }
    const updated = await withToken((token) =>
      approveContentComposition(token, campaignId, compositionId, {}),
    );
    if (updated) {
      applyComposition(updated);
      setSuccess('Composicao aprovada.');
    }
  }

  function renderVariantList(type: ContentVariantType) {
    const list = variantsByType[type].filter(
      (v) => !(type === 'BODY' && v.source === 'BASE'),
    );
    return (
      <section className="rounded-md border border-[#deddd4] bg-white p-4">
        <h3 className="font-semibold text-[#151515]">{TYPE_LABELS[type]}</h3>
        <ul className="mt-3 space-y-3">
          {list.map((variant) => (
            <li
              key={variant.id}
              className="rounded-md border border-[#ebeae3] p-3 text-sm"
            >
              {editingVariantId === variant.id ? (
                <div className="space-y-2">
                  <textarea
                    className="w-full rounded-md border border-[#c9c8c0] px-3 py-2"
                    rows={3}
                    value={editingText}
                    onChange={(event) => setEditingText(event.target.value)}
                    disabled={!editable || busy}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-md bg-[#24382b] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                      disabled={!editable || busy}
                      onClick={saveEditingVariant}
                    >
                      Salvar
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-[#c9c8c0] px-3 py-1.5 text-xs"
                      onClick={() => {
                        setEditingVariantId(null);
                        setEditingText('');
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="whitespace-pre-wrap text-[#24382b]">
                    {variant.text}
                  </p>
                  <p className="mt-2 text-xs text-[#65655f]">
                    {variant.enabled ? 'Ativa' : 'Inativa'}
                    {variant.source === 'AI_GENERATED' ? ' · Gerada por IA' : ''}
                    {variant.reviewPending ? ' · Revisao pendente' : ''}
                  </p>
                  {editable ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-md border border-[#c9c8c0] px-2 py-1 text-xs"
                        disabled={busy}
                        onClick={() => {
                          setEditingVariantId(variant.id);
                          setEditingText(variant.text);
                        }}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-[#c9c8c0] px-2 py-1 text-xs"
                        disabled={busy}
                        onClick={() => toggleEnabled(variant)}
                      >
                        {variant.enabled ? 'Desativar' : 'Ativar'}
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700"
                        disabled={busy}
                        onClick={() => removeVariant(variant)}
                      >
                        Remover
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </li>
          ))}
          {list.length === 0 ? (
            <li className="text-sm text-[#65655f]">Nenhuma variante ainda.</li>
          ) : null}
        </ul>

        {editable ? (
          <div className="mt-3 space-y-2">
            <textarea
              className="w-full rounded-md border border-[#c9c8c0] px-3 py-2 text-sm"
              rows={2}
              placeholder={`Nova ${TYPE_LABELS[type].toLowerCase().slice(0, -1)}...`}
              value={draftByType[type]}
              onChange={(event) =>
                setDraftByType((current) => ({
                  ...current,
                  [type]: event.target.value,
                }))
              }
              disabled={busy}
            />
            <button
              type="button"
              className="rounded-md border border-[#c9c8c0] px-3 py-1.5 text-sm font-medium text-[#24382b] disabled:opacity-60"
              disabled={busy}
              onClick={() => addVariant(type)}
            >
              Adicionar
            </button>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <DashboardShell userName={user?.name}>
      <div className="rounded-md border border-[#deddd4] bg-[#f7f6f1] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-[#65655f]">
              Editor de composicao
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-[#151515]">
              {composition?.name ?? 'Carregando...'}
            </h2>
            {campaign ? (
              <p className="mt-1 text-sm text-[#65655f]">{campaign.name}</p>
            ) : null}
            {composition ? (
              <p className="mt-2 text-sm text-[#65655f]">
                {STATUS_LABELS[composition.status] ?? composition.status} · v
                {composition.version}
              </p>
            ) : null}
          </div>
          <Link
            className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm font-medium text-[#24382b]"
            href={`/dashboard/campaigns/${campaignId}/content-compositions`}
          >
            Voltar a listagem
          </Link>
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

        {!loading && composition ? (
          <div className="mt-6 space-y-6">
            <form
              className="space-y-3 rounded-md border border-[#deddd4] bg-white p-4"
              onSubmit={saveMeta}
            >
              <label className="block text-sm text-[#24382b]">
                Nome
                <input
                  className="mt-1 w-full rounded-md border border-[#c9c8c0] px-3 py-2 disabled:bg-[#eee]"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={!editable || busy}
                  minLength={2}
                  maxLength={120}
                  required
                />
              </label>
              {editable ? (
                <button
                  type="submit"
                  className="rounded-md bg-[#24382b] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                  disabled={busy}
                >
                  Salvar nome
                </button>
              ) : null}
            </form>

            <section className="rounded-md border border-[#deddd4] bg-white p-4">
              <h3 className="font-semibold text-[#151515]">Mensagem-base</h3>
              <p className="mt-1 text-xs text-[#65655f]">
                Corpo principal da composicao. Variaveis opcionais:
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {VARIABLE_CHIPS.map((chip) => (
                  <button
                    key={chip.token}
                    type="button"
                    className="rounded-md border border-[#c9c8c0] bg-[#f7f6f1] px-2 py-1 text-xs text-[#24382b] disabled:opacity-50"
                    disabled={!editable || busy}
                    onClick={() => insertVariable(chip.token)}
                    title={chip.token}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
              <textarea
                className="mt-3 w-full rounded-md border border-[#c9c8c0] px-3 py-2 text-sm disabled:bg-[#eee]"
                rows={6}
                value={baseText}
                onChange={(event) => setBaseText(event.target.value)}
                disabled={!editable || busy}
                maxLength={3500}
              />
              {editable ? (
                <button
                  type="button"
                  className="mt-3 rounded-md bg-[#24382b] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                  disabled={busy || !baseVariant}
                  onClick={saveBase}
                >
                  Salvar mensagem-base
                </button>
              ) : null}
            </section>

            <div className="grid gap-4 lg:grid-cols-3">
              {renderVariantList('GREETING')}
              {renderVariantList('BODY')}
              {renderVariantList('CLOSING')}
            </div>

            <section className="rounded-md border border-[#deddd4] bg-white p-4">
              <h3 className="font-semibold text-[#151515]">Contexto para a IA</h3>
              <p className="mt-1 text-sm text-[#65655f]">
                Caracteristicas do eleitorado sao contexto coletivo —
                nao dados individuais do contato.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {(
                  [
                    ['objective', 'Objetivo'],
                    ['offerDescription', 'O que esta sendo oferecido'],
                    ['targetAudience', 'Publico/eleitorado'],
                    ['candidateCharacteristics', 'Caracteristicas relevantes'],
                    ['painPoints', 'Dores e necessidades'],
                    ['primaryBenefit', 'Beneficio principal'],
                    ['differentiators', 'Diferenciais'],
                    ['callToAction', 'Chamada para acao'],
                    ['tone', 'Tom'],
                    ['additionalInstructions', 'Instrucoes adicionais'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="block text-sm">
                    <span className="text-[#65655f]">{label}</span>
                    <textarea
                      className="mt-1 w-full rounded-md border border-[#c9c8c0] px-2 py-1.5 text-sm"
                      rows={key === 'offerDescription' || key === 'additionalInstructions' ? 3 : 2}
                      value={String(brief[key] ?? '')}
                      disabled={!editable || busy}
                      onChange={(e) =>
                        setBrief((b) => ({ ...b, [key]: e.target.value }))
                      }
                    />
                  </label>
                ))}
                <label className="block text-sm md:col-span-2">
                  <span className="text-[#65655f]">
                    Fatos que nao podem ser alterados (um por linha)
                  </span>
                  <textarea
                    className="mt-1 w-full rounded-md border border-[#c9c8c0] px-2 py-1.5 text-sm"
                    rows={3}
                    value={(brief.protectedFacts ?? []).join('\n')}
                    disabled={!editable || busy}
                    onChange={(e) =>
                      setBrief((b) => ({
                        ...b,
                        protectedFacts: e.target.value.split('\n'),
                      }))
                    }
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-[#65655f]">Local da personalizacao</span>
                  <select
                    className="mt-1 w-full rounded-md border border-[#c9c8c0] px-2 py-1.5 text-sm"
                    value={brief.personalizationPlacement ?? 'GREETING'}
                    disabled={!editable || busy}
                    onChange={(e) =>
                      setBrief((b) => ({
                        ...b,
                        personalizationPlacement: e.target
                          .value as ContentMarketingBrief['personalizationPlacement'],
                      }))
                    }
                  >
                    <option value="GREETING">Saudacao (padrao)</option>
                    <option value="BODY">Corpo</option>
                    <option value="NONE">Sem nome</option>
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="text-[#65655f]">Modo de combinacao</span>
                  <select
                    className="mt-1 w-full rounded-md border border-[#c9c8c0] px-2 py-1.5 text-sm"
                    value={combinationMode}
                    disabled={!editable || busy}
                    onChange={(e) =>
                      setCombinationMode(
                        e.target.value as 'LOCKED_SETS' | 'MIX_AND_MATCH',
                      )
                    }
                  >
                    <option value="LOCKED_SETS">Conjuntos travados (IA)</option>
                    <option value="MIX_AND_MATCH">Misturar variantes</option>
                  </select>
                  {combinationMode === 'MIX_AND_MATCH' ? (
                    <span className="mt-1 block text-xs text-[#8a5a00]">
                      Mistura exige validacao de coerencia. Prefira conjuntos
                      travados para mensagens geradas por IA.
                    </span>
                  ) : null}
                </label>
              </div>
              {editable ? (
                <button
                  type="button"
                  className="mt-3 rounded-md border border-[#c9c8c0] px-3 py-1.5 text-sm font-medium text-[#24382b] disabled:opacity-60"
                  disabled={busy}
                  onClick={onSaveBrief}
                >
                  Salvar contexto
                </button>
              ) : null}
            </section>

            <section className="rounded-md border border-[#deddd4] bg-white p-4">
              <h3 className="font-semibold text-[#151515]">Geracao com IA</h3>
              <p className="mt-1 text-sm text-[#65655f]">
                A IA sugere mensagens completas coerentes. Nada e enviado
                automaticamente. Aprovacao humana e obrigatoria.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  disabled={!editable || busy || !composition.aiEnabled}
                  onClick={() => onGenerateAi('FULL_SETS')}
                >
                  Gerar 3 mensagens completas
                </button>
                <button
                  type="button"
                  className="rounded-md border border-[#c9c8c0] px-3 py-2 text-sm disabled:opacity-60"
                  disabled={!editable || busy || !composition.aiEnabled}
                  onClick={() => onGenerateAi('GREETING_ONLY')}
                >
                  So saudações
                </button>
                <button
                  type="button"
                  className="rounded-md border border-[#c9c8c0] px-3 py-2 text-sm disabled:opacity-60"
                  disabled={!editable || busy || !composition.aiEnabled}
                  onClick={() => onGenerateAi('BODY_ONLY')}
                >
                  So corpos
                </button>
                <button
                  type="button"
                  className="rounded-md border border-[#c9c8c0] px-3 py-2 text-sm disabled:opacity-60"
                  disabled={!editable || busy || !composition.aiEnabled}
                  onClick={() => onGenerateAi('CLOSING_ONLY')}
                >
                  So fechamentos
                </button>
              </div>
              {!composition.aiEnabled ? (
                <p className="mt-2 text-sm text-[#8a5a00]">
                  Geracao por IA indisponivel (CONTENT_AI_ENABLED=false). O
                  editor manual continua disponivel.
                </p>
              ) : null}

              {(composition.generationSets ?? []).length > 0 ? (
                <div className="mt-4 space-y-3">
                  <h4 className="text-sm font-semibold text-[#24382b]">
                    Conjuntos gerados
                  </h4>
                  {composition.generationSets!.map((set, index) => (
                    <div
                      key={set.generationSetId}
                      className="rounded-md border border-[#ebeae3] bg-[#fafaf7] p-3 text-sm"
                    >
                      <p className="font-medium text-[#24382b]">
                        Mensagem {index + 1}
                        {set.marketingAngle
                          ? ` — ${set.marketingAngle}`
                          : ''}
                        {set.enabled ? ' (ativa)' : ' (revisao pendente)'}
                      </p>
                      {set.greeting ? (
                        <p className="mt-2">
                          <span className="text-[#65655f]">Saudacao:</span>{' '}
                          {set.greeting.text}
                        </p>
                      ) : null}
                      {set.body ? (
                        <p className="mt-1">
                          <span className="text-[#65655f]">Corpo:</span>{' '}
                          {set.body.text}
                        </p>
                      ) : null}
                      {set.closing ? (
                        <p className="mt-1">
                          <span className="text-[#65655f]">Fechamento:</span>{' '}
                          {set.closing.text}
                        </p>
                      ) : null}
                      {set.coherenceAlerts?.length ? (
                        <ul className="mt-2 list-disc pl-5 text-xs text-[#8a5a00]">
                          {set.coherenceAlerts.map((a) => (
                            <li key={`${set.generationSetId}-${a.code}`}>
                              {a.message}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {set.quality?.riskWarnings?.length ? (
                        <p className="mt-1 text-xs text-[#65655f]">
                          Alertas editoriais: {set.quality.riskWarnings.join('; ')}
                        </p>
                      ) : null}
                      {editable ? (
                        <div className="mt-3 flex gap-2">
                          {!set.enabled ? (
                            <button
                              type="button"
                              className="rounded-md bg-[#24382b] px-3 py-1 text-xs font-semibold text-white"
                              disabled={busy}
                              onClick={() => onApproveSet(set.generationSetId)}
                            >
                              Aprovar conjunto
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="rounded-md border border-[#c9c8c0] px-3 py-1 text-xs"
                            disabled={busy}
                            onClick={() => onDiscardSet(set.generationSetId)}
                          >
                            Descartar
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="rounded-md border border-[#deddd4] bg-white p-4">
              <h3 className="font-semibold text-[#151515]">Preview</h3>
              <p className="mt-1 text-sm text-[#65655f]">
                O preview usa o mesmo algoritmo deterministico do envio.
              </p>
              <button
                type="button"
                className="mt-3 rounded-md border border-[#c9c8c0] px-4 py-2 text-sm font-medium text-[#24382b] disabled:opacity-60"
                disabled={busy}
                onClick={onPreview}
              >
                Gerar preview
              </button>
              {preview ? (
                <div className="mt-4 space-y-3">
                  <p className="text-xs text-[#65655f]">{preview.notice}</p>
                  <p className="text-xs text-[#65655f]">
                    Combinacoes teoricas: {preview.counts.theoreticalCombinations}{' '}
                    ({preview.counts.greetings} saudacoes × {preview.counts.bodies}{' '}
                    corpos × {preview.counts.closings} fechamentos)
                  </p>
                  {preview.previews.map((row) => (
                    <div
                      key={row.contactId}
                      className="rounded-md border border-[#ebeae3] bg-[#fafaf7] p-3 text-sm"
                    >
                      <p className="font-medium text-[#24382b]">
                        {row.contactName?.trim() || 'Contato sem nome'}
                      </p>
                      <pre className="mt-2 whitespace-pre-wrap font-sans text-[#34342f]">
                        {row.renderedText}
                      </pre>
                      {!row.valid ? (
                        <p className="mt-2 text-xs text-red-700">
                          {row.errors.join('; ')}
                        </p>
                      ) : null}
                    </div>
                  ))}
                  {preview.previews.length === 0 ? (
                    <p className="text-sm text-[#65655f]">
                      Nenhum contato disponivel para preview.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>

            {canApprove && composition.status !== 'APPROVED' ? (
              <section className="rounded-md border border-[#deddd4] bg-white p-4">
                <h3 className="font-semibold text-[#151515]">Aprovacao</h3>
                <p className="mt-1 text-sm text-[#65655f]">
                  Somente OWNER/ADMIN. Aprovacao congela o snapshot usado no
                  disparo.
                </p>
                <button
                  type="button"
                  className="mt-3 rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  disabled={busy}
                  onClick={onApprove}
                >
                  Aprovar composicao
                </button>
              </section>
            ) : null}

            {composition.status === 'APPROVED' ? (
              <p className="rounded-md border border-[#c9d9c4] bg-[#eef5ea] px-3 py-2 text-sm text-[#47624f]">
                Composicao aprovada. Qualquer edicao volta o status para rascunho
                e exige nova aprovacao.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </DashboardShell>
  );
}
