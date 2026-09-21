/**
 * Registro best-effort de estatísticas de pergunta.
 *
 * Nunca é chamado antes do resultado competitivo já estar persistido, e uma
 * falha aqui nunca desfaz XP, Conhecimento ou o resultado em si — é só
 * telemetria editorial. A idempotência real vem de
 * `question_statistics_ledger`: cada (contexto, rodada, usuário) só
 * incrementa `question_statistics` uma única vez, mesmo que a finalização
 * autoritativa que chama esta função seja repetida (retry de alarme, replay
 * de um resultado já aplicado).
 */

const QUESTION_DURATION_MS = 10_000;

export interface QuestionAnswerEvent {
  contextId: string;
  contextKind: 'CHALLENGE' | 'MATCH';
  correct: boolean;
  questionId: string;
  remainingMs: number;
  roundNumber: number;
  selectedOption: number | null;
  userId: string;
}

export async function recordQuestionAnswers(
  questionsDb: D1Database,
  events: readonly QuestionAnswerEvent[],
): Promise<void> {
  if (events.length === 0) return;
  try {
    const ledgerResults = await questionsDb.batch(events.map((event) => questionsDb.prepare(
      `INSERT OR IGNORE INTO question_statistics_ledger
        (context_kind, context_id, round_number, user_id, question_id)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    ).bind(event.contextKind, event.contextId, event.roundNumber, event.userId, event.questionId)));
    const fresh = events.filter((_event, index) => (ledgerResults[index]?.meta.changes ?? 0) === 1);
    if (fresh.length === 0) return;

    const statements: D1PreparedStatement[] = [];
    for (const event of fresh) {
      statements.push(
        questionsDb.prepare('INSERT OR IGNORE INTO question_statistics (question_id) VALUES (?1)')
          .bind(event.questionId),
        questionsDb.prepare(
          `UPDATE question_statistics SET
              use_count = use_count + 1,
              answer_count = answer_count + ?1,
              correct_count = correct_count + ?2,
              wrong_count = wrong_count + ?3,
              option_a_count = option_a_count + CASE WHEN ?4 = 0 THEN 1 ELSE 0 END,
              option_b_count = option_b_count + CASE WHEN ?4 = 1 THEN 1 ELSE 0 END,
              option_c_count = option_c_count + CASE WHEN ?4 = 2 THEN 1 ELSE 0 END,
              option_d_count = option_d_count + CASE WHEN ?4 = 3 THEN 1 ELSE 0 END,
              total_response_ms = total_response_ms + ?5,
              updated_at = CURRENT_TIMESTAMP
            WHERE question_id = ?6`,
        ).bind(
          event.selectedOption === null ? 0 : 1,
          event.correct ? 1 : 0,
          event.correct ? 0 : 1,
          event.selectedOption ?? -1,
          Math.max(0, QUESTION_DURATION_MS - event.remainingMs),
          event.questionId,
        ),
      );
    }
    await questionsDb.batch(statements);
  } catch {
    console.error(JSON.stringify({ code: 'QUESTION_STATISTICS_RECORD_FAILED', event: 'question_statistics' }));
  }
}
