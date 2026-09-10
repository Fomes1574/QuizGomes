import type { Difficulty } from '@quiz-gomes/domain';
import type { SocialUser } from './social.js';

export type ChallengeKind = 'ASYNC' | 'DIRECT';

export type ChallengeStatus =
  | 'ACTIVE'
  | 'CANCELLED'
  | 'COMPLETED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'FIRST_PLAYER_ACTIVE'
  | 'PENDING_DIRECT'
  | 'PREPARING'
  | 'SECOND_PLAYER_ACTIVE'
  | 'VOID'
  | 'WAITING_FOR_SECOND';

export interface ChallengeView {
  challenger: SocialUser;
  difficulty: Difficulty;
  expiresAt: string | null;
  id: string;
  kind: ChallengeKind;
  role: 'CHALLENGED' | 'CHALLENGER';
  status: ChallengeStatus;
  theme: { name: string; slug: string };
}

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  EASY: 'Fácil',
  HARD: 'Difícil',
  MEDIUM: 'Médio',
};
