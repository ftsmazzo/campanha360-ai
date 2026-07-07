'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { TagBadge } from '../../../../../components/tag-badge';
import { DashboardShell } from '../../../../../components/dashboard-shell';
import {
  ApiError,
  AuthUser,
  CampaignItem,
  TagItem,
  clearStoredToken,
  createTag,
  deleteTag,
  fetchCampaign,
  fetchMe,
  fetchTags,
  getStoredToken,
  updateTag,
} from '../../../../../lib/api';
import { canWriteRole, getOrganizationRole } from '../../../../../lib/roles';

export default function CampaignTagsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const campaignId = params.id;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [campaign, setCampaign] = useState<CampaignItem | null>(null);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#47624f');
  const [description, setDescription] = useState('');
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canWrite = campaign
    ? canWriteRole(getOrganizationRole(user?.memberships, campaign.organizationId))
    : false;

  function resetForm() {
    setName('');
    setColor('#47624f');
    setDescription('');
    setEditingTagId(null);
  }

  function startEdit(tag: TagItem) {
    setEditingTagId(tag.id);
    setName(tag.name);
    setColor(tag.color ?? '#47624f');
    setDescription(tag.description ?? '');
    setError(null);
    setSuccess(null);
  }

  useEffect(() => {
    async function load() {
      const token = getStoredToken();
      if (!token) {
        router.replace('/login');
        return;
      }

      try {
        const [me, campaignItem, tagItems] = await Promise.all([
          fetchMe(token),
          fetchCampaign(token, campaignId),
          fetchTags(token, campaignId),
        ]);
        setUser(me);
        setCampaign(campaignItem);
        setTags(tagItems);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearStoredToken();
          router.replace('/login');
          return;
        }
        setError(err instanceof ApiError ? err.message : 'Nao foi possivel carregar tags');
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
      if (editingTagId) {
        const updated = await updateTag(token, campaignId, editingTagId, {
          name,
          color: color || undefined,
          description: description || undefined,
        });
        setTags((current) => current.map((item) => (item.id === updated.id ? updated : item)));
        setSuccess('Tag atualizada com sucesso.');
      } else {
        const created = await createTag(token, campaignId, {
          name,
          color: color || undefined,
          description: description || undefined,
        });
        setTags((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
        setSuccess('Tag criada com sucesso.');
      }
      resetForm();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel salvar a tag');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(tagId: string) {
    const token = getStoredToken();
    if (!token || !canWrite) return;

    setError(null);
    setSuccess(null);

    try {
      await deleteTag(token, campaignId, tagId);
      setTags((current) => current.filter((item) => item.id !== tagId));
      if (editingTagId === tagId) resetForm();
      setSuccess('Tag removida com sucesso.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel remover a tag');
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f7f5]">
        <p className="text-[#65655f]">Carregando tags...</p>
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
          <h2 className="text-2xl font-semibold text-[#151515]">Tags da campanha</h2>
          {campaign ? <p className="mt-2 text-sm text-[#65655f]">{campaign.name}</p> : null}
          <p className="mt-2 text-sm text-[#65655f]">
            Classifique contatos com tags manuais exclusivas desta campanha.
          </p>
        </div>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {success ? <p className="text-sm text-[#47624f]">{success}</p> : null}

        {canWrite ? (
          <form className="space-y-4 rounded-md border border-[#deddd4] bg-white p-4" onSubmit={handleSubmit}>
            <h3 className="font-medium text-[#24382b]">
              {editingTagId ? 'Editar tag' : 'Nova tag'}
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
              <span className="text-sm font-medium text-[#34342f]">Cor</span>
              <input
                className="mt-1 h-10 w-full rounded-md border border-[#d7d6cd] bg-white px-1 py-1"
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-[#34342f]">Descricao</span>
              <textarea
                className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-md bg-[#24382b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                type="submit"
                disabled={saving}
              >
                {saving ? 'Salvando...' : editingTagId ? 'Salvar tag' : 'Criar tag'}
              </button>
              {editingTagId ? (
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
            Seu perfil possui acesso somente leitura. Tags podem ser visualizadas, mas nao editadas.
          </p>
        )}

        <section className="space-y-3 rounded-md border border-[#deddd4] bg-white p-4">
          <h3 className="font-medium text-[#24382b]">Tags cadastradas</h3>
          {tags.length === 0 ? (
            <p className="text-sm text-[#65655f]">Nenhuma tag cadastrada nesta campanha.</p>
          ) : (
            <ul className="space-y-3">
              {tags.map((tag) => (
                <li
                  key={tag.id}
                  className="flex flex-col gap-3 rounded-md border border-[#eef2ea] bg-[#f7f7f5] p-3 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <TagBadge tag={tag} />
                    {tag.description ? (
                      <p className="mt-2 text-sm text-[#65655f]">{tag.description}</p>
                    ) : null}
                  </div>
                  {canWrite ? (
                    <div className="flex gap-2">
                      <button
                        className="rounded-md border border-[#c9c8c0] px-3 py-2 text-sm font-medium text-[#24382b]"
                        type="button"
                        onClick={() => startEdit(tag)}
                      >
                        Editar
                      </button>
                      <button
                        className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-800"
                        type="button"
                        onClick={() => handleDelete(tag.id)}
                      >
                        Excluir
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <Link
          className="inline-block text-sm font-medium text-[#24382b] underline"
          href={`/dashboard/campaigns/${campaignId}/contacts`}
        >
          Ir para contatos
        </Link>
      </div>
    </DashboardShell>
  );
}
