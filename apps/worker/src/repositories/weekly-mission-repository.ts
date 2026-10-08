import {
  WEEKLY_MISSION_DEFINITIONS,
  advanceWeeklyMission,
  type WeeklyMissionState,
  type WeeklyMissionType,
  type WeeklyRankedEvent,
} from '@quiz-gomes/domain';

interface WeeklyRow {
  completed_at: string | null;
  mission_type: WeeklyMissionType;
  progress: number;
  target: number;
}

function toState(row: WeeklyRow): WeeklyMissionState {
  return { completedAt: row.completed_at, progress: row.progress, target: row.target, type: row.mission_type };
}

/**
 * Missões semanais da Rankeada. Como as diárias, nascem sob demanda (uma vez
 * por pessoa e semana) e só avançam por evento que o servidor já confirmou.
 * Quem chama garante que a mesma partida não chega aqui duas vezes.
 */
export class WeeklyMissionRepository {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async ensureWeek(userId: string, weekKey: string): Promise<void> {
    await this.db.batch(WEEKLY_MISSION_DEFINITIONS.map((definition) => this.db.prepare(
      `INSERT OR IGNORE INTO user_weekly_missions (user_id, week_key, mission_type, target)
       VALUES (?1, ?2, ?3, ?4)`,
    ).bind(userId, weekKey, definition.type, definition.target)));
  }

  async list(userId: string, weekKey: string): Promise<WeeklyMissionState[]> {
    await this.ensureWeek(userId, weekKey);
    const rows = await this.db.prepare(
      `SELECT mission_type, target, progress, completed_at
         FROM user_weekly_missions WHERE user_id = ?1 AND week_key = ?2`,
    ).bind(userId, weekKey).all<WeeklyRow>();
    const order = WEEKLY_MISSION_DEFINITIONS.map((definition) => definition.type);
    return rows.results.map(toState).sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  }

  async advance(userId: string, weekKey: string, event: WeeklyRankedEvent): Promise<void> {
    const current = await this.list(userId, weekKey);
    const nowIso = this.now().toISOString();
    const statements: D1PreparedStatement[] = [];
    for (const mission of current) {
      const next = advanceWeeklyMission(mission, event, nowIso);
      if (next.progress === mission.progress && next.completedAt === mission.completedAt) continue;
      statements.push(this.db.prepare(
        `UPDATE user_weekly_missions SET progress = ?1, completed_at = ?2
          WHERE user_id = ?3 AND week_key = ?4 AND mission_type = ?5 AND progress = ?6`,
      ).bind(next.progress, next.completedAt, userId, weekKey, mission.type, mission.progress));
    }
    if (statements.length > 0) await this.db.batch(statements);
  }
}
