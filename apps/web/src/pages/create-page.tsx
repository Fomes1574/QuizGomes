import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import type { ThemeArtwork } from '@quiz-gomes/domain';
import { Button } from '../components/button.js';
import { ThemeArtwork as ThemeArtworkPreview } from '../components/theme-artwork.js';
import { useAuth } from '../features/auth-context.js';
import { apiRequest, apiUpload } from '../lib/api.js';
import type { AdminThemeSummary, Category, ThemeSummary } from '../lib/models.js';
import type { ThemeArtworkDraft } from '../components/theme-artwork-editor.js';

const ThemeArtworkEditor = lazy(() => import('../components/theme-artwork-editor.js'));

const themeStatusLabel: Record<AdminThemeSummary['status'], string> = {
  ACTIVE: 'Ativo',
  DISABLED: 'Desativado',
  PENDING: 'Pendente',
  REJECTED: 'Rejeitado',
};

function draftFromArtwork(artwork: ThemeArtwork): ThemeArtworkDraft {
  if (artwork.kind === 'ICON') return { iconKey: artwork.iconKey, kind: 'ICON' };
  if (artwork.kind === 'CUSTOM') return { image: null, kind: 'CUSTOM' };
  return { kind: 'NONE' };
}

async function persistArtwork(
  theme: ThemeSummary,
  draft: ThemeArtworkDraft,
  getToken: (forceRefresh?: boolean) => Promise<string | null>,
  token: string,
): Promise<ThemeSummary> {
  if (draft.kind === 'CUSTOM') {
    if (draft.image === null) {
      if (theme.artwork.kind === 'CUSTOM') return theme;
      throw new Error('Selecione e confirme o recorte da imagem antes de salvar.');
    }
    const result = await apiUpload<{ theme: ThemeSummary }>(`/api/admin/themes/${encodeURIComponent(theme.id)}/artwork`, {
      body: draft.image.blob,
      getToken,
      headers: { 'If-Match': String(theme.artwork.version) },
      method: 'PUT',
      token,
    });
    return result.theme;
  }
  if (draft.kind === 'ICON' && theme.artwork.kind === 'ICON' && theme.artwork.iconKey === draft.iconKey) return theme;
  if (draft.kind === 'NONE' && theme.artwork.kind === 'NONE') return theme;
  const result = await apiRequest<{ theme: ThemeSummary }>(`/api/admin/themes/${encodeURIComponent(theme.id)}/artwork`, {
    body: {
      expectedVersion: theme.artwork.version,
      ...(draft.kind === 'ICON' ? { iconKey: draft.iconKey } : {}),
      kind: draft.kind,
    },
    getToken,
    method: 'PATCH',
    token,
  });
  return result.theme;
}

