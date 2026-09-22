import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { recordQuestionAnswers, type QuestionAnswerEvent } from '../services/question-statistics-service.js';

async function seedQuestion(questionId: string): Promise<void> {
  const poolId = `stats-pool-${questionId}`;
  await env.QUESTIONS_DB.batch([
    env.QUESTIONS_DB.prepare(
      "INSERT INTO question_pools (id, theme_id, difficulty, active_count) VALUES (?1, ?2, 'EASY', 1)",
    ).bind(poolId, `theme-${questionId}`),
    env.QUESTIONS_DB.prepare(
      `INSERT INTO questions (
         id, pool_id, active_slot, prompt, option_a, option_b, option_c, option_d,
         correct_option, content_hash, status
       ) VALUES (?1, ?2, 1, 'x', 'a', 'b', 'c', 'd', 0, ?3, 'ACTIVE')`,
    ).bind(questionId, poolId, `hash-${questionId}`),
  ]);
}

async function statsOf(questionId: string) {
  return env.QUESTIONS_DB.prepare(
    `SELECT answer_count, correct_count, wrong_count, option_a_count, option_b_count,
            option_c_count, option_d_count, total_response_ms, use_count
       FROM question_statistics WHERE question_id = ?1`,
  ).bind(questionId).first();
}

describe('M11 — registro idempotente de estatísticas de pergunta', () => {
  it('incrementa uso, acerto/erro, distribuição por opção e tempo de resposta', async () => {
    const questionId = `stats-basic-${crypto.randomUUID()}`;
    await seedQuestion(questionId);
    const events: QuestionAnswerEvent[] = [
      {
        contextId: 'match-1', contextKind: 'MATCH', correct: true, questionId,
        remainingMs: 4_000, roundNumber: 1, selectedOption: 0, userId: 'user-a',
      },
      {
        contextId: 'match-1', contextKind: 'MATCH', correct: false, questionId,
        remainingMs: 0, roundNumber: 1, selectedOption: 2, userId: 'user-b',
      },
    ];
    await recordQuestionAnswers(env.QUESTIONS_DB, events);
    expect(await statsOf(questionId)).toEqual({
      answer_count: 2, correct_count: 1, wrong_count: 1,
      option_a_count: 1, option_b_count: 0, option_c_count: 1, option_d_count: 0,
      total_response_ms: 6_000 + 10_000, use_count: 2,
    });
  });

  it('timeout (selectedOption null) conta como uso/erro sem entrar em nenhuma opção', async () => {
    const questionId = `stats-timeout-${crypto.randomUUID()}`;
    await seedQuestion(questionId);
    await recordQuestionAnswers(env.QUESTIONS_DB, [{
      contextId: 'match-2', contextKind: 'MATCH', correct: false, questionId,
      remainingMs: 0, roundNumber: 1, selectedOption: null, userId: 'user-a',
    }]);
    expect(await statsOf(questionId)).toEqual({
      answer_count: 0, correct_count: 0, wrong_count: 1,
      option_a_count: 0, option_b_count: 0, option_c_count: 0, option_d_count: 0,
      total_response_ms: 10_000, use_count: 1,
    });
  });

  it('é idempotente por (contexto, rodada, usuário): repetir o mesmo evento não duplica', async () => {
    const questionId = `stats-idempotent-${crypto.randomUUID()}`;
    await seedQuestion(questionId);
    const event: QuestionAnswerEvent = {
      contextId: 'match-3', contextKind: 'MATCH', correct: true, questionId,
      remainingMs: 5_000, roundNumber: 1, selectedOption: 1, userId: 'user-a',
    };
    await recordQuestionAnswers(env.QUESTIONS_DB, [event]);
    // Simula um retry de finalização repetindo a MESMA chamada.
    await recordQuestionAnswers(env.QUESTIONS_DB, [event]);
    await recordQuestionAnswers(env.QUESTIONS_DB, [event]);
    expect(await statsOf(questionId)).toMatchObject({ answer_count: 1, use_count: 1 });
    const ledgerCount = await env.QUESTIONS_DB.prepare(
      `SELECT COUNT(*) AS total FROM question_statistics_ledger
        WHERE context_kind = 'MATCH' AND context_id = 'match-3' AND round_number = 1 AND user_id = 'user-a'`,
    ).first<{ total: number }>();
    expect(ledgerCount?.total).toBe(1);
  });

  it('retoma um recibo pendente sem duplicar o agregado', async () => {
    const questionId = `stats-pending-${crypto.randomUUID()}`;
    await seedQuestion(questionId);
    const event: QuestionAnswerEvent = {
      contextId: 'match-pending', contextKind: 'MATCH', correct: true, questionId,
      remainingMs: 5_000, roundNumber: 1, selectedOption: 1, userId: 'user-a',
    };
    // Simula uma queda depois de criar o recibo e antes do batch agregado.
    await env.QUESTIONS_DB.prepare(
      `INSERT INTO question_statistics_ledger
        (context_kind, context_id, round_number, user_id, question_id, applied)
       VALUES (?1, ?2, ?3, ?4, ?5, 0)`,
    ).bind(event.contextKind, event.contextId, event.roundNumber, event.userId, event.questionId).run();

    await expect(recordQuestionAnswers(env.QUESTIONS_DB, [event])).resolves.toBe(true);
    await expect(recordQuestionAnswers(env.QUESTIONS_DB, [event])).resolves.toBe(true);
    expect(await statsOf(questionId)).toMatchObject({ answer_count: 1, use_count: 1 });
    expect(await env.QUESTIONS_DB.prepare(
      `SELECT applied FROM question_statistics_ledger
        WHERE context_kind = ?1 AND context_id = ?2 AND round_number = ?3 AND user_id = ?4`,
    ).bind(event.contextKind, event.contextId, event.roundNumber, event.userId).first()).toEqual({ applied: 1 });
  });

  it('o mesmo usuário em rodadas diferentes, ou dois usuários na mesma rodada, contam separadamente', async () => {
    const questionId = `stats-rounds-${crypto.randomUUID()}`;
    await seedQuestion(questionId);
    await recordQuestionAnswers(env.QUESTIONS_DB, [
      { contextId: 'match-4', contextKind: 'MATCH', correct: true, questionId, remainingMs: 5_000, roundNumber: 1, selectedOption: 0, userId: 'user-a' },
      { contextId: 'match-4', contextKind: 'MATCH', correct: true, questionId, remainingMs: 5_000, roundNumber: 2, selectedOption: 0, userId: 'user-a' },
      { contextId: 'match-4', contextKind: 'MATCH', correct: true, questionId, remainingMs: 5_000, roundNumber: 1, selectedOption: 0, userId: 'user-b' },
    ]);
    expect(await statsOf(questionId)).toMatchObject({ answer_count: 3, use_count: 3 });
  });

  it('reporta false sem lançar quando a gravação best-effort falha', async () => {
    await expect(recordQuestionAnswers(env.QUESTIONS_DB, [{
      contextId: 'match-5', contextKind: 'MATCH', correct: true, questionId: 'pergunta-inexistente',
      remainingMs: 1_000, roundNumber: 1, selectedOption: 0, userId: 'user-a',
    }])).resolves.toBe(false);
  });

  it('lista vazia é no-op sem tocar o banco', async () => {
    await expect(recordQuestionAnswers(env.QUESTIONS_DB, [])).resolves.toBe(true);
  });
});
