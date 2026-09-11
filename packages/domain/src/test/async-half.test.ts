import { describe, expect, it } from 'vitest';
import {
  createAsyncHalfState,
  LIVE_ROUND_RESULT_MS,
  markAsyncHalfFinalized,
  projectAsyncHalf,
  QUESTION_DURATION_MS,
  questionsForDifficulty,
  RECONNECT_GRACE_MS,
  sealedAnswersOf,
  transitionAsyncHalf,
  type AsyncHalfCommand,
  type AsyncHalfState,
  type Difficulty,
  type LiveQuestion,
  type SealedRoundAnswer,
} from '../index.js';

const NOW = 1_700_000_000_000;

function questions(count: number): LiveQuestion[] {
  return Array.from({ length: count }, (_, index) => ({
    correctOption: index % 4,
    id: `q-${index + 1}`,
    imageUrl: null,
    options: ['A', 'B', 'C', 'D'] as [string, string, string, string],
    prompt: `Pergunta ${index + 1}?`,
    slot: index + 1,
  }));
}

const participant = (name: string) => ({
  customAvatarUrl: null,
  displayName: name,
  frameId: null,
  photoUrl: null,
});

function halfState(
  seat: 'FIRST' | 'SECOND',
  difficulty: Difficulty = 'EASY',
  sealedOpponent: SealedRoundAnswer[] | null = null,
): AsyncHalfState {
  return createAsyncHalfState({
    challengeId: 'challenge-1',
    createdAtMs: NOW,
    difficulty,
    opponent: participant('Ana'),
    questions: questions(questionsForDifficulty(difficulty)),
    seat,
    sealedOpponent,
    viewer: participant('Gomes'),
  });
}

function run(state: AsyncHalfState, command: AsyncHalfCommand, nowMs: number): AsyncHalfState {
  return transitionAsyncHalf(state, command, nowMs).state;
}

function sealed(scores: number[]): SealedRoundAnswer[] {
  return scores.map((score, index) => ({
    correct: score > 0,
    remainingMs: score > 0 ? (score - 10) * 1_000 : 0,
    score,
    selectedOption: index % 4,
  }));
}

