import type { Difficulty } from '@quiz-gomes/domain';

export interface PublicQuestionRecord {
  id: string;
  imageKey: string | null;
  options: readonly [string, string, string, string];
  poolId: string;
  prompt: string;
  slot: number;
}

export interface SecretQuestionRecord extends PublicQuestionRecord {
  correctOption: number;
}

interface QuestionRow {
  active_slot: number;
  correct_option: number;
  id: string;
  image_key: string | null;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  pool_id: string;
  prompt: string;
}

function mapQuestion(row: QuestionRow): SecretQuestionRecord {
  return {
    correctOption: row.correct_option,
    id: row.id,
    imageKey: row.image_key,
    options: [row.option_a, row.option_b, row.option_c, row.option_d],
    poolId: row.pool_id,
    prompt: row.prompt,
    slot: row.active_slot,
  };
}

export class QuestionRepository {
  constructor(private readonly db: D1Database) {}

  async pool(themeId: string, difficulty: Difficulty): Promise<{ activeCount: number; id: string; version: number } | null> {
    const row = await this.db.prepare(
      `SELECT id, active_count, version
         FROM question_pools
        WHERE theme_id = ?1 AND difficulty = ?2 AND migration_status = 'READY'`,
    ).bind(themeId, difficulty).first<{ active_count: number; id: string; version: number }>();
    return row === null ? null : { activeCount: row.active_count, id: row.id, version: row.version };
  }

  async secretBySlot(poolId: string, slot: number): Promise<SecretQuestionRecord | null> {
    const row = await this.db.prepare(
      `SELECT id, pool_id, active_slot, prompt, option_a, option_b, option_c, option_d, correct_option, image_key
         FROM questions
        WHERE pool_id = ?1 AND active_slot = ?2 AND status = 'ACTIVE'
        LIMIT 1`,
    ).bind(poolId, slot).first<QuestionRow>();
    return row === null ? null : mapQuestion(row);
  }

  async activeCounts(themeId: string): Promise<Record<Difficulty, number>> {
    const result = await this.db.prepare(
      `SELECT difficulty, active_count FROM question_pools WHERE theme_id = ?1 AND migration_status = 'READY'`,
    ).bind(themeId).all<{ active_count: number; difficulty: Difficulty }>();
    const counts: Record<Difficulty, number> = { EASY: 0, MEDIUM: 0, HARD: 0 };
    for (const row of result.results) counts[row.difficulty] = row.active_count;
    return counts;
  }

  async poolsByTheme(themeId: string): Promise<Array<{
    activeCount: number;
    difficulty: Difficulty;
    id: string;
    version: number;
  }>> {
    const result = await this.db.prepare(
      `SELECT id, difficulty, active_count, version
         FROM question_pools
        WHERE theme_id = ?1 AND migration_status = 'READY'`,
    ).bind(themeId).all<{ active_count: number; difficulty: Difficulty; id: string; version: number }>();
    return result.results.map((row) => ({
      activeCount: row.active_count,
      difficulty: row.difficulty,
      id: row.id,
      version: row.version,
    }));
  }
}
