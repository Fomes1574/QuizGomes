import {
  gameWeekKey,
  globalAchievementTitle,
  levelProgress,
  levelTitle,
  parseTitleId,
  themeAchievementTitle,
  themeAchievementTitleStyle,
  topTitleLabel,
  topTitleTier,
  type MatchThemeRewards,
  type PlayerTitle,
  type RankedOutcome,
} from '@quiz-gomes/domain';
import type { Env } from '../env.js';
import { TOP_TITLE_DEFAULT_MIN_PLAYERS, ThemeAchievementRepository } from '../repositories/theme-achievement-repository.js';
import { PLAYABLE_THEME_SQL } from '../repositories/theme-repository.js';
import { WeeklyMissionRepository } from '../repositories/weekly-mission-repository.js';

interface TitlePreferences {
  equipped_title_id: string | null;
  total_xp: number;
  equipped_top_theme_id: string | null;
  top_title_auto: number;
}

/** Mínimo de jogadores qualificados para um tema ter Top (configurável para testes). */
export function topTitleMinPlayers(env: Pick<Env, 'TOP_TITLE_MIN_PLAYERS'>): number {
  const value = Number(env.TOP_TITLE_MIN_PLAYERS ?? TOP_TITLE_DEFAULT_MIN_PLAYERS);
  return Number.isInteger(value) && value >= 1 && value <= 10_000 ? value : TOP_TITLE_DEFAULT_MIN_PLAYERS;
}

export function themeAchievements(env: Pick<Env, 'CORE_DB' | 'TOP_TITLE_MIN_PLAYERS'>): ThemeAchievementRepository {
  return new ThemeAchievementRepository(env.CORE_DB, topTitleMinPlayers(env));
}

export async function themeName(db: D1Database, themeId: string): Promise<string | null> {
  const row = await db.prepare(
    `SELECT t.name FROM themes t JOIN categories c ON c.id = t.category_id
      WHERE t.id = ?1 AND ${PLAYABLE_THEME_SQL}`,
  ).bind(themeId).first<{ name: string }>();
  return row?.name ?? null;
}

async function topTitle(db: D1Database, repository: ThemeAchievementRepository, userId: string, themeId: string): Promise<PlayerTitle | null> {
  const position = await repository.topPosition(userId, themeId);
  if (position === null) return null;
  const name = await themeName(db, themeId);
  return name === null ? null : { label: topTitleLabel(position, name), position, style: topTitleTier(position) };
}

/**
 * Qual título aparece sob o nome do jogador. Ordem:
 * 1. Top do tema da partida, se o Top automático estiver ligado;
 * 2. o Top fixado na vitrine, enquanto a pessoa estiver no Top 10 dele;
 * 3. o título permanente escolhido, se ainda for dela;
 * 4. nenhum.
 * Tudo vem do servidor: o cliente nunca diz qual é o próprio título.
 */
export async function resolvePlayerTitle(
  env: Pick<Env, 'CORE_DB' | 'TOP_TITLE_MIN_PLAYERS'>,
  userId: string,
  contextThemeId: string | null,
): Promise<PlayerTitle | null> {
  const db = env.CORE_DB;
  const preferences = await db.prepare(
    'SELECT equipped_title_id, equipped_top_theme_id, top_title_auto, total_xp FROM user_profiles WHERE user_id = ?1',
  ).bind(userId).first<TitlePreferences>();
  if (preferences === null) return null;
  const repository = themeAchievements(env);
  if (preferences.top_title_auto === 1 && contextThemeId !== null) {
    const contextual = await topTitle(db, repository, userId, contextThemeId);
    if (contextual !== null) return contextual;
  }
  if (preferences.equipped_top_theme_id !== null) {
    const pinned = await topTitle(db, repository, userId, preferences.equipped_top_theme_id);
    if (pinned !== null) return pinned;
  }
  if (preferences.equipped_title_id === null) return null;
  const parsed = parseTitleId(preferences.equipped_title_id);
  if (parsed === null) return null;
  if (parsed.kind === 'LEVEL') {
    const label = levelTitle(parsed.level);
    return label === null || levelProgress(preferences.total_xp).level < parsed.level ? null : { label, style: 'feat' };
  }
  if (parsed.kind === 'GLOBAL') {
    const owned = await db.prepare('SELECT 1 FROM user_achievements WHERE user_id = ?1 AND achievement_id = ?2')
      .bind(userId, parsed.achievementId).first();
    const label = globalAchievementTitle(parsed.achievementId);
    return owned === null || label === null ? null : { label, style: 'feat' };
  }
  if (!await repository.owns(userId, parsed.themeId, parsed.achievementId)) return null;
  const name = await themeName(db, parsed.themeId);
  return name === null ? null : {
    label: themeAchievementTitle(parsed.achievementId, name),
    style: themeAchievementTitleStyle(parsed.achievementId),
  };
}

export interface RankedRewardInput {
  /** Acertos desta pessoa na partida (para a missão semanal). */
  correctAnswers: number;
  outcome: RankedOutcome;
  topBefore: number | null;
  userId: string;
}

/**
 * Fecha a Rankeada no lado das conquistas: conta a partida no tema de cada
 * jogador e mede o Top depois dela. Devolve o que mudou para cada pessoa
 * (vazio se a partida já tinha sido contada antes).
 */
export async function recordRankedRewards(
  env: Pick<Env, 'CORE_DB' | 'TOP_TITLE_MIN_PLAYERS'>,
  matchId: string,
  themeId: string,
  players: readonly RankedRewardInput[],
  nowMs = Date.now(),
): Promise<Map<string, MatchThemeRewards>> {
  const repository = themeAchievements(env);
  const name = await themeName(env.CORE_DB, themeId);
  const rewards = new Map<string, MatchThemeRewards>();
  if (name === null) return rewards;
  const recorded = await Promise.all(players.map(async (player) => ({
    earned: await repository.recordRanked(player.userId, themeId, matchId, player.outcome),
    player,
  })));
  // Missões semanais andam junto, pela mesma guarda: partida já contada não volta.
  const weekKey = gameWeekKey(nowMs);
  const weekly = new WeeklyMissionRepository(env.CORE_DB);
  for (const { earned, player } of recorded) {
    if (earned === null || player.outcome.result === 'ABANDONED') continue;
    try {
      await weekly.advance(player.userId, weekKey, { correctAnswers: player.correctAnswers, won: player.outcome.result === 'WIN' });
    } catch {
      console.error(JSON.stringify({ code: 'WEEKLY_MISSION_RECORD_FAILED', matchId }));
    }
  }
  // O Top depois só faz sentido com as duas partidas já contadas.
  for (const { earned, player } of recorded) {
    if (earned === null) continue;
    rewards.set(player.userId, {
      achievements: earned.map((id) => ({ id, title: themeAchievementTitle(id, name) })),
      themeName: name,
      top: { after: await repository.topPosition(player.userId, themeId), before: player.topBefore },
    });
  }
  return rewards;
}
