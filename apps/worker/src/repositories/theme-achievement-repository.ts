import {
  DIVISION_THRESHOLDS,
  EMPTY_THEME_PROGRESS,
  TOP_TITLE_MAX_POSITION,
  achievementsFor,
  applyRankedOutcome,
  isThemeAchievementId,
  type RankedOutcome,
  type ThemeAchievementId,
  type ThemeProgress,
} from '@quiz-gomes/domain';
import { PLAYABLE_THEME_SQL } from './theme-repository.js';

/**
 * Quem pode exibir um Top: pelo menos estas Rankeadas concluídas no tema e
 * Conhecimento acima de zero. O tema também precisa de gente suficiente
 * (`TOP_TITLE_MIN_PLAYERS`), senão "Top 1" sairia de graça.
 */
export const TOP_TITLE_MIN_COMPLETED = 5;
export const TOP_TITLE_DEFAULT_MIN_PLAYERS = 30;

interface ProgressRow {
  best_division: number;
  completed_ranked: number;
  unbeaten_matches: number;
  unbeaten_wins: number;
  win_streak: number;
}

function toProgress(row: ProgressRow | null): ThemeProgress {
  return row === null ? { ...EMPTY_THEME_PROGRESS } : {
    bestDivision: row.best_division,
    completedRanked: row.completed_ranked,
    unbeatenMatches: row.unbeaten_matches,
    unbeatenWins: row.unbeaten_wins,
    winStreak: row.win_streak,
  };
}

function divisionIndexOf(knowledge: number): number {
  let index = 0;
  DIVISION_THRESHOLDS.forEach((threshold, position) => { if (threshold <= knowledge) index = position; });
  return index;
}

export interface ThemeAchievementRecord {
  achievementId: ThemeAchievementId;
  themeId: string;
  themeName: string;
  unlockedAt: string;
}

export interface PlayedThemeProgress {
  knowledge: number;
  progress: ThemeProgress;
  themeId: string;
  themeName: string;
  wins: number;
}

export class ThemeAchievementRepository {
  constructor(
    private readonly db: D1Database,
    private readonly minPlayers = TOP_TITLE_DEFAULT_MIN_PLAYERS,
  ) {}

  /**
   * Depois de uma Rankeada: atualiza os contadores do tema e grava as
   * conquistas a que a pessoa tem direito. Devolve só as que eram novas, ou
   * `null` se esta partida já tinha sido contada (finalização repetida).
   */
  async recordRanked(
    userId: string,
    themeId: string,
    matchId: string,
    outcome: RankedOutcome,
  ): Promise<ThemeAchievementId[] | null> {
    const current = await this.db.prepare(
      `SELECT best_division, completed_ranked, unbeaten_matches, unbeaten_wins, win_streak, last_match_id
         FROM user_theme_progress WHERE user_id = ?1 AND theme_id = ?2`,
    ).bind(userId, themeId).first<ProgressRow & { last_match_id: string | null }>();
    if (current?.last_match_id === matchId) return null;
    const { earned, progress } = applyRankedOutcome(toProgress(current), outcome);
    const statements = [
      this.db.prepare(
        `INSERT INTO user_theme_progress
           (user_id, theme_id, completed_ranked, win_streak, unbeaten_matches, unbeaten_wins, best_division, last_match_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT (user_id, theme_id) DO UPDATE SET
           completed_ranked = excluded.completed_ranked, win_streak = excluded.win_streak,
           unbeaten_matches = excluded.unbeaten_matches, unbeaten_wins = excluded.unbeaten_wins,
           best_division = excluded.best_division, last_match_id = excluded.last_match_id,
           updated_at = CURRENT_TIMESTAMP
         WHERE user_theme_progress.last_match_id IS NOT excluded.last_match_id`,
      ).bind(
        userId, themeId, progress.completedRanked, progress.winStreak,
        progress.unbeatenMatches, progress.unbeatenWins, progress.bestDivision, matchId,
      ),
      ...earned.map((achievementId) => this.db.prepare(
        'INSERT OR IGNORE INTO user_theme_achievements (user_id, theme_id, achievement_id) VALUES (?1, ?2, ?3)',
      ).bind(userId, themeId, achievementId)),
    ];
    const results = await this.db.batch(statements);
    if ((results[0]?.meta.changes ?? 0) === 0) return null;
    return earned.filter((_, index) => (results[index + 1]?.meta.changes ?? 0) > 0);
  }

