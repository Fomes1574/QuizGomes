import { useEffect, useState } from 'react';
import { Button } from '../components/button.js';
import { apiRequest } from '../lib/api.js';
import { DIFFICULTY_LABEL } from '../lib/challenges.js';
import type {
  AdminThemeSummary, CategoryAdmin, EditorialQuestion, EditorialQuestionPage, QuestionSourceInput,
} from '../lib/models.js';

type GetToken = (forceRefresh?: boolean) => Promise<string | null>;

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function AdminCategoriesPanel({ getToken }: { getToken: GetToken }) {
  const [categories, setCategories] = useState<CategoryAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    void apiRequest<{ categories: CategoryAdmin[] }>('/api/admin/categories', { getToken })
      .then((result) => setCategories(result.categories))
      .catch((loadError: unknown) => setMessage({ kind: 'error', text: errorText(loadError, 'Não foi possível abrir as categorias.') }))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    // Microtask para não chamar setState de forma síncrona no corpo do efeito.
    queueMicrotask(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load é recriada a cada render; só getToken decide a busca.
  }, [getToken]);

  async function create() {
    setCreating(true);
    setMessage(null);
    try {
      const result = await apiRequest<{ category: CategoryAdmin }>('/api/admin/categories', {
        body: { name, slug, sortOrder }, getToken, method: 'POST',
      });
      setCategories((current) => [...current, result.category].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)));
      setName('');
      setSlug('');
      setSortOrder(0);
      setMessage({ kind: 'success', text: `Categoria “${result.category.name}” criada.` });
    } catch (createError) {
      setMessage({ kind: 'error', text: errorText(createError, 'Não foi possível criar a categoria.') });
    } finally {
      setCreating(false);
    }
  }

  async function save(category: CategoryAdmin, patch: Partial<Pick<CategoryAdmin, 'name' | 'sortOrder' | 'status'>>) {
    setSavingId(category.id);
    setMessage(null);
    try {
      const result = await apiRequest<{ category: CategoryAdmin }>(`/api/admin/categories/${encodeURIComponent(category.id)}`, {
        body: {
          expectedRevision: category.revision, name: category.name, sortOrder: category.sortOrder, status: category.status, ...patch,
        },
        getToken,
        method: 'PATCH',
      });
      setCategories((current) => current.map((item) => item.id === result.category.id ? result.category : item));
    } catch (saveError) {
      setMessage({ kind: 'error', text: errorText(saveError, 'Não foi possível salvar a categoria.') });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="admin-panel" aria-labelledby="admin-categories-title">
      <div className="section-heading"><div><span className="eyebrow">Administração</span><h2 id="admin-categories-title">Categorias</h2></div></div>
      <div className="admin-panel__form">
        <label className="field"><span>Nome</span><input maxLength={60} minLength={2} onChange={(event) => setName(event.target.value)} value={name} /></label>
        <label className="field"><span>Slug</span><input maxLength={60} minLength={2} onChange={(event) => setSlug(event.target.value)} pattern="[a-z0-9-]+" value={slug} /></label>
        <label className="field"><span>Ordem</span><input max={9_999} min={0} onChange={(event) => setSortOrder(Number(event.target.value))} type="number" value={sortOrder} /></label>
        <Button disabled={creating || name.trim() === '' || slug.trim() === ''} onClick={() => void create()} type="button">
          {creating ? 'Criando…' : 'Criar categoria'}
        </Button>
      </div>
      {message !== null && <p className={`form-message form-message--${message.kind}`} role="status">{message.text}</p>}
      {loading ? <p className="inline-notice">Carregando categorias…</p> : null}
      <ul className="admin-list">
        {categories.map((category) => (
          <li className="admin-list__row" key={category.id}>
            <input
              onBlur={(event) => event.target.value.trim() !== category.name && save(category, { name: event.target.value.trim() })}
              defaultValue={category.name}
              key={`${category.id}:${category.revision}:name`}
              maxLength={60}
            />
            <input
              onBlur={(event) => Number(event.target.value) !== category.sortOrder && save(category, { sortOrder: Number(event.target.value) })}
              defaultValue={category.sortOrder}
              key={`${category.id}:${category.revision}:order`}
              min={0}
              type="number"
            />
            <select
              disabled={savingId === category.id}
              onChange={(event) => save(category, { status: event.target.value as CategoryAdmin['status'] })}
              value={category.status}
            >
              <option value="ACTIVE">Ativa</option>
              <option value="DISABLED">Desativada</option>
            </select>
            <small>{category.slug}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}

const THEME_STATUS_LABEL: Record<AdminThemeSummary['status'], string> = {
  ACTIVE: 'Ativo', DISABLED: 'Desativado', PENDING: 'Pendente', REJECTED: 'Rejeitado',
};
const THEME_STATUS_TABS: AdminThemeSummary['status'][] = ['PENDING', 'ACTIVE', 'REJECTED', 'DISABLED'];

export function AdminThemeModerationPanel({ getToken }: { getToken: GetToken }) {
  const [status, setStatus] = useState<AdminThemeSummary['status']>('PENDING');
  const [themes, setThemes] = useState<AdminThemeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  function load() {
    setLoading(true);
    setMessage(null);
    void apiRequest<{ themes: AdminThemeSummary[] }>('/api/admin/themes', { getToken })
      .then((result) => setThemes(result.themes))
      .catch((loadError: unknown) => setMessage(errorText(loadError, 'Não foi possível abrir os temas.')))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    // Microtask para não chamar setState de forma síncrona no corpo do efeito.
    queueMicrotask(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load é recriada a cada render; só getToken decide a busca.
  }, [getToken]);

  async function act(theme: AdminThemeSummary, action: 'approve' | 'deactivate' | 'reject') {
    setBusyId(theme.id);
    setMessage(null);
    try {
      const body = action === 'reject' ? { expectedRevision: theme.revision, note: note[theme.id]?.trim() || undefined } : { expectedRevision: theme.revision };
      const result = await apiRequest<{ theme: AdminThemeSummary }>(`/api/admin/themes/${encodeURIComponent(theme.id)}/${action}`, {
        body, getToken, method: 'POST',
      });
      setThemes((current) => current.map((item) => item.id === result.theme.id ? result.theme : item));
    } catch (actError) {
      setMessage(errorText(actError, 'Não foi possível concluir a ação.'));
    } finally {
      setBusyId(null);
    }
  }

  const visible = themes.filter((theme) => theme.status === status);

  return (
    <section className="admin-panel" aria-labelledby="admin-theme-moderation-title">
      <div className="section-heading"><div><span className="eyebrow">Administração</span><h2 id="admin-theme-moderation-title">Moderação de temas</h2></div></div>
      <div className="segmented" role="tablist" aria-label="Status do tema">
        {THEME_STATUS_TABS.map((value) => (
          <button aria-selected={status === value} className={status === value ? 'segmented__active' : ''} key={value} onClick={() => setStatus(value)} role="tab" type="button">
            {THEME_STATUS_LABEL[value]}
          </button>
        ))}
      </div>
      {message !== null && <p className="form-message form-message--error" role="status">{message}</p>}
      {loading ? <p className="inline-notice">Carregando temas…</p> : null}
      {!loading && visible.length === 0 ? <p className="inline-notice">Nenhum tema {THEME_STATUS_LABEL[status].toLowerCase()}.</p> : null}
      <div className="admin-card-list">
        {visible.map((theme) => (
          <article className="admin-card" key={theme.id}>
            <header><strong>{theme.name}</strong><small>{theme.categoryName} · {theme.origin === 'USER' ? 'Proposto por usuário' : 'Oficial'}</small></header>
            <p>{theme.description}</p>
            {theme.rejectionNote !== null && <p className="report-card__note"><strong>Motivo da rejeição:</strong> {theme.rejectionNote}</p>}
            {status === 'PENDING' ? (
              <>
                <label className="field"><span>Nota de rejeição (opcional)</span><textarea maxLength={280} onChange={(event) => setNote((current) => ({ ...current, [theme.id]: event.target.value }))} rows={2} value={note[theme.id] ?? ''} /></label>
                <div className="admin-card__actions">
                  <Button disabled={busyId !== null} onClick={() => void act(theme, 'reject')} type="button" variant="ghost">{busyId === theme.id ? 'Aguarde…' : 'Rejeitar'}</Button>
                  <Button disabled={busyId !== null} onClick={() => void act(theme, 'approve')} type="button">{busyId === theme.id ? 'Aguarde…' : 'Aprovar'}</Button>
                </div>
              </>
            ) : null}
            {status === 'ACTIVE' ? (
              <div className="admin-card__actions">
                <Button disabled={busyId !== null} onClick={() => void act(theme, 'deactivate')} type="button" variant="ghost">{busyId === theme.id ? 'Aguarde…' : 'Desativar'}</Button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

const QUESTION_STATUS_LABEL: Record<EditorialQuestion['status'], string> = {
  ACTIVE: 'Ativa', DISABLED: 'Desativada', IN_REVIEW: 'Em revisão', PENDING: 'Pendente', REJECTED: 'Rejeitada',
};
const QUESTION_STATUS_TABS: EditorialQuestion['status'][] = ['IN_REVIEW', 'ACTIVE', 'REJECTED', 'DISABLED'];
const EMPTY_SOURCE: QuestionSourceInput = { kind: 'WEB', title: '', url: '' };

function emptyDraft(): {
  correctOption: number; difficulty: 'EASY' | 'HARD' | 'MEDIUM'; options: [string, string, string, string];
  prompt: string; sources: QuestionSourceInput[];
} {
  return { correctOption: 0, difficulty: 'EASY', options: ['', '', '', ''], prompt: '', sources: [{ ...EMPTY_SOURCE }] };
}

export function AdminQuestionEditorialPanel({ getToken }: { getToken: GetToken }) {
  const [themeSearch, setThemeSearch] = useState('');
  const [themeOptions, setThemeOptions] = useState<AdminThemeSummary[]>([]);
  const [themeId, setThemeId] = useState('');
  const [status, setStatus] = useState<EditorialQuestion['status']>('IN_REVIEW');
  const [page, setPage] = useState<EditorialQuestionPage>({ nextCursor: null, questions: [] });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft());
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const delay = window.setTimeout(() => {
      void apiRequest<{ themes: AdminThemeSummary[] }>(`/api/admin/themes?search=${encodeURIComponent(themeSearch.trim())}`, { getToken })
        .then((result) => setThemeOptions(result.themes))
        .catch(() => setThemeOptions([]));
    }, 180);
    return () => window.clearTimeout(delay);
  }, [getToken, themeSearch]);

  function loadQuestions(themeId_: string, status_: EditorialQuestion['status'], cursor: string | null, replace: boolean) {
    if (themeId_ === '') return;
    setLoading(true);
    const params = new URLSearchParams({ statuses: status_ });
    if (cursor !== null) params.set('cursor', cursor);
    void apiRequest<EditorialQuestionPage>(`/api/editorial/themes/${encodeURIComponent(themeId_)}/questions?${params}`, { getToken })
      .then((result) => setPage((current) => ({
        nextCursor: result.nextCursor,
        questions: replace ? result.questions : [...current.questions, ...result.questions],
      })))
      .catch((loadError: unknown) => setMessage({ kind: 'error', text: errorText(loadError, 'Não foi possível abrir as perguntas.') }))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    // Microtask para não chamar setState de forma síncrona no corpo do efeito.
    queueMicrotask(() => {
      if (themeId === '') { setPage({ nextCursor: null, questions: [] }); return; }
      loadQuestions(themeId, status, null, true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadQuestions é recriada a cada render; tema/status decidem a busca.
  }, [getToken, themeId, status]);

  async function act(question: EditorialQuestion, action: 'approve' | 'deactivate' | 'reject') {
    setBusyId(question.id);
    setMessage(null);
    try {
      await apiRequest(`/api/editorial/questions/${encodeURIComponent(question.id)}/${action}`, { body: {}, getToken, method: 'POST' });
      setPage((current) => ({ ...current, questions: current.questions.filter((item) => item.id !== question.id) }));
    } catch (actError) {
      setMessage({ kind: 'error', text: errorText(actError, 'Não foi possível concluir a ação.') });
    } finally {
      setBusyId(null);
    }
  }

  function updateOption(index: number, value: string) {
    setDraft((current) => {
      const options = [...current.options] as [string, string, string, string];
      options[index] = value;
      return { ...current, options };
    });
  }

  function updateSource(index: number, patch: Partial<QuestionSourceInput>) {
    setDraft((current) => ({ ...current, sources: current.sources.map((source, sourceIndex) => sourceIndex === index ? { ...source, ...patch } : source) }));
  }

  async function createQuestion() {
    if (themeId === '') return;
    setCreating(true);
    setMessage(null);
    try {
      await apiRequest(`/api/editorial/themes/${encodeURIComponent(themeId)}/questions`, {
        body: {
          correctOption: draft.correctOption, difficulty: draft.difficulty, options: draft.options, prompt: draft.prompt,
          sources: draft.sources.filter((source) => source.url.trim() !== ''),
        },
        getToken,
        method: 'POST',
      });
      setDraft(emptyDraft());
      setMessage({ kind: 'success', text: 'Pergunta enviada para revisão.' });
      if (status === 'IN_REVIEW') loadQuestions(themeId, status, null, true);
    } catch (createError) {
      setMessage({ kind: 'error', text: errorText(createError, 'Não foi possível criar a pergunta.') });
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="admin-panel" aria-labelledby="admin-question-editorial-title">
      <div className="section-heading"><div><span className="eyebrow">Administração</span><h2 id="admin-question-editorial-title">Perguntas por tema</h2></div></div>
      <label className="search-field"><span className="sr-only">Buscar tema</span><input onChange={(event) => setThemeSearch(event.target.value)} placeholder="Buscar tema" type="search" value={themeSearch} /></label>
      <label className="field"><span>Tema</span><select onChange={(event) => setThemeId(event.target.value)} value={themeId}><option value="">Selecione um tema</option>{themeOptions.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</select></label>
      {themeId !== '' ? (
        <>
          <div className="segmented" role="tablist" aria-label="Status da pergunta">
            {QUESTION_STATUS_TABS.map((value) => (
              <button aria-selected={status === value} className={status === value ? 'segmented__active' : ''} key={value} onClick={() => setStatus(value)} role="tab" type="button">
                {QUESTION_STATUS_LABEL[value]}
              </button>
            ))}
          </div>
          {loading && page.questions.length === 0 ? <p className="inline-notice">Carregando perguntas…</p> : null}
          {!loading && page.questions.length === 0 ? <p className="inline-notice">Nenhuma pergunta {QUESTION_STATUS_LABEL[status].toLowerCase()}.</p> : null}
          <div className="admin-card-list">
            {page.questions.map((question) => (
              <article className="admin-card" key={question.id}>
                <header><strong>{question.prompt}</strong><small>{DIFFICULTY_LABEL[question.difficulty]}</small></header>
                <ol className="report-card__options">
                  {question.options.map((option, index) => <li className={index === question.correctOption ? 'report-card__option--correct' : ''} key={option}>{option}</li>)}
                </ol>
                {question.sources.length > 0 && (
                  <ul className="report-card__sources" aria-label="Fontes da pergunta">
                    {question.sources.map((source) => <li key={source.id}><a href={source.url} rel="noreferrer" target="_blank">{source.title ?? source.url}</a></li>)}
                  </ul>
                )}
                {question.resolutionNote !== null && <p className="report-card__note"><strong>Nota:</strong> {question.resolutionNote}</p>}
                <div className="admin-card__actions">
                  {question.status === 'IN_REVIEW' && (
                    <>
                      <Button disabled={busyId !== null} onClick={() => void act(question, 'reject')} type="button" variant="ghost">{busyId === question.id ? 'Aguarde…' : 'Rejeitar'}</Button>
                      <Button disabled={busyId !== null} onClick={() => void act(question, 'approve')} type="button">{busyId === question.id ? 'Aguarde…' : 'Aprovar'}</Button>
                    </>
                  )}
                  {question.status === 'ACTIVE' && (
                    <Button disabled={busyId !== null} onClick={() => void act(question, 'deactivate')} type="button" variant="ghost">{busyId === question.id ? 'Aguarde…' : 'Desativar'}</Button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {page.nextCursor !== null && (
            <Button disabled={loading} onClick={() => loadQuestions(themeId, status, page.nextCursor, false)} type="button" variant="ghost">
              {loading ? 'Carregando…' : 'Carregar mais'}
            </Button>
          )}
          <form className="form-card" onSubmit={(event) => { event.preventDefault(); void createQuestion(); }}>
            <h3>Nova pergunta</h3>
            <label className="field"><span>Dificuldade</span><select onChange={(event) => setDraft((current) => ({ ...current, difficulty: event.target.value as typeof draft.difficulty }))} value={draft.difficulty}><option value="EASY">Fácil</option><option value="MEDIUM">Média</option><option value="HARD">Difícil</option></select></label>
            <label className="field"><span>Enunciado</span><textarea maxLength={360} minLength={1} onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))} required rows={2} value={draft.prompt} /></label>
            {draft.options.map((option, index) => (
              <label className="field" key={index}>
                <span>Alternativa {index + 1}{index === draft.correctOption ? ' (correta)' : ''}</span>
                <div className="admin-panel__option-row">
                  <input maxLength={180} onChange={(event) => updateOption(index, event.target.value)} required value={option} />
                  <label><input checked={draft.correctOption === index} name="correct-option" onChange={() => setDraft((current) => ({ ...current, correctOption: index }))} type="radio" /> Correta</label>
                </div>
              </label>
            ))}
            {draft.sources.map((source, index) => (
              <div className="admin-panel__option-row" key={index}>
                <input onChange={(event) => updateSource(index, { url: event.target.value })} placeholder="URL da fonte" value={source.url} />
                <select onChange={(event) => updateSource(index, { kind: event.target.value as QuestionSourceInput['kind'] })} value={source.kind}>
                  <option value="PRIMARY">Primária</option><option value="WEB">Web</option><option value="BOOK">Livro</option><option value="OTHER">Outra</option>
                </select>
              </div>
            ))}
            <Button onClick={() => setDraft((current) => ({ ...current, sources: [...current.sources, { ...EMPTY_SOURCE }] }))} type="button" variant="ghost">Adicionar fonte</Button>
            {message !== null && <p className={`form-message form-message--${message.kind}`} role="status">{message.text}</p>}
            <Button disabled={creating} type="submit">{creating ? 'Enviando…' : 'Enviar para revisão'}</Button>
          </form>
        </>
      ) : null}
    </section>
  );
}
