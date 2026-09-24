import { canRevealFirstPlayerRound, CHALLENGE_MODE, type SealedRoundAnswer } from './challenge.js';
import { RECONNECT_GRACE_MS } from '../match/connection.js';
import { LIVE_ROUND_RESULT_MS, type LiveMatchProjection, type LiveQuestion } from '../match/live-match.js';
import { publicQuestion } from '../match/projection.js';
import { questionsForMode } from '../match/rules.js';
import { QUESTION_DURATION_MS, remainingAt, scoreAnswer } from '../match/scoring.js';

/**
 * Metade selada do desafio assíncrono: um jogador por vez contra o relógio.
 *
 * Reutiliza integralmente as primitivas competitivas do M8 — `QUESTION_DURATION_MS`,
 * `scoreAnswer`, `remainingAt`, `LIVE_ROUND_RESULT_MS` e a graça exata de
 * `RECONNECT_GRACE_MS` — em vez de recriar scoring, timer ou reconexão. A projeção
 * sai no mesmo formato da partida simultânea para a tela de jogo ser a mesma.
 */

export type AsyncHalfPhase =
  | 'ANSWERING'
  | 'CANCELLED'
  | 'FINALIZING'
  | 'FINISHED'
  | 'PAUSED'
  | 'ROUND_READY'
  | 'ROUND_RESULT'
  | 'VOID';

type PausablePhase = 'ANSWERING' | 'ROUND_READY' | 'ROUND_RESULT';

export type AsyncHalfSeat = 'FIRST' | 'SECOND';

export interface AsyncHalfAnswer extends SealedRoundAnswer {
  answeredAtMs: number;
  submitted: boolean;
}

export interface AsyncHalfParticipant {
  customAvatarUrl: string | null;
  displayName: string;
  frameId: string | null;
  photoUrl: string | null;
}

export interface AsyncHalfPause {
  graceDeadlineMs: number;
  phase: PausablePhase;
  phaseRemainingMs: number;
}

export interface AsyncHalfState {
  answers: (AsyncHalfAnswer | null)[];
  challengeId: string;
  connected: boolean;
  opponent: AsyncHalfParticipant;
  pause: AsyncHalfPause | null;
  phase: AsyncHalfPhase;
  phaseDeadlineMs: number | null;
  questions: readonly LiveQuestion[];
  roundIndex: number;
  score: number;
  seat: AsyncHalfSeat;
  /** Metade já selada do primeiro jogador; presente somente na metade do segundo. */
  sealedOpponent: readonly SealedRoundAnswer[] | null;
  startedAtMs: number | null;
  version: 1;
  viewer: AsyncHalfParticipant;
}

export type AsyncHalfCommand =
  | { type: 'ALARM' }
  | { type: 'CANCEL' }
  | { type: 'CONNECT' }
  | { type: 'DISCONNECT' }
  | { questionId: string; roundNumber: number; selectedOption: number; type: 'ANSWER' }
  | { roundNumber: number; type: 'ROUND_READY' }
  | { type: 'SYSTEM_FAILURE' };

export type AsyncHalfEvent =
  | { type: 'CANCELLED' }
  | { type: 'CONNECTED' }
  | { type: 'FINALIZE' }
  | { type: 'NOOP' }
  | { type: 'PAUSED' }
  | { type: 'QUESTION_AVAILABLE' }
  | { type: 'RESUMED' }
  | { type: 'ROUND_RESOLVED' }
  | { type: 'ROUND_STARTED' };

export interface AsyncHalfTransition {
  event: AsyncHalfEvent;
  state: AsyncHalfState;
}

export class AsyncHalfCommandError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'AsyncHalfCommandError';
  }
}

function pausablePhase(phase: AsyncHalfPhase): PausablePhase | null {
  return phase === 'ROUND_READY' || phase === 'ANSWERING' || phase === 'ROUND_RESULT' ? phase : null;
}

/** Fases que não aceitam mais nenhuma ação do jogador. */
export function isTerminalHalf(phase: AsyncHalfPhase): boolean {
  return phase === 'FINISHED' || phase === 'VOID' || phase === 'CANCELLED';
}

function assertNow(nowMs: number): void {
  if (!Number.isFinite(nowMs) || nowMs < 0) throw new RangeError('Tempo do servidor inválido.');
}

function cloneState(state: AsyncHalfState): AsyncHalfState {
  return {
    ...state,
    answers: state.answers.map((answer) => (answer === null ? null : { ...answer })),
    opponent: { ...state.opponent },
    pause: state.pause === null ? null : { ...state.pause },
    viewer: { ...state.viewer },
  };
}

