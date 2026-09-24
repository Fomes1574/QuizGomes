import { ApiError } from '../http/api-error.js';
import { questionContentHash, questionContentHashCandidates, questionPoolId } from '../services/question-content.js';

export interface QuestionSourceInput {
  kind: string;
  title?: string | null | undefined;
  url: string;
}

export interface QuestionSourceRecord {
  id: string;
  kind: string;
  title: string | null;
  url: string;
}

export interface QuestionModerationRecord {
  activeSlot: number | null;
  correctOption: number;
  createdAt: string;
  createdByUserId: string | null;
  id: string;
  options: [string, string, string, string];
  poolId: string;
  prompt: string;
  replacesQuestionId: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  sources: QuestionSourceRecord[];
  status: 'ACTIVE' | 'DISABLED' | 'IN_REVIEW' | 'PENDING' | 'REJECTED';
  themeId: string;
}

export interface QuestionModerationPage {
  nextCursor: string | null;
  questions: QuestionModerationRecord[];
}

interface QuestionRow {
  active_slot: number | null;
  content_hash: string;
  correct_option: number;
  created_at: string;
  created_by_user_id: string | null;
  id: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  pool_id: string;
  prompt: string;
  replaces_question_id: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  status: QuestionModerationRecord['status'];
  theme_id: string;
}

const QUESTION_COLUMNS = `q.id, q.pool_id, p.theme_id, q.active_slot, q.prompt,
  q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option, q.status,
  q.created_by_user_id, q.replaces_question_id, q.resolved_by_user_id, q.resolved_at,
  q.resolution_note, q.created_at`;

function encodeCursor(createdAt: string, id: string): string {
  return btoa(JSON.stringify([createdAt, id]));
}

function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = JSON.parse(atob(cursor)) as [string, string];
    return typeof createdAt === 'string' && typeof id === 'string' ? { createdAt, id } : null;
  } catch {
    return null;
  }
}

async function attachSources(db: D1Database, questions: QuestionRow[]): Promise<QuestionModerationRecord[]> {
  if (questions.length === 0) return [];
  const placeholders = questions.map((_, index) => `?${index + 1}`).join(', ');
  const sources = await db.prepare(
    `SELECT id, question_id, url, title, source_kind FROM question_sources WHERE question_id IN (${placeholders})`,
  ).bind(...questions.map((question) => question.id)).all<{
    id: string; question_id: string; source_kind: string; title: string | null; url: string;
  }>();
  const byQuestion = new Map<string, QuestionSourceRecord[]>();
  for (const source of sources.results) {
    const list = byQuestion.get(source.question_id) ?? [];
    list.push({ id: source.id, kind: source.source_kind, title: source.title, url: source.url });
    byQuestion.set(source.question_id, list);
  }
  return questions.map((row) => ({
    activeSlot: row.active_slot,
    correctOption: row.correct_option,
    createdAt: row.created_at,
    createdByUserId: row.created_by_user_id,
    id: row.id,
    options: [row.option_a, row.option_b, row.option_c, row.option_d],
    poolId: row.pool_id,
    prompt: row.prompt,
    replacesQuestionId: row.replaces_question_id,
    resolutionNote: row.resolution_note,
    resolvedAt: row.resolved_at,
    resolvedByUserId: row.resolved_by_user_id,
    sources: byQuestion.get(row.id) ?? [],
    status: row.status,
    themeId: row.theme_id,
  }));
}

/**
 * CRUD e versionamento de pergunta. Nova pergunta ou edição sempre nasce
 * IN_REVIEW e nunca ocupa slot ativo — o sorteio de rodada só lê
 * `status = 'ACTIVE'`. Aprovar publica: uma pergunta nova recebe o próximo
 * slot denso; a edição de uma ACTIVE troca o slot com a antiga no mesmo lote,
 * sem alterar a contagem. Desativar libera o slot preservando densidade via
 * swap com o último slot do pool, como o resto do produto já faz.
 */
export class QuestionEditorialRepository {
  constructor(private readonly db: D1Database) {}

