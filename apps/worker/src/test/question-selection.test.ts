import { createPoolState, markAnswered, type Difficulty } from '@quiz-gomes/domain';
import { describe, expect, it } from 'vitest';
import type { SecretQuestionRecord } from '../repositories/question-repository.js';
import { QuestionSelectionService } from '../services/question-selection-service.js';

function question(slot: number): SecretQuestionRecord {
  return {
    correctOption: 0,
    id: `q-${slot}`,
    imageKey: null,
    options: ['A', 'B', 'C', 'D'],
    poolId: 'pool-1',
    prompt: `Pergunta ${slot}`,
    slot,
  };
}

describe('seleção server-side de perguntas', () => {
  it('exclui a união recente e não duplica na partida', async () => {
    const first = markAnswered(createPoolState(), 1);
    const second = markAnswered(createPoolState(), 2);
    const service = new QuestionSelectionService(
      {
        pool: (theme: string, difficulty: Difficulty) => {
          expect(theme).toBe('theme');
          expect(difficulty).toBe('EASY');
          return Promise.resolve({ activeCount: 8, id: 'pool-1', version: 1 });
        },
        secretBySlot: (pool: string, slot: number) => {
          expect(pool).toBe('pool-1');
          return Promise.resolve(question(slot));
        },
      },
      {
        read: (userId: string) => Promise.resolve({ poolVersion: 1, revision: 1, state: userId === 'u1' ? first : second }),
      },
      () => 0,
    );
    const selected = await service.select('theme', 'EASY', ['u1', 'u2'], 5);
    expect(selected.questions.map((item) => item.slot)).toEqual([3, 4, 5, 6, 7]);
    expect(new Set(selected.questions.map((item) => item.id)).size).toBe(5);
  });

  it('reproduz o esgotamento do antigo dataset sintético de 30 perguntas', async () => {
    let state = createPoolState();
    for (let slot = 1; slot <= 30; slot += 1) state = markAnswered(state, slot);
    const service = new QuestionSelectionService(
      {
        pool: () => Promise.resolve({ activeCount: 30, id: 'pool-1', version: 1 }),
        secretBySlot: (pool: string, slot: number) => {
          void pool;
          return Promise.resolve(question(slot));
        },
      },
      { read: () => Promise.resolve({ poolVersion: 1, revision: 1, state }) },
      () => 0,
    );
    await expect(service.select('theme', 'EASY', ['u1', 'u2'], 5)).rejects.toMatchObject({
      code: 'QUESTION_POOL_INSUFFICIENT', status: 409,
    });
  });

  it('mantém 50 slots elegíveis no dataset sintético ampliado após 200 recentes', async () => {
    let state = createPoolState();
    for (let slot = 1; slot <= 200; slot += 1) state = markAnswered(state, slot);
    const service = new QuestionSelectionService(
      {
        pool: () => Promise.resolve({ activeCount: 250, id: 'pool-1', version: 1 }),
        secretBySlot: (_pool: string, slot: number) => Promise.resolve(question(slot)),
      },
      { read: () => Promise.resolve({ poolVersion: 1, revision: 40, state }) },
      () => 0,
    );
    const selected = await service.select('theme', 'EASY', ['u1', 'u2'], 5);
    expect(selected.questions.map((item) => item.slot)).toEqual([201, 202, 203, 204, 205]);
  });

  it('detecta slot denso inconsistente', async () => {
    const service = new QuestionSelectionService(
      {
        pool: () => Promise.resolve({ activeCount: 5, id: 'pool-1', version: 1 }),
        secretBySlot: () => Promise.resolve(null),
      },
      { read: () => Promise.resolve({ poolVersion: 1, revision: 0, state: createPoolState() }) },
      () => 0,
    );
    await expect(service.select('theme', 'EASY', ['u1', 'u2'], 1)).rejects.toMatchObject({
      code: 'QUESTION_POOL_INCONSISTENT', status: 503,
    });
  });
});