function currentQuestion(state: AsyncHalfState): LiveQuestion {
  const question = state.questions[state.roundIndex];
  if (question === undefined) throw new Error('Rodada sem pergunta autoritativa.');
  return question;
}

function beginRoundReady(state: AsyncHalfState, nowMs: number): AsyncHalfTransition {
  state.phase = 'ROUND_READY';
  state.phaseDeadlineMs = nowMs + RECONNECT_GRACE_MS;
  return { event: { type: 'QUESTION_AVAILABLE' }, state };
}

function finalize(
  state: AsyncHalfState,
  phase: 'CANCELLED' | 'FINALIZING' | 'VOID',
): AsyncHalfTransition {
  state.phase = phase;
  state.phaseDeadlineMs = null;
  state.pause = null;
  return { event: { type: phase === 'CANCELLED' ? 'CANCELLED' : 'FINALIZE' }, state };
}

function resolveRound(state: AsyncHalfState, nowMs: number): AsyncHalfTransition {
  if (state.answers[state.roundIndex] == null) {
    state.answers[state.roundIndex] = {
      answeredAtMs: nowMs,
      correct: false,
      remainingMs: 0,
      score: 0,
      selectedOption: null,
      submitted: false,
    };
  }
  state.score += state.answers[state.roundIndex]?.score ?? 0;
  state.phase = 'ROUND_RESULT';
  state.phaseDeadlineMs = nowMs + LIVE_ROUND_RESULT_MS;
  return { event: { type: 'ROUND_RESOLVED' }, state };
}

function alarm(state: AsyncHalfState, nowMs: number): AsyncHalfTransition {
  if (state.phase === 'PAUSED') {
    const pause = state.pause;
    if (pause === null) throw new Error('Pausa sem estado preservado.');
    // Limites exatos do M8: 6999 ainda retoma, 7000 e 7001 anulam.
    return nowMs < pause.graceDeadlineMs
      ? { event: { type: 'NOOP' }, state }
      : finalize(state, 'VOID');
  }
  if (state.phaseDeadlineMs === null || nowMs < state.phaseDeadlineMs) {
    return { event: { type: 'NOOP' }, state };
  }
  if (state.phase === 'ROUND_READY') return finalize(state, 'VOID');
  if (state.phase === 'ANSWERING') return resolveRound(state, nowMs);
  if (state.phase === 'ROUND_RESULT') {
    if (state.roundIndex + 1 >= state.questions.length) return finalize(state, 'FINALIZING');
    state.roundIndex += 1;
    return beginRoundReady(state, nowMs);
  }
  return { event: { type: 'NOOP' }, state };
}

export function createAsyncHalfState(input: {
  challengeId: string;
  createdAtMs: number;
  opponent: AsyncHalfParticipant;
  questions: readonly LiveQuestion[];
  seat: AsyncHalfSeat;
  sealedOpponent: readonly SealedRoundAnswer[] | null;
  viewer: AsyncHalfParticipant;
}): AsyncHalfState {
  assertNow(input.createdAtMs);
  // Desafio entre amigos é sempre Casual (CHALLENGE_MODE): 7 perguntas fixas.
  const expected = questionsForMode(CHALLENGE_MODE);
  if (input.questions.length !== expected) {
    throw new RangeError(`O desafio exige exatamente ${expected} perguntas.`);
  }
  if (input.seat === 'SECOND' && input.sealedOpponent === null) {
    throw new Error('A segunda metade exige a metade selada do primeiro jogador.');
  }
  if (input.seat === 'FIRST' && input.sealedOpponent !== null) {
    throw new Error('A primeira metade não pode conhecer nenhuma resposta do adversário.');
  }
  for (const question of input.questions) {
    if (!Number.isInteger(question.correctOption) || question.correctOption < 0 || question.correctOption > 3) {
      throw new RangeError('Pergunta com alternativa correta inválida.');
    }
  }
  return {
    answers: Array.from({ length: input.questions.length }, () => null),
    challengeId: input.challengeId,
    connected: false,
    opponent: input.opponent,
    pause: null,
    phase: 'ROUND_READY',
    phaseDeadlineMs: input.createdAtMs + RECONNECT_GRACE_MS,
    questions: input.questions,
    roundIndex: 0,
    score: 0,
    seat: input.seat,
    sealedOpponent: input.sealedOpponent,
    startedAtMs: null,
    version: 1,
    viewer: input.viewer,
  };
}

