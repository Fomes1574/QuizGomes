// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { loadSeenQuestions, storeSeenQuestions } from '../lib/reports.js';

describe('revisão sobrevive ao F5', () => {
  beforeEach(() => sessionStorage.clear());

  it('guarda por partida e ignora dados corrompidos', () => {
    storeSeenQuestions('sala-1', [{ contextId: 'sala-1', contextKind: 'MATCH', prompt: 'P1?', questionId: 'q1', roundNumber: 1 }]);
    expect(loadSeenQuestions('sala-1')).toHaveLength(1);
    expect(loadSeenQuestions('sala-2')).toEqual([]);
    sessionStorage.setItem('quiz-gomes:seen:sala-3', '{quebrado');
    expect(loadSeenQuestions('sala-3')).toEqual([]);
    sessionStorage.setItem('quiz-gomes:seen:sala-4', JSON.stringify([{ prompt: 1 }, { prompt: 'ok', questionId: 'q', roundNumber: 2 }]));
    expect(loadSeenQuestions('sala-4')).toHaveLength(1);
  });
});
