import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_FRAMES,
  isKnownAchievement,
  streakAchievements,
  streakDaysOf,
} from '../progression/achievements.js';

describe('conquistas de ofensiva', () => {
  it('nada antes de 7 dias; 7 dias dá a primeira moldura', () => {
    expect(streakAchievements(6)).toEqual([]);
    expect(streakAchievements(7)).toEqual(['STREAK_7']);
    expect(ACHIEVEMENT_FRAMES.STREAK_7).toBe('frame-streak-7');
  });

  it('cada 100 dias é um marco, e 1 e 2 anos têm conquista própria', () => {
    expect(streakAchievements(99)).toEqual(['STREAK_7']);
    expect(streakAchievements(100)).toEqual(['STREAK_7', 'STREAK_100']);
    expect(streakAchievements(365)).toEqual(['STREAK_7', 'STREAK_100', 'STREAK_200', 'STREAK_300', 'STREAK_365']);
    expect(streakAchievements(730)).toEqual([
      'STREAK_7', 'STREAK_100', 'STREAK_200', 'STREAK_300', 'STREAK_400', 'STREAK_500', 'STREAK_600', 'STREAK_700',
      'STREAK_365', 'STREAK_730',
    ]);
  });

  it('reconhece só conquistas que existem', () => {
    expect(isKnownAchievement('STREAK_300')).toBe(true);
    expect(isKnownAchievement('STREAK_365')).toBe(true);
    expect(isKnownAchievement('STREAK_150')).toBe(false);
    expect(isKnownAchievement('MISSIONS_DAY')).toBe(true);
    expect(isKnownAchievement('QUALQUER')).toBe(false);
    expect(streakDaysOf('STREAK_730')).toBe(730);
    expect(streakDaysOf('MISSIONS_DAY')).toBeNull();
  });
});
