/**
 * Limpeza automática, rodada por Cron Trigger (ver `scheduled` em index.ts).
 *
 * O que vence:
 * - 15 dias: perguntas seladas, respostas, recibos de denúncia e de
 *   estatística de partidas e desafios já encerrados; missões diárias;
 *   lotes de importação concluídos.
 * - 6 meses: histórico de administração, exceto concessão e remoção do papel
 *   de ADMIN, que ficam para sempre.
 * - 1 dia: marcas de limite do aviso "amigo na fila" (só valem por 1 hora).
 *
 * O que nunca vence: a partida em si (`matches`, `match_players`,
 * `result_ledger`), perfis, Conhecimento, recordes, ofensivas e conquistas.
 * Assim placar, estatísticas e "últimas partidas" continuam corretos.
 *
 * Cada execução tem um orçamento fixo de consultas (o D1 gratuito limita
 * consultas por invocação) e apaga em lotes pequenos; o que sobrar fica para
 * a próxima hora. As consultas partem sempre do que ainda existe, então o
 * custo acompanha só os últimos 15 dias, nunca o histórico inteiro.
 */

export const GAMEPLAY_RETENTION_DAYS = 15;
export const ADMIN_AUDIT_RETENTION_MONTHS = 6;
export const QUEUE_ALERT_RETENTION_MS = 24 * 60 * 60 * 1_000;
/** Ações de auditoria guardadas para sempre. */
export const PERMANENT_AUDIT_ACTIONS = ['GRANT_ADMIN_ROLE', 'REVOKE_ADMIN_ROLE'] as const;

const DEFAULT_QUERY_BUDGET = 40;
const CONTEXT_CHUNK = 40;
const ROW_CHUNK = 500;

const TERMINAL_MATCH_STATUSES = "('FINISHED', 'VOID')";
const TERMINAL_CHALLENGE_STATUSES = "('CANCELLED', 'DECLINED', 'EXPIRED', 'VOID', 'COMPLETED')";

export interface RetentionReport {
  auditLogs: number;
  challenges: number;
  /** Sobrou trabalho para a próxima execução (lotes cheios até o teto). */
  backlog: boolean;
  dailyMissions: number;
  weeklyMissions: number;
  importBatches: number;
  matches: number;
  queueAlerts: number;
  reportViews: number;
  statisticsReceipts: number;
}

/**
 * Corte com precisão de dia (`YYYY-MM-DD`). Comparar com o prefixo do dia
 * funciona tanto para `CURRENT_TIMESTAMP` ("2026-09-12 10:00:00") quanto para
 * ISO ("2026-09-12T10:00:00.000Z"): os dois são maiores que "2026-09-12".
 */
export function retentionCutoffDay(nowMs: number, days = GAMEPLAY_RETENTION_DAYS): string {
  return new Date(nowMs - days * 86_400_000).toISOString().slice(0, 10);
}

export function auditCutoffDay(nowMs: number, months = ADMIN_AUDIT_RETENTION_MONTHS): string {
  const date = new Date(nowMs);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 10);
}

function placeholders(count: number, offset = 0): string {
  return Array.from({ length: count }, (_, index) => `?${index + 1 + offset}`).join(',');
}

export class RetentionService {
  private remaining: number;
  private backlog = false;

  constructor(
    private readonly coreDb: D1Database,
    private readonly questionsDb: D1Database,
    queryBudget = DEFAULT_QUERY_BUDGET,
  ) {
    this.remaining = queryBudget;
  }

  private spend(count: number): boolean {
    if (this.remaining < count) return false;
    this.remaining -= count;
    return true;
  }

