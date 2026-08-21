import { RECONNECT_GRACE_MS } from './connection.js';
import { publicQuestion, type PublicQuestion, type SecretQuestion } from './projection.js';
import { questionsForDifficulty } from './rules.js';
import { QUESTION_DURATION_MS, remainingAt, scoreAnswer } from './scoring.js';
import type { Difficulty, MatchMode } from '../types.js';

export const LIVE_PREPARATION_MS = 3_000;
export const LIVE_ROUND_RESULT_MS = 2_900;
export const LIVE_ROUND_TRANSITION_MS = 450;

export type LiveSeat = 1 | 2;
export type LiveMatchPhase =
  | 'LOBBY'
  | 'PREPARING'
  | 'ROUND_READY'
  | 'ANSWERING'
  | 'ROUND_RESULT'
  | 'PAUSED'
  | 'FINALIZING'
  | 'FINISHED'
  | 'VOID';

type PausablePhase = 'PREPARING' | 'ROUND_READY' | 'ANSWERING' | 'ROUND_RESULT';

export interface LiveQuestion extends SecretQuestion {
  slot: number;
}

export interface LivePlayer {
  connected: boolean;
  customAvatarUrl: string | null;
  displayName: string;
  firebaseUid: string;
  frameId: string | null;
  knowledgeBefore: number;
  lobbyReady: boolean;
  photoUrl: string | null;
  roundReady: boolean;
  score: number;
  seat: LiveSeat;
  userId: string;
}

export interface LiveRoundAnswer {
  answeredAtMs: number;
  correct: boolean;
  remainingMs: number;
  score: number;
  selectedOption: number | null;
  submitted: boolean;
}

export interface LiveResolvedRound {
  answers: [LiveRoundAnswer, LiveRoundAnswer];
  roundNumber: number;
}

export type LiveVoidReason =
  | 'CANCELLED'
  | 'INDIVIDUAL_ABANDONMENT'
  | 'INDIVIDUAL_DISCONNECT'
  | 'READINESS_TIMEOUT'
  | 'SYSTEM_FAILURE';

export type LivePendingOutcome =
  | { kind: 'COMPLETED'; reason: 'COMPLETED' }
  | { cancelledBySeat?: LiveSeat; kind: 'VOID'; penalizedSeat: LiveSeat | null; reason: LiveVoidReason };

export interface LivePause {
  disconnectedSeats: LiveSeat[];
  graceDeadlineMs: number;
  phase: PausablePhase;
  phaseRemainingMs: number;
}

export interface LiveMatchState {
  answers: [LiveRoundAnswer | null, LiveRoundAnswer | null];
  createdAtMs: number;
  difficulty: Difficulty;
  matchId: string;
  mode: MatchMode;
  pause: LivePause | null;
  pendingOutcome: LivePendingOutcome | null;
  phase: LiveMatchPhase;
  phaseDeadlineMs: number | null;
  players: [LivePlayer, LivePlayer];
  poolId: string;
  poolVersion: number;
  questions: readonly LiveQuestion[];
  roundIndex: number;
  roundHistory: LiveResolvedRound[];
  startedAtMs: number | null;
  themeId: string;
  version: 1;
}

export type LiveMatchCommand =
  | { seat: LiveSeat; type: 'CONNECT' }
  | { seat: LiveSeat; type: 'DISCONNECT' }
  | { seat: LiveSeat; type: 'LOBBY_READY' }
  | { roundNumber: number; seat: LiveSeat; type: 'ROUND_READY' }
  | { questionId: string; roundNumber: number; seat: LiveSeat; selectedOption: number; type: 'ANSWER' }
  | { seat: LiveSeat; type: 'CANCEL' }
  | { type: 'SYSTEM_FAILURE' }
  | { type: 'ALARM' };

export type LiveMatchEvent =
  | { type: 'NOOP' }
  | { seat: LiveSeat; type: 'CONNECTED' }
  | { seat: LiveSeat; type: 'LOBBY_READY' }
  | { type: 'PREPARING' }
  | { type: 'QUESTION_AVAILABLE' }
  | { type: 'ROUND_STARTED' }
  | { seat: LiveSeat; type: 'ANSWER_ACCEPTED' }
  | { type: 'ROUND_RESOLVED' }
  | { type: 'PAUSED' }
  | { type: 'RESUMED' }
  | { type: 'FINALIZE' };

