import type { ReportContextKind } from '@quiz-gomes/domain';

/**
 * Recibo idempotente de entrega de pergunta. Não contém resposta, tempo ou
 * resultado; existe somente para provar que a rodada pública chegou ao usuário.
 */
export async function recordReportView(
  db: D1Database,
  input: {
    contextId: string;
    contextKind: ReportContextKind;
    questionId: string;
    roundNumber: number;
    userId: string;
  },
): Promise<void> {
  await db.prepare(
    `INSERT OR IGNORE INTO question_report_views
      (context_kind, context_id, user_id, round_number, question_id)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  ).bind(
    input.contextKind,
    input.contextId,
    input.userId,
    input.roundNumber,
    input.questionId,
  ).run();
}
