import { describe, expect, it } from 'vitest';
import {
  LEVEL_TITLES,
  THEME_ACHIEVEMENT_IDS,
  THEME_TRAIL_ORDER,
  WEEKLY_MISSION_DEFINITIONS,
  advanceWeeklyMission,
  gameWeekKey,
  levelTitle,
  nextGameWeekStartMs,
  nextLevelTitle,
  parseTitleId,
} from '../index.js';

describe('semana do jogo', () => {
  it('começa na segunda à 0h de Brasília, não à meia-noite UTC', () => {
    // Domingo 23h59 em Brasília = segunda 02h59 UTC: ainda é a semana anterior.
    expect(gameWeekKey(Date.parse('2026-10-12T02:59:00Z'))).toBe('2026-10-05');
    // Segunda 0h em Brasília = 03h UTC: semana nova.
    expect(gameWeekKey(Date.parse('2026-10-12T03:00:00Z'))).toBe('2026-10-12');
    expect(gameWeekKey(Date.parse('2026-10-18T20:00:00Z'))).toBe('2026-10-12');
    expect(new Date(nextGameWeekStartMs(Date.parse('2026-10-08T15:00:00Z'))).toISOString()).toBe('2026-10-12T03:00:00.000Z');
  });

  it('missões só andam para frente e saturam na meta', () => {
    const now = '2026-10-08T15:00:00.000Z';
    const [play, win, correct] = WEEKLY_MISSION_DEFINITIONS.map((definition) => ({
      completedAt: null, progress: 0, target: definition.target, type: definition.type,
    }));
    if (play === undefined || win === undefined || correct === undefined) throw new Error('definições');
    expect(advanceWeeklyMission(play, { correctAnswers: 3, won: false }, now).progress).toBe(1);
    expect(advanceWeeklyMission(win, { correctAnswers: 3, won: false }, now)).toBe(win);
    expect(advanceWeeklyMission(win, { correctAnswers: 3, won: true }, now).progress).toBe(1);
    const almost = { ...correct, progress: correct.target - 2 };
    const finished = advanceWeeklyMission(almost, { correctAnswers: 9, won: true }, now);
    expect(finished).toMatchObject({ completedAt: now, progress: correct.target });
    expect(advanceWeeklyMission(finished, { correctAnswers: 9, won: true }, '2026-10-09T00:00:00.000Z')).toBe(finished);
  });
});

describe('títulos de nível e trilha', () => {
  it('marcos concentrados até o 300, depois só prestígio', () => {
    const levels = LEVEL_TITLES.map((entry) => entry.level);
    expect(levels.filter((level) => level <= 300)).toHaveLength(10);
    expect(levels.at(-1)).toBe(999);
    expect(levelTitle(100)).toBe('Enciclopédia ambulante');
    expect(levelTitle(7)).toBeNull();
    expect(nextLevelTitle(12)).toEqual({ label: 'Estudioso', level: 25 });
    expect(nextLevelTitle(999)).toBeNull();
    expect(parseTitleId('N:50')).toEqual({ kind: 'LEVEL', level: 50 });
    expect(parseTitleId('N:51')).toBeNull();
  });

  it('a trilha passa por cada conquista de tema uma única vez', () => {
    expect([...THEME_TRAIL_ORDER].sort()).toEqual([...THEME_ACHIEVEMENT_IDS].sort());
  });
});
