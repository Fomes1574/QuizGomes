import type { MatchMode, MatchResult } from '../types.js';

export const MAX_LEVEL = 999;
export const TOTAL_XP_TO_MAX_LEVEL = 5_230_904;

/** XP da vitória por modo (decisão do proprietário, 2026-10-08). */
export const WIN_XP: Readonly<Record<MatchMode, number>> = Object.freeze({
  CASUAL: 50,
  RANKED: 100,
});

export function xpForNextLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level >= MAX_LEVEL) {
    throw new RangeError('O nível deve estar entre 1 e 998.');
  }
  const offset = level - 1;
  return 100 + (2 * offset) + Math.ceil((offset ** 2) / 80);
}

export function totalXpForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) {
    throw new RangeError('O nível deve estar entre 1 e 999.');
  }
  let total = 0;
  for (let current = 1; current < level; current += 1) total += xpForNextLevel(current);
  return total;
}

export interface LevelProgress {
  currentLevelXp: number;
  level: number;
  nextLevelXp: number | null;
  progress: number;
  totalXp: number;
}

export function levelProgress(totalXpInput: number): LevelProgress {
  if (!Number.isFinite(totalXpInput)) throw new TypeError('XP deve ser finito.');
  const totalXp = Math.max(0, Math.trunc(totalXpInput));
  let level = 1;
  let spent = 0;
  while (level < MAX_LEVEL) {
    const needed = xpForNextLevel(level);
    if (spent + needed > totalXp) break;
    spent += needed;
    level += 1;
  }
  const nextLevelXp = level === MAX_LEVEL ? null : xpForNextLevel(level);
  const currentLevelXp = totalXp - spent;
  return {
    currentLevelXp,
    level,
    nextLevelXp,
    progress: nextLevelXp === null ? 1 : Math.min(1, currentLevelXp / nextLevelXp),
    totalXp,
  };
}

/**
 * XP de participação: quem termina a partida ganha algo mesmo sem vencer.
 * Vale para derrota e empate de partida concluída; partida anulada (VOID) e
 * abandono nunca pagam.
 */
export const PARTICIPATION_XP: Readonly<Record<MatchMode, number>> = Object.freeze({
  CASUAL: 10,
  RANKED: 20,
});

export function xpAward(mode: MatchMode, result: MatchResult): number {
  if (result === 'WIN') return WIN_XP[mode];
  return result === 'LOSS' || result === 'DRAW' ? PARTICIPATION_XP[mode] : 0;
}

export function minimumRankedWinsToMaxLevel(): number {
  return Math.ceil(TOTAL_XP_TO_MAX_LEVEL / WIN_XP.RANKED);
}
