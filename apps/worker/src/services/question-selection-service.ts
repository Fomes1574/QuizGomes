import {
  InsufficientQuestionPoolError,
  selectUniformSlots,
  type Difficulty,
  type RandomOrdinal,
} from '@quiz-gomes/domain';
import { ApiError } from '../http/api-error.js';
import type { SecretQuestionRecord } from '../repositories/question-repository.js';

interface QuestionReader {
  pool(themeId: string, difficulty: Difficulty): Promise<{ activeCount: number; id: string; version: number } | null>;
  secretBySlot(poolId: string, slot: number): Promise<SecretQuestionRecord | null>;
}

/**
 * Sorteio uniforme sobre os slots densos `1..N` do pool tema+dificuldade.
 *
 * Não consulta histórico de nenhum jogador: repetição entre partidas diferentes é
 * permitida e a ausência de repetição dentro da mesma partida vem da amostragem sem
 * reposição. O conjunto é sorteado uma única vez e serve os dois jogadores.
 */
export class QuestionSelectionService {
  constructor(
    private readonly questions: QuestionReader,
    private readonly randomOrdinal?: RandomOrdinal,
  ) {}

  async select(
    themeId: string,
    difficulty: Difficulty,
    count: number,
  ): Promise<{ poolId: string; poolVersion: number; questions: SecretQuestionRecord[] }> {
    const pool = await this.questions.pool(themeId, difficulty);
    if (pool === null || pool.activeCount === 0) {
      throw new ApiError(409, 'QUESTION_POOL_EMPTY', 'Este tema ainda não possui perguntas suficientes.');
    }
    let slots: number[];
    try {
      slots = selectUniformSlots(pool.activeCount, count, new Set(), this.randomOrdinal);
    } catch (error) {
      if (error instanceof InsufficientQuestionPoolError) {
        throw new ApiError(409, error.code, 'Este tema ainda não possui perguntas suficientes para esta dificuldade.');
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
