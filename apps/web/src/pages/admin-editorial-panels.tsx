import { useEffect, useState } from 'react';
import { Button } from '../components/button.js';
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { ClientApiError, apiDownload, apiRequest, apiUpload } from '../lib/api.js';
import type {
  AdminThemeSummary, CategoryAdmin, EditorialQuestion, EditorialQuestionPage, QuestionSourceInput,
} from '../lib/models.js';

type GetToken = (forceRefresh?: boolean) => Promise<string | null>;

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function AdminCategoriesPanel({ getToken, onCatalogChanged }: { getToken: GetToken; onCatalogChanged?: () => void }) {
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
      onCatalogChanged?.();
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
      onCatalogChanged?.();
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
            <div>
              <input
                aria-label={`Nome da categoria ${category.name}`}
                onBlur={(event) => event.target.value.trim() !== category.name && save(category, { name: event.target.value.trim() })}
                defaultValue={category.name}
                key={`${category.id}:${category.revision}:name`}
                maxLength={60}
              />
              <small>{category.slug}</small>
            </div>
            <input
              aria-label={`Ordem de ${category.name}`}
              onBlur={(event) => Number(event.target.value) !== category.sortOrder && save(category, { sortOrder: Number(event.target.value) })}
              defaultValue={category.sortOrder}
              key={`${category.id}:${category.revision}:order`}
              min={0}
              type="number"
            />
            <select
              aria-label={`Status da categoria ${category.name}`}
              disabled={savingId === category.id}
              onChange={(event) => save(category, { status: event.target.value as CategoryAdmin['status'] })}
              value={category.status}
            >
              <option value="ACTIVE">Ativa</option>
              <option value="DISABLED">Desativada</option>
            </select>
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

export function AdminThemeModerationPanel({
  getToken,
  onCatalogChanged,
  refreshKey = 0,
}: {
  getToken: GetToken;
  onCatalogChanged?: () => void;
  refreshKey?: number;
}) {
  const [status, setStatus] = useState<AdminThemeSummary['status']>('PENDING');
  const [themes, setThemes] = useState<AdminThemeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [pendingAction, setPendingAction] = useState<{ action: 'deactivate' | 'reject'; theme: AdminThemeSummary } | null>(null);

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
  }, [getToken, refreshKey]);

  async function act(theme: AdminThemeSummary, action: 'approve' | 'deactivate' | 'reject') {
    setBusyId(theme.id);
    setMessage(null);
    try {
      const body = action === 'reject' ? { expectedRevision: theme.revision, note: note[theme.id]?.trim() || undefined } : { expectedRevision: theme.revision };
      const result = await apiRequest<{ theme: AdminThemeSummary }>(`/api/admin/themes/${encodeURIComponent(theme.id)}/${action}`, {
        body, getToken, method: 'POST',
      });
      setThemes((current) => current.map((item) => item.id === result.theme.id ? result.theme : item));
      onCatalogChanged?.();
    } catch (actError) {
      setMessage(errorText(actError, 'Não foi possível concluir a ação.'));
    } finally {
      setBusyId(null);
      setPendingAction(null);
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
      {!loading && visible.length === 0 && message === null ? <p className="inline-notice">Nenhum tema {THEME_STATUS_LABEL[status].toLowerCase()}.</p> : null}
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
                  <Button disabled={busyId !== null} onClick={() => setPendingAction({ action: 'reject', theme })} type="button" variant="ghost">{busyId === theme.id ? 'Aguarde…' : 'Rejeitar'}</Button>
                  <Button disabled={busyId !== null} onClick={() => void act(theme, 'approve')} type="button">{busyId === theme.id ? 'Aguarde…' : 'Aprovar'}</Button>
                </div>
              </>
            ) : null}
            {status === 'ACTIVE' ? (
              <div className="admin-card__actions">
                <Button disabled={busyId !== null} onClick={() => setPendingAction({ action: 'deactivate', theme })} type="button" variant="ghost">{busyId === theme.id ? 'Aguarde…' : 'Desativar'}</Button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
      {pendingAction !== null && (
        <ConfirmDialog
          body={pendingAction.action === 'deactivate'
            ? `“${pendingAction.theme.name}” some do catálogo e do sorteio de partidas.`
            : `“${pendingAction.theme.name}” volta para quem propôs como rejeitado.`}
          busy={busyId === pendingAction.theme.id}
          confirmLabel={pendingAction.action === 'deactivate' ? 'Desativar tema' : 'Rejeitar tema'}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void act(pendingAction.theme, pendingAction.action)}
          title={pendingAction.action === 'deactivate' ? `Desativar “${pendingAction.theme.name}”?` : `Rejeitar “${pendingAction.theme.name}”?`}
        />
      )}
    </section>
  );
}

