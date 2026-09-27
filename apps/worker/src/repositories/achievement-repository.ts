import {
  ACHIEVEMENT_FRAMES,
  DAILY_MISSION_DEFINITIONS,
  isKnownAchievement,
  streakAchievements,
  type MatchMode,
} from '@quiz-gomes/domain';

export interface AchievementRecord {
  achievementId: string;
  frameId: string | null;
  seen: boolean;
  themeName: string | null;
  unlockedAt: string;
  value: number;
}

export interface FrameRecord {
  equipped: boolean;
  id: string;
  name: string;
}

export interface AchievementGrant {
  achievementId: string;
  themeId?: string | null;
  value?: number;
}

/**
 * Conquistas e molduras. Toda concessão é `INSERT OR IGNORE`: repetir o
 * mesmo evento (retry, dois avisos do mesmo marco) nunca duplica nada, e a
 * moldura vem no mesmo batch da conquista.
 */
export class AchievementRepository {
  constructor(private readonly db: D1Database) {}

  /** Concede e devolve só as conquistas que eram novas. */
  async grant(userId: string, grants: readonly AchievementGrant[]): Promise<string[]> {
    const valid = grants.filter((grant) => isKnownAchievement(grant.achievementId));
    if (valid.length === 0) return [];
    const statements: D1PreparedStatement[] = [];
    for (const grant of valid) {
      statements.push(this.db.prepare(
        `INSERT OR IGNORE INTO user_achievements (user_id, achievement_id, theme_id, value)
         VALUES (?1, ?2, ?3, ?4)`,
      ).bind(userId, grant.achievementId, grant.themeId ?? null, grant.value ?? 0));
    }
    for (const grant of valid) {
      const frameId = ACHIEVEMENT_FRAMES[grant.achievementId];
      if (frameId === undefined) continue;
      statements.push(this.db.prepare(
        `INSERT OR IGNORE INTO cosmetic_inventory (user_id, cosmetic_id, source)
         SELECT ?1, id, ?3 FROM cosmetics WHERE id = ?2 AND status = 'AVAILABLE'`,
      ).bind(userId, frameId, grant.achievementId));
    }
    const results = await this.db.batch(statements);
    return valid
      .filter((_, index) => (results[index]?.meta.changes ?? 0) > 0)
      .map((grant) => grant.achievementId);
  }

  /**
   * Depois de uma partida ou metade de desafio concluída: ofensiva do tema e
   * missões do dia. Leitura de 2 linhas pequenas, gravação só se houver algo.
   */
  async evaluateProgress(userId: string, themeId: string, dayKey: string): Promise<string[]> {
    const [streak, missions] = await this.db.batch([
      this.db.prepare(
        'SELECT current_streak FROM user_theme_streaks WHERE user_id = ?1 AND theme_id = ?2',
      ).bind(userId, themeId),
      this.db.prepare(
        `SELECT COUNT(*) AS completed FROM user_daily_missions
          WHERE user_id = ?1 AND day_key = ?2 AND completed_at IS NOT NULL`,
      ).bind(userId, dayKey),
    ]);
    const currentStreak = (streak?.results[0] as { current_streak?: number } | undefined)?.current_streak ?? 0;
    const completed = (missions?.results[0] as { completed?: number } | undefined)?.completed ?? 0;
    const grants: AchievementGrant[] = streakAchievements(currentStreak)
      .map((achievementId) => ({ achievementId, themeId, value: currentStreak }));
    if (completed >= DAILY_MISSION_DEFINITIONS.length) grants.push({ achievementId: 'MISSIONS_DAY' });
    if (grants.length === 0) return [];
    // Só grava o que ainda falta: quem já tem tudo não paga escrita nenhuma.
    const owned = await this.ownedIds(userId, grants.map((grant) => grant.achievementId));
    return this.grant(userId, grants.filter((grant) => !owned.has(grant.achievementId)));
  }

  /**
   * "Recordista": bateu o próprio recorde num tema e modo em que já tinha
   * jogado antes (o primeiro recorde de um tema novo não conta).
   */
  async evaluatePersonalRecord(userId: string, themeId: string, mode: MatchMode): Promise<string[]> {
    const owned = await this.ownedIds(userId, ['PERSONAL_RECORD']);
    if (owned.has('PERSONAL_RECORD')) return [];
    const played = await this.db.prepare(
      `SELECT COUNT(*) AS total FROM (
         SELECT 1 FROM match_players mp JOIN matches m ON m.id = mp.match_id
          WHERE mp.user_id = ?1 AND mp.completed_at IS NOT NULL
            AND m.theme_id = ?2 AND m.mode = ?3 AND m.status = 'FINISHED'
          LIMIT 2)`,
    ).bind(userId, themeId, mode).first<{ total: number }>();
    if ((played?.total ?? 0) < 2) return [];
    return this.grant(userId, [{ achievementId: 'PERSONAL_RECORD', themeId }]);
  }

