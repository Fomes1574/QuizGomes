import { describe, expect, it } from 'vitest';
import {
  MAX_LEVEL,
  TOTAL_XP_TO_MAX_LEVEL,
  levelProgress,
  minimumRankedWinsToMaxLevel,
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

  it('exige no mínimo 174.364 vitórias Ranqueadas teóricas', () => {
    expect(minimumRankedWinsToMaxLevel()).toBe(52_310);
  });

  it('não cria nível 1000 e mantém MAX', () => {
    expect(levelProgress(TOTAL_XP_TO_MAX_LEVEL)).toMatchObject({ level: 999, nextLevelXp: null, progress: 1 });
    expect(levelProgress(TOTAL_XP_TO_MAX_LEVEL + 1_000_000).level).toBe(999);
  });

  it('vitória vale o XP do modo; derrota e empate concluídos valem a participação do modo', () => {
    expect(xpAward('CASUAL', 'WIN')).toBe(50);
    expect(xpAward('RANKED', 'WIN')).toBe(100);
    expect(xpAward('CASUAL', 'LOSS')).toBe(10);
    expect(xpAward('CASUAL', 'DRAW')).toBe(10);
    expect(xpAward('RANKED', 'LOSS')).toBe(20);
    expect(xpAward('RANKED', 'DRAW')).toBe(20);
    expect(xpAward('RANKED', 'VOID')).toBe(0);
    expect(xpAward('CASUAL', 'VOID')).toBe(0);
  });
});
