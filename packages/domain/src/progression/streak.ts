/**
 * Streak por usuário+tema.
 *
 * Puro: recebe o estado anterior e a chave do dia do jogo (`YYYY-MM-DD` de
 * Brasília, `gameDayKey()` do módulo de missões) do evento autoritativo atual e devolve
 * o próximo estado. O mesmo dia é idempotente; um gap de mais de um dia zera
 * o atual sem tocar o recorde; um evento fora de ordem (dia anterior ao já
 * registrado) nunca anda para trás.
 */

export interface ThemeStreakState {
  bestStreak: number;
  currentStreak: number;
  lastActiveDay: string;
}

function daysBetween(fromDayKey: string, toDayKey: string): number {
  const from = Date.parse(`${fromDayKey}T00:00:00.000Z`);
  const to = Date.parse(`${toDayKey}T00:00:00.000Z`);
  return Math.round((to - from) / 86_400_000);
}

export function advanceThemeStreak(state: ThemeStreakState | null, dayKey: string): ThemeStreakState {
  if (state === null) return { bestStreak: 1, currentStreak: 1, lastActiveDay: dayKey };
  const delta = daysBetween(state.lastActiveDay, dayKey);
  if (delta <= 0) return state;
  const currentStreak = delta === 1 ? state.currentStreak + 1 : 1;
  return {
    bestStreak: Math.max(state.bestStreak, currentStreak),
    currentStreak,
    lastActiveDay: dayKey,
  };
}

/**
 * Ofensiva que ainda vale hoje: quem jogou hoje ou ontem mantém a sequência;
 * depois disso ela já está perdida, mesmo que o banco ainda guarde o número
 * antigo (a linha só é reescrita na próxima partida).
 */
export function liveStreak(state: ThemeStreakState | null, todayKey: string): number {
  if (state === null) return 0;
  const delta = daysBetween(state.lastActiveDay, todayKey);
  return delta <= 1 ? state.currentStreak : 0;
}

/** A ofensiva de hoje ainda depende de uma partida (jogou ontem, não hoje). */
export function streakAtRisk(state: ThemeStreakState | null, todayKey: string): boolean {
  return state !== null && state.currentStreak > 0 && daysBetween(state.lastActiveDay, todayKey) === 1;
}
