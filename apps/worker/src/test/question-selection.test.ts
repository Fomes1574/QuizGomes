import type { Difficulty } from '@quiz-gomes/domain';
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

function serviceWith(activeCount: number, ordinal = () => 0, secretBySlot?: () => Promise<null>) {
  return new QuestionSelectionService(
    {
      pool: (theme: string, difficulty: Difficulty) => {
        void theme;
        void difficulty;
        return Promise.resolve({ activeCount, id: 'pool-1', version: 1 });
      },
      secretBySlot: secretBySlot ?? ((pool: string, slot: number) => {
        expect(pool).toBe('pool-1');
        return Promise.resolve(question(slot));
      }),
    },
    ordinal,
  );
}

describe('seleção server-side de perguntas', () => {
  it('sorteia sobre o pool inteiro, sem consultar histórico de ninguém', async () => {
    const selected = await serviceWith(8).select('theme', 'EASY', 5);
    // Ordinal 0 sempre pega o menor slot elegível restante: nada foi bloqueado por histórico.
    expect(selected.questions.map((item) => item.slot)).toEqual([1, 2, 3, 4, 5]);
  });

  it('nunca repete pergunta dentro da mesma partida', async () => {
    let call = 0;
    const selected = await serviceWith(12, (upperExclusive) => {
      call += 1;
      return (call * 7) % upperExclusive;
    }).select('theme', 'HARD', 12);

    expect(selected.questions).toHaveLength(12);
    expect(new Set(selected.questions.map((item) => item.slot)).size).toBe(12);
    expect(new Set(selected.questions.map((item) => item.id)).size).toBe(12);
  });

  it('respeita o pool mínimo de cada dificuldade', async () => {
    await expect(serviceWith(4).select('theme', 'EASY', 5)).rejects.toMatchObject({
      code: 'QUESTION_POOL_INSUFFICIENT', status: 409,
    });
    await expect(serviceWith(7).select('theme', 'MEDIUM', 8)).rejects.toMatchObject({
      code: 'QUESTION_POOL_INSUFFICIENT', status: 409,
    });
    await expect(serviceWith(11).select('theme', 'HARD', 12)).rejects.toMatchObject({
      code: 'QUESTION_POOL_INSUFFICIENT', status: 409,
    });
    await expect(serviceWith(5).select('theme', 'EASY', 5)).resolves.toMatchObject({ poolId: 'pool-1' });
    await expect(serviceWith(8).select('theme', 'MEDIUM', 8)).resolves.toMatchObject({ poolId: 'pool-1' });
    await expect(serviceWith(12).select('theme', 'HARD', 12)).resolves.toMatchObject({ poolId: 'pool-1' });
  });

  it('rejeita pool vazio', async () => {
    await expect(serviceWith(0).select('theme', 'EASY', 5)).rejects.toMatchObject({
      code: 'QUESTION_POOL_EMPTY', status: 409,
    });
  });

  it('detecta slot denso inconsistente', async () => {
    await expect(serviceWith(5, () => 0, () => Promise.resolve(null)).select('theme', 'EASY', 1))
      .rejects.toMatchObject({ code: 'QUESTION_POOL_INCONSISTENT', status: 503 });
  });
});