export interface LiveTransition {
  event: LiveMatchEvent;
  state: LiveMatchState;
}

export class LiveMatchCommandError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'LiveMatchCommandError';
  }
}

function assertNow(nowMs: number): void {
  if (!Number.isFinite(nowMs) || nowMs < 0) throw new RangeError('Tempo do servidor inválido.');
}

function playerIndex(seat: LiveSeat): 0 | 1 {
  return seat === 1 ? 0 : 1;
}

function otherSeat(seat: LiveSeat): LiveSeat {
  return seat === 1 ? 2 : 1;
}

function cloneState(state: LiveMatchState): LiveMatchState {
  const firstAnswer = state.answers[0];
  const secondAnswer = state.answers[1];
  return {
    ...state,
    answers: [
      firstAnswer === null ? null : { ...firstAnswer },
      secondAnswer === null ? null : { ...secondAnswer },
    ],
    pause: state.pause === null ? null : {
      ...state.pause,
      disconnectedSeats: [...state.pause.disconnectedSeats],
    },
    pendingOutcome: state.pendingOutcome === null ? null : { ...state.pendingOutcome },
    players: [{ ...state.players[0] }, { ...state.players[1] }],
    roundHistory: state.roundHistory.map((round) => ({
      answers: [{ ...round.answers[0] }, { ...round.answers[1] }],
      roundNumber: round.roundNumber,
    })),
  };
}

function pauseOf(state: LiveMatchState): LivePause | null {
  return state.pause;
}

function setPause(state: LiveMatchState, pause: LivePause | null): void {
  state.pause = pause;
}

function currentQuestion(state: LiveMatchState): LiveQuestion {
  const question = state.questions[state.roundIndex];
  if (question === undefined) throw new Error('Rodada sem pergunta autoritativa.');
  return question;
}

function beginFinalization(state: LiveMatchState, outcome: LivePendingOutcome): LiveTransition {
  state.pendingOutcome = outcome;
  state.phase = 'FINALIZING';
  state.phaseDeadlineMs = null;
  setPause(state, null);
  return { event: { type: 'FINALIZE' }, state };
}

function beginVoid(
  state: LiveMatchState,
  reason: LiveVoidReason,
  penalizedSeat: LiveSeat | null,
): LiveTransition {
  return beginFinalization(state, { kind: 'VOID', penalizedSeat, reason });
}

function beginRoundReady(state: LiveMatchState, nowMs: number): LiveTransition {
  state.answers = [null, null];
  state.players[0].roundReady = false;
  state.players[1].roundReady = false;
  state.phase = 'ROUND_READY';
  state.phaseDeadlineMs = nowMs + RECONNECT_GRACE_MS;
  return { event: { type: 'QUESTION_AVAILABLE' }, state };
}

function timeoutAnswer(nowMs: number): LiveRoundAnswer {
  return {
    answeredAtMs: nowMs,
    correct: false,
    remainingMs: 0,
    score: 0,
    selectedOption: null,
    submitted: false,
  };
}

function resolveRound(state: LiveMatchState, nowMs: number): LiveTransition {
  if (state.answers[0] === null) state.answers[0] = timeoutAnswer(nowMs);
  if (state.answers[1] === null) state.answers[1] = timeoutAnswer(nowMs);
  const first = state.answers[0];
  const second = state.answers[1];
  if (state.roundHistory.at(-1)?.roundNumber !== state.roundIndex + 1) {
    state.roundHistory.push({
      answers: [{ ...first }, { ...second }],
      roundNumber: state.roundIndex + 1,
    });
  }
  state.players[0].score += first.score;
  state.players[1].score += second.score;
  state.phase = 'ROUND_RESULT';
  state.phaseDeadlineMs = nowMs + LIVE_ROUND_RESULT_MS;
  return { event: { type: 'ROUND_RESOLVED' }, state };
}

function expirePause(state: LiveMatchState): LiveTransition {
  const pause = pauseOf(state);
  if (pause === null) throw new Error('Pausa sem estado preservado.');
  if (pause.disconnectedSeats.length !== 1) return beginVoid(state, 'SYSTEM_FAILURE', null);
  const disconnectedSeat = pause.disconnectedSeats[0] ?? null;
  return state.startedAtMs === null
    ? beginVoid(state, 'READINESS_TIMEOUT', null)
    : beginVoid(state, 'INDIVIDUAL_DISCONNECT', disconnectedSeat);
}