  async create(input: {
    actorUserId: string;
    correctOption: number;
    options: readonly [string, string, string, string];
    prompt: string;
    sources: readonly QuestionSourceInput[];
    themeId: string;
  }): Promise<{ questionId: string }> {
    const targetPoolId = questionPoolId(input.themeId);
    const questionId = crypto.randomUUID();
    const [contentHash, ...legacyHashes] = await questionContentHashCandidates(input);
    await this.assertNoLegacyDuplicate([contentHash, ...legacyHashes]);
    const statements: D1PreparedStatement[] = [
      // `difficulty` é legado físico do schema (nunca lido de volta); todo pool novo nasce com o mesmo valor fixo.
      this.db.prepare("INSERT OR IGNORE INTO question_pools (id, theme_id, difficulty) VALUES (?1, ?2, 'MEDIUM')")
        .bind(targetPoolId, input.themeId),
      this.db.prepare(
        `INSERT INTO questions (
           id, pool_id, prompt, option_a, option_b, option_c, option_d, correct_option,
           content_hash, status, created_by_user_id
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'IN_REVIEW', ?10)`,
      ).bind(questionId, targetPoolId, input.prompt, ...input.options, input.correctOption, contentHash, input.actorUserId),
      ...input.sources.map((source) => this.db.prepare(
        'INSERT INTO question_sources (id, question_id, url, title, source_kind) VALUES (?1, ?2, ?3, ?4, ?5)',
      ).bind(crypto.randomUUID(), questionId, source.url, source.title ?? null, source.kind)),
    ];
    await this.runOrDuplicate(statements);
    return { questionId };
  }

  async proposeEdit(input: {
    actorUserId: string;
    correctOption: number;
    options: readonly [string, string, string, string];
    prompt: string;
    questionId: string;
    sources: readonly QuestionSourceInput[];
  }): Promise<{ draftId: string }> {
    const active = await this.db.prepare(
      `SELECT q.pool_id, p.theme_id FROM questions q
        JOIN question_pools p ON p.id = q.pool_id
       WHERE q.id = ?1 AND q.status = 'ACTIVE'`,
    ).bind(input.questionId).first<{ pool_id: string; theme_id: string }>();
    if (active === null) throw new ApiError(404, 'QUESTION_NOT_ACTIVE', 'Só uma pergunta publicada pode ser editada.');
    const draftId = crypto.randomUUID();
    // A revisão é escopada pela pergunta publicada. Assim é possível corrigir
    // apenas a alternativa correta ou as fontes sem liberar uma segunda
    // pergunta nova com o mesmo enunciado/opções no tema.
    const contentHash = await questionContentHash({
      ...input, revisionOf: input.questionId, themeId: active.theme_id,
    });
    const statements: D1PreparedStatement[] = [
      this.db.prepare(
        `INSERT INTO questions (
           id, pool_id, prompt, option_a, option_b, option_c, option_d, correct_option,
           content_hash, status, created_by_user_id, replaces_question_id
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'IN_REVIEW', ?10, ?11)`,
      ).bind(
        draftId, active.pool_id, input.prompt, ...input.options, input.correctOption, contentHash,
        input.actorUserId, input.questionId,
      ),
      ...input.sources.map((source) => this.db.prepare(
        'INSERT INTO question_sources (id, question_id, url, title, source_kind) VALUES (?1, ?2, ?3, ?4, ?5)',
      ).bind(crypto.randomUUID(), draftId, source.url, source.title ?? null, source.kind)),
    ];
    await this.runOrDuplicate(statements);
    return { draftId };
  }

