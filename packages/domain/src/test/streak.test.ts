import { describe, expect, it } from 'vitest';
import { advanceThemeStreak } from '../progression/streak.js';

describe('streak por usuário+tema', () => {
  it('nasce em 1/1 no primeiro dia ativo', () => {
    expect(advanceThemeStreak(null, '2026-09-21')).toEqual({
      bestStreak: 1, currentStreak: 1, lastActiveDay: '2026-09-21',
    });
  });

  it('o mesmo dia é idempotente: replay não conta duas vezes', () => {
    const state = { bestStreak: 3, currentStreak: 3, lastActiveDay: '2026-09-21' };
    expect(advanceThemeStreak(state, '2026-09-21')).toEqual(state);
  });

  it('dia seguinte consecutivo avança o atual e atualiza o recorde quando supera', () => {
    const state = { bestStreak: 3, currentStreak: 3, lastActiveDay: '2026-09-21' };
    expect(advanceThemeStreak(state, '2026-09-22')).toEqual({
      bestStreak: 4, currentStreak: 4, lastActiveDay: '2026-09-22',
    });
  });

  it('um gap de mais de um dia reseta o atual para 1 sem tocar o recorde', () => {
    const state = { bestStreak: 10, currentStreak: 6, lastActiveDay: '2026-09-10' };
    expect(advanceThemeStreak(state, '2026-09-21')).toEqual({
      bestStreak: 10, currentStreak: 1, lastActiveDay: '2026-09-21',
    });
  });

  it('um evento fora de ordem (dia anterior ao já registrado) nunca anda para trás', () => {
    const state = { bestStreak: 5, currentStreak: 5, lastActiveDay: '2026-09-21' };
    expect(advanceThemeStreak(state, '2026-09-20')).toEqual(state);
  });

  it('recorde nunca fica abaixo do atual mesmo após reset', () => {
    const state = { bestStreak: 2, currentStreak: 2, lastActiveDay: '2026-09-01' };
    const afterGap = advanceThemeStreak(state, '2026-09-30');
    expect(afterGap.bestStreak).toBeGreaterThanOrEqual(afterGap.currentStreak);
  });
});
