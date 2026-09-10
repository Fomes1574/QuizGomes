import type { Difficulty, MatchResult } from '../types.js';

const QUESTION_COUNTS: Record<Difficulty, number> = {
  EASY: 5,
  MEDIUM: 8,
  HARD: 12,
};

/**
 * Quantidade de perguntas por partida, válida para matchmaking, desafio simultâneo
 * e desafio assíncrono. O pool do tema precisa de pelo menos esta quantidade ativa.
 */
export function questionsForDifficulty(difficulty: Difficulty): number {
  return QUESTION_COUNTS[difficulty];
}

export function resultFromScores(playerScore: number, opponentScore: number): MatchResult {
  if (playerScore === opponentScore) return 'DRAW';
  return playerScore > opponentScore ? 'WIN' : 'LOSS';
}
