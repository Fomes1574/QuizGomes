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
  status: string;
}

/**
 * Texto e ações do card, derivados do estado AUTORITATIVO do desafio.
 *
 * Nada de progresso, número de pergunta ou score parcial do outro lado: a segunda
 * linha diz apenas de quem é a vez.
 */
export function challengeCardCopy(challenge: ChallengeView): ChallengeCardCopy {
  const mine = challenge.role === 'CHALLENGER';
  const other = mine ? challenge.challenged : challenge.challenger;
  const context = `em ${challenge.theme.name} na dificuldade ${DIFFICULTY_LABEL[challenge.difficulty]}`;
  const headline = mine
    ? `Você desafiou ${other.displayName} ${context}`
    : `${other.displayName} te desafiou ${context}`;
  const idle = { canCancel: false, canDecline: false, canPlay: false, canResume: false };

  if (challenge.kind === 'DIRECT') {
    return challenge.status === 'PENDING_DIRECT'
      ? {
        ...idle,
        canCancel: mine,
        canDecline: !mine,
        canPlay: !mine,
        headline,
        status: mine ? 'Aguardando resposta' : 'Convite para jogar agora',
      }
      : { ...idle, headline, status: 'Em partida' };
  }

  if (challenge.status === 'FIRST_PLAYER_ACTIVE') {
    return {
      ...idle,
      canCancel: mine,
      canResume: mine,
      headline,
      status: mine ? 'Em partida' : 'Desafiante jogando',
    };
  }
  if (challenge.status === 'WAITING_FOR_SECOND') {
    return {
      ...idle,
      canCancel: mine,
      canDecline: !mine,
      canPlay: !mine,
      headline,
      status: mine ? `Aguardando ${other.displayName}` : 'Pronto para jogar',
    };
  }
  if (challenge.status === 'SECOND_PLAYER_ACTIVE') {
    return {
      ...idle,
      headline,
      status: mine ? `${other.displayName} está jogando` : 'Em partida',
    };
  }
  return { ...idle, headline, status: 'Em partida' };
}