  private async ownedIds(userId: string, ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const placeholders = ids.map((_, index) => `?${index + 2}`).join(',');
    const rows = await this.db.prepare(
      `SELECT achievement_id FROM user_achievements WHERE user_id = ?1 AND achievement_id IN (${placeholders})`,
    ).bind(userId, ...ids).all<{ achievement_id: string }>();
    return new Set(rows.results.map((row) => row.achievement_id));
  }

  async list(userId: string): Promise<AchievementRecord[]> {
    const rows = await this.db.prepare(
      `SELECT a.achievement_id, a.value, a.unlocked_at, a.seen_at, t.name AS theme_name
         FROM user_achievements a
         LEFT JOIN themes t ON t.id = a.theme_id
        WHERE a.user_id = ?1
        ORDER BY a.unlocked_at DESC, a.achievement_id
        LIMIT 100`,
    ).bind(userId).all<{ achievement_id: string; seen_at: string | null; theme_name: string | null; unlocked_at: string; value: number }>();
    return rows.results.map((row) => ({
      achievementId: row.achievement_id,
      frameId: ACHIEVEMENT_FRAMES[row.achievement_id] ?? null,
      seen: row.seen_at !== null,
      themeName: row.theme_name,
      unlockedAt: row.unlocked_at,
      value: row.value,
    }));
  }

  /** Cartões de parabéns ainda não mostrados (no máximo alguns por vez). */
  async unseen(userId: string): Promise<AchievementRecord[]> {
    const rows = await this.db.prepare(
      `SELECT a.achievement_id, a.value, a.unlocked_at, t.name AS theme_name
         FROM user_achievements a
         LEFT JOIN themes t ON t.id = a.theme_id
        WHERE a.user_id = ?1 AND a.seen_at IS NULL
        ORDER BY a.unlocked_at, a.achievement_id
        LIMIT 5`,
    ).bind(userId).all<{ achievement_id: string; theme_name: string | null; unlocked_at: string; value: number }>();
    return rows.results.map((row) => ({
      achievementId: row.achievement_id,
      frameId: ACHIEVEMENT_FRAMES[row.achievement_id] ?? null,
      seen: false,
      themeName: row.theme_name,
      unlockedAt: row.unlocked_at,
      value: row.value,
    }));
  }

  async markSeen(userId: string, achievementIds: readonly string[]): Promise<void> {
    const ids = [...new Set(achievementIds)].slice(0, 20);
    if (ids.length === 0) return;
    const placeholders = ids.map((_, index) => `?${index + 2}`).join(',');
    await this.db.prepare(
      `UPDATE user_achievements SET seen_at = CURRENT_TIMESTAMP
        WHERE user_id = ?1 AND seen_at IS NULL AND achievement_id IN (${placeholders})`,
    ).bind(userId, ...ids).run();
  }

  async frames(userId: string, equippedFrameId: string | null): Promise<FrameRecord[]> {
    const rows = await this.db.prepare(
      `SELECT c.id, c.name FROM cosmetic_inventory i
         JOIN cosmetics c ON c.id = i.cosmetic_id
        WHERE i.user_id = ?1 AND c.kind = 'FRAME' AND c.status = 'AVAILABLE'
        ORDER BY i.unlocked_at, c.id`,
    ).bind(userId).all<{ id: string; name: string }>();
    return rows.results.map((row) => ({ equipped: row.id === equippedFrameId, id: row.id, name: row.name }));
  }

  /** Equipa uma moldura que a pessoa possui (ou tira, com null). */
  async equipFrame(userId: string, frameId: string | null): Promise<boolean> {
    const result = frameId === null
      ? await this.db.prepare(
        'UPDATE user_profiles SET equipped_frame_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?1',
      ).bind(userId).run()
      : await this.db.prepare(
        `UPDATE user_profiles SET equipped_frame_id = ?2, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ?1 AND EXISTS (
            SELECT 1 FROM cosmetic_inventory i JOIN cosmetics c ON c.id = i.cosmetic_id
             WHERE i.user_id = ?1 AND i.cosmetic_id = ?2 AND c.kind = 'FRAME' AND c.status = 'AVAILABLE'
          )`,
      ).bind(userId, frameId).run();
    return (result.meta.changes ?? 0) === 1;
  }
}