export function transitionAsyncHalf(
  current: AsyncHalfState,
  command: AsyncHalfCommand,
  nowMs: number,
): AsyncHalfTransition {
  assertNow(nowMs);
  const state = cloneState(current);

  if (command.type === 'ALARM') return alarm(state, nowMs);
  if (command.type === 'SYSTEM_FAILURE') {
    if (isTerminalHalf(state.phase)) return { event: { type: 'NOOP' }, state };
    return finalize(state, 'VOID');
  }
  if (command.type === 'CANCEL') {
    // Desistir da própria metade é cancelamento explícito, nunca queda nem VOID.
    if (state.phase === 'CANCELLED') return { event: { type: 'NOOP' }, state };
    if (isTerminalHalf(state.phase)) {
      throw new AsyncHalfCommandError('MATCH_NOT_ACTIVE', 'Esta metade não aceita mais ações.');
    }
    return finalize(state, 'CANCELLED');
  }
  if (isTerminalHalf(state.phase) || state.phase === 'FINALIZING') {
    throw new AsyncHalfCommandError('MATCH_NOT_ACTIVE', 'Esta metade não aceita mais ações.');
  }

  if (command.type === 'CONNECT') {
    if (state.phase === 'PAUSED') {
      const pause = state.pause;
      if (pause === null) throw new Error('Pausa sem estado preservado.');
      if (nowMs >= pause.graceDeadlineMs) return finalize(state, 'VOID');
      state.connected = true;
      state.phase = pause.phase;
      state.phaseDeadlineMs = nowMs + pause.phaseRemainingMs;
      state.pause = null;
      return { event: { type: 'RESUMED' }, state };
    }
    state.connected = true;
    return { event: { type: 'CONNECTED' }, state };
  }

  if (command.type === 'DISCONNECT') {
    if (!state.connected) return { event: { type: 'NOOP' }, state };
    state.connected = false;
    if (state.phase === 'PAUSED') return { event: { type: 'PAUSED' }, state };
    const phase = pausablePhase(state.phase);
    if (phase === null) return { event: { type: 'NOOP' }, state };
    const phaseRemainingMs = state.phaseDeadlineMs === null ? 0 : remainingAt(nowMs, state.phaseDeadlineMs);
    state.phase = 'PAUSED';
    state.phaseDeadlineMs = nowMs + RECONNECT_GRACE_MS;
    state.pause = { graceDeadlineMs: state.phaseDeadlineMs, phase, phaseRemainingMs };
    return { event: { type: 'PAUSED' }, state };
  }

  if (!state.connected) {
    throw new AsyncHalfCommandError('PLAYER_DISCONNECTED', 'Reconecte antes de continuar.');
  }

  if (command.type === 'ROUND_READY') {
    if (state.phase !== 'ROUND_READY' || command.roundNumber !== state.roundIndex + 1) {
      throw new AsyncHalfCommandError('INVALID_ROUND_READY', 'A rodada informada não aguarda READY.');
    }
    state.startedAtMs ??= nowMs;
    state.phase = 'ANSWERING';
    state.phaseDeadlineMs = nowMs + QUESTION_DURATION_MS;
    return { event: { type: 'ROUND_STARTED' }, state };
  }

  if (state.phase !== 'ANSWERING') {
    throw new AsyncHalfCommandError('INVALID_STATE', 'A rodada não aceita respostas.');
  }
  if (command.roundNumber !== state.roundIndex + 1 || command.questionId !== currentQuestion(state).id) {
    throw new AsyncHalfCommandError('INVALID_QUESTION', 'A resposta não pertence à pergunta atual.');
  }
  if (!Number.isInteger(command.selectedOption) || command.selectedOption < 0 || command.selectedOption > 3) {
    throw new AsyncHalfCommandError('INVALID_OPTION', 'Escolha uma alternativa válida.');
  }
  if (state.phaseDeadlineMs === null || nowMs >= state.phaseDeadlineMs) return resolveRound(state, nowMs);
  if (state.answers[state.roundIndex] != null) {
    throw new AsyncHalfCommandError('ANSWER_ALREADY_SUBMITTED', 'Sua resposta já foi registrada.');
  }
  const remainingMs = remainingAt(nowMs, state.phaseDeadlineMs);
  const correct = command.selectedOption === currentQuestion(state).correctOption;
  state.answers[state.roundIndex] = {
    answeredAtMs: nowMs,
    correct,
    remainingMs,
    score: scoreAnswer(correct, remainingMs),
    selectedOption: command.selectedOption,
    submitted: true,
  };
  return resolveRound(state, nowMs);
}

export function markAsyncHalfFinalized(state: AsyncHalfState): AsyncHalfState {
  if (state.phase !== 'FINALIZING') {
    throw new AsyncHalfCommandError('INVALID_STATE', 'Esta metade não aguarda finalização.');
  }
  const next = cloneState(state);
  next.phase = 'FINISHED';
  next.phaseDeadlineMs = null;
  next.pause = null;
  return next;
}

