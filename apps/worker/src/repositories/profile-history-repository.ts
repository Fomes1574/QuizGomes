import { PLAYABLE_THEME_SQL } from './theme-repository.js';
import type { MatchMode } from '@quiz-gomes/domain';
import type { MatchSummaryRecord } from './user-repository.js';

export interface RecentMatchRecord {
  finishedAt: string;
  matchId: string;
  mode: MatchMode;
  myScore: number;
  opponent: { displayName: string; publicId: string } | null;
  opponentScore: number;
  result: 'DRAW' | 'LOSS' | 'WIN';
  themeName: string;
  themeSlug: string;
  xpDelta: number;
}

export interface ThemeRecordEntry {
  bestScore: number;
  mode: MatchMode;
  themeName: string;
  themeSlug: string;
}

/**
 * Leituras do "cartão de jogador" no Perfil. Tudo parte de índices por
 * pessoa e tem limite fixo: nenhum perfil varre o histórico inteiro.
 */
export class ProfileHistoryRepository {
  constructor(private readonly db: D1Database) {}

  /** Totais da Partida normal (a Rankeada vem de theme_rankings). */
  async casualSummary(userId: string): Promise<MatchSummaryRecord> {
    const row = await this.db.prepare(
      'SELECT matches, wins, losses, draws FROM user_casual_stats WHERE user_id = ?1',
    ).bind(userId).first<MatchSummaryRecord>();
    return row ?? { draws: 0, losses: 0, matches: 0, wins: 0 };
  }

  /** Últimas partidas concluídas (mais recentes primeiro), com o adversário público. */
  async recentMatches(userId: string, limit = 10): Promise<RecentMatchRecord[]> {
    const result = await this.db.prepare(
      `SELECT mp.match_id, mp.score AS my_score, mp.xp_delta, mp.completed_at,
              m.mode, m.winner_user_id, t.name AS theme_name, t.slug AS theme_slug,
              opp.score AS opponent_score, op.display_name AS opponent_name, op.public_id AS opponent_public_id
         FROM match_players mp
         JOIN matches m ON m.id = mp.match_id
         JOIN themes t ON t.id = m.theme_id
         LEFT JOIN match_players opp ON opp.match_id = mp.match_id AND opp.user_id <> mp.user_id
         LEFT JOIN user_profiles op ON op.user_id = opp.user_id
        WHERE mp.user_id = ?1 AND mp.completed_at IS NOT NULL AND m.status = 'FINISHED'
        ORDER BY mp.completed_at DESC
        LIMIT ?2`,
    ).bind(userId, Math.min(20, Math.max(1, limit))).all<{
      completed_at: string;
      match_id: string;
      mode: MatchMode;
      my_score: number;
      opponent_name: string | null;
      opponent_public_id: string | null;
      opponent_score: number | null;
      theme_name: string;
      theme_slug: string;
      winner_user_id: string | null;
      xp_delta: number;
    }>();
    return result.results.map((row) => ({
      finishedAt: row.completed_at,
      matchId: row.match_id,
      mode: row.mode,
      myScore: row.my_score,
      opponent: row.opponent_name === null || row.opponent_public_id === null
        ? null
        : { displayName: row.opponent_name, publicId: row.opponent_public_id },
      opponentScore: row.opponent_score ?? 0,
      result: row.winner_user_id === null ? 'DRAW' : row.winner_user_id === userId ? 'WIN' : 'LOSS',
      themeName: row.theme_name,
      themeSlug: row.theme_slug,
      xpDelta: row.xp_delta,
    }));
  }

  /** Melhores recordes da pessoa, um por tema e modo, do maior para o menor. */
  async themeRecords(userId: string, limit = 12): Promise<ThemeRecordEntry[]> {
    const result = await this.db.prepare(
      `SELECT r.mode, r.best_score, t.name AS theme_name, t.slug AS theme_slug
         FROM theme_personal_records r
         JOIN themes t ON t.id = r.theme_id
         JOIN categories c ON c.id = t.category_id
        WHERE r.user_id = ?1 AND ${PLAYABLE_THEME_SQL}
        ORDER BY r.best_score DESC, t.name COLLATE NOCASE
        LIMIT ?2`,
    ).bind(userId, Math.min(40, Math.max(1, limit))).all<{
      best_score: number;
      mode: MatchMode;
      theme_name: string;
      theme_slug: string;
    }>();
    return result.results.map((row) => ({
      bestScore: row.best_score, mode: row.mode, themeName: row.theme_name, themeSlug: row.theme_slug,
    }));
  }
}