function alarm(state: LiveMatchState, nowMs: number): LiveTransition {
  if (state.phase === 'PAUSED') {
    const pause = pauseOf(state);
    if (pause === null) throw new Error('Pausa sem estado preservado.');
    return nowMs < pause.graceDeadlineMs
      ? { event: { type: 'NOOP' }, state }
      : expirePause(state);
  }
  if (state.phaseDeadlineMs === null || nowMs < state.phaseDeadlineMs) {
    return { event: { type: 'NOOP' }, state };
  }
  if (state.phase === 'LOBBY') {
    const connected = state.players.filter((player) => player.connected).length;
    const ready = state.players.filter((player) => player.lobbyReady).length;
    return connected === 0 || ready === 0
      ? beginVoid(state, 'SYSTEM_FAILURE', null)
      : beginVoid(state, 'READINESS_TIMEOUT', null);
  }
  if (state.phase === 'PREPARING') {
    state.startedAtMs = nowMs;
    return beginRoundReady(state, nowMs);
  }
  if (state.phase === 'ROUND_READY') {
    const unready = state.players.filter((player) => !player.roundReady);
    if (unready.length !== 1) return beginVoid(state, 'SYSTEM_FAILURE', null);
    return beginVoid(state, 'READINESS_TIMEOUT', unready[0]?.seat ?? null);
  }
  if (state.phase === 'ANSWERING') return resolveRound(state, nowMs);
  if (state.phase === 'ROUND_RESULT') {
    if (state.roundIndex + 1 >= state.questions.length) {
      return beginFinalization(state, { kind: 'COMPLETED', reason: 'COMPLETED' });
    }
    state.roundIndex += 1;
    return beginRoundReady(state, nowMs);
  }
  return { event: { type: 'NOOP' }, state };
}

export function createLiveMatchState(input: {
  createdAtMs: number;
  difficulty: Difficulty;
  matchId: string;
  mode: MatchMode;
  players: readonly [Omit<LivePlayer, 'connected' | 'lobbyReady' | 'roundReady' | 'score' | 'seat'>, Omit<LivePlayer, 'connected' | 'lobbyReady' | 'roundReady' | 'score' | 'seat'>];
  poolId: string;
  poolVersion: number;
  questions: readonly LiveQuestion[];
  themeId: string;
}): LiveMatchState {
  assertNow(input.createdAtMs);
  const expected = questionsForDifficulty(input.difficulty);
  if (input.questions.length !== expected) {
    throw new RangeError(`A dificuldade exige exatamente ${expected} perguntas.`);
  }
  if (input.players[0].firebaseUid === input.players[1].firebaseUid || input.players[0].userId === input.players[1].userId) {
    throw new Error('Uma partida exige dois jogadores diferentes.');
  }
  for (const question of input.questions) {
    if (!Number.isInteger(question.correctOption) || question.correctOption < 0 || question.correctOption > 3) {
      throw new RangeError('Pergunta com alternativa correta inválida.');
    }
  }
  return {
    answers: [null, null],
    createdAtMs: input.createdAtMs,
    difficulty: input.difficulty,
    matchId: input.matchId,
    mode: input.mode,
    pause: null,
    pendingOutcome: null,
    phase: 'LOBBY',
    phaseDeadlineMs: input.createdAtMs + RECONNECT_GRACE_MS,
    players: [
      { ...input.players[0], connected: false, lobbyReady: false, roundReady: false, score: 0, seat: 1 },
      { ...input.players[1], connected: false, lobbyReady: false, roundReady: false, score: 0, seat: 2 },
    ],
    poolId: input.poolId,
    poolVersion: input.poolVersion,
    questions: input.questions,
    roundIndex: 0,
    roundHistory: [],
    startedAtMs: null,
    themeId: input.themeId,
    version: 1,
  };
}