  /**
   * Corrige o próprio rascunho sem criar uma segunda cópia. Rascunhos não
   * participam do pool; por isso a edição é segura e a pergunta publicada que
   * eventualmente será substituída continua intacta.
   */
  async reviseDraft(input: {
    correctOption: number;
    options: readonly [string, string, string, string];
    prompt: string;
    questionId: string;
    sources: readonly QuestionSourceInput[];
  }): Promise<{ questionId: string }> {
    const draft = await this.db.prepare(
      `SELECT q.pool_id, q.replaces_question_id, p.theme_id FROM questions q
        JOIN question_pools p ON p.id = q.pool_id
       WHERE q.id = ?1 AND q.status = 'IN_REVIEW'`,
    ).bind(input.questionId).first<{
      pool_id: string; replaces_question_id: string | null; theme_id: string;
    }>();
    if (draft === null) throw new ApiError(409, 'QUESTION_NOT_IN_REVIEW', 'Esta pergunta não está em revisão.');

    const contentHash = await questionContentHash(draft.replaces_question_id === null
      ? { ...input, themeId: draft.theme_id }
      : { ...input, revisionOf: draft.replaces_question_id, themeId: draft.theme_id });
    // Atualiza o conteúdo antes de tocar nas fontes: se o hash conflitar, as
    // referências originais permanecem intactas. `batch` é transacional no D1.
    const statements: D1PreparedStatement[] = [
      this.db.prepare(
        `UPDATE questions
            SET prompt = ?1, option_a = ?2, option_b = ?3, option_c = ?4, option_d = ?5,
                correct_option = ?6, content_hash = ?7
          WHERE id = ?8 AND status = 'IN_REVIEW'`,
      ).bind(input.prompt, ...input.options, input.correctOption, contentHash, input.questionId),
      this.db.prepare('DELETE FROM question_sources WHERE question_id = ?1').bind(input.questionId),
      ...input.sources.map((source) => this.db.prepare(
        'INSERT INTO question_sources (id, question_id, url, title, source_kind) VALUES (?1, ?2, ?3, ?4, ?5)',
      ).bind(crypto.randomUUID(), input.questionId, source.url, source.title ?? null, source.kind)),
    ];
    try {
      const results = await this.db.batch(statements);
      if ((results[0]?.meta.changes ?? 0) !== 1) {
        throw new ApiError(409, 'QUESTION_NOT_IN_REVIEW', 'Esta pergunta mudou de estado. Atualize a tela.');
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && /UNIQUE constraint failed: questions\.content_hash/i.test(error.message)) {
        throw new ApiError(409, 'DUPLICATE_QUESTION', 'Uma pergunta com este conteúdo já existe.');
      }
      throw error;
    }
    return { questionId: input.questionId };
  }

  /**
   * Aprova uma seleção já revisada, sempre em série. Assim cada aprovação vê
   * a contagem/slot produzido pela anterior e não há corrida interna no mesmo
   * pool. Antes de começar, o lote inteiro é conferido contra o tema e o
   * estado atual; uma corrida externa vira falha explícita por item, nunca
   * publicação silenciosa de outra pergunta.
   */
  async approveMany(input: {
    actorUserId: string;
    questionIds: readonly string[];
    themeId: string;
  }): Promise<{ approvedQuestionIds: string[]; failed: Array<{ code: string; questionId: string }> }> {
    const records = await Promise.all(input.questionIds.map((questionId) => this.findForModeration(questionId)));
    for (const record of records) {
      if (record === null || record.themeId !== input.themeId) {
        throw new ApiError(404, 'QUESTION_NOT_FOUND', 'Uma das perguntas não pertence a este tema.');
      }
      if (record.status !== 'IN_REVIEW') {
        throw new ApiError(409, 'QUESTION_NOT_PENDING', 'Todas as perguntas do lote precisam estar em revisão. Atualize a tela.');
      }
    }

    const approvedQuestionIds: string[] = [];
    const failed: Array<{ code: string; questionId: string }> = [];
    for (const questionId of input.questionIds) {
      try {
        await this.approve(questionId, input.actorUserId);
        approvedQuestionIds.push(questionId);
      } catch (error) {
        failed.push({
          code: error instanceof ApiError ? error.code : 'QUESTION_APPROVAL_FAILED',
          questionId,
        });
      }
    }
    return { approvedQuestionIds, failed };
  }

  async findForModeration(questionId: string): Promise<QuestionModerationRecord | null> {
    const row = await this.db.prepare(
      `SELECT ${QUESTION_COLUMNS} FROM questions q JOIN question_pools p ON p.id = q.pool_id WHERE q.id = ?1`,
    ).bind(questionId).first<QuestionRow>();
    if (row === null) return null;
    const [record] = await attachSources(this.db, [row]);
    return record ?? null;
  }

