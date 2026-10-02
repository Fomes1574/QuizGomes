import type { ImportedQuestion } from '../http/schemas.js';
import { ApiError } from '../http/api-error.js';
import { questionContentHashCandidates, questionPoolId } from './question-content.js';

// Limite documentado do D1 por instrução. Cada pergunta consulta também três
// hashes legados; um lote de 100 pode chegar a 400 valores no IN (...).
const D1_MAX_BOUND_PARAMETERS = 100;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

interface ExistingQuestion {
  id: string;
  image_key: string | null;
  status: string;
}

/**
 * Destino de cada pergunta do lote, na mesma ordem do envio. O painel usa
 * para prender a foto citada na linha: só aceita foto a pergunta que está em
 * revisão e ainda não tem foto (a recém-criada, ou a de uma parte que já
 * entrou antes e teve o envio da foto interrompido). Publicada, rejeitada ou
 * já com foto nunca é tocada por uma importação. Repetida dentro do próprio
 * lote não recebe destino: a foto da primeira ocorrência é a que vale.
 */
export interface ImportedRow {
  acceptsImage: boolean;
  questionId: string | null;
}

export class QuestionImportService {
  constructor(
    private readonly coreDb: D1Database,
    private readonly questionsDb: D1Database,
  ) {}

  /**
   * Importa um lote (até 100 perguntas) para revisão, tudo ou nada.
   *
   * Com `skipDuplicates`, perguntas que já existem no catálogo (ou repetidas
   * dentro do próprio lote) são puladas e contadas em `skipped` em vez de
   * recusar o lote inteiro. É o modo usado pelo painel ao enviar um arquivo
   * grande em partes: reenviar o mesmo arquivo depois de uma falha continua
   * de onde parou, sem duplicar nada.
   */
  async import(
    actorUserId: string,
    idempotencyKey: string,
    questions: readonly ImportedQuestion[],
    options: { skipDuplicates?: boolean } = {},
  ): Promise<{
    batchId: string; imported: number; rows: ImportedRow[]; skipped: number; status: 'APPLIED' | 'ALREADY_APPLIED';
  }> {
    if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Envie uma Idempotency-Key válida.');
    }
    const existing = await this.questionsDb.prepare(
      'SELECT id, status, item_count FROM question_import_batches WHERE idempotency_key = ?1',
    ).bind(idempotencyKey).first<{ id: string; item_count: number; status: string }>();
    if (existing !== null) {
      if (existing.status === 'APPLIED') {
        // Parte reenviada: o destino de cada linha vem do conteúdo, para a
        // retomada ainda conseguir prender as fotos que faltaram.
        const candidates = await Promise.all(questions.map((question) => questionContentHashCandidates(question)));
        const found = await this.findByHashes([...new Set(candidates.flat())]);
        return {
          batchId: existing.id, imported: existing.item_count,
          rows: rowsFor(candidates, found, new Map()), skipped: 0, status: 'ALREADY_APPLIED',
        };
      }
      throw new ApiError(409, 'IMPORT_IN_PROGRESS', 'Este lote já está em processamento.');
    }

    const themeIds = [...new Set(questions.map((question) => question.themeId))];
    const placeholders = themeIds.map((_, index) => `?${index + 1}`).join(',');
    const themes = await this.coreDb.prepare(
      `SELECT id FROM themes WHERE id IN (${placeholders}) AND status IN ('ACTIVE', 'PENDING')`,
    ).bind(...themeIds).all<{ id: string }>();
    const foundThemeIds = new Set(themes.results.map((theme) => theme.id));
    const missing = themeIds.filter((id) => !foundThemeIds.has(id));
    if (missing.length > 0) throw new ApiError(400, 'UNKNOWN_THEME', 'O lote contém tema inexistente.', { themeIds: missing });

    const hashCandidates = await Promise.all(questions.map((question) => questionContentHashCandidates(question)));
    const canonicalHashes = hashCandidates.map(([canonical]) => canonical);
    if (!options.skipDuplicates && new Set(canonicalHashes).size !== canonicalHashes.length) {
      throw new ApiError(400, 'DUPLICATE_IN_BATCH', 'O lote contém perguntas duplicadas.');
    }
    const existingByHash = await this.findByHashes([...new Set(hashCandidates.flat())]);
    if (!options.skipDuplicates && existingByHash.size > 0) {
      throw new ApiError(409, 'DUPLICATE_QUESTION', 'Uma ou mais perguntas já existem.');
    }

