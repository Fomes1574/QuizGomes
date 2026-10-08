import {
  LEVEL_TITLES,
  THEME_ACHIEVEMENT_IDS,
  THEME_TRAIL_ORDER,
  globalAchievementTitle,
  levelProgress,
  levelTitle,
  parseTitleId,
  themeAchievementGroup,
  themeAchievementHint,
  themeAchievementProgress,
  themeAchievementTitle,
  themeAchievementTitleStyle,
  themeTitleId,
  topTitleLabel,
  topTitleTier,
  totalXpForLevel,
  type PlayerTitle,
  type PlayerTitleStyle,
} from '@quiz-gomes/domain';
import type { Env } from '../env.js';
import { ApiError } from '../http/api-error.js';
import { resolvePlayerTitle, themeAchievements, themeName } from './player-title-service.js';

/** Quantos títulos ainda bloqueados a vitrine mostra (os mais próximos primeiro). */
const LOCKED_SHOWN = 24;
export const MAX_PINNED_TITLES = 3;
const TOP_PREFIX = 'TOP:';

export interface ShowcaseTitle {
  group: 'feitos' | 'ranking' | 'top';
  hint: string;
  id: string;
  label: string;
  /** Presente só em título ainda não conquistado. */
  locked?: { ratio: number; text: string };
  /** Posição atual, só em título de Top. */
  position?: number;
  style: PlayerTitleStyle;
}

export interface TitleShowcase {
  autoTop: boolean;
  /** Título que aparece sob o nome agora (fora de partida). */
  current: PlayerTitle | null;
  equippedId: string | null;
  /** O título que a pessoa escolheu perseguir, com o progresso atual. */
  goal: ShowcaseTitle | null;
  owned: number;
  pins: string[];
  /** Conquistáveis nos temas que a pessoa joga (mais os gerais que já tem). */
  possible: number;
  titles: ShowcaseTitle[];
}

interface ShowcasePreferences {
  equipped_title_id: string | null;
  equipped_top_theme_id: string | null;
  goal_title_id: string | null;
  pinned_achievements: string | null;
  top_title_auto: number;
  total_xp: number;
}

function parsePins(value: string | null): string[] {
  if (value === null) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string').slice(0, MAX_PINNED_TITLES)
      : [];
  } catch {
    return [];
  }
}

async function preferencesOf(db: D1Database, userId: string): Promise<ShowcasePreferences> {
  const row = await db.prepare(
    `SELECT equipped_title_id, equipped_top_theme_id, goal_title_id, pinned_achievements, top_title_auto, total_xp
       FROM user_profiles WHERE user_id = ?1`,
  ).bind(userId).first<ShowcasePreferences>();
  if (row === null) throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Perfil não encontrado.');
  return row;
}

/**
 * Tudo que a vitrine de títulos precisa numa leitura: o que a pessoa já tem
 * (Tops atuais, conquistas de tema e gerais), o que está perto de sair e as
 * escolhas dela. Antes, garante as conquistas que o histórico já prova.
 */