  async listForTheme(input: {
    cursor?: string | null;
    statuses?: readonly QuestionModerationRecord['status'][];
    themeId: string;
  }): Promise<QuestionModerationPage> {
    const statuses = input.statuses ?? ['PENDING', 'ACTIVE', 'IN_REVIEW', 'REJECTED', 'DISABLED'];
    const placeholders = statuses.map((_, index) => `?${index + 2}`).join(', ');
    const pageSize = 50;
    const decoded = input.cursor == null ? null : decodeCursor(input.cursor);
    const cursorClause = decoded === null
      ? ''
      : `AND (q.created_at < ?${statuses.length + 2} OR (q.created_at = ?${statuses.length + 2} AND q.id < ?${statuses.length + 3}))`;
    const binds: unknown[] = [input.themeId, ...statuses];
    if (decoded !== null) binds.push(decoded.createdAt, decoded.id);
    const result = await this.db.prepare(
      `SELECT ${QUESTION_COLUMNS} FROM questions q
         JOIN question_pools p ON p.id = q.pool_id
        WHERE p.theme_id = ?1 AND q.status IN (${placeholders}) ${cursorClause}
        ORDER BY q.created_at DESC, q.id DESC
        LIMIT ${pageSize + 1}`,
    ).bind(...binds).all<QuestionRow>();
    const rows = result.results.slice(0, pageSize);
    const questions = await attachSources(this.db, rows);
    const last = rows.at(-1);
    const nextCursor = result.results.length > pageSize && last !== undefined
      ? encodeCursor(last.created_at, last.id)
      : null;
    return { nextCursor, questions };
  }

  /** Publica um rascunho IN_REVIEW: nova pergunta ganha o próximo slot denso; edição troca o slot da antiga. */
  async approve(questionId: string, actorUserId: string): Promise<{ themeId: string }> {
    const draft = await this.findForModeration(questionId);
    if (draft === null || draft.status !== 'IN_REVIEW') {
      throw new ApiError(409, 'QUESTION_NOT_PENDING', 'Esta pergunta não aguarda aprovação.');
    }
    if (draft.replacesQuestionId === null) {
      const pool = await this.db.prepare('SELECT active_count FROM question_pools WHERE id = ?1')
        .bind(draft.poolId).first<{ active_count: number }>();
      if (pool === null) throw new ApiError(500, 'POOL_NOT_FOUND', 'Pool da pergunta não encontrado.');
      const nextSlot = pool.active_count + 1;
      // Duas aprovações concorrentes no MESMO pool podem ler o mesmo
      // active_count e mirar o mesmo próximo slot; a CAS abaixo barra a
      // segunda, mas a colisão de slot pode disparar a UNIQUE antes disso —
      // em ambos os casos é uma corrida perdida, não um erro de servidor.
      let results;
      try {
        results = await this.db.batch([
          this.db.prepare(
            `UPDATE questions SET status = 'ACTIVE', active_slot = ?1, resolved_by_user_id = ?2, resolved_at = CURRENT_TIMESTAMP
              WHERE id = ?3 AND status = 'IN_REVIEW'`,
          ).bind(nextSlot, actorUserId, questionId),
          this.db.prepare(
            `UPDATE question_pools SET active_count = active_count + 1, version = version + 1, updated_at = CURRENT_TIMESTAMP
              WHERE id = ?1 AND active_count = ?2`,
          ).bind(draft.poolId, pool.active_count),
        ]);
      } catch (error) {
        if (error instanceof Error && /UNIQUE constraint failed: questions\.pool_id, questions\.active_slot/i.test(error.message)) {
          throw new ApiError(409, 'QUESTION_CONFLICT', 'Esta pergunta mudou de estado. Atualize a tela.');
        }
        throw error;
      }
      if ((results[0]?.meta.changes ?? 0) !== 1 || (results[1]?.meta.changes ?? 0) !== 1) {
        throw new ApiError(409, 'QUESTION_CONFLICT', 'Esta pergunta mudou de estado. Atualize a tela.');
      }
      return { themeId: draft.themeId };
    }
    const previous = await this.db.prepare("SELECT active_slot FROM questions WHERE id = ?1 AND status = 'ACTIVE'")
      .bind(draft.replacesQuestionId).first<{ active_slot: number }>();
    if (previous === null) {
      throw new ApiError(409, 'QUESTION_REPLACED_MISSING', 'A pergunta publicada que este rascunho substituiria não está mais ativa.');
    }
    const results = await this.db.batch([
      this.db.prepare(
        `UPDATE questions SET status = 'DISABLED', active_slot = NULL, resolved_by_user_id = ?1, resolved_at = CURRENT_TIMESTAMP
          WHERE id = ?2 AND status = 'ACTIVE'`,
      ).bind(actorUserId, draft.replacesQuestionId),
      this.db.prepare(
        `UPDATE questions SET status = 'ACTIVE', active_slot = ?1, resolved_by_user_id = ?2, resolved_at = CURRENT_TIMESTAMP
          WHERE id = ?3 AND status = 'IN_REVIEW'`,
      ).bind(previous.active_slot, actorUserId, questionId),
    ]);
    if ((results[0]?.meta.changes ?? 0) !== 1 || (results[1]?.meta.changes ?? 0) !== 1) {
      throw new ApiError(409, 'QUESTION_CONFLICT', 'Esta pergunta mudou de estado. Atualize a tela.');
    }
    return { themeId: draft.themeId };
  }