/** Respostas seladas desta metade, na ordem das rodadas, para persistência. */
export function sealedAnswersOf(state: AsyncHalfState): SealedRoundAnswer[] {
  return state.answers.map((answer) => ({
    correct: answer?.correct ?? false,
    remainingMs: answer?.remainingMs ?? 0,
    score: answer?.score ?? 0,
    selectedOption: answer?.selectedOption ?? null,
  }));
}

function phaseHasCurrentQuestion(state: AsyncHalfState): boolean {
  if (['ROUND_READY', 'ANSWERING', 'ROUND_RESULT'].includes(state.phase)) return true;
  return state.phase === 'PAUSED' && state.pause !== null;
}

/**
 * Projeção no formato da partida simultânea, respeitando o sigilo do assíncrono.
 *
 * Na metade do primeiro jogador nada do adversário existe ainda: `opponentPending`
 * marca isso para a tela não exibir um placar que não foi jogado. Na metade do
 * segundo, uma rodada do primeiro só é revelada depois de resolvida aqui.
 */
export function projectAsyncHalf(state: AsyncHalfState, nowMs: number): LiveMatchProjection {
  assertNow(nowMs);
  const resolvedRounds = state.phase === 'ROUND_RESULT' || state.pause?.phase === 'ROUND_RESULT'
    ? state.roundIndex + 1
    : state.roundIndex;
  const revealedOpponentScore = state.sealedOpponent === null
    ? 0
    : state.sealedOpponent
      .slice(0, Math.min(resolvedRounds, state.sealedOpponent.length))
      .reduce((total, answer) => total + answer.score, 0);

  const projection: LiveMatchProjection = {
    opponent: {
      answered: false,
      customAvatarUrl: state.opponent.customAvatarUrl,
      displayName: state.opponent.displayName,
      frameId: state.opponent.frameId,
      photoUrl: state.opponent.photoUrl,
      score: revealedOpponentScore,
    },
    phase: state.phase === 'FINALIZING' || state.phase === 'CANCELLED' ? 'FINALIZING' : state.phase,
    serverNow: nowMs,
    viewer: {
      customAvatarUrl: state.viewer.customAvatarUrl,
      displayName: state.viewer.displayName,
      frameId: state.viewer.frameId,
      photoUrl: state.viewer.photoUrl,
      score: state.score,
      seat: state.seat === 'FIRST' ? 1 : 2,
    },
  };
  if (state.sealedOpponent === null) projection.opponentPending = true;

  if (phaseHasCurrentQuestion(state)) {
    projection.question = publicQuestion(currentQuestion(state));
    projection.round = { number: state.roundIndex + 1, total: state.questions.length };
  }
  if (state.phaseDeadlineMs !== null) projection.remainingMs = remainingAt(nowMs, state.phaseDeadlineMs);

  const viewerAnswer = state.answers[state.roundIndex] ?? null;
  if (viewerAnswer !== null && state.phase === 'ANSWERING') {
    projection.selectedOption = viewerAnswer.selectedOption;
  }
  if (state.phase === 'PAUSED' && state.pause !== null) {
    projection.paused = {
      graceRemainingMs: remainingAt(nowMs, state.pause.graceDeadlineMs),
      phase: state.pause.phase === 'ROUND_READY' ? 'ROUND_READY' : state.pause.phase,
      phaseRemainingMs: state.pause.phaseRemainingMs,
    };
    if (viewerAnswer !== null && state.pause.phase === 'ANSWERING') {
      projection.selectedOption = viewerAnswer.selectedOption;
    }
  }

  const roundResolved = state.phase === 'ROUND_RESULT' || state.pause?.phase === 'ROUND_RESULT';
  if (viewerAnswer !== null && roundResolved) {
    const roundNumber = state.roundIndex + 1;
    const sealed = state.sealedOpponent === null
      ? null
      : canRevealFirstPlayerRound(roundNumber, resolvedRounds)
        ? state.sealedOpponent[state.roundIndex] ?? null
        : null;
    projection.resolution = {
      correctOption: currentQuestion(state).correctOption,
      opponent: {
        answered: sealed !== null,
        correct: sealed?.correct ?? false,
        score: revealedOpponentScore,
        selectedOption: sealed?.selectedOption ?? null,
      },
      viewer: {
        correct: viewerAnswer.correct,
        roundScore: viewerAnswer.score,
        score: state.score,
        selectedOption: viewerAnswer.selectedOption,
      },
    };
  }
  return projection;
}