export async function titleShowcase(
  env: Pick<Env, 'CORE_DB' | 'TOP_TITLE_MIN_PLAYERS'>,
  userId: string,
): Promise<TitleShowcase> {
  const db = env.CORE_DB;
  const repository = themeAchievements(env);
  await repository.syncFromHistory(userId);
  const [preferences, played, ownedTheme, globals] = await Promise.all([
    preferencesOf(db, userId),
    repository.playedThemes(userId),
    repository.list(userId),
    db.prepare('SELECT achievement_id FROM user_achievements WHERE user_id = ?1 ORDER BY unlocked_at DESC LIMIT 100')
      .bind(userId).all<{ achievement_id: string }>(),
  ]);
  const tops = await repository.topPositions(played);
  const titles: ShowcaseTitle[] = [];

  for (const theme of played) {
    const position = tops.get(theme.themeId);
    if (position === undefined) continue;
    titles.push({
      group: 'top',
      hint: 'Sua posição hoje. Muda junto com o ranking.',
      id: `${TOP_PREFIX}${theme.themeId}`,
      label: topTitleLabel(position, theme.themeName),
      position,
      style: topTitleTier(position),
    });
  }
  titles.sort((a, b) => (a.position ?? 99) - (b.position ?? 99));

  const ownedKeys = new Set<string>();
  for (const record of ownedTheme) {
    ownedKeys.add(themeTitleId(record.themeId, record.achievementId));
    titles.push({
      group: themeAchievementGroup(record.achievementId),
      hint: themeAchievementHint(record.achievementId),
      id: themeTitleId(record.themeId, record.achievementId),
      label: themeAchievementTitle(record.achievementId, record.themeName),
      style: themeAchievementTitleStyle(record.achievementId),
    });
  }
  for (const { achievement_id: achievementId } of globals.results) {
    const label = globalAchievementTitle(achievementId);
    if (label === null) continue;
    titles.push({ group: 'feitos', hint: 'Conquista geral', id: `G:${achievementId}`, label, style: 'feat' });
  }
  const level = levelProgress(preferences.total_xp).level;
  const levelLocked: ShowcaseTitle[] = [];
  for (const milestone of LEVEL_TITLES) {
    const id = `N:${milestone.level}`;
    if (level >= milestone.level) {
      titles.push({ group: 'feitos', hint: `Chegou ao nível ${milestone.level}`, id, label: milestone.label, style: 'feat' });
    } else if (levelLocked.length === 0) {
      // Só o próximo marco de nível aparece bloqueado: o resto ainda está longe demais.
      const target = totalXpForLevel(milestone.level);
      const missing = Math.max(0, target - preferences.total_xp);
      levelLocked.push({
        group: 'feitos',
        hint: `Chegue ao nível ${milestone.level}`,
        id,
        label: milestone.label,
        locked: { ratio: Math.min(1, preferences.total_xp / target), text: `faltam ${missing.toLocaleString('pt-BR')} de XP` },
        style: 'feat',
      });
    }
  }
  const ownedCount = titles.length;

  const locked: ShowcaseTitle[] = [...levelLocked];
  for (const theme of played) {
    for (const achievementId of THEME_ACHIEVEMENT_IDS) {
      const id = themeTitleId(theme.themeId, achievementId);
      if (ownedKeys.has(id)) continue;
      locked.push({
        group: themeAchievementGroup(achievementId),
        hint: themeAchievementHint(achievementId),
        id,
        label: themeAchievementTitle(achievementId, theme.themeName),
        locked: themeAchievementProgress(achievementId, theme),
        style: themeAchievementTitleStyle(achievementId),
      });
    }
  }
  const possible = ownedCount + locked.length;
  locked.sort((a, b) => (b.locked?.ratio ?? 0) - (a.locked?.ratio ?? 0));
  titles.push(...locked.slice(0, LOCKED_SHOWN));

  const pinnedTop = preferences.equipped_top_theme_id;
  const equippedId = pinnedTop !== null && tops.has(pinnedTop)
    ? `${TOP_PREFIX}${pinnedTop}`
    : preferences.equipped_title_id !== null && titles.some((title) => title.id === preferences.equipped_title_id && title.locked === undefined)
      ? preferences.equipped_title_id
      : null;
  const available = new Set(titles.filter((title) => title.locked === undefined).map((title) => title.id));
  const goalId = preferences.goal_title_id;
  const goal = goalId === null
    ? null
    : titles.find((title) => title.id === goalId) ?? locked.find((title) => title.id === goalId) ?? null;
  return {
    autoTop: preferences.top_title_auto === 1,
    current: await resolvePlayerTitle(env, userId, null),
    equippedId,
    goal,
    owned: ownedCount,
    pins: parsePins(preferences.pinned_achievements).filter((id) => available.has(id)),
    possible,
    titles,
  };
}