    const seen = new Set<string>();
    const accepted: Array<{ hash: string; question: ImportedQuestion }> = [];
    let skipped = 0;
    questions.forEach((question, index) => {
      const candidates = hashCandidates[index] ?? [];
      const hash = candidates[0]!;
      if (seen.has(hash)) {
        skipped += 1;
        return;
      }
      seen.add(hash);
      if (candidates.some((candidate) => existingByHash.has(candidate))) {
        skipped += 1;
        return;
      }
      accepted.push({ hash, question });
    });

    const batchId = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [
      this.questionsDb.prepare(
        `INSERT INTO question_import_batches (id, actor_user_id, idempotency_key, status, item_count)
         VALUES (?1, ?2, ?3, 'VALIDATING', ?4)`,
      ).bind(batchId, actorUserId, idempotencyKey, accepted.length),
      // `difficulty` é legado físico do schema (nunca lido de volta); todo pool novo nasce com o mesmo valor fixo.
      ...[...new Set(accepted.map(({ question }) => question.themeId))].map((themeId) => this.questionsDb.prepare(
        `INSERT OR IGNORE INTO question_pools (id, theme_id, difficulty)
         VALUES (?1, ?2, 'MEDIUM')`,
      ).bind(questionPoolId(themeId), themeId)),
    ];

    const createdByHash = new Map<string, string>();
    accepted.forEach(({ hash, question }) => {
      const targetPoolId = questionPoolId(question.themeId);
      const questionId = crypto.randomUUID();
      createdByHash.set(hash, questionId);
      statements.push(
        this.questionsDb.prepare(
           `INSERT INTO questions (
             id, pool_id, prompt, option_a, option_b, option_c, option_d, correct_option,
             content_hash, status, created_by_user_id
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'IN_REVIEW', ?10)`,
        ).bind(
          questionId,
          targetPoolId,
          question.prompt,
          ...question.options,
          question.correctOption,
          hash,
          actorUserId,
        ),
      );
      question.sources.forEach((source) => {
        statements.push(
          this.questionsDb.prepare(
            `INSERT INTO question_sources (id, question_id, url, title, source_kind)
             VALUES (?1, ?2, ?3, ?4, ?5)`,
          ).bind(crypto.randomUUID(), questionId, source.url, source.title ?? null, source.kind),
        );
      });
    });

    statements.push(
      this.questionsDb.prepare(
        "UPDATE question_import_batches SET status = 'APPLIED', finished_at = CURRENT_TIMESTAMP WHERE id = ?1",
      ).bind(batchId),
    );

    try {
      await this.questionsDb.batch(statements);
      return {
        batchId, imported: accepted.length, rows: rowsFor(hashCandidates, existingByHash, createdByHash), skipped, status: 'APPLIED',
      };
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: questions\.content_hash/i.test(error.message)) {
        throw new ApiError(409, 'DUPLICATE_QUESTION', 'Uma ou mais perguntas já existem.');
      }
      throw error;
    }
  }

  /** Perguntas já gravadas com algum destes hashes, em consultas de até 100 parâmetros. */
  private async findByHashes(hashes: readonly string[]): Promise<Map<string, ExistingQuestion>> {
    const found = new Map<string, ExistingQuestion>();
    // Nunca monte um IN acima dos 100 parâmetros do D1. Este era o motivo de
    // o CSV válido de 100 perguntas falhar com erro genérico em produção.
    for (const hashChunk of chunks(hashes, D1_MAX_BOUND_PARAMETERS)) {
      const hashPlaceholders = hashChunk.map((_, index) => `?${index + 1}`).join(',');
      const result = await this.questionsDb.prepare(
        `SELECT content_hash, id, status, image_key FROM questions WHERE content_hash IN (${hashPlaceholders})`,
      ).bind(...hashChunk).all<ExistingQuestion & { content_hash: string }>();
      for (const row of result.results) found.set(row.content_hash, { id: row.id, image_key: row.image_key, status: row.status });
    }
    return found;
  }
}

function rowsFor(
  hashCandidates: readonly (readonly string[])[],
  existingByHash: ReadonlyMap<string, ExistingQuestion>,
  createdByHash: ReadonlyMap<string, string>,
): ImportedRow[] {
  const seen = new Set<string>();
  return hashCandidates.map((candidates) => {
    const canonical = candidates[0]!;
    if (seen.has(canonical)) return { acceptsImage: false, questionId: null };
    seen.add(canonical);
    const created = createdByHash.get(canonical);
    if (created !== undefined) return { acceptsImage: true, questionId: created };
    const existing = candidates.map((candidate) => existingByHash.get(candidate)).find((row) => row !== undefined);
    if (existing === undefined) return { acceptsImage: false, questionId: null };
    return { acceptsImage: existing.status === 'IN_REVIEW' && existing.image_key === null, questionId: existing.id };
  });
}
