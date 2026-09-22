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
): Promise<boolean> {
  if (events.length === 0) return true;
  try {
    await questionsDb.batch(events.map((event) => questionsDb.prepare(
      `INSERT OR IGNORE INTO question_statistics_ledger
        (context_kind, context_id, round_number, user_id, question_id, applied)
       VALUES (?1, ?2, ?3, ?4, ?5, 0)`,
    ).bind(event.contextKind, event.contextId, event.roundNumber, event.userId, event.questionId)));

    // Todas as mutações do evento pendente e seu recibo final vivem no mesmo
    // batch: retry após falha retoma `applied = 0`; retry após sucesso é no-op.
    const statements: D1PreparedStatement[] = [];
    for (const event of events) {
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
            WHERE question_id = ?6
              AND EXISTS (
                SELECT 1 FROM question_statistics_ledger
                 WHERE context_kind = ?7 AND context_id = ?8 AND round_number = ?9
                   AND user_id = ?10 AND question_id = ?6 AND applied = 0
              )`,
        ).bind(
          event.selectedOption === null ? 0 : 1,
          event.correct ? 1 : 0,
          event.correct ? 0 : 1,
          event.selectedOption ?? -1,
          Math.max(0, QUESTION_DURATION_MS - event.remainingMs),
          event.questionId,
          event.contextKind,
          event.contextId,
          event.roundNumber,
          event.userId,
        ),
        questionsDb.prepare(
          `UPDATE question_statistics_ledger SET applied = 1
            WHERE context_kind = ?1 AND context_id = ?2 AND round_number = ?3
              AND user_id = ?4 AND question_id = ?5 AND applied = 0`,
        ).bind(event.contextKind, event.contextId, event.roundNumber, event.userId, event.questionId),
      );
    }
    await questionsDb.batch(statements);
    return true;
  } catch {
    console.error(JSON.stringify({ code: 'QUESTION_STATISTICS_RECORD_FAILED', event: 'question_statistics' }));
    return false;
  }
}
