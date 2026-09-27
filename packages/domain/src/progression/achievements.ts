/**
 * Conquistas permanentes e as molduras que elas dão.
 *
 * Todas nascem de eventos que o servidor já confirmou (partida concluída,
 * missões do dia, ofensiva por tema). Uma conquista é única por pessoa: a
 * primeira vez vale, as seguintes não mudam nada.
 *
 * Ofensiva: 7 dias dá a primeira moldura; cada 100 dias vira um marco com
 * cartão de parabéns (100, 200, 300…); 1 ano (365) e 2 anos (730) têm
 * conquista e moldura próprias.
 */

export const STREAK_FIRST_WEEK = 7;
export const STREAK_MILESTONE_STEP = 100;
export const STREAK_ONE_YEAR = 365;
export const STREAK_TWO_YEARS = 730;

export type AchievementId =
  | 'MISSIONS_DAY'
  | 'PERSONAL_RECORD'
  | `STREAK_${number}`;

/** Moldura dada por cada conquista que tem uma. */
export const ACHIEVEMENT_FRAMES: Readonly<Record<string, string>> = Object.freeze({
  MISSIONS_DAY: 'frame-missions',
  PERSONAL_RECORD: 'frame-record',
  STREAK_7: 'frame-streak-7',
  STREAK_100: 'frame-streak-100',
  STREAK_365: 'frame-streak-365',
  STREAK_730: 'frame-streak-730',
});

export function streakAchievementId(days: number): AchievementId {
  return `STREAK_${days}`;
}

/** Dias de ofensiva de uma conquista `STREAK_N`, ou null se não for de ofensiva. */
export function streakDaysOf(achievementId: string): number | null {
  const match = /^STREAK_(\d{1,5})$/.exec(achievementId);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/**
 * Todas as conquistas de ofensiva que uma sequência de `days` dias já
 * garante. Inclui as anteriores de propósito: se um evento se perdeu, o
 * próximo recupera (a gravação ignora o que já existe).
 */
export function streakAchievements(days: number): AchievementId[] {
  if (!Number.isSafeInteger(days) || days < STREAK_FIRST_WEEK) return [];
  const earned: AchievementId[] = [streakAchievementId(STREAK_FIRST_WEEK)];
  for (let milestone = STREAK_MILESTONE_STEP; milestone <= days; milestone += STREAK_MILESTONE_STEP) {
    earned.push(streakAchievementId(milestone));
  }
  if (days >= STREAK_ONE_YEAR) earned.push(streakAchievementId(STREAK_ONE_YEAR));
  if (days >= STREAK_TWO_YEARS) earned.push(streakAchievementId(STREAK_TWO_YEARS));
  return earned;
}

export function isKnownAchievement(achievementId: string): boolean {
  if (achievementId === 'MISSIONS_DAY' || achievementId === 'PERSONAL_RECORD') return true;
  const days = streakDaysOf(achievementId);
  return days !== null && (
    days === STREAK_FIRST_WEEK || days === STREAK_ONE_YEAR || days === STREAK_TWO_YEARS
    || (days > 0 && days % STREAK_MILESTONE_STEP === 0)
  );
}