export function CreatePage() {
  const { firebaseUser, getToken, profile, role, signIn } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [creationArtwork, setCreationArtwork] = useState<ThemeArtworkDraft>({ kind: 'NONE' });
  const [adminRefreshKey, setAdminRefreshKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    void apiRequest<{ categories: Category[] }>('/api/categories')
      .then((result) => {
        setCategories(result.categories);
        setCategoryId((current) => current || result.categories[0]?.id || '');
      })
      .catch(() => setMessage({ kind: 'error', text: 'Não foi possível carregar as categorias.' }));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    let createdTheme: ThemeSummary | null = null;
    try {
      const token = await getToken();
      if (token === null || profile === null) throw new Error('Entre e conclua seu perfil para enviar um tema.');
      if (role === 'ADMIN' && creationArtwork.kind === 'CUSTOM' && creationArtwork.image === null) {
        throw new Error('Confirme o recorte da imagem personalizada antes de criar o tema.');
      }
      const result = await apiRequest<{ theme: ThemeSummary }>('/api/themes', {
        body: { categoryId, description, name }, getToken, method: 'POST', token,
      });
      createdTheme = result.theme;
      const theme = role === 'ADMIN'
        ? await persistArtwork(result.theme, creationArtwork, getToken, token)
        : result.theme;
      setMessage({ kind: 'success', text: `“${theme.name}” foi enviado para revisão${role === 'ADMIN' ? ' com a arte escolhida' : ''}.` });
      setName('');
      setDescription('');
      setCreationArtwork({ kind: 'NONE' });
      setAdminRefreshKey((current) => current + 1);
    } catch (submitError) {
      if (createdTheme !== null) {
        setName('');
        setDescription('');
        setCreationArtwork({ kind: 'NONE' });
        setAdminRefreshKey((current) => current + 1);
        setMessage({
          kind: 'error',
          text: `“${createdTheme.name}” foi criado, mas a arte não pôde ser salva. Use a seção Arte dos temas abaixo para concluir.`,
        });
      } else {
        setMessage({ kind: 'error', text: submitError instanceof Error ? submitError.message : 'Não foi possível enviar o tema.' });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page page--create">
      <div className="page-heading"><div><span className="eyebrow">Contribua</span><h1>Criar tema</h1><p>Proponha um novo assunto. A publicação acontece somente após revisão.</p></div></div>
      {firebaseUser === null ? (
        <div className="auth-card">
          <span className="auth-card__symbol">+</span>
          <h2>Entre para criar</h2>
          <p>Seu perfil identifica a autoria e, após aprovação, torna você owner do tema.</p>
          <Button onClick={() => void signIn()}>Continuar com Google</Button>
        </div>
      ) : (
        <form className="form-card" onSubmit={(event) => void submit(event)}>
          <label className="field"><span>Categoria</span><select onChange={(event) => setCategoryId(event.target.value)} required value={categoryId}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label className="field"><span>Nome do tema</span><input maxLength={60} minLength={2} onChange={(event) => setName(event.target.value)} placeholder="Ex.: The Last of Us" required value={name} /></label>
          <label className="field"><span>Descrição curta</span><textarea maxLength={240} minLength={12} onChange={(event) => setDescription(event.target.value)} placeholder="Diga em poucas palavras o que este tema reúne." required rows={4} value={description} /><small>{description.length}/240</small></label>
          {role === 'ADMIN' ? (
            <Suspense fallback={<p className="inline-notice">Abrindo editor de arte…</p>}>
              <ThemeArtworkEditor currentArtwork={{ kind: 'NONE', version: 0 }} disabled={saving} name={name || 'Novo tema'} onChange={setCreationArtwork} value={creationArtwork} />
            </Suspense>
          ) : null}
          <aside className="review-note"><strong>Antes de aparecer para todos</strong><p>A administração verifica nome, categoria e escopo. Perguntas são enviadas em uma etapa separada depois da aprovação.</p></aside>
          {message && <p className={`form-message form-message--${message.kind}`} role="status">{message.text}</p>}
          <Button disabled={saving || profile === null} type="submit">{saving ? 'Enviando…' : 'Enviar para revisão'}</Button>
        </form>
      )}
      {role === 'ADMIN' ? <AdminThemeArtworkManager getToken={getToken} refreshKey={adminRefreshKey} /> : null}
    </section>
  );
}

function AdminThemeArtworkManager({
  getToken,
  refreshKey,
}: {
  getToken: (forceRefresh?: boolean) => Promise<string | null>;
  refreshKey: number;
}) {
  const [themes, setThemes] = useState<AdminThemeSummary[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<ThemeArtworkDraft>({ kind: 'NONE' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const selected = themes.find((theme) => theme.id === selectedId) ?? null;

  useEffect(() => {
    const controller = new AbortController();
    const delay = window.setTimeout(() => {
      setLoading(true);
      setMessage(null);
      const params = new URLSearchParams();
      if (search.trim() !== '') params.set('search', search.trim());
      void getToken().then((token) => {
        if (token === null) throw new Error('Sua sessão expirou. Entre novamente.');
        return apiRequest<{ themes: AdminThemeSummary[] }>(`/api/admin/themes?${params}`, {
          getToken,
          signal: controller.signal,
          token,
        });
      }).then((result) => {
        setThemes(result.themes);
        const nextSelected = result.themes[0] ?? null;
        setSelectedId(nextSelected?.id ?? '');
        setDraft(nextSelected === null ? { kind: 'NONE' } : draftFromArtwork(nextSelected.artwork));
        setMessage(null);
      }).catch((loadError: unknown) => {
        if (controller.signal.aborted || (loadError instanceof DOMException && loadError.name === 'AbortError')) return;
        setMessage({ kind: 'error', text: loadError instanceof Error ? loadError.message : 'Não foi possível abrir os temas.' });
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    }, 180);
    return () => {
      controller.abort();
      window.clearTimeout(delay);
    };
  }, [getToken, refreshKey, search]);

  function selectTheme(themeId: string) {
    setSelectedId(themeId);
    const theme = themes.find((candidate) => candidate.id === themeId);
    if (theme !== undefined) setDraft(draftFromArtwork(theme.artwork));
    setMessage(null);
  }

  async function save() {
    if (selected === null) return;
    setSaving(true);
    setMessage(null);
    try {
      const token = await getToken();
      if (token === null) throw new Error('Sua sessão expirou. Entre novamente.');
      const updated = await persistArtwork(selected, draft, getToken, token);
      const withStatus: AdminThemeSummary = { ...updated, status: selected.status };
      setThemes((current) => current.map((theme) => theme.id === withStatus.id ? withStatus : theme));
      setDraft(draftFromArtwork(withStatus.artwork));
      setMessage({ kind: 'success', text: `Arte de “${withStatus.name}” atualizada.` });
    } catch (saveError) {
      setMessage({ kind: 'error', text: saveError instanceof Error ? saveError.message : 'Não foi possível salvar a arte.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="admin-theme-artwork" aria-labelledby="admin-theme-artwork-title">
      <div className="section-heading"><div><span className="eyebrow">Administração</span><h2 id="admin-theme-artwork-title">Arte dos temas</h2></div></div>
      <p>Escolha um tema existente e defina uma única apresentação ativa. A imagem anterior é substituída.</p>
      <label className="search-field admin-theme-artwork__search">
        <span className="sr-only">Buscar tema para editar a arte</span>
        <input onChange={(event) => setSearch(event.target.value)} placeholder="Buscar tema para editar" type="search" value={search} />
      </label>
      {loading ? <p className="inline-notice">Carregando temas…</p> : null}
      {!loading && themes.length === 0 ? <p className="inline-notice">Nenhum tema disponível.</p> : null}
      {themes.length > 0 ? (
        <>
          <label className="field"><span>Tema</span><select disabled={loading} onChange={(event) => selectTheme(event.target.value)} value={selectedId}>{themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name} · {themeStatusLabel[theme.status]}</option>)}</select></label>
          {selected !== null ? (
            <div className="admin-theme-artwork__selected">
              <ThemeArtworkPreview artwork={selected.artwork} decorative={false} eager name={selected.name} />
              <div><strong>{selected.name}</strong><small>{selected.categoryName} · versão {selected.artwork.version}</small></div>
            </div>
          ) : null}
          {selected !== null ? (
            <Suspense fallback={<p className="inline-notice">Abrindo editor de arte…</p>}>
              <ThemeArtworkEditor currentArtwork={selected.artwork} disabled={loading || saving} key={`${selected.id}:${selected.artwork.version}`} name={selected.name} onChange={setDraft} value={draft} />
            </Suspense>
          ) : null}
          {message !== null ? <p className={`form-message form-message--${message.kind}`} role="status">{message.text}</p> : null}
          <Button disabled={loading || saving || selected === null} onClick={() => void save()} type="button">{saving ? 'Salvando…' : 'Salvar arte'}</Button>
        </>
      ) : null}
    </section>
  );
}
