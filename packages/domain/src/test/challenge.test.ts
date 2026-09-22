import { describe, expect, it } from 'vitest';
import {
  CHALLENGE_MODE,
  DIRECT_CHALLENGE_TIMEOUT_MS,
  availableChallengeKinds,
  acceptedStatus,
  canRevealFirstPlayerRound,
  challengePair,
  decideChallengeCreation,
  directChallengeExpired,
  directChallengeExpiresAt,
  isLiveChallenge,
  isTerminalChallenge,
  presenceAllowsDirectChallenge,
  revealableFirstPlayerScore,
  secondPlayerStarted,
  transitionChallenge,
  visibleFirstPlayerAnswers,
  type ChallengeRecord,
  type ChallengeStatus,
  type FriendPresence,
  type SealedRoundAnswer,
} from '../index.js';

const NOW = 1_700_000_000_000;

function challenge(overrides: Partial<ChallengeRecord> = {}): ChallengeRecord {
  return {
    difficulty: 'MEDIUM',
    expiresAtMs: null,
    firstPlayerUserId: 'user-a',
    id: 'challenge-1',
    kind: 'ASYNC',
    revision: 1,
    secondPlayerAgreed: false,
    secondPlayerUserId: 'user-b',
    status: 'WAITING_FOR_SECOND',
    themeId: 'theme-1',
    ...overrides,
  };
}

describe('desafio entre amigos', () => {
  it('é sempre Casual', () => {
    expect(CHALLENGE_MODE).toBe('CASUAL');
  });

  it('normaliza a dupla e recusa desafio contra si mesmo', () => {
    expect(challengePair('user-b', 'user-a')).toEqual(['user-a', 'user-b']);
    expect(challengePair('user-a', 'user-b')).toEqual(['user-a', 'user-b']);
    expect(() => challengePair('user-a', 'user-a')).toThrow(/dois usuários diferentes/);
  });

  it('libera desafio imediato só para amigo Online', () => {
    const cases: [FriendPresence, boolean][] = [
      ['ONLINE', true],
      ['MATCHMAKING', false],
      ['IN_MATCH', false],
      ['RECONNECTING', false],
      ['OFFLINE', false],
    ];
    for (const [presence, allowed] of cases) {
      expect(presenceAllowsDirectChallenge(presence)).toBe(allowed);
      expect(availableChallengeKinds(presence)).toEqual(allowed ? ['DIRECT', 'ASYNC'] : ['ASYNC']);
    }
  });

  it('expira o convite direto em exatamente 30 s', () => {
    expect(DIRECT_CHALLENGE_TIMEOUT_MS).toBe(30_000);
    const pending = challenge({
      expiresAtMs: directChallengeExpiresAt(NOW),
      kind: 'DIRECT',
      status: 'PENDING_DIRECT',
    });
    expect(pending.expiresAtMs).toBe(NOW + 30_000);
    expect(directChallengeExpired(pending, NOW + 29_999)).toBe(false);
    expect(directChallengeExpired(pending, NOW + 30_000)).toBe(true);
    expect(directChallengeExpired(pending, NOW + 30_001)).toBe(true);
  });

  it('assíncrono nunca expira', () => {
    const async = challenge({ expiresAtMs: null, status: 'WAITING_FOR_SECOND' });
    expect(directChallengeExpired(async, NOW + 10 * 24 * 3_600_000)).toBe(false);
    expect(() => transitionChallenge(async, { type: 'EXPIRE' }, NOW)).toThrow(/ainda está válido/);
  });

  it('classifica estados vivos e terminais sem sobreposição', () => {
    const statuses: ChallengeStatus[] = [
      'PENDING_DIRECT', 'PREPARING', 'ACTIVE', 'FIRST_PLAYER_ACTIVE',
      'WAITING_FOR_SECOND', 'SECOND_PLAYER_ACTIVE',
      'CANCELLED', 'DECLINED', 'EXPIRED', 'VOID', 'COMPLETED',
    ];
    for (const status of statuses) {
      expect(isLiveChallenge(status)).toBe(!isTerminalChallenge(status));
    }
  });

  it('define o estado após o aceite conforme a modalidade', () => {
    expect(acceptedStatus('DIRECT')).toBe('PREPARING');
    expect(acceptedStatus('ASYNC')).toBe('SECOND_PLAYER_ACTIVE');
  });
});