export function transitionLiveMatch(
  current: LiveMatchState,
  command: LiveMatchCommand,
  nowMs: number,
): LiveTransition {
  assertNow(nowMs);
  const state = cloneState(current);

  if (command.type === 'ALARM') return alarm(state, nowMs);
  if (command.type === 'SYSTEM_FAILURE') {
    if (state.phase === 'FINISHED' || state.phase === 'VOID') return { event: { type: 'NOOP' }, state };
    return beginVoid(state, 'SYSTEM_FAILURE', null);
  }

  const player = state.players[playerIndex(command.seat)];
  if (state.phase === 'FINISHED' || state.phase === 'VOID' || state.phase === 'FINALIZING') {
    throw new LiveMatchCommandError('MATCH_NOT_ACTIVE', 'A partida não aceita mais ações.');
  }

  if (command.type === 'CONNECT') {
    if (state.phase === 'PAUSED') {
      const pause = pauseOf(state);
      if (pause === null) throw new Error('Pausa sem estado preservado.');
      if (nowMs >= pause.graceDeadlineMs) return expirePause(state);
    }
    player.connected = true;
    if (state.phase !== 'PAUSED') {
      if (state.phase === 'LOBBY' && state.players.every((entry) => entry.connected && entry.lobbyReady)) {
        state.phase = 'PREPARING';
        state.phaseDeadlineMs = nowMs + LIVE_PREPARATION_MS;
        return { event: { type: 'PREPARING' }, state };
      }
      return { event: { seat: command.seat, type: 'CONNECTED' }, state };
    }
    const pause = pauseOf(state);
    if (pause === null || !pause.disconnectedSeats.includes(command.seat)) {
      return { event: { seat: command.seat, type: 'CONNECTED' }, state };
    }
    pause.disconnectedSeats = pause.disconnectedSeats.filter((seat) => seat !== command.seat);
    if (pause.disconnectedSeats.length > 0) {
      setPause(state, pause);
      return { event: { seat: command.seat, type: 'CONNECTED' }, state };
    }
    state.phase = pause.phase;
    state.phaseDeadlineMs = nowMs + pause.phaseRemainingMs;
    setPause(state, null);
    return { event: { type: 'RESUMED' }, state };
  }

  if (command.type === 'DISCONNECT') {
    if (!player.connected) return { event: { type: 'NOOP' }, state };
    player.connected = false;
    if (state.phase === 'LOBBY') {
      if (state.players.every((entry) => !entry.connected)) return beginVoid(state, 'SYSTEM_FAILURE', null);
      state.phaseDeadlineMs = nowMs + RECONNECT_GRACE_MS;
      return { event: { type: 'PAUSED' }, state };
    }
    if (state.phase === 'PAUSED') {
      const pause = pauseOf(state);
      if (pause === null) throw new Error('Pausa sem estado preservado.');
      if (!pause.disconnectedSeats.includes(command.seat)) pause.disconnectedSeats.push(command.seat);
      return pause.disconnectedSeats.length >= 2
        ? beginVoid(state, 'SYSTEM_FAILURE', null)
        : { event: { type: 'PAUSED' }, state };
    }
    if (!['PREPARING', 'ROUND_READY', 'ANSWERING', 'ROUND_RESULT'].includes(state.phase)) {
      return { event: { type: 'NOOP' }, state };
    }
    const phase = state.phase;
    const phaseRemainingMs = state.phaseDeadlineMs === null ? 0 : remainingAt(nowMs, state.phaseDeadlineMs);
    state.phase = 'PAUSED';
    state.phaseDeadlineMs = nowMs + RECONNECT_GRACE_MS;
    setPause(state, {
      disconnectedSeats: [command.seat],
      graceDeadlineMs: state.phaseDeadlineMs,
      phase,
      phaseRemainingMs,
    });
    return { event: { type: 'PAUSED' }, state };
  }

  if (command.type === 'CANCEL') {
    return state.startedAtMs === null
      ? beginFinalization(state, {
        cancelledBySeat: command.seat,
        kind: 'VOID',
        penalizedSeat: null,
        reason: 'CANCELLED',
      })
      : beginVoid(state, 'INDIVIDUAL_ABANDONMENT', command.seat);
  }

  if (!player.connected) {
    throw new LiveMatchCommandError('PLAYER_DISCONNECTED', 'Reconecte antes de continuar.');
  }

  if (command.type === 'LOBBY_READY') {
    if (state.phase !== 'LOBBY') throw new LiveMatchCommandError('INVALID_STATE', 'READY não é válido neste estado.');
    if (player.lobbyReady) return { event: { type: 'NOOP' }, state };
    player.lobbyReady = true;
    state.phaseDeadlineMs = nowMs + RECONNECT_GRACE_MS;
    if (state.players.every((entry) => entry.connected && entry.lobbyReady)) {
      state.phase = 'PREPARING';
      state.phaseDeadlineMs = nowMs + LIVE_PREPARATION_MS;
      return { event: { type: 'PREPARING' }, state };
    }
    return { event: { seat: command.seat, type: 'LOBBY_READY' }, state };
  }

  if (command.type === 'ROUND_READY') {
    if (state.phase !== 'ROUND_READY' || command.roundNumber !== state.roundIndex + 1) {
      throw new LiveMatchCommandError('INVALID_ROUND_READY', 'A rodada informada não aguarda READY.');
    }
    if (player.roundReady) return { event: { type: 'NOOP' }, state };
    player.roundReady = true;
    if (state.players.every((entry) => entry.connected && entry.roundReady)) {
      state.phase = 'ANSWERING';
      state.phaseDeadlineMs = nowMs + QUESTION_DURATION_MS;
      return { event: { type: 'ROUND_STARTED' }, state };
    }
    return { event: { type: 'NOOP' }, state };
  }

  if (command.type === 'ANSWER') {
    if (state.phase !== 'ANSWERING') throw new LiveMatchCommandError('INVALID_STATE', 'A rodada não aceita respostas.');
    if (command.roundNumber !== state.roundIndex + 1 || command.questionId !== currentQuestion(state).id) {
      throw new LiveMatchCommandError('INVALID_QUESTION', 'A resposta não pertence à pergunta atual.');
    }
    if (!Number.isInteger(command.selectedOption) || command.selectedOption < 0 || command.selectedOption > 3) {
      throw new LiveMatchCommandError('INVALID_OPTION', 'Escolha uma alternativa válida.');
    }
    if (state.phaseDeadlineMs === null || nowMs >= state.phaseDeadlineMs) return resolveRound(state, nowMs);
    const answerIndex = playerIndex(command.seat);
    if (state.answers[answerIndex] !== null) {
      throw new LiveMatchCommandError('ANSWER_ALREADY_SUBMITTED', 'Sua resposta já foi registrada.');
    }
    const remainingMs = remainingAt(nowMs, state.phaseDeadlineMs);
    const correct = command.selectedOption === currentQuestion(state).correctOption;
    state.answers[answerIndex] = {
      answeredAtMs: nowMs,
      correct,
      remainingMs,
      score: scoreAnswer(correct, remainingMs),
      selectedOption: command.selectedOption,
      submitted: true,
    };
    return state.answers[playerIndex(otherSeat(command.seat))] === null
      ? { event: { seat: command.seat, type: 'ANSWER_ACCEPTED' }, state }
      : resolveRound(state, nowMs);
  }

  return { event: { type: 'NOOP' }, state };
}

