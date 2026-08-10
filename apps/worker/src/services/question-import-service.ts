import type { ImportedQuestion } from '../http/schemas.js';
import { ApiError } from '../http/api-error.js';

function normalized(question: ImportedQuestion): string {
  return JSON.stringify({
    difficulty: question.difficulty,
    options: question.options.map((option) => option.normalize('NFKC').trim().toLocaleLowerCase('pt-BR')),
    prompt: question.prompt.normalize('NFKC').trim().toLocaleLowerCase('pt-BR'),
    themeId: question.themeId,
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function poolId(themeId: string, difficulty: string): string {
  return `${themeId}:${difficulty.toLowerCase()}`;
}

export class QuestionImportService {
  constructor(
    private readonly coreDb: D1Database,
    private readonly questionsDb: D1Database,
  ) {}

  async import(
    actorUserId: string,
    idempotencyKey: string,
    questions: readonly ImportedQuestion[],
  ): Promise<{ batchId: string; imported: number; status: 'APPLIED' | 'ALREADY_APPLIED' }> {
    if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Envie uma Idempotency-Key válida.');
    }
    const existing = await this.questionsDb.prepare(
      'SELECT id, status, item_count FROM question_import_batches WHERE idempotency_key = ?1',
    ).bind(idempotencyKey).first<{ id: string; item_count: number; status: string }>();
    if (existing !== null) {
      if (existing.status === 'APPLIED') return { batchId: existing.id, imported: existing.item_count, status: 'ALREADY_APPLIED' };
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

    const hashes = await Promise.all(questions.map((question) => sha256(normalized(question))));
    if (new Set(hashes).size !== hashes.length) {
      throw new ApiError(400, 'DUPLICATE_IN_BATCH', 'O lote contém perguntas duplicadas.');
    }

    const batchId = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [
      this.questionsDb.prepare(
        `INSERT INTO question_import_batches (id, actor_user_id, idempotency_key, status, item_count)
         VALUES (?1, ?2, ?3, 'VALIDATING', ?4)`,
      ).bind(batchId, actorUserId, idempotencyKey, questions.length),
    ];

    questions.forEach((question, index) => {
      const targetPoolId = poolId(question.themeId, question.difficulty);
      statements.push(
        this.questionsDb.prepare(
          `INSERT OR IGNORE INTO question_pools (id, theme_id, difficulty)
           VALUES (?1, ?2, ?3)`,
        ).bind(targetPoolId, question.themeId, question.difficulty),
      );
      const questionId = crypto.randomUUID();
      statements.push(
        this.questionsDb.prepare(
          `INSERT INTO questions (
             id, pool_id, prompt, option_a, option_b, option_c, option_d, correct_option,
             content_hash, status, image_key, image_bytes, image_license, created_by_user_id
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'IN_REVIEW', ?10, ?11, ?12, ?13)`,
        ).bind(
          questionId,
          targetPoolId,
          question.prompt,
          ...question.options,
          question.correctOption,
          hashes[index],
          question.image?.key ?? null,
          question.image?.bytes ?? null,
          question.image?.license ?? null,
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
      return { batchId, imported: questions.length, status: 'APPLIED' };
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: questions\.content_hash/i.test(error.message)) {
        throw new ApiError(409, 'DUPLICATE_QUESTION', 'Uma ou mais perguntas já existem.');
      }
      throw error;
    }
  }
}