async function ownsTitle(
  env: Pick<Env, 'CORE_DB' | 'TOP_TITLE_MIN_PLAYERS'>,
  userId: string,
  id: string,
): Promise<boolean> {
  if (id.startsWith(TOP_PREFIX)) {
    const themeId = id.slice(TOP_PREFIX.length);
    return themeId.length > 0 && themeId.length <= 128
      && await themeAchievements(env).topPosition(userId, themeId) !== null;
  }
  const parsed = parseTitleId(id);
  if (parsed === null) return false;
  if (parsed.kind === 'THEME') return themeAchievements(env).owns(userId, parsed.themeId, parsed.achievementId);
  if (parsed.kind === 'LEVEL') {
    const row = await env.CORE_DB.prepare('SELECT total_xp FROM user_profiles WHERE user_id = ?1').bind(userId).first<{ total_xp: number }>();
    return row !== null && levelProgress(row.total_xp).level >= parsed.level;
  }
  return await env.CORE_DB.prepare('SELECT 1 FROM user_achievements WHERE user_id = ?1 AND achievement_id = ?2')
    .bind(userId, parsed.achievementId).first() !== null;
}

export interface TitleShowcaseUpdate {
  autoTop?: boolean | undefined;
  /** Título a perseguir (precisa ser um título que existe); null tira. */
  goalId?: string | null | undefined;
  /** null tira o título escolhido. */
  equippedId?: string | null | undefined;
  pins?: string[] | undefined;
}

/**
 * Grava as escolhas da vitrine. Só aceita títulos que a pessoa tem agora
 * (um Top só enquanto ela estiver nele). Escolher um Top mantém o título
 * permanente guardado para quando ela sair do Top 10.
 */
export async function updateTitleShowcase(
  env: Pick<Env, 'CORE_DB' | 'TOP_TITLE_MIN_PLAYERS'>,
  userId: string,
  update: TitleShowcaseUpdate,
): Promise<void> {
  const assignments: string[] = [];
  const values: Array<number | string | null> = [];
  const set = (column: string, value: number | string | null) => {
    values.push(value);
    assignments.push(`${column} = ?${values.length + 1}`);
  };

  if (update.equippedId !== undefined) {
    const id = update.equippedId;
    if (id === null) {
      set('equipped_title_id', null);
      set('equipped_top_theme_id', null);
    } else {
      if (!await ownsTitle(env, userId, id)) throw new ApiError(403, 'TITLE_NOT_OWNED', 'Esse título ainda não é seu.');
      if (id.startsWith(TOP_PREFIX)) {
        set('equipped_top_theme_id', id.slice(TOP_PREFIX.length));
      } else {
        set('equipped_title_id', id);
        set('equipped_top_theme_id', null);
      }
    }
  }
  if (update.autoTop !== undefined) set('top_title_auto', update.autoTop ? 1 : 0);
  if (update.goalId !== undefined) {
    if (update.goalId !== null && parseTitleId(update.goalId) === null) {
      throw new ApiError(400, 'GOAL_INVALID', 'Esse objetivo não existe.');
    }
    set('goal_title_id', update.goalId);
  }
  if (update.pins !== undefined) {
    const pins = [...new Set(update.pins)];
    if (pins.length > MAX_PINNED_TITLES) throw new ApiError(400, 'TOO_MANY_PINS', `Dá pra destacar até ${MAX_PINNED_TITLES}.`);
    for (const id of pins) {
      if (!await ownsTitle(env, userId, id)) throw new ApiError(403, 'TITLE_NOT_OWNED', 'Só dá pra destacar o que já é seu.');
    }
    set('pinned_achievements', pins.length === 0 ? null : JSON.stringify(pins));
  }
  if (assignments.length === 0) return;
  await env.CORE_DB.prepare(
    `UPDATE user_profiles SET ${assignments.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?1`,
  ).bind(userId, ...values).run();
}

/**
 * Os destaques que a pessoa escolheu, como os outros veem: só o que ela tem
 * agora (um Top que ela perdeu some do destaque sem mexer na escolha).
 */
export async function pinnedHighlights(
  env: Pick<Env, 'CORE_DB' | 'TOP_TITLE_MIN_PLAYERS'>,
  userId: string,
): Promise<ShowcaseTitle[]> {
  const row = await env.CORE_DB.prepare('SELECT pinned_achievements FROM user_profiles WHERE user_id = ?1')
    .bind(userId).first<{ pinned_achievements: string | null }>();
  const highlights: ShowcaseTitle[] = [];
  for (const id of parsePins(row?.pinned_achievements ?? null)) {
    const described = await describeOwnedTitle(env, userId, id);
    if (described !== null) highlights.push(described);
  }
  return highlights;
}

