import { describe, expect, it } from 'vitest';
import {
  advanceMissionProgress,
  DAILY_MISSION_DEFINITIONS,
  gameDayKey,
  nextGameDayStartMs,
  previousDayKey,
  type MissionState,
} from '../progression/missions.js';

function mission(type: MissionState['type'], target: number): MissionState {
  return { completedAt: null, progress: 0, target, type };
}

describe('missões diárias', () => {
  it('define exatamente três missões fixas', () => {
    expect(DAILY_MISSION_DEFINITIONS).toEqual([
      { target: 1, type: 'PLAY_MATCH' },
      { target: 8, type: 'ANSWER_QUESTIONS' },
      { target: 5, type: 'CORRECT_ANSWERS' },
    ]);
  });

  it('avança PLAY_MATCH somente com partida válida e completa em 1', () => {
    const started = mission('PLAY_MATCH', 1);
    const untouched = advanceMissionProgress(started, {
      correctAnswers: 0, playedValidMatch: false, totalAnswers: 5,
    }, '2026-09-21T12:00:00.000Z');
    expect(untouched).toEqual(started);

    const completed = advanceMissionProgress(started, {
      correctAnswers: 0, playedValidMatch: true, totalAnswers: 0,
    }, '2026-09-21T12:00:00.000Z');
    expect(completed).toEqual({ completedAt: '2026-09-21T12:00:00.000Z', progress: 1, target: 1, type: 'PLAY_MATCH' });
  });

  it('acumula ANSWER_QUESTIONS/CORRECT_ANSWERS sem ultrapassar a meta', () => {
    const answering = mission('ANSWER_QUESTIONS', 8);
    const afterFirstMatch = advanceMissionProgress(answering, {
      correctAnswers: 2, playedValidMatch: true, totalAnswers: 5,
    }, '2026-09-21T12:00:00.000Z');
    expect(afterFirstMatch).toEqual({ completedAt: null, progress: 5, target: 8, type: 'ANSWER_QUESTIONS' });

    const afterSecondMatch = advanceMissionProgress(afterFirstMatch, {
      correctAnswers: 1, playedValidMatch: true, totalAnswers: 12,
    }, '2026-09-21T13:00:00.000Z');
    expect(afterSecondMatch).toEqual({ completedAt: '2026-09-21T13:00:00.000Z', progress: 8, target: 8, type: 'ANSWER_QUESTIONS' });
  });

  it('nunca regride nem reabre uma missão já completa', () => {
    const completed: MissionState = {
      completedAt: '2026-09-21T10:00:00.000Z', progress: 5, target: 5, type: 'CORRECT_ANSWERS',
    };
    const replayed = advanceMissionProgress(completed, {
      correctAnswers: 5, playedValidMatch: true, totalAnswers: 5,
    }, '2026-09-21T11:00:00.000Z');
    expect(replayed).toEqual(completed);
  });

  it('o dia do jogo é o de Brasília: vira à meia-noite de Brasília, não às 21h', () => {
    // 21h30 em Brasília ainda é o mesmo dia, embora já seja o dia seguinte em UTC.
    expect(gameDayKey(Date.parse('2026-09-22T00:30:00.000Z'))).toBe('2026-09-21');
    expect(gameDayKey(Date.parse('2026-09-22T02:59:59.999Z'))).toBe('2026-09-21');
    expect(gameDayKey(Date.parse('2026-09-22T03:00:00.000Z'))).toBe('2026-09-22');
  });

  it('calcula a próxima renovação das missões à meia-noite de Brasília', () => {
    expect(nextGameDayStartMs(Date.parse('2026-09-21T15:00:00.000Z'))).toBe(Date.parse('2026-09-22T03:00:00.000Z'));
    expect(nextGameDayStartMs(Date.parse('2026-09-22T02:59:59.000Z'))).toBe(Date.parse('2026-09-22T03:00:00.000Z'));
    expect(nextGameDayStartMs(Date.parse('2026-09-22T03:00:00.000Z'))).toBe(Date.parse('2026-09-23T03:00:00.000Z'));
  });

  it('volta um dia inclusive na virada de mês e ano', () => {
    expect(previousDayKey('2026-10-01')).toBe('2026-09-30');
    expect(previousDayKey('2027-01-01')).toBe('2026-12-31');
  });
});
