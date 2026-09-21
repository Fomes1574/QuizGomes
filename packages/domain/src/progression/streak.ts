/**
 * Streak por usuário+tema.
 *
 * Puro: recebe o estado anterior e a chave de dia UTC (`YYYY-MM-DD`,
 * `utcDayKey()` do módulo de missões) do evento autoritativo atual e devolve
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