  /**
   * Garante as conquistas que o histórico já prova (contadores preenchidos na
   * migration, vitória Rankeada registrada no ranking). Idempotente e barato:
   * só grava o que falta.
   */
  async syncFromHistory(userId: string): Promise<void> {
    const played = await this.playedThemes(userId);
    const owned = await this.ownedSet(userId);
    const missing: Array<{ achievementId: ThemeAchievementId; themeId: string }> = [];
    for (const theme of played) {
      const progress = {
        ...theme.progress,
        bestDivision: Math.max(theme.progress.bestDivision, divisionIndexOf(theme.knowledge)),
      };
      const earned = achievementsFor(progress);
      if (theme.wins > 0) earned.push('FIRST_WIN');
      for (const achievementId of earned) {
        if (!owned.has(`${theme.themeId}:${achievementId}`)) missing.push({ achievementId, themeId: theme.themeId });
      }
    }
    if (missing.length === 0) return;
    await this.db.batch(missing.map(({ achievementId, themeId }) => this.db.prepare(
      'INSERT OR IGNORE INTO user_theme_achievements (user_id, theme_id, achievement_id) VALUES (?1, ?2, ?3)',
    ).bind(userId, themeId, achievementId)));
  }

  /** Temas jogáveis em que a pessoa tem ranking, com contadores e vitórias. */
  async playedThemes(userId: string): Promise<PlayedThemeProgress[]> {
    const rows = await this.db.prepare(
      `SELECT r.theme_id, t.name AS theme_name, r.knowledge, r.wins,
              p.best_division, p.completed_ranked, p.unbeaten_matches, p.unbeaten_wins, p.win_streak
         FROM theme_rankings r
         JOIN themes t ON t.id = r.theme_id
         JOIN categories c ON c.id = t.category_id AND ${PLAYABLE_THEME_SQL}
         LEFT JOIN user_theme_progress p ON p.user_id = r.user_id AND p.theme_id = r.theme_id
        WHERE r.user_id = ?1
        ORDER BY r.knowledge DESC
        LIMIT 200`,
    ).bind(userId).all<ProgressRow & { knowledge: number; theme_id: string; theme_name: string; wins: number }>();
    return rows.results.map((row) => ({
      knowledge: row.knowledge,
      progress: toProgress(row.completed_ranked === null ? null : row),
      themeId: row.theme_id,
      themeName: row.theme_name,
      wins: row.wins,
    }));
  }

  async list(userId: string): Promise<ThemeAchievementRecord[]> {
    const rows = await this.db.prepare(
      `SELECT a.achievement_id, a.theme_id, a.unlocked_at, t.name AS theme_name
         FROM user_theme_achievements a
         JOIN themes t ON t.id = a.theme_id
         JOIN categories c ON c.id = t.category_id AND ${PLAYABLE_THEME_SQL}
        WHERE a.user_id = ?1
        ORDER BY a.unlocked_at DESC
        LIMIT 500`,
    ).bind(userId).all<{ achievement_id: string; theme_id: string; theme_name: string; unlocked_at: string }>();
    return rows.results
      .filter((row) => isThemeAchievementId(row.achievement_id))
      .map((row) => ({
        achievementId: row.achievement_id as ThemeAchievementId,
        themeId: row.theme_id,
        themeName: row.theme_name,
        unlockedAt: row.unlocked_at,
      }));
  }

  async owns(userId: string, themeId: string, achievementId: string): Promise<boolean> {
    if (!isThemeAchievementId(achievementId)) return false;
    return await this.db.prepare(
      `SELECT 1 FROM user_theme_achievements a
         JOIN themes t ON t.id = a.theme_id
         JOIN categories c ON c.id = t.category_id AND ${PLAYABLE_THEME_SQL}
        WHERE a.user_id = ?1 AND a.theme_id = ?2 AND a.achievement_id = ?3`,
    ).bind(userId, themeId, achievementId).first() !== null;
  }