describe('metade selada do desafio assíncrono', () => {
  it('exige exatamente a contagem da dificuldade e alternativa correta válida', () => {
    expect(() => createAsyncHalfState({
      challengeId: 'c', createdAtMs: NOW, difficulty: 'MEDIUM',
      opponent: participant('Ana'), questions: questions(5), seat: 'FIRST',
      sealedOpponent: null, viewer: participant('Gomes'),
    })).toThrow(/exige exatamente 8 perguntas/);
    expect(halfState('FIRST', 'EASY').questions).toHaveLength(5);
    expect(halfState('FIRST', 'MEDIUM').questions).toHaveLength(8);
    expect(halfState('FIRST', 'HARD').questions).toHaveLength(12);
  });

  it('a primeira metade nunca nasce conhecendo resposta do adversário', () => {
    expect(() => createAsyncHalfState({
      challengeId: 'c', createdAtMs: NOW, difficulty: 'EASY',
      opponent: participant('Ana'), questions: questions(5), seat: 'FIRST',
      sealedOpponent: sealed([20, 0, 0, 0, 0]), viewer: participant('Gomes'),
    })).toThrow(/não pode conhecer nenhuma resposta/);
    expect(() => createAsyncHalfState({
      challengeId: 'c', createdAtMs: NOW, difficulty: 'EASY',
      opponent: participant('Ana'), questions: questions(5), seat: 'SECOND',
      sealedOpponent: null, viewer: participant('Gomes'),
    })).toThrow(/exige a metade selada/);
  });

  it('pontua com a mesma regra da partida simultânea', () => {
    let state = run(halfState('FIRST'), { type: 'CONNECT' }, NOW);
    state = run(state, { roundNumber: 1, type: 'ROUND_READY' }, NOW);
    expect(state.phase).toBe('ANSWERING');

    // Acerto com 7 s restantes vale 10 + 7.
    state = run(state, {
      questionId: 'q-1', roundNumber: 1, selectedOption: 0, type: 'ANSWER',
    }, NOW + 3_000);
    expect(state.score).toBe(17);
    expect(state.phase).toBe('ROUND_RESULT');
    expect(state.answers[0]).toMatchObject({ correct: true, score: 17, submitted: true });
  });

  it('erro e timeout valem zero e o timeout não fica marcado como enviado', () => {
    let state = run(halfState('FIRST'), { type: 'CONNECT' }, NOW);
    state = run(state, { roundNumber: 1, type: 'ROUND_READY' }, NOW);
    state = run(state, {
      questionId: 'q-1', roundNumber: 1, selectedOption: 3, type: 'ANSWER',
    }, NOW + 1_000);
    expect(state.score).toBe(0);

    let timedOut = run(halfState('FIRST'), { type: 'CONNECT' }, NOW);
    timedOut = run(timedOut, { roundNumber: 1, type: 'ROUND_READY' }, NOW);
    timedOut = run(timedOut, { type: 'ALARM' }, NOW + QUESTION_DURATION_MS);
    expect(timedOut.score).toBe(0);
    expect(timedOut.answers[0]).toMatchObject({ selectedOption: null, submitted: false });
  });

  it('percorre todas as rodadas e finaliza a metade', () => {
    let state = run(halfState('FIRST', 'HARD'), { type: 'CONNECT' }, NOW);
    let now = NOW;
    for (let round = 1; round <= 12; round += 1) {
      state = run(state, { roundNumber: round, type: 'ROUND_READY' }, now);
      state = run(state, { type: 'ALARM' }, now + QUESTION_DURATION_MS);
      now += QUESTION_DURATION_MS;
      expect(state.phase).toBe('ROUND_RESULT');
      state = run(state, { type: 'ALARM' }, now + LIVE_ROUND_RESULT_MS);
      now += LIVE_ROUND_RESULT_MS;
    }
    expect(state.phase).toBe('FINALIZING');
    expect(sealedAnswersOf(state)).toHaveLength(12);
    expect(markAsyncHalfFinalized(state).phase).toBe('FINISHED');
  });

  it('aplica a graça exata do M8: 6999 retoma, 7000 e 7001 anulam', () => {
    const base = (() => {
      let state = run(halfState('FIRST'), { type: 'CONNECT' }, NOW);
      state = run(state, { roundNumber: 1, type: 'ROUND_READY' }, NOW);
      return run(state, { type: 'DISCONNECT' }, NOW + 2_000);
    })();
    expect(base.phase).toBe('PAUSED');
    expect(base.pause?.phaseRemainingMs).toBe(QUESTION_DURATION_MS - 2_000);

    const disconnectedAt = NOW + 2_000;
    const resumed = run(base, { type: 'CONNECT' }, disconnectedAt + RECONNECT_GRACE_MS - 1);
    expect(resumed.phase).toBe('ANSWERING');
    expect(resumed.phaseDeadlineMs).toBe(disconnectedAt + RECONNECT_GRACE_MS - 1 + (QUESTION_DURATION_MS - 2_000));

    for (const elapsed of [RECONNECT_GRACE_MS, RECONNECT_GRACE_MS + 1]) {
      expect(run(base, { type: 'ALARM' }, disconnectedAt + elapsed).phase).toBe('VOID');
      expect(run(base, { type: 'CONNECT' }, disconnectedAt + elapsed).phase).toBe('VOID');
    }
  });

  it('rejeita resposta fora da pergunta atual, repetida ou desconectada', () => {
    let state = run(halfState('FIRST'), { type: 'CONNECT' }, NOW);
    state = run(state, { roundNumber: 1, type: 'ROUND_READY' }, NOW);
    expect(() => transitionAsyncHalf(state, {
      questionId: 'q-2', roundNumber: 1, selectedOption: 0, type: 'ANSWER',
    }, NOW + 1_000)).toThrow(/não pertence à pergunta atual/);
    expect(() => transitionAsyncHalf(state, {
      questionId: 'q-1', roundNumber: 1, selectedOption: 9, type: 'ANSWER',
    }, NOW + 1_000)).toThrow(/alternativa válida/);

    const disconnected = run(state, { type: 'DISCONNECT' }, NOW + 1_000);
    expect(() => transitionAsyncHalf(disconnected, { roundNumber: 1, type: 'ROUND_READY' }, NOW + 1_500))
      .toThrow(/Reconecte antes/);
  });
});

