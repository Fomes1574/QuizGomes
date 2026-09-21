import {
  advanceMissionProgress,
  DAILY_MISSION_DEFINITIONS,
  type MissionProgressEvent,
  type MissionState,
  type MissionType,
} from '@quiz-gomes/domain';

interface MissionRow {
  completed_at: string | null;
  mission_type: MissionType;
  progress: number;
  target: number;
}

function toState(row: MissionRow): MissionState {
  return { completedAt: row.completed_at, progress: row.progress, target: row.target, type: row.mission_type };
}

/**
 * Missões pessoais diárias.
 *
 * As três missões do dia nascem sob demanda, uma vez por usuário/dia
 * (`INSERT OR IGNORE` pela chave primária), nunca por um job periódico.
 * Progresso só avança por evento autoritativo já persistido pelo chamador
 * (partida válida concluída, resposta registrada, acerto registrado); uma
 * partida VOID/cancelada nunca chega a produzir esse evento.
 */
export class MissionRepository {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async ensureToday(userId: string, dayKey: string): Promise<void> {
    await this.db.batch(DAILY_MISSION_DEFINITIONS.map((definition) => this.db.prepare(
      `INSERT OR IGNORE INTO user_daily_missions (user_id, day_key, mission_type, target)
       VALUES (?1, ?2, ?3, ?4)`,
    ).bind(userId, dayKey, definition.type, definition.target)));
  }

  async listForDay(userId: string, dayKey: string): Promise<MissionState[]> {
    await this.ensureToday(userId, dayKey);
    const result = await this.db.prepare(
      `SELECT mission_type, target, progress, completed_at
         FROM user_daily_missions WHERE user_id = ?1 AND day_key = ?2`,
    ).bind(userId, dayKey).all<MissionRow>();
    return result.results.map(toState);
  }

  /** Aplica o mesmo evento às três missões do dia; cada uma decide se o incrementa. */
  async advance(userId: string, dayKey: string, event: MissionProgressEvent): Promise<void> {
    await this.ensureToday(userId, dayKey);
    const current = await this.db.prepare(
      `SELECT mission_type, target, progress, completed_at
         FROM user_daily_missions WHERE user_id = ?1 AND day_key = ?2`,
    ).bind(userId, dayKey).all<MissionRow>();
    const nowIso = this.now().toISOString();
    const statements: D1PreparedStatement[] = [];
    for (const row of current.results) {
      const next = advanceMissionProgress(toState(row), event, nowIso);
      if (next.progress === row.progress && next.completedAt === row.completed_at) continue;
      statements.push(this.db.prepare(
        `UPDATE user_daily_missions SET progress = ?1, completed_at = ?2
          WHERE user_id = ?3 AND day_key = ?4 AND mission_type = ?5 AND progress = ?6`,
      ).bind(next.progress, next.completedAt, userId, dayKey, row.mission_type, row.progress));
    }
    if (statements.length > 0) await this.db.batch(statements);
  }
}
