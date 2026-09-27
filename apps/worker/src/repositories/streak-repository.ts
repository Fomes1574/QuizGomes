import { advanceThemeStreak, previousDayKey, type ThemeStreakState } from '@quiz-gomes/domain';

export interface ThemeStreakRecord extends ThemeStreakState {
  themeId: string;
}

interface StreakRow {
  best_streak: number;
  current_streak: number;
  last_active_day: string;
  theme_id: string;
}

function toRecord(row: StreakRow): ThemeStreakRecord {
  return {
    bestStreak: row.best_streak, currentStreak: row.current_streak,
    lastActiveDay: row.last_active_day, themeId: row.theme_id,
  };
}

/**
 * Streak por usuário+tema.
 *
 * `advance` é idempotente pelo mesmo dia: chamar de novo no mesmo `dayKey`
 * não altera nada. O UPSERT usa o `last_active_day` lido como guarda de CAS
 * no `DO UPDATE ... WHERE`, então duas chamadas concorrentes para o mesmo
 * usuário+tema nunca contam o mesmo dia duas vezes.
 */
export class StreakRepository {
  constructor(private readonly db: D1Database) {}

  async advance(userId: string, themeId: string, dayKey: string): Promise<void> {
    const current = await this.db.prepare(
      'SELECT current_streak, best_streak, last_active_day FROM user_theme_streaks WHERE user_id = ?1 AND theme_id = ?2',
    ).bind(userId, themeId).first<{ best_streak: number; current_streak: number; last_active_day: string }>();
    const state: ThemeStreakState | null = current === null ? null : {
      bestStreak: current.best_streak, currentStreak: current.current_streak, lastActiveDay: current.last_active_day,
    };
    const next = advanceThemeStreak(state, dayKey);
    if (state !== null && next.lastActiveDay === state.lastActiveDay) return;
    await this.db.prepare(
      `INSERT INTO user_theme_streaks (user_id, theme_id, current_streak, best_streak, last_active_day)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (user_id, theme_id) DO UPDATE SET
         current_streak = excluded.current_streak,
         best_streak = excluded.best_streak,
         last_active_day = excluded.last_active_day,
         updated_at = CURRENT_TIMESTAMP
       WHERE user_theme_streaks.last_active_day = ?6`,
    ).bind(userId, themeId, next.currentStreak, next.bestStreak, next.lastActiveDay, state?.lastActiveDay ?? '').run();
  }

  /** Fallback determinístico do "tema ativo": maior streak atual, desempate por theme_id — leitura indexada. */
  async activeStreak(userId: string): Promise<ThemeStreakRecord | null> {
    const row = await this.db.prepare(
      `SELECT theme_id, current_streak, best_streak, last_active_day
         FROM user_theme_streaks
        WHERE user_id = ?1
        ORDER BY current_streak DESC, theme_id
        LIMIT 1`,
    ).bind(userId).first<StreakRow>();
    return row === null ? null : toRecord(row);
  }

  async forTheme(userId: string, themeId: string): Promise<ThemeStreakRecord | null> {
    const row = await this.db.prepare(
      'SELECT theme_id, current_streak, best_streak, last_active_day FROM user_theme_streaks WHERE user_id = ?1 AND theme_id = ?2',
    ).bind(userId, themeId).first<StreakRow>();
    return row === null ? null : toRecord(row);
  }

  /**
   * Ofensiva exibida no perfil, com nome/slug do tema. Quem não joga desde
   * anteontem já perdeu a sequência, mesmo que a linha ainda guarde o número
   * antigo; por isso o ranking usa a ofensiva viva, não `current_streak` cru.
   */
  async activeStreakWithTheme(
    userId: string,
    todayKey: string,
  ): Promise<(ThemeStreakRecord & { atRisk: boolean; themeName: string; themeSlug: string }) | null> {
    const yesterday = previousDayKey(todayKey);
    const row = await this.db.prepare(
      `SELECT s.theme_id, s.best_streak, s.last_active_day, t.name AS theme_name, t.slug AS theme_slug,
              CASE WHEN s.last_active_day >= ?2 THEN s.current_streak ELSE 0 END AS current_streak
         FROM user_theme_streaks s
         JOIN themes t ON t.id = s.theme_id
        WHERE s.user_id = ?1
        ORDER BY current_streak DESC, s.best_streak DESC, s.theme_id
        LIMIT 1`,
    ).bind(userId, yesterday).first<StreakRow & { theme_name: string; theme_slug: string }>();
    if (row === null) return null;
    return {
      ...toRecord(row),
      atRisk: row.current_streak > 0 && row.last_active_day === yesterday,
      themeName: row.theme_name,
      themeSlug: row.theme_slug,
    };
  }
}
