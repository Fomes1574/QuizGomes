import { describe, expect, it } from 'vitest';
import { displayedSeconds, questionsForDifficulty, remainingAt, resultFromScores, scoreAnswer } from '../index.js';

describe('pontuação da rodada', () => {
  it.each([
    [10_000, 20],
    [9_000, 19],
    [8_000, 18],
    [1_000, 11],
    [1, 11],
  ])('%i ms corretos valem %i', (remainingMs, score) => {
    expect(scoreAnswer(true, remainingMs)).toBe(score);
  });

  it('usa ceil nos limites de milissegundos', () => {
    expect(displayedSeconds(9_001)).toBe(10);
    expect(displayedSeconds(9_000)).toBe(9);
    expect(displayedSeconds(-1)).toBe(0);
  });

  it('erro e timeout valem zero', () => {
    expect(scoreAnswer(false, 10_000)).toBe(0);
    expect(scoreAnswer(true, 0)).toBe(0);
    expect(scoreAnswer(true, -1)).toBe(0);
  });

  it('deriva restante de deadline autoritativo', () => {
    expect(remainingAt(1_000, 10_000)).toBe(9_000);
    expect(remainingAt(11_000, 10_000)).toBe(0);
  });

  it('preserva empate sem desempate', () => {
    expect(resultFromScores(247, 247)).toBe('DRAW');
    expect(resultFromScores(248, 247)).toBe('WIN');
    expect(resultFromScores(246, 247)).toBe('LOSS');
  });

  it('define 5/10/15 perguntas', () => {
    expect(questionsForDifficulty('EASY')).toBe(5);
    expect(questionsForDifficulty('MEDIUM')).toBe(10);
    expect(questionsForDifficulty('HARD')).toBe(15);
  });
});
