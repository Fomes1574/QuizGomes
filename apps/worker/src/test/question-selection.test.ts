import type { RandomOrdinal } from '@quiz-gomes/domain';
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

function serviceWith(
  activeCount: number,
  ordinal: RandomOrdinal = () => 0,
  secretBySlot?: () => Promise<null>,
) {
  return new QuestionSelectionService(
    {
      pool: (theme: string) => {
        void theme;
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
  it('sorteia sobre o pool único do tema inteiro, sem consultar histórico de ninguém', async () => {
    const selected = await serviceWith(8).select('theme', 5);
    // Ordinal 0 sempre pega o menor slot elegível restante: nada foi bloqueado por histórico.
    expect(selected.questions.map((item) => item.slot)).toEqual([1, 2, 3, 4, 5]);
  });

  it('nunca repete pergunta dentro da mesma partida', async () => {
    let call = 0;
    const selected = await serviceWith(12, (upperExclusive) => {
      call += 1;
      return (call * 7) % upperExclusive;
    }).select('theme', 10);

    expect(selected.questions).toHaveLength(10);
    expect(new Set(selected.questions.map((item) => item.slot)).size).toBe(10);
    expect(new Set(selected.questions.map((item) => item.id)).size).toBe(10);
  });

  it('respeita o mínimo de perguntas exigido por Normal (7) e Rankeada (10)', async () => {
    await expect(serviceWith(6).select('theme', 7)).rejects.toMatchObject({
      code: 'QUESTION_POOL_INSUFFICIENT', status: 409,
    });
    await expect(serviceWith(9).select('theme', 10)).rejects.toMatchObject({
      code: 'QUESTION_POOL_INSUFFICIENT', status: 409,
    });
    await expect(serviceWith(7).select('theme', 7)).resolves.toMatchObject({ poolId: 'pool-1' });
    await expect(serviceWith(10).select('theme', 10)).resolves.toMatchObject({ poolId: 'pool-1' });
  });

  it('rejeita pool vazio', async () => {
    await expect(serviceWith(0).select('theme', 7)).rejects.toMatchObject({
      code: 'QUESTION_POOL_EMPTY', status: 409,
    });
  });

  it('detecta slot denso inconsistente', async () => {
    await expect(serviceWith(5, () => 0, () => Promise.resolve(null)).select('theme', 1))
      .rejects.toMatchObject({ code: 'QUESTION_POOL_INCONSISTENT', status: 503 });
  });
});