describe('bloqueio por dupla e desafio cruzado', () => {
  it('cria quando a dupla está livre ou o desafio anterior terminou', () => {
    expect(decideChallengeCreation({
      existing: null, nowMs: NOW, requestedKind: 'ASYNC', requesterUserId: 'user-a',
    })).toEqual({ kind: 'CREATE' });
    expect(decideChallengeCreation({
      existing: challenge({ status: 'COMPLETED' }), nowMs: NOW, requestedKind: 'DIRECT', requesterUserId: 'user-a',
    })).toEqual({ kind: 'CREATE' });
  });

  it('impede o mesmo desafiante de abrir um segundo desafio para a mesma pessoa', () => {
    expect(() => decideChallengeCreation({
      existing: challenge(), nowMs: NOW, requestedKind: 'ASYNC', requesterUserId: 'user-a',
    })).toThrow(/já tem um desafio em andamento/);
  });

  it('trata o convite direto cruzado como aceite do convite existente', () => {
    const pending = challenge({
      expiresAtMs: directChallengeExpiresAt(NOW), kind: 'DIRECT', status: 'PENDING_DIRECT',
    });
    expect(decideChallengeCreation({
      existing: pending, nowMs: NOW + 1_000, requestedKind: 'DIRECT', requesterUserId: 'user-b',
    })).toEqual({ challengeId: 'challenge-1', kind: 'ACCEPT_EXISTING_DIRECT' });
  });

  it('trata o assíncrono cruzado como concordância, preservando o primeiro jogador', () => {
    for (const status of ['FIRST_PLAYER_ACTIVE', 'WAITING_FOR_SECOND'] as const) {
      expect(decideChallengeCreation({
        existing: challenge({ status }), nowMs: NOW, requestedKind: 'ASYNC', requesterUserId: 'user-b',
      })).toEqual({ challengeId: 'challenge-1', kind: 'AGREE_WITH_EXISTING' });
    }
  });

  it('convite direto já expirado deixa a dupla livre para um novo desafio', () => {
    const stale = challenge({
      expiresAtMs: directChallengeExpiresAt(NOW), kind: 'DIRECT', status: 'PENDING_DIRECT',
    });
    expect(decideChallengeCreation({
      existing: stale, nowMs: NOW + 30_000, requestedKind: 'ASYNC', requesterUserId: 'user-a',
    })).toEqual({ kind: 'CREATE' });
  });

  it('não deixa o segundo jogador furar um desafio que já está em partida', () => {
    expect(() => decideChallengeCreation({
      existing: challenge({ status: 'SECOND_PLAYER_ACTIVE' }),
      nowMs: NOW, requestedKind: 'ASYNC', requesterUserId: 'user-b',
    })).toThrow(/Já existe um desafio em andamento/);
  });
});

