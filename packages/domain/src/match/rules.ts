import type { Difficulty, MatchResult } from '../types.js';

const QUESTION_COUNTS: Record<Difficulty, number> = {
  EASY: 5,
  MEDIUM: 10,
  HARD: 15,
};

export function questionsForDifficulty(difficulty: Difficulty): number {
  return QUESTION_COUNTS[difficulty];
}

export function resultFromScores(playerScore: number, opponentScore: number): MatchResult {
  if (playerScore === opponentScore) return 'DRAW';
  return playerScore > opponentScore ? 'WIN' : 'LOSS';
}