export function markLiveMatchFinalized(state: LiveMatchState): LiveMatchState {
  const outcome = state.pendingOutcome;
  if (state.phase !== 'FINALIZING' || outcome === null) {
    throw new LiveMatchCommandError('INVALID_STATE', 'A partida não aguarda finalização.');
  }
  const next = cloneState(state);
  next.phase = outcome.kind === 'COMPLETED' ? 'FINISHED' : 'VOID';
  next.phaseDeadlineMs = null;
  setPause(next, null);
  return next;
}

export interface LiveMatchProjection {
  opponent: {
    answered: boolean;
    customAvatarUrl: string | null;
    displayName: string;
    frameId: string | null;
    photoUrl: string | null;
    score: number;
  };
  paused?: {
    graceRemainingMs: number;
    phase: PausablePhase;
    phaseRemainingMs: number;
  };
  phase: LiveMatchPhase;
  question?: PublicQuestion;
  remainingMs?: number;
  resolution?: {
    correctOption: number;
    opponent: {
      answered: boolean;
      correct: boolean;
      score: number;
      selectedOption: number | null;
    };
    viewer: { correct: boolean; roundScore: number; score: number; selectedOption: number | null };
  };
  round?: { number: number; total: number };
  selectedOption?: number | null;
  serverNow: number;
  viewer: {
    customAvatarUrl: string | null;
    displayName: string;
    frameId: string | null;
    photoUrl: string | null;
    score: number;
    seat: LiveSeat;
  };
}

