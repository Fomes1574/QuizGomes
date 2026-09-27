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
  ): Promise<{ batchId: string; imported: number; skipped: number; status: 'APPLIED' | 'ALREADY_APPLIED' }> {
    if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Envie uma Idempotency-Key válida.');
    }
    const existing = await this.questionsDb.prepare(
      'SELECT id, status, item_count FROM question_import_batches WHERE idempotency_key = ?1',
    ).bind(idempotencyKey).first<{ id: string; item_count: number; status: string }>();
    if (existing !== null) {
      if (existing.status === 'APPLIED') {
        return { batchId: existing.id, imported: existing.item_count, skipped: 0, status: 'ALREADY_APPLIED' };
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
    const allHashCandidates = [...new Set(hashCandidates.flat())];
    const existingHashes = new Set<string>();
    // Nunca monte um IN acima dos 100 parâmetros do D1. Este era o motivo de
    // o CSV válido de 100 perguntas falhar com erro genérico em produção.
    for (const hashChunk of chunks(allHashCandidates, D1_MAX_BOUND_PARAMETERS)) {
      const hashPlaceholders = hashChunk.map((_, index) => `?${index + 1}`).join(',');
      const found = await this.questionsDb.prepare(
        `SELECT content_hash FROM questions WHERE content_hash IN (${hashPlaceholders})`,
      ).bind(...hashChunk).all<{ content_hash: string }>();
      for (const row of found.results) existingHashes.add(row.content_hash);
      if (!options.skipDuplicates && existingHashes.size > 0) {
        throw new ApiError(409, 'DUPLICATE_QUESTION', 'Uma ou mais perguntas já existem.');
      }
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
      if (candidates.some((candidate) => existingHashes.has(candidate))) {
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

    accepted.forEach(({ hash, question }) => {
      const targetPoolId = questionPoolId(question.themeId);
      const questionId = crypto.randomUUID();
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
      return { batchId, imported: accepted.length, skipped, status: 'APPLIED' };
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: questions\.content_hash/i.test(error.message)) {
        throw new ApiError(409, 'DUPLICATE_QUESTION', 'Uma ou mais perguntas já existem.');
      }
      throw error;
    }
  }
}
