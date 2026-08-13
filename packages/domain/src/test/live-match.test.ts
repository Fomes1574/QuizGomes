import {
  createLiveMatchState,
  LIVE_PREPARATION_MS,
  LIVE_ROUND_RESULT_MS,
  projectLiveMatchForSeat,
  projectLiveMatchPresentationForSeat,
  QUESTION_DURATION_MS,
  RECONNECT_GRACE_MS,
  transitionLiveMatch,
  type Difficulty,
  type LiveMatchState,
  type LiveQuestion,
} from '../index.js';
import { describe, expect, it } from 'vitest';

function questions(difficulty: Difficulty): LiveQuestion[] {
  const count = difficulty === 'EASY' ? 5 : difficulty === 'MEDIUM' ? 10 : 15;
  return Array.from({ length: count }, (_, index) => ({
    correctOption: index % 4,
    id: `q-${index + 1}`,
    imageUrl: null,
    options: [`A${index}`, `B${index}`, `C${index}`, `D${index}`],
    prompt: `Pergunta sintética ${index + 1}?`,
    slot: index + 1,
  }));
}

function match(difficulty: Difficulty = 'EASY'): LiveMatchState {
  return createLiveMatchState({
    createdAtMs: 1_000,
    difficulty,
    matchId: 'match-1',
    mode: 'RANKED',
    players: [
      { customAvatarUrl: null, displayName: 'Jogador 1', firebaseUid: 'firebase-1', frameId: null, knowledgeBefore: 2_500, photoUrl: null, userId: 'user-1' },
      { customAvatarUrl: null, displayName: 'Jogador 2', firebaseUid: 'firebase-2', frameId: null, knowledgeBefore: 5_000, photoUrl: null, userId: 'user-2' },
    ],
    poolId: 'pool-1',
    poolVersion: 1,
    questions: questions(difficulty),
    themeId: 'theme-1',
  });
}

function command(state: LiveMatchState, input: Parameters<typeof transitionLiveMatch>[1], nowMs: number): LiveMatchState {
  return transitionLiveMatch(state, input, nowMs).state;
}

function startFirstRound(difficulty: Difficulty = 'EASY'): { now: number; state: LiveMatchState } {
  let state = match(difficulty);
  state = command(state, { seat: 1, type: 'CONNECT' }, 1_100);
  state = command(state, { seat: 2, type: 'CONNECT' }, 1_101);
  state = command(state, { seat: 1, type: 'LOBBY_READY' }, 1_102);
  state = command(state, { seat: 2, type: 'LOBBY_READY' }, 1_103);
  expect(state.phase).toBe('PREPARING');
  const preparationEnds = 1_103 + LIVE_PREPARATION_MS;
  state = command(state, { type: 'ALARM' }, preparationEnds);
  expect(state.phase).toBe('ROUND_READY');
  state = command(state, { roundNumber: 1, seat: 1, type: 'ROUND_READY' }, preparationEnds + 1);
  state = command(state, { roundNumber: 1, seat: 2, type: 'ROUND_READY' }, preparationEnds + 2);
  expect(state.phase).toBe('ANSWERING');
  return { now: preparationEnds + 2, state };
}