describe('cancelamento, recusa e fim de relacionamento', () => {
  it('deixa o desafiante cancelar e o desafiado recusar antes do início', () => {
    expect(transitionChallenge(challenge(), { actorUserId: 'user-a', type: 'CANCEL' }, NOW))
      .toEqual({ cleanupPayload: true, status: 'CANCELLED' });
    expect(transitionChallenge(challenge(), { actorUserId: 'user-b', type: 'DECLINE' }, NOW))
      .toEqual({ cleanupPayload: true, status: 'DECLINED' });
  });

  it('não troca os papéis de cancelar e recusar', () => {
    expect(() => transitionChallenge(challenge(), { actorUserId: 'user-b', type: 'CANCEL' }, NOW))
      .toThrow(/Só quem desafiou pode cancelar/);
    expect(() => transitionChallenge(challenge(), { actorUserId: 'user-a', type: 'DECLINE' }, NOW))
      .toThrow(/Só quem foi desafiado pode recusar/);
  });

  it('recusa qualquer ação de quem não participa', () => {
    expect(() => transitionChallenge(challenge(), { actorUserId: 'user-c', type: 'CANCEL' }, NOW))
      .toThrow(/não pertence a você/);
  });

  it('o cancelamento tem precedência até o segundo jogador começar', () => {
    expect(secondPlayerStarted('WAITING_FOR_SECOND')).toBe(false);
    expect(secondPlayerStarted('SECOND_PLAYER_ACTIVE')).toBe(true);
    expect(secondPlayerStarted('ACTIVE')).toBe(true);

    const started = challenge({ status: 'SECOND_PLAYER_ACTIVE' });
    expect(() => transitionChallenge(started, { actorUserId: 'user-a', type: 'CANCEL' }, NOW))
      .toThrow(/já começou/);
    expect(() => transitionChallenge(started, { actorUserId: 'user-b', type: 'DECLINE' }, NOW))
      .toThrow(/já começou/);
  });

  it('desfazer amizade ou bloquear encerra o pendente e limpa o payload', () => {
    expect(transitionChallenge(challenge(), { type: 'RELATIONSHIP_ENDED' }, NOW))
      .toEqual({ cleanupPayload: true, status: 'CANCELLED' });
  });

  it('desfazer amizade ou bloquear não derruba partida já iniciada', () => {
    for (const status of ['PREPARING', 'ACTIVE', 'SECOND_PLAYER_ACTIVE'] as const) {
      expect(() => transitionChallenge(challenge({ status }), { type: 'RELATIONSHIP_ENDED' }, NOW))
        .toThrow(/já começou/);
    }
  });

  it('expira o convite direto sem tratar como recusa', () => {
    const pending = challenge({
      expiresAtMs: directChallengeExpiresAt(NOW), kind: 'DIRECT', status: 'PENDING_DIRECT',
    });
    expect(transitionChallenge(pending, { type: 'EXPIRE' }, NOW + 30_000))
      .toEqual({ cleanupPayload: true, status: 'EXPIRED' });
    expect(() => transitionChallenge(pending, { type: 'EXPIRE' }, NOW + 29_999)).toThrow(/ainda está válido/);
  });

  it('DIRECT já aceito (PREPARING) nunca é cancelado, recusado ou encerrado por relacionamento', () => {
    const accepted = challenge({ kind: 'DIRECT', status: 'PREPARING' });
    expect(() => transitionChallenge(accepted, { actorUserId: 'user-a', type: 'CANCEL' }, NOW))
      .toThrow(/já começou/);
    expect(() => transitionChallenge(accepted, { actorUserId: 'user-b', type: 'DECLINE' }, NOW))
      .toThrow(/já começou/);
    expect(() => transitionChallenge(accepted, { type: 'RELATIONSHIP_ENDED' }, NOW))
      .toThrow(/já começou/);
  });

  it('nenhuma ação reabre um desafio já encerrado', () => {
    for (const status of ['CANCELLED', 'DECLINED', 'EXPIRED', 'VOID', 'COMPLETED'] as const) {
      expect(() => transitionChallenge(challenge({ status }), { actorUserId: 'user-a', type: 'CANCEL' }, NOW))
        .toThrow(/já foi encerrado/);
    }
  });
});

describe('sigilo do desafio assíncrono', () => {
  const sealed: SealedRoundAnswer[] = [
    { correct: true, remainingMs: 7_000, score: 17, selectedOption: 0 },
    { correct: false, remainingMs: 3_000, score: 0, selectedOption: 2 },
    { correct: true, remainingMs: 9_100, score: 20, selectedOption: 1 },
  ];

  it('não revela nenhuma rodada antes do segundo jogador resolver', () => {
    expect(visibleFirstPlayerAnswers(sealed, 0)).toEqual([null, null, null]);
    expect(revealableFirstPlayerScore(sealed, 0)).toBe(0);
    expect(canRevealFirstPlayerRound(1, 0)).toBe(false);
  });

  it('revela exatamente as rodadas já resolvidas, nunca as futuras', () => {
    expect(visibleFirstPlayerAnswers(sealed, 2)).toEqual([sealed[0], sealed[1], null]);
    expect(canRevealFirstPlayerRound(2, 2)).toBe(true);
    expect(canRevealFirstPlayerRound(3, 2)).toBe(false);
  });

  it('o acumulado revelável nunca antecipa o placar final', () => {
    expect(revealableFirstPlayerScore(sealed, 1)).toBe(17);
    expect(revealableFirstPlayerScore(sealed, 2)).toBe(17);
    expect(revealableFirstPlayerScore(sealed, 3)).toBe(37);
    // Mesmo pedindo mais rodadas do que existem, nada além do total é revelado.
    expect(revealableFirstPlayerScore(sealed, 99)).toBe(37);
  });

  it('rejeita contagens inválidas em vez de revelar por engano', () => {
    expect(() => revealableFirstPlayerScore(sealed, -1)).toThrow(/inválidas/);
    expect(canRevealFirstPlayerRound(0, 3)).toBe(false);
  });
});
