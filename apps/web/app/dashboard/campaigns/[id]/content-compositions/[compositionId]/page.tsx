'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CampaignNav } from '../../../../../../components/campaign-nav';
import { DashboardShell } from '../../../../../../components/dashboard-shell';
import {
  ApiError,
  AuthUser,
  CampaignItem,
  CandidateItem,
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
  fetchCandidate,
  fetchContentComposition,
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

const DEFAULT_INTENTION =
  'Criar convites iniciais no WhatsApp. Cada variação deve usar UMA pauta concreta diferente como isca (ex.: proteção às mulheres, crianças, CRAS/CREAS, dependência química, idosos). O objetivo é descobrir o que interessa a pessoa, sem pedido de voto e sem soar como panfleto de candidatura.';

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
  const [candidate, setCandidate] = useState<CandidateItem | null>(null);
  const [composition, setComposition] = useState<ContentCompositionItem | null>(
    null,
  );
  const [name, setName] = useState('');
  const [baseText, setBaseText] = useState('');
  const [intention, setIntention] = useState(DEFAULT_INTENTION);
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
    setIntention(
      item.marketingBrief?.additionalInstructions?.trim() || DEFAULT_INTENTION,
    );
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
        const [me, campaignItem, item, candidateRes] = await Promise.all([
          fetchMe(token),
          fetchCampaign(token, campaignId),
          fetchContentComposition(token, campaignId, compositionId),
          fetchCandidate(token, campaignId),
        ]);
        setUser(me);
        setCampaign(campaignItem);
        setCandidate(candidateRes.candidate);
        applyComposition(item);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearStoredToken();
          router.replace('/login');
          return;
        }
        setError(
          err instanceof ApiError
            ? err.message
            : 'Nao foi possivel carregar a mensagem',
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [campaignId, compositionId, router]);

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
      setError(err instanceof ApiError ? err.message : 'Operacao falhou');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function onGenerateInvite() {
    if (!editable || !composition?.aiEnabled) return;
    const updated = await withToken((token) =>
      generateContentAiVariants(token, campaignId, compositionId, {
        mode: 'FULL_SETS',
        requireRecommendedBrief: false,
        intention: intention.trim() || DEFAULT_INTENTION,
      }),
    );
    if (updated) {
      applyComposition(updated);
      setSuccess(
        'Variacoes geradas. Revise os cards abaixo e aprove as que quiser usar. Nada foi enviado.',
      );
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
      setSuccess('Variacao ativada.');
    }
  }

  async function onDiscardSet(generationSetId: string) {
    if (!editable || !composition) return;
    if (!window.confirm('Descartar esta variacao?')) return;
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
      setSuccess('Variacao descartada.');
    }
  }

  async function onApprove() {
    if (!canApprove || !composition) return;
    if (
      !window.confirm(
        'Aprovar esta mensagem? O texto aprovado sera usado nos disparos.',
      )
    ) {
      return;
    }
    const updated = await withToken((token) =>
      approveContentComposition(token, campaignId, compositionId, {}),
    );
    if (updated) {
      applyComposition(updated);
      setSuccess('Mensagem aprovada. Pode seguir para Enviar.');
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
      setSuccess('Bloco atualizado.');
    }
  }

  async function onSaveBrief() {
    if (!editable) return;
    const updated = await withToken((token) =>
      updateContentComposition(token, campaignId, compositionId, {
        marketingBrief: {
          ...brief,
          additionalInstructions: intention.trim() || brief.additionalInstructions,
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
      setSuccess('Contexto avancado salvo.');
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

  async function onGenerateAiAdvanced(
    mode: 'FULL_SETS' | 'GREETING_ONLY' | 'BODY_ONLY' | 'CLOSING_ONLY',
  ) {
    if (!editable || !composition?.aiEnabled) return;
    const updated = await withToken((token) =>
      generateContentAiVariants(token, campaignId, compositionId, {
        mode,
        requireRecommendedBrief: false,
        intention: intention.trim() || undefined,
      }),
    );
    if (updated) {
      applyComposition(updated);
      setSuccess('Sugestoes geradas (revisao pendente).');
    }
  }

  function renderVariantList(type: ContentVariantType) {
    const list = variantsByType[type].filter(
      (v) => !(type === 'BODY' && v.source === 'BASE'),
    );
    return (
      <section className="rounded-md border border-[#ebeae3] bg-white p-3">
        <h4 className="text-sm font-semibold text-[#151515]">{TYPE_LABELS[type]}</h4>
        <ul className="mt-2 space-y-2">
          {list.map((variant) => (
            <li key={variant.id} className="rounded border border-[#ebeae3] p-2 text-sm">
              {editingVariantId === variant.id ? (
                <div className="space-y-2">
                  <textarea
                    className="w-full rounded-md border border-[#c9c8c0] px-2 py-1.5"
                    rows={3}
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    disabled={!editable || busy}
                  />
                  <button
                    type="button"
                    className="rounded-md bg-[#24382b] px-2 py-1 text-xs font-semibold text-white"
                    disabled={!editable || busy}
                    onClick={() => void saveEditingVariant()}
                  >
                    Salvar
                  </button>
                </div>
              ) : (
                <>
                  <p className="whitespace-pre-wrap">{variant.text}</p>
                  {editable ? (
                    <button
                      type="button"
                      className="mt-1 text-xs underline"
                      disabled={busy}
                      onClick={() => {
                        setEditingVariantId(variant.id);
                        setEditingText(variant.text);
                      }}
                    >
                      Editar
                    </button>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
        {editable ? (
          <div className="mt-2 space-y-2">
            <textarea
              className="w-full rounded-md border border-[#c9c8c0] px-2 py-1.5 text-sm"
              rows={2}
              value={draftByType[type]}
              onChange={(e) =>
                setDraftByType((c) => ({ ...c, [type]: e.target.value }))
              }
              disabled={busy}
            />
            <button
              type="button"
              className="rounded-md border border-[#c9c8c0] px-2 py-1 text-xs"
              disabled={busy}
              onClick={() => void addVariant(type)}
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
      <div>
        <CampaignNav campaignId={campaignId} campaignName={campaign?.name} />
        <div className="rounded-md border border-[#deddd4] bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold text-[#151515]">
                {composition?.name ?? 'Convite inicial'}
              </h2>
              {composition ? (
                <p className="mt-1 text-sm text-[#65655f]">
                  {STATUS_LABELS[composition.status] ?? composition.status}
                </p>
              ) : null}
            </div>
            <Link
              className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm font-medium text-[#24382b]"
              href={`/dashboard/campaigns/${campaignId}/content-compositions`}
            >
              Voltar
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
              <section className="rounded-md border border-[#deddd4] bg-[#fafaf8] p-4">
                <h3 className="font-semibold text-[#24382b]">1. Contexto do candidato</h3>
                {candidate ? (
                  <div className="mt-2 space-y-1 text-sm text-[#34342f]">
                    <p>
                      <span className="text-[#65655f]">Nome:</span> {candidate.name}
                      {candidate.office ? ` · ${candidate.office}` : ''}
                      {candidate.party ? ` · ${candidate.party}` : ''}
                    </p>
                    {candidate.toneOfVoice ? (
                      <p>
                        <span className="text-[#65655f]">Tom:</span>{' '}
                        {candidate.toneOfVoice}
                      </p>
                    ) : null}
                    {candidate.bio ? (
                      <p className="whitespace-pre-wrap">
                        <span className="text-[#65655f]">Bio:</span> {candidate.bio}
                      </p>
                    ) : null}
                    {(candidate.mainProposals ?? []).length > 0 ? (
                      <p>
                        <span className="text-[#65655f]">Pautas:</span>{' '}
                        {(candidate.mainProposals ?? []).join('; ')}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-[#8a5a00]">
                    Candidato ainda nao cadastrado.{' '}
                    <Link
                      className="underline"
                      href={`/dashboard/campaigns/${campaignId}/candidate`}
                    >
                      Preencher candidato
                    </Link>{' '}
                    melhora a qualidade das mensagens.
                  </p>
                )}
              </section>

              <section className="rounded-md border border-[#deddd4] p-4">
                <h3 className="font-semibold text-[#24382b]">2. O que a mensagem deve fazer</h3>
                <p className="mt-1 text-sm text-[#65655f]">
                  Um pedido curto. A IA usa isso junto com os dados do candidato.
                </p>
                <textarea
                  className="mt-3 w-full rounded-md border border-[#c9c8c0] px-3 py-2 text-sm disabled:bg-[#eee]"
                  rows={4}
                  value={intention}
                  onChange={(e) => setIntention(e.target.value)}
                  disabled={!editable || busy}
                  maxLength={2000}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    disabled={!editable || busy || !composition.aiEnabled}
                    onClick={() => void onGenerateInvite()}
                  >
                    {busy ? 'Gerando...' : 'Gerar 5 variacoes'}
                  </button>
                  {!composition.aiEnabled ? (
                    <p className="text-sm text-[#8a5a00]">
                      IA indisponivel (CONTENT_AI_ENABLED=false).
                    </p>
                  ) : null}
                </div>
              </section>

              <section className="rounded-md border border-[#deddd4] p-4">
                <h3 className="font-semibold text-[#24382b]">3. Revisar variacoes</h3>
                <p className="mt-1 text-sm text-[#65655f]">
                  Cada card e uma mensagem completa. Ative as que quiser usar no
                  disparo.
                </p>

                {(composition.generationSets ?? []).length === 0 ? (
                  <p className="mt-4 text-sm text-[#65655f]">
                    Ainda nao ha variacoes. Gere acima para comecar.
                  </p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {composition.generationSets!.map((set, index) => {
                      const fullMessage = [
                        set.greeting?.text,
                        set.body?.text,
                        set.closing?.text,
                      ]
                        .filter(Boolean)
                        .join('\n\n');
                      return (
                        <article
                          key={set.generationSetId}
                          className="rounded-md border border-[#ebeae3] bg-[#fafaf8] p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-[#151515]">
                              Variacao {index + 1}
                              {set.enabled ? ' · ativa' : ' · pendente'}
                            </p>
                            {set.marketingAngle ? (
                              <span className="text-xs text-[#65655f]">
                                {set.marketingAngle}
                              </span>
                            ) : null}
                          </div>
                          <pre className="mt-3 whitespace-pre-wrap font-sans text-sm text-[#34342f]">
                            {fullMessage}
                          </pre>
                          {set.coherenceAlerts?.length ? (
                            <ul className="mt-2 list-disc pl-5 text-xs text-[#8a5a00]">
                              {set.coherenceAlerts.map((a) => (
                                <li key={`${set.generationSetId}-${a.code}`}>
                                  {a.message}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          {editable ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {!set.enabled ? (
                                <button
                                  type="button"
                                  className="rounded-md bg-[#24382b] px-3 py-1.5 text-xs font-semibold text-white"
                                  disabled={busy}
                                  onClick={() => void onApproveSet(set.generationSetId)}
                                >
                                  Usar esta
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="rounded-md border border-[#c9c8c0] px-3 py-1.5 text-xs"
                                disabled={busy}
                                onClick={() => void onDiscardSet(set.generationSetId)}
                              >
                                Descartar
                              </button>
                            </div>
                          ) : null}
                          <details className="mt-3">
                            <summary className="cursor-pointer text-xs text-[#65655f]">
                              Editar blocos (saudacao / corpo / fechamento)
                            </summary>
                            <div className="mt-2 grid gap-2 md:grid-cols-3">
                              {(['GREETING', 'BODY', 'CLOSING'] as const).map((type) => {
                                const variant = composition.variants.find(
                                  (v) =>
                                    v.generationSetId === set.generationSetId &&
                                    v.type === type,
                                );
                                if (!variant) return null;
                                return (
                                  <div
                                    key={variant.id}
                                    className="rounded border border-[#ebeae3] bg-white p-2 text-xs"
                                  >
                                    <p className="font-medium text-[#65655f]">
                                      {TYPE_LABELS[type]}
                                    </p>
                                    {editingVariantId === variant.id ? (
                                      <div className="mt-1 space-y-1">
                                        <textarea
                                          className="w-full rounded border border-[#c9c8c0] px-2 py-1"
                                          rows={3}
                                          value={editingText}
                                          onChange={(e) => setEditingText(e.target.value)}
                                        />
                                        <button
                                          type="button"
                                          className="rounded bg-[#24382b] px-2 py-1 text-white"
                                          onClick={() => void saveEditingVariant()}
                                        >
                                          Salvar
                                        </button>
                                      </div>
                                    ) : (
                                      <>
                                        <p className="mt-1 whitespace-pre-wrap">
                                          {variant.text}
                                        </p>
                                        {editable ? (
                                          <button
                                            type="button"
                                            className="mt-1 underline"
                                            onClick={() => {
                                              setEditingVariantId(variant.id);
                                              setEditingText(variant.text);
                                            }}
                                          >
                                            Editar
                                          </button>
                                        ) : null}
                                      </>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </details>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>

              {canApprove && composition.status !== 'APPROVED' ? (
                <section className="rounded-md border border-[#deddd4] p-4">
                  <h3 className="font-semibold text-[#24382b]">4. Aprovar</h3>
                  <p className="mt-1 text-sm text-[#65655f]">
                    Ative ao menos uma variacao e aprove para liberar o uso no
                    disparo.
                  </p>
                  <button
                    type="button"
                    className="mt-3 rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    disabled={busy}
                    onClick={() => void onApprove()}
                  >
                    Aprovar mensagem
                  </button>
                </section>
              ) : null}

              {composition.status === 'APPROVED' ? (
                <p className="rounded-md border border-[#c9d9c4] bg-[#eef5ea] px-3 py-2 text-sm text-[#47624f]">
                  Mensagem aprovada. Proximo passo: Enviar no menu da campanha.
                </p>
              ) : null}

              <details className="rounded-md border border-[#deddd4] p-4">
                <summary className="cursor-pointer font-medium text-[#65655f]">
                  Ferramentas avancadas
                </summary>
                <div className="mt-4 space-y-4">
                  <form className="space-y-2" onSubmit={saveMeta}>
                    <label className="block text-sm">
                      Nome interno
                      <input
                        className="mt-1 w-full rounded-md border border-[#c9c8c0] px-3 py-2"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={!editable || busy}
                      />
                    </label>
                    {editable ? (
                      <button
                        type="submit"
                        className="rounded-md border border-[#c9c8c0] px-3 py-1.5 text-sm"
                        disabled={busy}
                      >
                        Salvar nome
                      </button>
                    ) : null}
                  </form>

                  <div>
                    <h4 className="text-sm font-semibold">Mensagem-base</h4>
                    <textarea
                      className="mt-2 w-full rounded-md border border-[#c9c8c0] px-3 py-2 text-sm"
                      rows={4}
                      value={baseText}
                      onChange={(e) => setBaseText(e.target.value)}
                      disabled={!editable || busy}
                    />
                    {editable ? (
                      <button
                        type="button"
                        className="mt-2 rounded-md border border-[#c9c8c0] px-3 py-1.5 text-sm"
                        disabled={busy || !baseVariant}
                        onClick={() => void saveBase()}
                      >
                        Salvar base
                      </button>
                    ) : null}
                  </div>

                  <div className="grid gap-3 lg:grid-cols-3">
                    {renderVariantList('GREETING')}
                    {renderVariantList('BODY')}
                    {renderVariantList('CLOSING')}
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {(
                      [
                        ['objective', 'Objetivo'],
                        ['offerDescription', 'Oferta'],
                        ['targetAudience', 'Publico'],
                        ['callToAction', 'CTA'],
                        ['tone', 'Tom'],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="block text-sm">
                        {label}
                        <textarea
                          className="mt-1 w-full rounded-md border border-[#c9c8c0] px-2 py-1.5 text-sm"
                          rows={2}
                          value={String(brief[key] ?? '')}
                          disabled={!editable || busy}
                          onChange={(e) =>
                            setBrief((b) => ({ ...b, [key]: e.target.value }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <label className="block text-sm">
                    Modo de combinacao
                    <select
                      className="mt-1 w-full rounded-md border border-[#c9c8c0] px-2 py-1.5"
                      value={combinationMode}
                      disabled={!editable || busy}
                      onChange={(e) =>
                        setCombinationMode(
                          e.target.value as 'LOCKED_SETS' | 'MIX_AND_MATCH',
                        )
                      }
                    >
                      <option value="LOCKED_SETS">Conjuntos travados</option>
                      <option value="MIX_AND_MATCH">Misturar</option>
                    </select>
                  </label>
                  {editable ? (
                    <button
                      type="button"
                      className="rounded-md border border-[#c9c8c0] px-3 py-1.5 text-sm"
                      disabled={busy}
                      onClick={() => void onSaveBrief()}
                    >
                      Salvar contexto avancado
                    </button>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-[#c9c8c0] px-3 py-1.5 text-sm"
                      disabled={!editable || busy || !composition.aiEnabled}
                      onClick={() => void onGenerateAiAdvanced('FULL_SETS')}
                    >
                      Gerar conjuntos (avancado)
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-[#c9c8c0] px-3 py-1.5 text-sm"
                      disabled={busy}
                      onClick={() => void onPreview()}
                    >
                      Preview
                    </button>
                  </div>
                  {preview ? (
                    <div className="space-y-2 text-sm">
                      {preview.previews.map((row) => (
                        <pre
                          key={row.contactId}
                          className="whitespace-pre-wrap rounded border border-[#ebeae3] bg-[#fafaf8] p-3 font-sans"
                        >
                          {row.renderedText}
                        </pre>
                      ))}
                    </div>
                  ) : null}
                </div>
              </details>
            </div>
          ) : null}
        </div>
      </div>
    </DashboardShell>
  );
}
