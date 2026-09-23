import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { ReportStatus, ThemeArtwork } from '@quiz-gomes/domain';
import { Button } from '../components/button.js';
import { ThemeArtwork as ThemeArtworkPreview } from '../components/theme-artwork.js';
import { useAuth } from '../features/auth-context.js';
import { apiRequest, apiUpload } from '../lib/api.js';
import type { AdminQuestionReportEntry, AdminThemeSummary, Category, ThemeSummary } from '../lib/models.js';
import { DIFFICULTY_LABEL } from '../lib/challenges.js';
import { REPORT_REASON_LABEL } from '../lib/reports.js';
import type { ThemeArtworkDraft } from '../components/theme-artwork-editor.js';
import { AdminAuditLogPanel, AdminUsersPanel } from './admin-directory-panels.js';
import { AdminCategoriesPanel, AdminQuestionEditorialPanel, AdminThemeModerationPanel } from './admin-editorial-panels.js';

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

export function CreatePage({ adminOnly = false }: { adminOnly?: boolean }) {
  const { firebaseUser, getToken, profile, role, signIn } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [creationArtwork, setCreationArtwork] = useState<ThemeArtworkDraft>({ kind: 'NONE' });
  const [catalogRefreshKey, setCatalogRefreshKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const refreshCatalog = useCallback(() => {
    setCatalogRefreshKey((current) => current + 1);
  }, []);

  useEffect(() => {
    void apiRequest<{ categories: Category[] }>('/api/categories')
      .then((result) => {
        setCategories(result.categories);
        setCategoryId((current) => result.categories.some((category) => category.id === current)
          ? current
          : result.categories[0]?.id || '');
      })
      .catch(() => setMessage({ kind: 'error', text: 'Não foi possível carregar as categorias.' }));
  }, [catalogRefreshKey]);

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
      refreshCatalog();
    } catch (submitError) {
      if (createdTheme !== null) {
        setName('');
        setDescription('');
        setCreationArtwork({ kind: 'NONE' });
        refreshCatalog();
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

  if (adminOnly && role !== 'ADMIN') {
    return (
      <section className="page page--narrow">
        <div className="empty-state"><h1>Administração</h1><p>Esta área é restrita à administração.</p></div>
      </section>
    );
  }

  return (
    <section className="page page--create">
      <div className="page-heading"><div><span className="eyebrow">{adminOnly ? 'Administração' : 'Contribua'}</span><h1>{adminOnly ? 'Conteúdo e moderação' : 'Criar tema'}</h1><p>{adminOnly ? 'Gerencie o catálogo, revisões e auditoria.' : 'Proponha um novo assunto. A publicação acontece somente após revisão.'}</p></div></div>
      {firebaseUser === null ? (
        <div className="auth-card">
          <span className="auth-card__symbol">+</span>
          <h2>{adminOnly ? 'Entre para administrar' : 'Entre para criar'}</h2>
          <p>{adminOnly ? 'A administração pode cadastrar e moderar o catálogo.' : 'Seu perfil identifica a autoria e, após aprovação, torna você owner do tema.'}</p>
          <Button onClick={() => void signIn()}>Continuar com Google</Button>
        </div>
      ) : (
        <form className="form-card" onSubmit={(event) => void submit(event)}>
          {adminOnly ? <h2>Novo tema</h2> : null}
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
      {role === 'ADMIN' ? <AdminCategoriesPanel getToken={getToken} onCatalogChanged={refreshCatalog} /> : null}
      {role === 'ADMIN' ? <AdminThemeModerationPanel getToken={getToken} onCatalogChanged={refreshCatalog} refreshKey={catalogRefreshKey} /> : null}
      {role === 'ADMIN' ? <AdminThemeArtworkManager getToken={getToken} refreshKey={catalogRefreshKey} /> : null}
      {role === 'ADMIN' ? <AdminQuestionEditorialPanel getToken={getToken} refreshKey={catalogRefreshKey} /> : null}
      {role === 'ADMIN' ? <AdminReportsPanel getToken={getToken} /> : null}
      {role === 'ADMIN' ? <AdminUsersPanel currentUserId={profile?.userId ?? null} getToken={getToken} /> : null}
      {role === 'ADMIN' ? <AdminAuditLogPanel getToken={getToken} refreshKey={catalogRefreshKey} /> : null}
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
  const selectedIdRef = useRef(selectedId);
  const selected = themes.find((theme) => theme.id === selectedId) ?? null;

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

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
        const nextSelected = result.themes.find((theme) => theme.id === selectedIdRef.current) ?? result.themes[0] ?? null;
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
      const withStatus: AdminThemeSummary = {
        ...updated,
        createdByUserId: selected.createdByUserId,
        origin: selected.origin,
        rejectionNote: selected.rejectionNote,
        revision: selected.revision,
        status: selected.status,
      };
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

const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  DISMISSED: 'Dispensadas',
  IN_REVIEW: 'Em revisão',
  OPEN: 'Abertas',
  RESOLVED: 'Resolvidas',
};

function ReportCard({
  entry,
  getToken,
  onResolved,
}: {
  entry: AdminQuestionReportEntry;
  getToken: (forceRefresh?: boolean) => Promise<string | null>;
  onResolved: (report: AdminQuestionReportEntry['report']) => void;
}) {
  const { questionMetadata, questionSnapshot, report } = entry;
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<ReportStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canAct = report.status === 'OPEN' || report.status === 'IN_REVIEW';

  async function resolve(status: ReportStatus) {
    setBusy(status);
    setError(null);
    try {
      const token = await getToken();
      if (token === null) throw new Error('Sua sessão expirou. Entre novamente.');
      const result = await apiRequest<{ report: AdminQuestionReportEntry['report'] }>(
        `/api/admin/reports/${encodeURIComponent(report.id)}/resolve`,
        { body: { resolutionNote: note.trim() === '' ? undefined : note.trim(), status }, getToken, method: 'POST', token },
      );
      onResolved(result.report);
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : 'Não foi possível atualizar a denúncia.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="report-card">
      <header>
        <strong>{REPORT_REASON_LABEL[report.reason]}</strong>
        <small>{report.contextKind === 'MATCH' ? 'Partida' : 'Desafio'} · rodada {report.roundNumber} · {new Date(report.createdAt).toLocaleString('pt-BR')}</small>
      </header>
      {questionSnapshot === null ? (
        <p className="inline-notice">A rodada original não está mais disponível para revisão.</p>
      ) : (
        <>
          <p className="report-card__prompt">{questionSnapshot.prompt}</p>
          <ol className="report-card__options">
            {questionSnapshot.options.map((option, index) => {
              const correct = index === questionSnapshot.correctOption;
              return (
                <li className={correct ? 'report-card__option--correct' : ''} key={option}>
                  {correct && <span aria-hidden="true">✓ </span>}
                  {option}
                  {correct && <span className="sr-only"> (alternativa correta)</span>}
                </li>
              );
            })}
          </ol>
        </>
      )}
      {questionMetadata !== null && (
        <div className="report-card__metadata">
          <p><strong>{questionMetadata.themeName}</strong> · {DIFFICULTY_LABEL[questionMetadata.difficulty]}</p>
          {questionMetadata.statistics === null ? (
            <p>Sem estatísticas registradas para esta pergunta.</p>
          ) : (
            <p>
              {questionMetadata.statistics.useCount} usos · {questionMetadata.statistics.answerCount} respostas ·
              {' '}{questionMetadata.statistics.correctCount} acertos · {questionMetadata.statistics.wrongCount} erros ·
              {' '}A/B/C/D: {questionMetadata.statistics.optionACount}/{questionMetadata.statistics.optionBCount}/{questionMetadata.statistics.optionCCount}/{questionMetadata.statistics.optionDCount}
            </p>
          )}
          {questionMetadata.sources.length === 0 ? <p>Sem fonte vinculada no registro atual.</p> : (
            <ul className="report-card__sources" aria-label="Fontes da pergunta">
              {questionMetadata.sources.map((source) => (
                <li key={source.url}><a href={source.url} rel="noreferrer" target="_blank">{source.title ?? source.url}</a> <small>({source.sourceKind})</small></li>
              ))}
            </ul>
          )}
        </div>
      )}
      {report.note !== null && <p className="report-card__note"><strong>Nota de quem denunciou:</strong> {report.note}</p>}
      {report.resolutionNote !== null && <p className="report-card__note"><strong>Resolução:</strong> {report.resolutionNote}</p>}
      {canAct && (
        <>
          <label className="field"><span>Nota de resolução (opcional)</span><textarea maxLength={280} onChange={(event) => setNote(event.target.value)} rows={2} value={note} /></label>
          {error !== null && <p className="form-error" role="alert">{error}</p>}
          <div className="report-card__actions">
            {report.status === 'OPEN' && (
              <Button disabled={busy !== null} onClick={() => void resolve('IN_REVIEW')} type="button" variant="ghost">
                {busy === 'IN_REVIEW' ? 'Marcando...' : 'Marcar em revisão'}
              </Button>
            )}
            <Button disabled={busy !== null} onClick={() => void resolve('DISMISSED')} type="button" variant="ghost">
              {busy === 'DISMISSED' ? 'Dispensando...' : 'Dispensar'}
            </Button>
            <Button disabled={busy !== null} onClick={() => void resolve('RESOLVED')} type="button">
              {busy === 'RESOLVED' ? 'Resolvendo...' : 'Resolver'}
            </Button>
          </div>
        </>
      )}
    </article>
  );
}

function AdminReportsPanel({ getToken }: { getToken: (forceRefresh?: boolean) => Promise<string | null> }) {
  const [status, setStatus] = useState<ReportStatus>('OPEN');
  const [reports, setReports] = useState<AdminQuestionReportEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  async function load(status_: ReportStatus, after: string | null, replace: boolean) {
    setLoading(true);
    setMessage(null);
    try {
      const token = await getToken();
      if (token === null) throw new Error('Sua sessão expirou. Entre novamente.');
      const params = new URLSearchParams({ status: status_ });
      if (after !== null) params.set('cursor', after);
      const result = await apiRequest<{ nextCursor: string | null; reports: AdminQuestionReportEntry[] }>(
        `/api/admin/reports?${params}`, { getToken, token },
      );
      setReports((current) => replace ? result.reports : [...current, ...result.reports]);
      setCursor(result.nextCursor);
    } catch (loadError) {
      setMessage(loadError instanceof Error ? loadError.message : 'Não foi possível abrir as denúncias.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Microtask para não chamar setState de forma síncrona no corpo do efeito.
    queueMicrotask(() => { void load(status, null, true); });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load é recriada a cada render; só o status decide a busca.
  }, [status]);

  return (
    <section className="admin-reports" aria-labelledby="admin-reports-title">
      <div className="section-heading"><div><span className="eyebrow">Administração</span><h2 id="admin-reports-title">Denúncias de perguntas</h2></div></div>
      <div className="segmented" role="tablist" aria-label="Status da denúncia">
        {(['OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED'] as ReportStatus[]).map((value) => (
          <button
            aria-selected={status === value}
            className={status === value ? 'segmented__active' : ''}
            key={value}
            onClick={() => setStatus(value)}
            role="tab"
            type="button"
          >{REPORT_STATUS_LABEL[value]}</button>
        ))}
      </div>
      {message !== null && <p className="form-message form-message--error" role="status">{message}</p>}
      {loading && reports.length === 0 ? <p className="inline-notice">Carregando denúncias…</p> : null}
      {!loading && reports.length === 0 && message === null ? <p className="inline-notice">Nenhuma denúncia {REPORT_STATUS_LABEL[status].toLowerCase()}.</p> : null}
      <div className="report-list">
        {reports.map((entry) => (
          <ReportCard
            entry={entry}
            getToken={getToken}
            key={entry.report.id}
            onResolved={() => setReports((current) => current.filter((candidate) => candidate.report.id !== entry.report.id))}
          />
        ))}
      </div>
      {cursor !== null && (
        <Button disabled={loading} onClick={() => void load(status, cursor, false)} type="button" variant="ghost">
          {loading ? 'Carregando…' : 'Carregar mais'}
        </Button>
      )}
    </section>
  );
}
