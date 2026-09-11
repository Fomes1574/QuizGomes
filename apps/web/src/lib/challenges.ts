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
  challenged: SocialUser;
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

export interface ChallengeCardCopy {
  /** Só aparece quando a ação é realmente possível agora. */
  canCancel: boolean;
  canDecline: boolean;
  canPlay: boolean;
  canResume: boolean;
  headline: string;
  subtitle: string;
}

/**
 * Texto e ações do card, derivados do estado AUTORITATIVO do desafio.
 *
 * A presença visual é resolvida separadamente pelo SocialRealtime. Aqui não há
 * progresso, número de pergunta, score parcial nem estado textual concatenado.
 */
export function challengeCardCopy(challenge: ChallengeView): ChallengeCardCopy {
  const mine = challenge.role === 'CHALLENGER';
  const other = mine ? challenge.challenged : challenge.challenger;
  const headline = mine
    ? `Você desafiou ${other.displayName}`
    : `${other.displayName} te desafiou`;
  const subtitle = `${challenge.theme.name} · ${DIFFICULTY_LABEL[challenge.difficulty]}`;
  const idle = { canCancel: false, canDecline: false, canPlay: false, canResume: false };

  if (challenge.kind === 'DIRECT') {
    return challenge.status === 'PENDING_DIRECT'
      ? {
        ...idle,
        canCancel: mine,
        canDecline: !mine,
        canPlay: !mine,
        headline,
        subtitle,
      }
      : { ...idle, headline, subtitle };
  }

  if (challenge.status === 'FIRST_PLAYER_ACTIVE') {
    return {
      ...idle,
      canCancel: mine,
      canResume: mine,
      headline,
      subtitle,
    };
  }
  if (challenge.status === 'WAITING_FOR_SECOND') {
    return {
      ...idle,
      canCancel: mine,
      canDecline: !mine,
      canPlay: !mine,
      headline,
      subtitle,
    };
  }
  if (challenge.status === 'SECOND_PLAYER_ACTIVE') {
    return {
      ...idle,
      headline,
      subtitle,
    };
  }
  return { ...idle, headline, subtitle };
}