  async reject(questionId: string, actorUserId: string, note: string | null): Promise<{ themeId: string }> {
    const draft = await this.findForModeration(questionId);
    if (draft === null) throw new ApiError(404, 'QUESTION_NOT_FOUND', 'Pergunta não encontrada.');
    const result = await this.db.prepare(
      `UPDATE questions SET status = 'REJECTED', resolution_note = ?1, resolved_by_user_id = ?2, resolved_at = CURRENT_TIMESTAMP
        WHERE id = ?3 AND status = 'IN_REVIEW'`,
    ).bind(note, actorUserId, questionId).run();
    if ((result.meta.changes ?? 0) !== 1) throw new ApiError(409, 'QUESTION_NOT_PENDING', 'Esta pergunta não aguarda aprovação.');
    return { themeId: draft.themeId };
  }

  /** Desativa uma pergunta ACTIVE preservando densidade: o último slot do pool assume o slot vago. */
  async deactivate(questionId: string, actorUserId: string): Promise<{ themeId: string }> {
    const current = await this.findForModeration(questionId);
    if (current === null || current.status !== 'ACTIVE' || current.activeSlot === null) {
      throw new ApiError(409, 'QUESTION_NOT_ACTIVE', 'Esta pergunta não está publicada.');
    }
    const pool = await this.db.prepare('SELECT active_count FROM question_pools WHERE id = ?1')
      .bind(current.poolId).first<{ active_count: number }>();
    if (pool === null) throw new ApiError(500, 'POOL_NOT_FOUND', 'Pool da pergunta não encontrado.');
    const lastSlot = pool.active_count;
    // A pergunta some do slot ANTES de qualquer outra tentar ocupá-lo: a ordem
    // evita colidir com o índice único (pool_id, active_slot) por um instante.
    const statements: D1PreparedStatement[] = [
      this.db.prepare(
        `UPDATE questions SET status = 'DISABLED', active_slot = NULL, resolved_by_user_id = ?1, resolved_at = CURRENT_TIMESTAMP
          WHERE id = ?2 AND status = 'ACTIVE' AND active_slot = ?3`,
      ).bind(actorUserId, questionId, current.activeSlot),
    ];
    if (current.activeSlot !== lastSlot) {
      statements.push(this.db.prepare(
        "UPDATE questions SET active_slot = ?1 WHERE pool_id = ?2 AND active_slot = ?3 AND status = 'ACTIVE'",
      ).bind(current.activeSlot, current.poolId, lastSlot));
    }
    statements.push(this.db.prepare(
      `UPDATE question_pools SET active_count = active_count - 1, version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?1 AND active_count = ?2`,
    ).bind(current.poolId, pool.active_count));
    const results = await this.db.batch(statements);
    if (results.some((result) => (result.meta.changes ?? 0) !== 1)) {
      throw new ApiError(409, 'QUESTION_CONFLICT', 'Esta pergunta mudou de estado. Atualize a tela.');
    }
    return { themeId: current.themeId };
  }

  private async assertNoLegacyDuplicate(hashes: readonly string[]): Promise<void> {
    const placeholders = hashes.map((_, index) => `?${index + 1}`).join(',');
    const duplicate = await this.db.prepare(
      `SELECT 1 FROM questions WHERE content_hash IN (${placeholders}) LIMIT 1`,
    ).bind(...hashes).first();
    if (duplicate !== null) {
      throw new ApiError(409, 'DUPLICATE_QUESTION', 'Uma pergunta com este conteúdo já existe.');
    }
  }

  private async runOrDuplicate(statements: D1PreparedStatement[]): Promise<void> {
    try {
      await this.db.batch(statements);
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: questions\.content_hash/i.test(error.message)) {
        throw new ApiError(409, 'DUPLICATE_QUESTION', 'Uma pergunta com este conteúdo já existe.');
      }
      throw error;
    }
  }
}