  async run(nowMs: number): Promise<RetentionReport> {
    const cutoff = retentionCutoffDay(nowMs);
    const report: RetentionReport = {
      auditLogs: 0, backlog: false, challenges: 0, dailyMissions: 0, importBatches: 0, weeklyMissions: 0,
      matches: 0, queueAlerts: 0, reportViews: 0, statisticsReceipts: 0,
    };
    // Cada etapa tem um teto de rodadas para uma fila grande de partidas não
    // impedir as outras tabelas de andarem: 15 + 9 + 6 × 2 = 36 consultas.
    report.matches = await this.purgeContexts('match', cutoff, 5);
    report.challenges = await this.purgeContexts('challenge', cutoff, 3);
    report.reportViews = await this.deleteRows(
      this.coreDb,
      `DELETE FROM question_report_views WHERE rowid IN (
         SELECT rowid FROM question_report_views WHERE delivered_at < ?1 LIMIT ${ROW_CHUNK})`,
      [cutoff],
    );
    report.statisticsReceipts = await this.deleteRows(
      this.questionsDb,
      `DELETE FROM question_statistics_ledger WHERE rowid IN (
         SELECT rowid FROM question_statistics_ledger WHERE applied = 1 AND recorded_at < ?1 LIMIT ${ROW_CHUNK})`,
      [cutoff],
    );
    report.dailyMissions = await this.deleteRows(
      this.coreDb,
      `DELETE FROM user_daily_missions WHERE rowid IN (
         SELECT rowid FROM user_daily_missions WHERE day_key < ?1 LIMIT ${ROW_CHUNK})`,
      [cutoff],
    );
    report.weeklyMissions = await this.deleteRows(
      this.coreDb,
      `DELETE FROM user_weekly_missions WHERE rowid IN (
         SELECT rowid FROM user_weekly_missions WHERE week_key < ?1 LIMIT ${ROW_CHUNK})`,
      [cutoff],
    );
    report.queueAlerts = await this.deleteRows(
      this.coreDb,
      `DELETE FROM friend_queue_alerts WHERE rowid IN (
         SELECT rowid FROM friend_queue_alerts WHERE sent_at_ms < ?1 LIMIT ${ROW_CHUNK})`,
      [nowMs - QUEUE_ALERT_RETENTION_MS],
    );
    report.importBatches = await this.deleteRows(
      this.questionsDb,
      `DELETE FROM question_import_batches WHERE id IN (
         SELECT id FROM question_import_batches WHERE status <> 'VALIDATING' AND created_at < ?1 LIMIT ${ROW_CHUNK})`,
      [cutoff],
    );
    report.auditLogs = await this.deleteRows(
      this.coreDb,
      `DELETE FROM audit_logs WHERE id IN (
         SELECT id FROM audit_logs
          WHERE created_at < ?1 AND action NOT IN (${placeholders(PERMANENT_AUDIT_ACTIONS.length, 1)})
          LIMIT ${ROW_CHUNK})`,
      [auditCutoffDay(nowMs), ...PERMANENT_AUDIT_ACTIONS],
    );
    report.backlog = this.backlog;
    return report;
  }

  /** Repete um DELETE limitado até esvaziar, acabar as rodadas ou o orçamento. */
  private async deleteRows(db: D1Database, sql: string, params: unknown[], rounds = 2): Promise<number> {
    let total = 0;
    let full = false;
    for (let round = 0; round < rounds && this.spend(1); round += 1) {
      const result = await db.prepare(sql).bind(...params).run();
      const changes = result.meta.changes ?? 0;
      total += changes;
      full = changes >= ROW_CHUNK;
      if (!full) break;
    }
    if (full) this.backlog = true;
    return total;
  }

  /**
   * Parte da tabela de perguntas seladas (que só guarda os últimos 15 dias)
   * em vez da tabela de partidas/desafios (que guarda tudo): o custo não
   * cresce com o histórico. Respostas saem antes das perguntas, no mesmo
   * batch atômico. Uma rodada custa 3 consultas.
   */
  private async purgeContexts(
    kind: 'challenge' | 'match',
    cutoff: string,
    rounds: number,
  ): Promise<number> {
    const { answers, column, filter, parent, questions } = kind === 'match'
      ? {
        answers: 'match_answers', column: 'match_id', parent: 'matches',
        filter: `p.status IN ${TERMINAL_MATCH_STATUSES} AND p.created_at < ?1`, questions: 'match_questions',
      }
      : {
        answers: 'challenge_answers', column: 'challenge_id', parent: 'challenges',
        filter: `p.status IN ${TERMINAL_CHALLENGE_STATUSES} AND p.updated_at < ?1`, questions: 'challenge_questions',
      };
    let total = 0;
    let full = false;
    for (let round = 0; round < rounds && this.spend(3); round += 1) {
      const rows = await this.coreDb.prepare(
        `SELECT q.${column} AS id FROM ${questions} q
           JOIN ${parent} p ON p.id = q.${column}
          WHERE q.round_number = 1 AND ${filter}
          LIMIT ${CONTEXT_CHUNK}`,
      ).bind(cutoff).all<{ id: string }>();
      const ids = rows.results.map((row) => row.id);
      full = ids.length >= CONTEXT_CHUNK;
      if (ids.length === 0) break;
      const list = placeholders(ids.length);
      await this.coreDb.batch([
        this.coreDb.prepare(`DELETE FROM ${answers} WHERE ${column} IN (${list})`).bind(...ids),
        this.coreDb.prepare(`DELETE FROM ${questions} WHERE ${column} IN (${list})`).bind(...ids),
      ]);
      total += ids.length;
      if (!full) break;
    }
    if (full) this.backlog = true;
    return total;
  }
}
