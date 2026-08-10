import {
  InsufficientQuestionPoolError,
  selectUniformSlots,
  unionRecent,
  type Difficulty,
  type RandomOrdinal,
} from '@quiz-gomes/domain';
import { ApiError } from '../http/api-error.js';
import type { SecretQuestionRecord } from '../repositories/question-repository.js';
import type { VersionedPoolState } from '../repositories/pool-state-repository.js';

interface PoolStateReader {
  read(userId: string, poolId: string, poolVersion?: number): Promise<VersionedPoolState>;
}

interface QuestionReader {
  pool(themeId: string, difficulty: Difficulty): Promise<{ activeCount: number; id: string; version: number } | null>;
  secretBySlot(poolId: string, slot: number): Promise<SecretQuestionRecord | null>;
}

export class QuestionSelectionService {
  constructor(
    private readonly questions: QuestionReader,
    private readonly poolStates: PoolStateReader,
    private readonly randomOrdinal?: RandomOrdinal,
  ) {}

  async select(
    themeId: string,
    difficulty: Difficulty,
    userIds: readonly [string, string],
    count: number,
  ): Promise<{ poolId: string; poolVersion: number; questions: SecretQuestionRecord[] }> {
    const pool = await this.questions.pool(themeId, difficulty);
    if (pool === null || pool.activeCount === 0) {
      throw new ApiError(409, 'QUESTION_POOL_EMPTY', 'Este tema ainda não possui perguntas suficientes.');
    }
    const states = await Promise.all(userIds.map((userId) => this.poolStates.read(userId, pool.id, pool.version)));
    const blocked = unionRecent(...states.map((state) => state.state));
    let slots: number[];
    try {
      slots = selectUniformSlots(pool.activeCount, count, blocked, this.randomOrdinal);
    } catch (error) {
      if (error instanceof InsufficientQuestionPoolError) {
        throw new ApiError(409, error.code, 'Não há perguntas elegíveis suficientes sem repetição recente.');
      }
      throw error;
    }
    const selected = await Promise.all(slots.map((slot) => this.questions.secretBySlot(pool.id, slot)));
    const complete = selected.filter((question): question is SecretQuestionRecord => question !== null);
    if (complete.length !== selected.length) {
      throw new ApiError(503, 'QUESTION_POOL_INCONSISTENT', 'O pool de perguntas está em manutenção.');
    }
    return {
      poolId: pool.id,
      poolVersion: pool.version,
      questions: complete,
    };
  }
}