describe('partida simultânea autoritativa', () => {
  it('só inicia os 10 segundos depois de ambos READY na rodada', () => {
    let state = match();
    state = command(state, { seat: 1, type: 'CONNECT' }, 1_100);
    state = command(state, { seat: 2, type: 'CONNECT' }, 1_101);
    state = command(state, { seat: 1, type: 'LOBBY_READY' }, 1_102);
    expect(state.phase).toBe('LOBBY');
    expect(state.phaseDeadlineMs).toBe(1_102 + RECONNECT_GRACE_MS);
    state = command(state, { seat: 2, type: 'LOBBY_READY' }, 1_103);
    state = command(state, { type: 'ALARM' }, 1_103 + LIVE_PREPARATION_MS);
    const deliveredAt = 1_103 + LIVE_PREPARATION_MS;
    expect(state.phase).toBe('ROUND_READY');
    expect(projectLiveMatchForSeat(state, 1, deliveredAt).remainingMs).toBe(RECONNECT_GRACE_MS);
    state = command(state, { roundNumber: 1, seat: 1, type: 'ROUND_READY' }, deliveredAt + 1);
    expect(state.phase).toBe('ROUND_READY');
    state = command(state, { roundNumber: 1, seat: 2, type: 'ROUND_READY' }, deliveredAt + 2);
    expect(state.phase).toBe('ANSWERING');
    expect(state.phaseDeadlineMs).toBe(deliveredAt + 2 + QUESTION_DURATION_MS);
  });

  it('retoma a preparação quando o jogador já pronto reconecta no lobby', () => {
    let state = match();
    state = command(state, { seat: 1, type: 'CONNECT' }, 1_100);
    state = command(state, { seat: 2, type: 'CONNECT' }, 1_101);
    state = command(state, { seat: 1, type: 'LOBBY_READY' }, 1_102);
    state = command(state, { seat: 1, type: 'DISCONNECT' }, 1_103);
    state = command(state, { seat: 2, type: 'LOBBY_READY' }, 1_104);
    expect(state.phase).toBe('LOBBY');
    state = command(state, { seat: 1, type: 'CONNECT' }, 1_105);
    expect(state.phase).toBe('PREPARING');
    expect(state.phaseDeadlineMs).toBe(1_105 + LIVE_PREPARATION_MS);
  });

  it('entrega somente a pergunta pública atual', () => {
    const { now, state } = startFirstRound();
    const projection = projectLiveMatchForSeat(state, 1, now);
    expect(projection.round).toEqual({ number: 1, total: 5 });
    expect(projection.question?.id).toBe('q-1');
    expect(JSON.stringify(projection)).not.toContain('correctOption');
    expect(JSON.stringify(projection)).not.toContain('q-2');
  });

  it('projeta apresentação individual com adversário real, elo temático e somente a primeira pergunta pública', () => {
    const state = match();
    state.players[1].customAvatarUrl = '/api/avatars/user-2/v3.webp';
    state.players[1].frameId = 'frame-real';
    const presentation = projectLiveMatchPresentationForSeat(state, 1);

    expect(presentation.opponent).toEqual({
      customAvatarUrl: '/api/avatars/user-2/v3.webp',
      displayName: 'Jogador 2',
      frameId: 'frame-real',
      knowledge: 5_000,
      photoUrl: null,
    });
    expect(presentation.preload.firstQuestion.id).toBe('q-1');
    expect(JSON.stringify(presentation)).not.toContain('correctOption');
    expect(JSON.stringify(presentation)).not.toContain('q-2');
    expect(JSON.stringify(presentation)).not.toContain('selectedOption');
  });

  it('calcula score no servidor, sela a escolha durante ANSWERING e a revela somente na resolução', () => {
    const started = startFirstRound();
    const deadline = started.state.phaseDeadlineMs ?? 0;
    let state = command(started.state, {
      questionId: 'q-1', roundNumber: 1, seat: 1, selectedOption: 0, type: 'ANSWER',
    }, deadline - 8_100);
    const whileSecondThinks = projectLiveMatchForSeat(state, 2, deadline - 8_000);
    expect(whileSecondThinks.opponent).toEqual(expect.objectContaining({ answered: true, score: 0 }));
    expect(whileSecondThinks.opponent).not.toHaveProperty('correct');
    expect(whileSecondThinks.opponent).not.toHaveProperty('selectedOption');
    expect(whileSecondThinks).not.toHaveProperty('resolution');

    state = command(state, {
      questionId: 'q-1', roundNumber: 1, seat: 2, selectedOption: 3, type: 'ANSWER',
    }, deadline - 4_100);
    expect(state.phase).toBe('ROUND_RESULT');
    expect(state.players.map((player) => player.score)).toEqual([19, 0]);
    const resolved = projectLiveMatchForSeat(state, 2, deadline - 4_100);
    expect(resolved.resolution).toEqual({
      correctOption: 0,
      opponent: { answered: true, correct: true, score: 19, selectedOption: 0 },
      viewer: { correct: false, roundScore: 0, score: 0, selectedOption: 3 },
    });
    expect(resolved.opponent).not.toHaveProperty('correct');
    expect(resolved.opponent).not.toHaveProperty('selectedOption');

    const winnerView = projectLiveMatchForSeat(state, 1, deadline - 4_100);
    expect(winnerView.resolution).toEqual({
      correctOption: 0,
      opponent: { answered: true, correct: false, score: 0, selectedOption: 3 },
      viewer: { correct: true, roundScore: 19, score: 19, selectedOption: 0 },
    });

    const pausedResult = command(state, { seat: 1, type: 'DISCONNECT' }, deadline - 4_000);
    expect(pausedResult.pause?.phase).toBe('ROUND_RESULT');
    expect(projectLiveMatchForSeat(pausedResult, 2, deadline - 3_900).resolution).toEqual(resolved.resolution);
  });

  it('projeta selectedOption nulo para ambos quando a rodada termina por timeout sem resposta', () => {
    const started = startFirstRound();
    const deadline = started.state.phaseDeadlineMs ?? 0;
    const state = command(started.state, { type: 'ALARM' }, deadline);
    const resolved = projectLiveMatchForSeat(state, 1, deadline);

    expect(resolved.resolution).toEqual({
      correctOption: 0,
      opponent: { answered: false, correct: false, score: 0, selectedOption: null },
      viewer: { correct: false, roundScore: 0, score: 0, selectedOption: null },
    });
  });

  it.each([['EASY', 5], ['MEDIUM', 10], ['HARD', 15]] as const)(
    'finaliza %s após exatamente %i perguntas e aceita empate real',
    (difficulty, total) => {
      let { now, state } = startFirstRound(difficulty);
      for (let round = 1; round <= total; round += 1) {
        const answerDeadline = state.phaseDeadlineMs ?? now;
        state = command(state, { type: 'ALARM' }, answerDeadline);
        expect(state.players[0].score).toBe(0);
        expect(state.players[1].score).toBe(0);
        const resultDeadline = state.phaseDeadlineMs ?? answerDeadline;
        state = command(state, { type: 'ALARM' }, resultDeadline);
        now = resultDeadline;
        if (round < total) {
          expect(state.roundIndex + 1).toBe(round + 1);
          state = command(state, { roundNumber: round + 1, seat: 1, type: 'ROUND_READY' }, now + 1);
          state = command(state, { roundNumber: round + 1, seat: 2, type: 'ROUND_READY' }, now + 2);
          now += 2;
        }
      }
      expect(state.phase).toBe('FINALIZING');
      expect(state.pendingOutcome).toEqual({ kind: 'COMPLETED', reason: 'COMPLETED' });
      expect(state.roundIndex + 1).toBe(total);
    },
  );

  it('pausa integralmente e restaura o remainingMs sem renovar a rodada', () => {
    const started = startFirstRound();
    const deadline = started.state.phaseDeadlineMs ?? 0;
    const disconnectedAt = deadline - 6_500;
    let state = command(started.state, { seat: 1, type: 'DISCONNECT' }, disconnectedAt);
    expect(state.phase).toBe('PAUSED');
    expect(state.pause?.phaseRemainingMs).toBe(6_500);
    const reconnectedAt = disconnectedAt + 5_000;
    state = command(state, { seat: 1, type: 'CONNECT' }, reconnectedAt);
    expect(state.phase).toBe('ANSWERING');
    expect(state.phaseDeadlineMs).toBe(reconnectedAt + 6_500);
  });

  it('aguarda 7 segundos exatos, pune somente queda individual e não pune queda dupla', () => {
    const started = startFirstRound();
    const disconnectedAt = started.now + 100;
    let state = command(started.state, { seat: 1, type: 'DISCONNECT' }, disconnectedAt);
    state = command(state, { type: 'ALARM' }, disconnectedAt + RECONNECT_GRACE_MS - 1);
    expect(state.phase).toBe('PAUSED');
    state = command(state, { type: 'ALARM' }, disconnectedAt + RECONNECT_GRACE_MS);
    expect(state.pendingOutcome).toEqual({ kind: 'VOID', penalizedSeat: 1, reason: 'INDIVIDUAL_DISCONNECT' });

    let doubleDrop = command(started.state, { seat: 1, type: 'DISCONNECT' }, disconnectedAt);
    doubleDrop = command(doubleDrop, { seat: 2, type: 'DISCONNECT' }, disconnectedAt + 1);
    expect(doubleDrop.pendingOutcome).toEqual({ kind: 'VOID', penalizedSeat: null, reason: 'SYSTEM_FAILURE' });
  });

  it('rejeita estado inválido, pergunta divergente e double-submit', () => {
    let state = match();
    state = command(state, { seat: 1, type: 'CONNECT' }, 1_100);
    expect(() => transitionLiveMatch(state, { roundNumber: 1, seat: 1, type: 'ROUND_READY' }, 1_101))
      .toThrowError(expect.objectContaining({ code: 'INVALID_ROUND_READY' }));

    const started = startFirstRound();
    expect(() => transitionLiveMatch(started.state, {
      questionId: 'q-futura', roundNumber: 1, seat: 1, selectedOption: 0, type: 'ANSWER',
    }, started.now + 1)).toThrowError(expect.objectContaining({ code: 'INVALID_QUESTION' }));
    state = command(started.state, {
      questionId: 'q-1', roundNumber: 1, seat: 1, selectedOption: 0, type: 'ANSWER',
    }, started.now + 1);
    expect(() => transitionLiveMatch(state, {
      questionId: 'q-1', roundNumber: 1, seat: 1, selectedOption: 0, type: 'ANSWER',
    }, started.now + 2)).toThrowError(expect.objectContaining({ code: 'ANSWER_ALREADY_SUBMITTED' }));
  });

  it('cancela antes do início sem penalidade e trata saída durante jogo como abandono', () => {
    let state = match();
    state = command(state, { seat: 1, type: 'CONNECT' }, 1_100);
    state = command(state, { seat: 1, type: 'CANCEL' }, 1_101);
    expect(state.pendingOutcome).toEqual({ kind: 'VOID', penalizedSeat: null, reason: 'CANCELLED' });

    const started = startFirstRound();
    state = command(started.state, { seat: 2, type: 'CANCEL' }, started.now + 1);
    expect(state.pendingOutcome).toEqual({ kind: 'VOID', penalizedSeat: 2, reason: 'INDIVIDUAL_ABANDONMENT' });
  });

  it('mantém o resultado visível por 2,4 segundos exatos antes da próxima pergunta', () => {
    const started = startFirstRound();
    const deadline = started.state.phaseDeadlineMs ?? 0;
    let state = command(started.state, { type: 'ALARM' }, deadline);
    const revealEnds = state.phaseDeadlineMs ?? 0;
    expect(LIVE_ROUND_RESULT_MS).toBe(2_400);
    expect(revealEnds).toBe(deadline + LIVE_ROUND_RESULT_MS);
    state = command(state, { type: 'ALARM' }, revealEnds - 1);
    expect(state.phase).toBe('ROUND_RESULT');
    state = command(state, { type: 'ALARM' }, revealEnds);
    expect(state.phase).toBe('ROUND_READY');
  });
});