  /**
   * Posição da pessoa no Top do tema, ou `null` se ela (ou o tema) não se
   * qualifica ou se está abaixo do 10º lugar. Empate divide a posição
   * (1, 1, 3), como no Top 5 do tema. Leituras limitadas: nunca varre o
   * ranking inteiro de um tema grande.
   */
  async topPosition(userId: string, themeId: string): Promise<number | null> {
    const me = await this.db.prepare(
      `SELECT r.knowledge, COALESCE(p.completed_ranked, 0) AS completed
         FROM theme_rankings r
         JOIN themes t ON t.id = r.theme_id
         JOIN categories c ON c.id = t.category_id AND ${PLAYABLE_THEME_SQL}
         LEFT JOIN user_theme_progress p ON p.user_id = r.user_id AND p.theme_id = r.theme_id
        WHERE r.user_id = ?1 AND r.theme_id = ?2`,
    ).bind(userId, themeId).first<{ completed: number; knowledge: number }>();
    if (me === null) return null;
    return this.positionFor(themeId, me.knowledge, me.completed);
  }

  /**
   * Tops atuais a partir dos temas já lidos (sem reler o próprio ranking).
   * Só olha onde a pessoa se qualifica, até 20 temas.
   */
  async topPositions(played: readonly PlayedThemeProgress[]): Promise<Map<string, number>> {
    const positions = new Map<string, number>();
    const candidates = played
      .filter((theme) => theme.knowledge > 0 && theme.progress.completedRanked >= TOP_TITLE_MIN_COMPLETED)
      .slice(0, 20);
    for (const theme of candidates) {
      const position = await this.positionFor(theme.themeId, theme.knowledge, theme.progress.completedRanked);
      if (position !== null) positions.set(theme.themeId, position);
    }
    return positions;
  }

  private async positionFor(themeId: string, knowledge: number, completed: number): Promise<number | null> {
    if (knowledge <= 0 || completed < TOP_TITLE_MIN_COMPLETED) return null;
    const [above, population] = await this.db.batch<{ total: number }>([
      this.db.prepare(
        `SELECT COUNT(*) AS total FROM (
           SELECT 1 FROM theme_rankings r
             JOIN user_theme_progress p ON p.user_id = r.user_id AND p.theme_id = r.theme_id
             JOIN users u ON u.id = r.user_id AND u.disabled_at IS NULL
            WHERE r.theme_id = ?1 AND r.knowledge > ?2 AND p.completed_ranked >= ?3
            LIMIT ?4)`,
      ).bind(themeId, knowledge, TOP_TITLE_MIN_COMPLETED, TOP_TITLE_MAX_POSITION),
      this.db.prepare(
        `SELECT COUNT(*) AS total FROM (
           SELECT 1 FROM theme_rankings r
             JOIN user_theme_progress p ON p.user_id = r.user_id AND p.theme_id = r.theme_id
             JOIN users u ON u.id = r.user_id AND u.disabled_at IS NULL
            WHERE r.theme_id = ?1 AND r.knowledge > 0 AND p.completed_ranked >= ?2
            LIMIT ?3)`,
      ).bind(themeId, TOP_TITLE_MIN_COMPLETED, this.minPlayers),
    ]);
    const position = 1 + (above?.results[0]?.total ?? TOP_TITLE_MAX_POSITION);
    if ((population?.results[0]?.total ?? 0) < this.minPlayers) return null;
    return position <= TOP_TITLE_MAX_POSITION ? position : null;
  }

  private async ownedSet(userId: string): Promise<Set<string>> {
    const rows = await this.db.prepare(
      'SELECT theme_id, achievement_id FROM user_theme_achievements WHERE user_id = ?1 LIMIT 5000',
    ).bind(userId).all<{ achievement_id: string; theme_id: string }>();
    return new Set(rows.results.map((row) => `${row.theme_id}:${row.achievement_id}`));
  }
}
