import type { MatchMode, MatchResult } from '../types.js';

const QUESTION_COUNTS: Record<MatchMode, number> = {
  CASUAL: 7,
  RANKED: 10,
};

/**
 * Quantidade de perguntas por partida, válida para matchmaking, desafio simultâneo
 * e desafio assíncrono (sempre Casual). O pool único do tema precisa de pelo menos
 * esta quantidade ativa.
 */
export function questionsForMode(mode: MatchMode): number {
  return QUESTION_COUNTS[mode];
}

export function resultFromScores(playerScore: number, opponentScore: number): MatchResult {
  if (playerScore === opponentScore) return 'DRAW';
  return playerScore > opponentScore ? 'WIN' : 'LOSS';
}
