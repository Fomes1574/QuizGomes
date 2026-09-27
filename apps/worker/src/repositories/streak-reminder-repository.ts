import { previousDayKey } from '@quiz-gomes/domain';

export interface StreakReminderCandidate {
  streak: number;
  themeName: string;
  themeSlug: string;
  userId: string;
}

/** Ofensiva mínima para valer um aviso: com 1 dia ainda não há o que perder. */
export const STREAK_REMINDER_MIN_DAYS = 2;

/**
 * Aviso opcional "sua ofensiva acaba hoje". Desligado por padrão; um por
 * dia no máximo, marcado antes do envio (nunca repete em retry do Cron).
 */
export class StreakReminderRepository {
  constructor(private readonly db: D1Database) {}

  async enabled(userId: string): Promise<boolean> {
    const row = await this.db.prepare('SELECT enabled FROM streak_reminder_preferences WHERE user_id = ?1')
      .bind(userId).first<{ enabled: number }>();
    return row?.enabled === 1;
  }

  async setEnabled(userId: string, enabled: boolean): Promise<void> {
    await this.db.prepare(
      `INSERT INTO streak_reminder_preferences (user_id, enabled) VALUES (?1, ?2)
       ON CONFLICT (user_id) DO UPDATE SET enabled = excluded.enabled, updated_at = CURRENT_TIMESTAMP`,
    ).bind(userId, enabled ? 1 : 0).run();
  }

  /**
   * Quem ligou o aviso, ainda não recebeu hoje e tem uma ofensiva que só
   * continua se jogar hoje (jogou ontem naquele tema). Pega a maior delas.
   */
  async candidates(todayKey: string, limit: number): Promise<StreakReminderCandidate[]> {
    const rows = await this.db.prepare(
      `SELECT p.user_id, MAX(s.current_streak) AS streak, t.name AS theme_name, t.slug AS theme_slug
         FROM streak_reminder_preferences p
         JOIN user_theme_streaks s ON s.user_id = p.user_id
         JOIN themes t ON t.id = s.theme_id
        WHERE p.enabled = 1
          AND (p.last_sent_day IS NULL OR p.last_sent_day <> ?1)
          AND s.last_active_day = ?2
          AND s.current_streak >= ?3
        GROUP BY p.user_id
        LIMIT ?4`,
    ).bind(todayKey, previousDayKey(todayKey), STREAK_REMINDER_MIN_DAYS, limit).all<{
      streak: number;
      theme_name: string;
      theme_slug: string;
      user_id: string;
    }>();
    return rows.results.map((row) => ({
      streak: row.streak, themeName: row.theme_name, themeSlug: row.theme_slug, userId: row.user_id,
    }));
  }

  async markSent(userIds: readonly string[], todayKey: string): Promise<void> {
    if (userIds.length === 0) return;
    const placeholders = userIds.map((_, index) => `?${index + 2}`).join(',');
    await this.db.prepare(
      `UPDATE streak_reminder_preferences SET last_sent_day = ?1 WHERE user_id IN (${placeholders})`,
    ).bind(todayKey, ...userIds).run();
  }
}