const QUESTION_STATUS_LABEL: Record<EditorialQuestion['status'], string> = {
  ACTIVE: 'Ativa', DISABLED: 'Desativada', IN_REVIEW: 'Em revisão', PENDING: 'Pendente', REJECTED: 'Rejeitada',
};
const QUESTION_STATUS_TABS: EditorialQuestion['status'][] = ['IN_REVIEW', 'ACTIVE', 'REJECTED', 'DISABLED'];
const EMPTY_SOURCE: QuestionSourceInput = { kind: 'WEB', title: '', url: '' };
const CSV_IMPORT_TEMPLATE = [
  'prompt,optionA,optionB,optionC,optionD,correctOption',
  '"Exemplo de pergunta?",Alternativa A,Alternativa B,Alternativa C,Alternativa D,0',
].join('\n');

/** Referência de campo `questions.N.campo` do Zod vira "Pergunta N+1 (campo)". */
function jsonImportFieldLabel(field: string): string {
  const match = /^questions\.(\d+)\.(.+)$/.exec(field);
  if (match?.[1] === undefined) return field;
  return `Pergunta ${Number(match[1]) + 1}${match[2] !== undefined ? ` (${match[2]})` : ''}`;
}

function importErrorText(error: unknown): string {
  if (error instanceof ClientApiError && Array.isArray(error.details)) {
    const diagnostics = error.details
      .filter((detail): detail is Record<string, unknown> => typeof detail === 'object' && detail !== null)
      .slice(0, 3)
      .map((detail) => {
        // Diagnóstico de linha do CSV: `{ row, messages: string[] }`.
        if (Array.isArray(detail.messages)) {
          const messages = detail.messages.filter((message): message is string => typeof message === 'string').join(' ');
          return messages === '' ? '' : `Linha ${typeof detail.row === 'number' ? detail.row : '?'}: ${messages}`;
        }
        // Erro de validação de campo do JSON: `{ field, message }`.
        if (typeof detail.message === 'string') {
          const field = typeof detail.field === 'string' && detail.field !== '' ? jsonImportFieldLabel(detail.field) : '';
          return field === '' ? detail.message : `${field}: ${detail.message}`;
        }
        return '';
      })
      .filter((detail) => detail !== '');
    if (diagnostics.length > 0) return `${error.message} ${diagnostics.join(' ')}`;
  }
  return errorText(error, 'Não foi possível importar o lote.');
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function downloadCsvTemplate(): void {
  const href = URL.createObjectURL(new Blob([CSV_IMPORT_TEMPLATE], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.download = 'modelo-perguntas.csv';
  link.href = href;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
}

function emptyDraft(): {
  correctOption: number; options: [string, string, string, string];
  prompt: string; sources: QuestionSourceInput[];
} {
  return { correctOption: 0, options: ['', '', '', ''], prompt: '', sources: [{ ...EMPTY_SOURCE }] };
}

export function AdminQuestionEditorialPanel({ getToken, refreshKey = 0 }: { getToken: GetToken; refreshKey?: number }) {
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
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importFileKey, setImportFileKey] = useState(0);
  // Nasce junto com o arquivo escolhido, não a cada clique: um retry manual
  // do MESMO arquivo (após timeout/falha aparente) precisa reusar a mesma
  // chave para o servidor deduplicar de verdade — gerar uma chave nova a
  // cada tentativa anularia a própria proteção de idempotência.
  const [importIdempotencyKey, setImportIdempotencyKey] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [batchApproving, setBatchApproving] = useState(false);
  const [confirmingBatchApproval, setConfirmingBatchApproval] = useState(false);
  const [pendingDeactivation, setPendingDeactivation] = useState<EditorialQuestion | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<EditorialQuestion | null>(null);
  const [editDraft, setEditDraft] = useState(emptyDraft());
  const [savingEdit, setSavingEdit] = useState(false);
  const [exporting, setExporting] = useState<'csv' | 'json' | null>(null);

  useEffect(() => {
    const delay = window.setTimeout(() => {
      void apiRequest<{ themes: AdminThemeSummary[] }>(`/api/admin/themes?search=${encodeURIComponent(themeSearch.trim())}`, { getToken })
        .then((result) => setThemeOptions(result.themes))
        .catch((searchError: unknown) => {
          setThemeOptions([]);
          setMessage({ kind: 'error', text: errorText(searchError, 'Não foi possível buscar temas.') });
        });
    }, 180);
    return () => window.clearTimeout(delay);
  }, [getToken, refreshKey, themeSearch]);

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
      .then(() => { if (replace) setSelectedQuestionIds([]); })
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
      setPendingDeactivation(null);
    }
  }

  function beginEdit(question: EditorialQuestion) {
    setMessage(null);
    setEditingQuestion(question);
    setEditDraft({
      correctOption: question.correctOption,
      options: [...question.options] as [string, string, string, string],
      prompt: question.prompt,
      sources: question.sources.map((source) => source.title === undefined
        ? { kind: source.kind, url: source.url }
        : { kind: source.kind, title: source.title, url: source.url }),
    });
  }

  function updateEditOption(index: number, value: string) {
    setEditDraft((current) => {
      const options = [...current.options] as [string, string, string, string];
      options[index] = value;
      return { ...current, options };
    });
  }

  function updateEditSource(index: number, patch: Partial<QuestionSourceInput>) {
    setEditDraft((current) => ({ ...current, sources: current.sources.map((source, sourceIndex) => sourceIndex === index ? { ...source, ...patch } : source) }));
  }

  async function saveEdit() {
    if (editingQuestion === null) return;
    setSavingEdit(true);
    setMessage(null);
    try {
      const result = await apiRequest<{ question?: EditorialQuestion }>(`/api/editorial/questions/${encodeURIComponent(editingQuestion.id)}`, {
        body: {
          correctOption: editDraft.correctOption, options: editDraft.options, prompt: editDraft.prompt,
          sources: editDraft.sources.filter((source) => source.url.trim() !== ''),
        },
        getToken, method: 'PATCH',
      });
      if (editingQuestion.status === 'IN_REVIEW' && result.question !== undefined) {
        setPage((current) => ({ ...current, questions: current.questions.map((question) => question.id === result.question?.id ? result.question : question) }));
        setMessage({ kind: 'success', text: 'Rascunho atualizado. Revise-o antes de aprovar.' });
      } else {
        setMessage({ kind: 'success', text: 'Revisão criada. A pergunta publicada continua ativa até você aprová-la.' });
        if (status === 'IN_REVIEW') loadQuestions(themeId, status, null, true);
      }
      setEditingQuestion(null);
    } catch (saveError) {
      setMessage({ kind: 'error', text: errorText(saveError, 'Não foi possível salvar a revisão.') });
    } finally {
      setSavingEdit(false);
    }
  }

  function toggleQuestionSelection(questionId: string) {
    setSelectedQuestionIds((current) => current.includes(questionId)
      ? current.filter((id) => id !== questionId)
      : [...current, questionId]);
  }

  function togglePageSelection() {
    const reviewIds = page.questions.filter((question) => question.status === 'IN_REVIEW').map((question) => question.id);
    const allSelected = reviewIds.length > 0 && reviewIds.every((id) => selectedQuestionIds.includes(id));
    setSelectedQuestionIds((current) => allSelected
      ? current.filter((id) => !reviewIds.includes(id))
      : [...new Set([...current, ...reviewIds])]);
  }

  async function approveSelected() {
    if (themeId === '' || selectedQuestionIds.length === 0) return;
    setBatchApproving(true);
    setMessage(null);
    try {
      const result = await apiRequest<{ approvedQuestionIds: string[]; failed: Array<{ code: string; questionId: string }> }>(
        `/api/editorial/themes/${encodeURIComponent(themeId)}/questions/approve`,
        { body: { questionIds: selectedQuestionIds }, getToken, method: 'POST' },
      );
      const approved = new Set(result.approvedQuestionIds);
      setPage((current) => ({ ...current, questions: current.questions.filter((question) => !approved.has(question.id)) }));
      setSelectedQuestionIds((current) => current.filter((id) => !approved.has(id)));
      setMessage({
        kind: result.failed.length === 0 ? 'success' : 'error',
        text: result.failed.length === 0
          ? `${result.approvedQuestionIds.length} ${result.approvedQuestionIds.length === 1 ? 'pergunta aprovada.' : 'perguntas aprovadas.'}`
          : `${result.approvedQuestionIds.length} aprovadas; ${result.failed.length} mudaram de estado. Atualize e revise as restantes.`,
      });
    } catch (approvalError) {
      setMessage({ kind: 'error', text: errorText(approvalError, 'Não foi possível aprovar o lote.') });
    } finally {
      setBatchApproving(false);
      setConfirmingBatchApproval(false);
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
          correctOption: draft.correctOption, options: draft.options, prompt: draft.prompt,
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

  async function importQuestions() {
    if (themeId === '' || importFile === null) return;
    if (importFile.size > 256 * 1024) {
      setMessage({ kind: 'error', text: 'O lote deve ter no máximo 256 KB.' });
      return;
    }
    setImporting(true);
    setMessage(null);
    try {
      const importPath = `/api/admin/questions/import?themeId=${encodeURIComponent(themeId)}`;
      const headers = { 'Idempotency-Key': importIdempotencyKey ?? crypto.randomUUID() };
      const isCsv = importFile.name.toLowerCase().endsWith('.csv') || importFile.type === 'text/csv';
      let result: { imported: number; status: 'ALREADY_APPLIED' | 'APPLIED' };
      if (isCsv) {
        result = await apiUpload(importPath, {
          body: new Blob([await importFile.text()], { type: 'text/csv' }), getToken, headers, method: 'POST',
        });
      } else {
        const parsedFile = JSON.parse(await importFile.text()) as unknown;
        result = await apiRequest(importPath, {
          body: Array.isArray(parsedFile) ? { questions: parsedFile } : parsedFile,
          getToken, headers, method: 'POST',
        });
      }
      setImportFile(null);
      setImportFileKey((current) => current + 1);
      setImportIdempotencyKey(null);
      setMessage({ kind: 'success', text: result.status === 'ALREADY_APPLIED' ? 'Este lote já havia sido importado.' : `${result.imported} ${result.imported === 1 ? 'pergunta enviada' : 'perguntas enviadas'} para revisão.` });
      if (status === 'IN_REVIEW') loadQuestions(themeId, status, null, true);
    } catch (importError) {
      setMessage({ kind: 'error', text: importErrorText(importError) });
    } finally {
      setImporting(false);
    }
  }

  async function exportQuestions(format: 'csv' | 'json') {
    if (themeId === '') return;
    setExporting(format);
    setMessage(null);
    try {
      const response = await apiDownload(
        `/api/admin/themes/${encodeURIComponent(themeId)}/questions/${format}`,
        { getToken },
      );
      const href = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.download = `quiz-gomes-${themeId}-perguntas.${format}`;
      link.href = href;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 0);
      setMessage({ kind: 'success', text: `Relatório ${format.toUpperCase()} baixado.` });
    } catch (exportError) {
      setMessage({ kind: 'error', text: errorText(exportError, 'Não foi possível exportar as perguntas.') });
    } finally {
      setExporting(null);
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
          {status === 'IN_REVIEW' && page.questions.length > 0 && (
            <div className="admin-card__actions" aria-label="Ações em lote da revisão">
              <label className="field">
                <input
                  aria-label="Selecionar todas as perguntas desta página"
                  checked={page.questions.every((question) => selectedQuestionIds.includes(question.id))}
                  onChange={togglePageSelection}
                  type="checkbox"
                /> Selecionar todas desta página
              </label>
              <span aria-live="polite" className="sr-only">
                {selectedQuestionIds.length === 0
                  ? 'Nenhuma pergunta selecionada'
                  : `${selectedQuestionIds.length} ${selectedQuestionIds.length === 1 ? 'pergunta selecionada' : 'perguntas selecionadas'}`}
              </span>
              <Button disabled={batchApproving || busyId !== null || selectedQuestionIds.length === 0} onClick={() => setConfirmingBatchApproval(true)} type="button">
                {batchApproving ? 'Aprovando…' : `Aprovar selecionadas (${selectedQuestionIds.length})`}
              </Button>
            </div>
          )}
          {loading && page.questions.length === 0 ? <p className="inline-notice">Carregando perguntas…</p> : null}
          {!loading && page.questions.length === 0 && message?.kind !== 'error' ? <p className="inline-notice">Nenhuma pergunta {QUESTION_STATUS_LABEL[status].toLowerCase()}.</p> : null}
          <div className="admin-card-list">
            {page.questions.map((question) => (
              <article className="admin-card" key={question.id}>
                <header><strong>{question.prompt}</strong></header>
                {question.status === 'IN_REVIEW' && (
                  <label className="field">
                    <input
                      aria-label={`Selecionar “${truncate(question.prompt, 60)}” para aprovação em lote`}
                      checked={selectedQuestionIds.includes(question.id)}
                      disabled={batchApproving || busyId !== null}
                      onChange={() => toggleQuestionSelection(question.id)}
                      type="checkbox"
                    /> Selecionar para aprovação em lote
                  </label>
                )}
                <ol className="report-card__options">
                  {question.options.map((option, index) => {
                    const correct = index === question.correctOption;
                    return (
                      <li className={correct ? 'report-card__option--correct' : ''} key={option}>
                        {correct && <span aria-hidden="true">✓ </span>}
                        {option}
                        {correct && <span className="sr-only"> (alternativa correta)</span>}
                      </li>
                    );
                  })}
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
                      <Button disabled={busyId !== null || batchApproving || savingEdit} onClick={() => beginEdit(question)} type="button" variant="ghost">Revisar e editar</Button>
                      <Button disabled={busyId !== null} onClick={() => void act(question, 'reject')} type="button" variant="ghost">{busyId === question.id ? 'Aguarde…' : 'Rejeitar'}</Button>
                      <Button disabled={busyId !== null} onClick={() => void act(question, 'approve')} type="button">{busyId === question.id ? 'Aguarde…' : 'Aprovar'}</Button>
                    </>
                  )}
                  {question.status === 'ACTIVE' && (
                    <>
                      <Button disabled={busyId !== null || batchApproving || savingEdit} onClick={() => beginEdit(question)} type="button" variant="ghost">Criar revisão</Button>
                      <Button disabled={busyId !== null} onClick={() => setPendingDeactivation(question)} type="button" variant="ghost">{busyId === question.id ? 'Aguarde…' : 'Desativar'}</Button>
                    </>
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
          {message !== null && <p className={`form-message form-message--${message.kind}`} role="status">{message.text}</p>}
          {pendingDeactivation !== null && (
            <ConfirmDialog
              body={`“${truncate(pendingDeactivation.prompt, 90)}” some do sorteio de partidas.`}
              busy={busyId === pendingDeactivation.id}
              confirmLabel="Desativar pergunta"
              onCancel={() => setPendingDeactivation(null)}
              onConfirm={() => void act(pendingDeactivation, 'deactivate')}
              title="Desativar esta pergunta?"
            />
          )}
          {confirmingBatchApproval && (
            <ConfirmDialog
              body={`${selectedQuestionIds.length} ${selectedQuestionIds.length === 1 ? 'pergunta vai ser publicada' : 'perguntas vão ser publicadas'} e passa${selectedQuestionIds.length === 1 ? '' : 'm'} a valer em partidas.`}
              busy={batchApproving}
              confirmLabel={`Aprovar ${selectedQuestionIds.length} ${selectedQuestionIds.length === 1 ? 'pergunta' : 'perguntas'}`}
              onCancel={() => setConfirmingBatchApproval(false)}
              onConfirm={() => void approveSelected()}
              title="Aprovar o lote selecionado?"
            />
          )}
          {editingQuestion !== null && (
            <form className="form-card" onSubmit={(event) => { event.preventDefault(); void saveEdit(); }}>
              <h3>{editingQuestion.status === 'ACTIVE' ? 'Criar revisão da pergunta publicada' : 'Revisar pergunta'}</h3>
              {editingQuestion.status === 'ACTIVE' && <p>A versão publicada continua disponível até que este rascunho seja aprovado.</p>}
              <label className="field"><span>Enunciado</span><textarea aria-label="Enunciado da revisão" maxLength={360} minLength={1} onChange={(event) => setEditDraft((current) => ({ ...current, prompt: event.target.value }))} required rows={3} value={editDraft.prompt} /></label>
              {editDraft.options.map((option, index) => (
                <label className="field" key={index}>
                  <span>Alternativa {index + 1}{index === editDraft.correctOption ? ' (correta)' : ''}</span>
                  <div className="admin-panel__option-row">
                    <input maxLength={180} onChange={(event) => updateEditOption(index, event.target.value)} required value={option} />
                    <label><input checked={editDraft.correctOption === index} name="edit-correct-option" onChange={() => setEditDraft((current) => ({ ...current, correctOption: index }))} type="radio" /> Correta</label>
                  </div>
                </label>
              ))}
              {editDraft.sources.map((source, index) => (
                <div className="admin-panel__option-row" key={index}>
                  <input aria-label={`Título da fonte opcional ${index + 1}`} maxLength={160} onChange={(event) => updateEditSource(index, { title: event.target.value })} placeholder="Título da fonte (opcional)" value={source.title ?? ''} />
                  <input aria-label={`URL da fonte opcional ${index + 1}`} onChange={(event) => updateEditSource(index, { url: event.target.value })} placeholder="URL da fonte (opcional)" value={source.url} />
                  <select aria-label={`Tipo da fonte opcional ${index + 1}`} onChange={(event) => updateEditSource(index, { kind: event.target.value as QuestionSourceInput['kind'] })} value={source.kind}>
                    <option value="PRIMARY">Primária</option><option value="WEB">Web</option><option value="BOOK">Livro</option><option value="OTHER">Outra</option>
                  </select>
                  <Button aria-label={`Remover fonte ${index + 1}`} onClick={() => setEditDraft((current) => ({ ...current, sources: current.sources.filter((_, sourceIndex) => sourceIndex !== index) }))} type="button" variant="ghost">Remover</Button>
                </div>
              ))}
              <div className="admin-card__actions">
                <Button disabled={savingEdit || editDraft.sources.length >= 5} onClick={() => setEditDraft((current) => ({ ...current, sources: [...current.sources, { ...EMPTY_SOURCE }] }))} type="button" variant="ghost">Adicionar fonte opcional</Button>
                <Button disabled={savingEdit} type="button" variant="ghost" onClick={() => setEditingQuestion(null)}>Cancelar</Button>
                <Button disabled={savingEdit} type="submit">{savingEdit ? 'Salvando…' : editingQuestion.status === 'ACTIVE' ? 'Enviar revisão' : 'Salvar revisão'}</Button>
              </div>
            </form>
          )}
          <section className="form-card" aria-labelledby="admin-question-import-title">
            <h3 id="admin-question-import-title">Importar perguntas</h3>
            <p>Envie CSV ou JSON com no máximo 100 perguntas. O tema selecionado acima é aplicado ao lote; fontes são opcionais.</p>
            <label className="field"><span>Arquivo CSV ou JSON</span><input accept=".csv,application/json,text/csv" key={importFileKey} onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setImportFile(file);
              setImportIdempotencyKey(file === null ? null : crypto.randomUUID());
            }} type="file" /></label>
            <div className="admin-card__actions">
              <Button onClick={downloadCsvTemplate} type="button" variant="ghost">Baixar modelo CSV</Button>
              <Button disabled={importing || importFile === null} onClick={() => void importQuestions()} type="button">
                {importing ? 'Importando…' : 'Importar para revisão'}
              </Button>
            </div>
          </section>
          <section className="form-card" aria-labelledby="admin-question-export-title">
            <h3 id="admin-question-export-title">Exportar relatório completo</h3>
            <p>Baixe todas as perguntas deste tema, inclusive as que estão em revisão, rejeitadas ou desativadas. O JSON preserva a estrutura completa; o CSV abre em planilhas.</p>
            <div className="admin-card__actions">
              <Button disabled={exporting !== null} onClick={() => void exportQuestions('csv')} type="button" variant="ghost">
                {exporting === 'csv' ? 'Preparando CSV…' : 'Exportar CSV'}
              </Button>
              <Button disabled={exporting !== null} onClick={() => void exportQuestions('json')} type="button" variant="ghost">
                {exporting === 'json' ? 'Preparando JSON…' : 'Exportar JSON'}
              </Button>
            </div>
          </section>
          <form className="form-card" onSubmit={(event) => { event.preventDefault(); void createQuestion(); }}>
            <h3>Nova pergunta</h3>
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
                <input aria-label={`URL da fonte opcional ${index + 1}`} onChange={(event) => updateSource(index, { url: event.target.value })} placeholder="URL da fonte (opcional)" value={source.url} />
                <select onChange={(event) => updateSource(index, { kind: event.target.value as QuestionSourceInput['kind'] })} value={source.kind}>
                  <option value="PRIMARY">Primária</option><option value="WEB">Web</option><option value="BOOK">Livro</option><option value="OTHER">Outra</option>
                </select>
              </div>
            ))}
            <Button onClick={() => setDraft((current) => ({ ...current, sources: [...current.sources, { ...EMPTY_SOURCE }] }))} type="button" variant="ghost">Adicionar fonte opcional</Button>
            <Button disabled={creating} type="submit">{creating ? 'Enviando…' : 'Enviar para revisão'}</Button>
          </form>
        </>
      ) : null}
    </section>
  );
}