describe('sigilo e revelação progressiva', () => {
  function secondHalfAtRound(round: number): AsyncHalfState {
    let state = run(halfState('SECOND', 'EASY', sealed([20, 0, 15, 11, 18])), { type: 'CONNECT' }, NOW);
    let now = NOW;
    for (let current = 1; current <= round; current += 1) {
      state = run(state, { roundNumber: current, type: 'ROUND_READY' }, now);
      state = run(state, {
        questionId: `q-${current}`, roundNumber: current, selectedOption: (current - 1) % 4, type: 'ANSWER',
      }, now + 2_000);
      now += 2_000;
      if (current < round) {
        state = run(state, { type: 'ALARM' }, now + LIVE_ROUND_RESULT_MS);
        now += LIVE_ROUND_RESULT_MS;
      }
    }
    return state;
  }

  it('na primeira metade nada do adversário existe e o placar dele não é inventado', () => {
    let state = run(halfState('FIRST'), { type: 'CONNECT' }, NOW);
    state = run(state, { roundNumber: 1, type: 'ROUND_READY' }, NOW);
    state = run(state, {
      questionId: 'q-1', roundNumber: 1, selectedOption: 0, type: 'ANSWER',
    }, NOW + 2_000);

    const projection = projectAsyncHalf(state, NOW + 2_000);
    expect(projection.opponentPending).toBe(true);
    expect(projection.opponent.score).toBe(0);
    expect(projection.opponent.answered).toBe(false);
    expect(projection.resolution?.opponent.selectedOption).toBeNull();
    expect(projection.resolution?.opponent.answered).toBe(false);
    expect(projection.resolution?.viewer.roundScore).toBe(18);
  });

  it('não revela a rodada do primeiro jogador enquanto o segundo não responde', () => {
    let state = run(halfState('SECOND', 'EASY', sealed([20, 0, 15, 11, 18])), { type: 'CONNECT' }, NOW);
    state = run(state, { roundNumber: 1, type: 'ROUND_READY' }, NOW);

    const projection = projectAsyncHalf(state, NOW + 1_000);
    expect(projection.opponentPending).toBeUndefined();
    expect(projection.resolution).toBeUndefined();
    expect(projection.opponent.score).toBe(0);
    // Nem a escolha, nem o tempo, nem o score do primeiro jogador atravessam.
    expect(JSON.stringify(projection)).not.toContain('"selectedOption"');
  });

  it('revela exatamente a rodada resolvida e o acumulado até ela, nunca o futuro', () => {
    const first = secondHalfAtRound(1);
    const firstProjection = projectAsyncHalf(first, NOW + 2_000);
    expect(firstProjection.resolution?.opponent).toMatchObject({ answered: true, correct: true, selectedOption: 0 });
    expect(firstProjection.opponent.score).toBe(20);

    const third = secondHalfAtRound(3);
    const thirdProjection = projectAsyncHalf(third, NOW + 20_000);
    // 20 + 0 + 15 das três rodadas resolvidas; as duas futuras não entram.
    expect(thirdProjection.opponent.score).toBe(35);
    expect(thirdProjection.round).toEqual({ number: 3, total: 5 });
  });

  it('o acumulado revelado nunca antecipa o placar final do primeiro jogador', () => {
    const total = sealed([20, 0, 15, 11, 18]).reduce((sum, answer) => sum + answer.score, 0);
    for (let round = 1; round <= 4; round += 1) {
      const projection = projectAsyncHalf(secondHalfAtRound(round), NOW + 60_000);
      expect(projection.opponent.score).toBeLessThan(total);
    }
    expect(projectAsyncHalf(secondHalfAtRound(5), NOW + 60_000).opponent.score).toBe(total);
  });
});