async function describeOwnedTitle(
  env: Pick<Env, 'CORE_DB' | 'TOP_TITLE_MIN_PLAYERS'>,
  userId: string,
  id: string,
): Promise<ShowcaseTitle | null> {
  if (!await ownsTitle(env, userId, id)) return null;
  if (id.startsWith(TOP_PREFIX)) {
    const themeId = id.slice(TOP_PREFIX.length);
    const [position, name] = await Promise.all([
      themeAchievements(env).topPosition(userId, themeId),
      themeName(env.CORE_DB, themeId),
    ]);
    if (position === null || name === null) return null;
    return { group: 'top', hint: '', id, label: topTitleLabel(position, name), position, style: topTitleTier(position) };
  }
  const parsed = parseTitleId(id);
  if (parsed === null) return null;
  if (parsed.kind === 'LEVEL') {
    const label = levelTitle(parsed.level);
    return label === null ? null : { group: 'feitos', hint: '', id, label, style: 'feat' };
  }
  if (parsed.kind === 'GLOBAL') {
    const label = globalAchievementTitle(parsed.achievementId);
    return label === null ? null : { group: 'feitos', hint: '', id, label, style: 'feat' };
  }
  const name = await themeName(env.CORE_DB, parsed.themeId);
  return name === null ? null : {
    group: themeAchievementGroup(parsed.achievementId),
    hint: '',
    id,
    label: themeAchievementTitle(parsed.achievementId, name),
    style: themeAchievementTitleStyle(parsed.achievementId),
  };
}

export interface ThemeTrailStep {
  id: string;
  label: string;
  progress: { ratio: number; text: string } | null;
  style: PlayerTitleStyle;
  unlocked: boolean;
}

/**
 * Trilha de um tema para quem está olhando: cada conquista no caminho, o que
 * já saiu e quanto falta para a próxima. Quem nunca jogou o tema vê a trilha
 * inteira começando do zero.
 */
export async function themeTrail(
  env: Pick<Env, 'CORE_DB' | 'TOP_TITLE_MIN_PLAYERS'>,
  userId: string,
  themeId: string,
  themeName: string,
): Promise<ThemeTrailStep[]> {
  const repository = themeAchievements(env);
  const [row, owned] = await Promise.all([
    env.CORE_DB.prepare(
      `SELECT r.knowledge, r.wins, p.best_division, p.completed_ranked, p.unbeaten_matches, p.unbeaten_wins, p.win_streak
         FROM theme_rankings r
         LEFT JOIN user_theme_progress p ON p.user_id = r.user_id AND p.theme_id = r.theme_id
        WHERE r.user_id = ?1 AND r.theme_id = ?2`,
    ).bind(userId, themeId).first<{
      best_division: number | null; completed_ranked: number | null; knowledge: number;
      unbeaten_matches: number | null; unbeaten_wins: number | null; wins: number; win_streak: number | null;
    }>(),
    repository.list(userId),
  ]);
  const have = new Set(owned.filter((record) => record.themeId === themeId).map((record) => record.achievementId));
  const context = {
    knowledge: row?.knowledge ?? 0,
    progress: {
      bestDivision: row?.best_division ?? 0,
      completedRanked: row?.completed_ranked ?? 0,
      unbeatenMatches: row?.unbeaten_matches ?? 0,
      unbeatenWins: row?.unbeaten_wins ?? 0,
      winStreak: row?.win_streak ?? 0,
    },
    wins: row?.wins ?? 0,
  };
  return THEME_TRAIL_ORDER.map((achievementId) => {
    const unlocked = have.has(achievementId);
    return {
      id: themeTitleId(themeId, achievementId),
      label: themeAchievementTitle(achievementId, themeName),
      progress: unlocked ? null : themeAchievementProgress(achievementId, context),
      style: themeAchievementTitleStyle(achievementId),
      unlocked,
    };
  });
}
