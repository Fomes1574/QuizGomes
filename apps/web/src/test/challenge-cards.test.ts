import { describe, expect, it } from 'vitest';
import { challengeCardCopy, type ChallengeStatus, type ChallengeView } from '../lib/challenges.js';

const ana = {
  customAvatarUrl: null,
  displayName: 'Ana',
  frameId: null,
  photoUrl: null,
  publicId: '#QGANA1',
};
const gomes = {
  customAvatarUrl: null,
  displayName: 'Gomes',
  frameId: null,
  photoUrl: null,
  publicId: '#QGGOM1',
};

function view(overrides: Partial<ChallengeView> = {}): ChallengeView {
  return {
    challenged: ana,
    challenger: gomes,
    expiresAt: null,
    id: 'challenge-1',
    kind: 'ASYNC',
    role: 'CHALLENGER',
    roomId: null,
    status: 'FIRST_PLAYER_ACTIVE',
    theme: { name: 'Elden Ring', slug: 'elden-ring' },
    ...overrides,
  };
}

describe('texto e ações do card de desafio', () => {
  it('descreve o desafio pelo nome do tema, sem dificuldade', () => {
    expect(challengeCardCopy(view()).headline)
      .toBe('Você desafiou Ana');
    expect(challengeCardCopy(view({ role: 'CHALLENGED' })).headline)
      .toBe('Gomes te desafiou');
    expect(challengeCardCopy(view()).subtitle).toBe('Elden Ring');
  });

  it('não concatena status de gameplay na descrição', () => {
    const statuses: ChallengeStatus[] = [
      'FIRST_PLAYER_ACTIVE', 'WAITING_FOR_SECOND', 'SECOND_PLAYER_ACTIVE', 'PENDING_DIRECT',
    ];
    for (const status of statuses) {
      for (const role of ['CHALLENGER', 'CHALLENGED'] as const) {
        const copy = challengeCardCopy(view({ role, status }));
        expect(copy.headline.toLowerCase()).not.toMatch(/aguardando|em partida|jogando/);
        expect(copy.subtitle.toLowerCase()).not.toMatch(/aguardando|em partida|jogando/);
      }
    }
  });

  it('ASYNC FIRST_PLAYER_ACTIVE: desafiante retoma, desafiado só observa', () => {
    const challenger = challengeCardCopy(view({ status: 'FIRST_PLAYER_ACTIVE' }));
    expect(challenger.canResume).toBe(true);
    expect(challenger.canCancel).toBe(true);

    const challenged = challengeCardCopy(view({ role: 'CHALLENGED', status: 'FIRST_PLAYER_ACTIVE' }));
    // Jogar só aparece depois que a primeira metade estiver selada.
    expect(challenged.canPlay).toBe(false);
    expect(challenged.canResume).toBe(false);
  });

  it('ASYNC WAITING_FOR_SECOND: desafiado ganha Jogar e Recusar', () => {
    const challenger = challengeCardCopy(view({ status: 'WAITING_FOR_SECOND' }));
    expect(challenger.canPlay).toBe(false);
    expect(challenger.canResume).toBe(false);

    const challenged = challengeCardCopy(view({ role: 'CHALLENGED', status: 'WAITING_FOR_SECOND' }));
    expect(challenged.canPlay).toBe(true);
    expect(challenged.canDecline).toBe(true);
  });

  it('ASYNC SECOND_PLAYER_ACTIVE: ninguém cancela e ninguém recusa', () => {
    const challenger = challengeCardCopy(view({ status: 'SECOND_PLAYER_ACTIVE' }));
    expect(challenger.canCancel).toBe(false);

    const challenged = challengeCardCopy(view({ role: 'CHALLENGED', status: 'SECOND_PLAYER_ACTIVE' }));
    expect(challenged.canDecline).toBe(false);
    expect(challenged.canPlay).toBe(false);
  });

  it('DIRECT pendente distingue quem espera de quem foi convidado', () => {
    const challenger = challengeCardCopy(view({ kind: 'DIRECT', status: 'PENDING_DIRECT' }));
    expect(challenger.canCancel).toBe(true);

    const challenged = challengeCardCopy(view({ kind: 'DIRECT', role: 'CHALLENGED', status: 'PENDING_DIRECT' }));
    expect(challenged.canPlay).toBe(true);
    expect(challenged.canDecline).toBe(true);
  });

  it('nunca expõe progresso, número de pergunta ou score parcial do adversário', () => {
    const statuses: ChallengeStatus[] = [
      'FIRST_PLAYER_ACTIVE', 'WAITING_FOR_SECOND', 'SECOND_PLAYER_ACTIVE', 'PENDING_DIRECT',
    ];
    for (const status of statuses) {
      for (const role of ['CHALLENGER', 'CHALLENGED'] as const) {
        const copy = challengeCardCopy(view({ role, status }));
        expect(copy.headline).not.toMatch(/\d/);
        expect(copy.subtitle.toLowerCase()).not.toMatch(/pergunta|ponto|placar|score/);
      }
    }
  });
});
