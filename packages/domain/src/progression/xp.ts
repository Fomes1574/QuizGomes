import type { Difficulty, MatchResult } from '../types.js';

export const MAX_LEVEL = 999;
export const TOTAL_XP_TO_MAX_LEVEL = 5_230_904;

const XP_BY_DIFFICULTY: Record<Difficulty, number> = {
  EASY: 10,
  MEDIUM: 20,
  HARD: 30,
};

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

export function xpAward(difficulty: Difficulty, result: MatchResult): number {
  return result === 'WIN' ? XP_BY_DIFFICULTY[difficulty] : 0;
}

export function minimumHardWinsToMaxLevel(): number {
  return Math.ceil(TOTAL_XP_TO_MAX_LEVEL / XP_BY_DIFFICULTY.HARD);
}
