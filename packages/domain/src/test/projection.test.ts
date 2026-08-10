import { describe, expect, it } from 'vitest';
import { projectRoundForViewer, publicQuestion, type SealedAnswer, type SecretQuestion } from '../index.js';

const question: SecretQuestion = {
  correctOption: 2,
  id: 'q1',
  imageUrl: null,
  options: ['A', 'B', 'C', 'D'],
  prompt: 'Pergunta sintética?',
};

const firstAnswer: SealedAnswer = { correct: true, remainingMs: 8_100, score: 19, selectedOption: 2 };
const secondAnswer: SealedAnswer = { correct: false, remainingMs: 5_200, score: 0, selectedOption: 1 };

describe('projeção segura da rodada', () => {
  it('remove a resposta correta do payload público', () => {
    expect(publicQuestion(question)).not.toHaveProperty('correctOption');
  });

  it('revela somente que o adversário respondeu enquanto o local pensa', () => {
    const projection = projectRoundForViewer(question, null, firstAnswer);
    expect(projection.opponent).toEqual({ answered: true });
    expect(projection).not.toHaveProperty('correctOption');
    expect(JSON.stringify(projection)).not.toContain('remainingMs');
    expect(JSON.stringify(projection)).not.toContain('selectedOption');
    expect(JSON.stringify(projection)).not.toContain('"score"');
  });

  it('no assíncrono mantém o fantasma selado antes da resposta do segundo', () => {
    const payloadToSecond = projectRoundForViewer(question, null, firstAnswer);
    expect(payloadToSecond.opponent.answered).toBe(true);
    expect(payloadToSecond.opponent).not.toHaveProperty('correct');
    expect(payloadToSecond.opponent).not.toHaveProperty('score');
    expect(payloadToSecond.opponent).not.toHaveProperty('selectedOption');
  });

  it('revela apenas a rodada atual depois que o jogador trava a resposta', () => {
    const projection = projectRoundForViewer(question, secondAnswer, firstAnswer);
    expect(projection.correctOption).toBe(2);
    expect(projection.viewer).toEqual({ correct: false, score: 0, selectedOption: 1 });
    expect(projection.opponent).toEqual({ answered: true, correct: true, score: 19, selectedOption: 2 });
  });
});