export interface LiveMatchPresentationProjection {
  opponent: {
    customAvatarUrl: string | null;
    displayName: string;
    frameId: string | null;
    knowledge: number;
    photoUrl: string | null;
  };
  preload: {
    firstQuestion: PublicQuestion;
  };
}

export function projectLiveMatchPresentationForSeat(
  state: LiveMatchState,
  viewerSeat: LiveSeat,
): LiveMatchPresentationProjection {
  const opponent = state.players[playerIndex(otherSeat(viewerSeat))];
  const firstQuestion = state.questions[0];
  if (firstQuestion === undefined) throw new LiveMatchCommandError('MATCH_WITHOUT_QUESTIONS', 'A partida não possui perguntas.');
  return {
    opponent: {
      customAvatarUrl: opponent.customAvatarUrl,
      displayName: opponent.displayName,
      frameId: opponent.frameId,
      knowledge: opponent.knowledgeBefore,
      photoUrl: opponent.photoUrl,
    },
    preload: { firstQuestion: publicQuestion(firstQuestion) },
  };
}

function phaseHasCurrentQuestion(state: LiveMatchState): boolean {
  if (['ROUND_READY', 'ANSWERING', 'ROUND_RESULT'].includes(state.phase)) return true;
  const pause = pauseOf(state);
  return state.phase === 'PAUSED' && pause !== null && pause.phase !== 'PREPARING';
}

function phaseHasResolvedCurrentRound(state: LiveMatchState): boolean {
  if (state.phase === 'ROUND_RESULT') return true;
  const pause = pauseOf(state);
  return state.phase === 'PAUSED' && pause?.phase === 'ROUND_RESULT';
}

export function projectLiveMatchForSeat(
  state: LiveMatchState,
  viewerSeat: LiveSeat,
  nowMs: number,
): LiveMatchProjection {
  assertNow(nowMs);
  const viewerIndex = playerIndex(viewerSeat);
  const opponentIndex = playerIndex(otherSeat(viewerSeat));
  const viewer = state.players[viewerIndex];
  const opponent = state.players[opponentIndex];
  const viewerAnswer = state.answers[viewerIndex];
  const opponentAnswer = state.answers[opponentIndex];
  const projection: LiveMatchProjection = {
    opponent: {
      answered: opponentAnswer?.submitted ?? false,
      customAvatarUrl: opponent.customAvatarUrl,
      displayName: opponent.displayName,
      frameId: opponent.frameId,
      photoUrl: opponent.photoUrl,
      score: opponent.score,
    },
    phase: state.phase,
    serverNow: nowMs,
    viewer: {
      customAvatarUrl: viewer.customAvatarUrl,
      displayName: viewer.displayName,
      frameId: viewer.frameId,
      photoUrl: viewer.photoUrl,
      score: viewer.score,
      seat: viewerSeat,
    },
  };
  if (phaseHasCurrentQuestion(state)) {
    const question = currentQuestion(state);
    projection.question = publicQuestion(question);
    projection.round = { number: state.roundIndex + 1, total: state.questions.length };
  }
  if (state.phaseDeadlineMs !== null) projection.remainingMs = remainingAt(nowMs, state.phaseDeadlineMs);
  if (viewerAnswer !== null && state.phase === 'ANSWERING') projection.selectedOption = viewerAnswer.selectedOption;
  const pause = pauseOf(state);
  if (state.phase === 'PAUSED' && pause !== null) {
    projection.paused = {
      graceRemainingMs: remainingAt(nowMs, pause.graceDeadlineMs),
      phase: pause.phase,
      phaseRemainingMs: pause.phaseRemainingMs,
    };
    if (viewerAnswer !== null && pause.phase === 'ANSWERING') projection.selectedOption = viewerAnswer.selectedOption;
  }
  if (viewerAnswer !== null && opponentAnswer !== null && phaseHasResolvedCurrentRound(state)) {
    projection.resolution = {
      correctOption: currentQuestion(state).correctOption,
      opponent: {
        answered: opponentAnswer.submitted,
        correct: opponentAnswer.correct,
        score: opponent.score,
        selectedOption: opponentAnswer.selectedOption,
      },
      viewer: {
        correct: viewerAnswer.correct,
        roundScore: viewerAnswer.score,
        score: viewer.score,
        selectedOption: viewerAnswer.selectedOption,
      },
    };
  }
  return projection;
}
