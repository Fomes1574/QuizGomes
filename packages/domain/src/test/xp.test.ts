import { describe, expect, it } from 'vitest';
import {
  MAX_LEVEL,
  TOTAL_XP_TO_MAX_LEVEL,
  levelProgress,
  minimumHardWinsToMaxLevel,
  totalXpForLevel,
  xpAward,
  xpForNextLevel,
} from '../index.js';

describe('XP global', () => {
  it.each([
    [1, 100],
    [2, 103],
    [5, 109],
    [10, 120],
    [25, 156],
    [50, 229],
    [100, 421],
    [250, 1_374],
    [500, 4_211],
    [750, 8_611],
    [998, 14_520],
  ])('nível %i exige %i XP', (level, expected) => {
    expect(xpForNextLevel(level)).toBe(expected);
  });

  it('cada nível exige mais XP que o anterior', () => {
    for (let level = 2; level < MAX_LEVEL; level += 1) {
      expect(xpForNextLevel(level)).toBeGreaterThan(xpForNextLevel(level - 1));
    }
  });

  it('totaliza 5.230.904 XP até o nível 999', () => {
    expect(totalXpForLevel(MAX_LEVEL)).toBe(TOTAL_XP_TO_MAX_LEVEL);
  });

  it('exige no mínimo 174.364 vitórias difíceis teóricas', () => {
    expect(minimumHardWinsToMaxLevel()).toBe(174_364);
  });

  it('não cria nível 1000 e mantém MAX', () => {
    expect(levelProgress(TOTAL_XP_TO_MAX_LEVEL)).toMatchObject({ level: 999, nextLevelXp: null, progress: 1 });
    expect(levelProgress(TOTAL_XP_TO_MAX_LEVEL + 1_000_000).level).toBe(999);
  });

  it('concede XP apenas em vitória', () => {
    expect(xpAward('EASY', 'WIN')).toBe(10);
    expect(xpAward('MEDIUM', 'WIN')).toBe(20);
    expect(xpAward('HARD', 'WIN')).toBe(30);
    expect(xpAward('HARD', 'LOSS')).toBe(0);
    expect(xpAward('HARD', 'DRAW')).toBe(0);
    expect(xpAward('HARD', 'VOID')).toBe(0);
  });
});
