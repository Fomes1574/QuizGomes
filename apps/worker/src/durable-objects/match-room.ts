import {
  LiveMatchCommandError,
  LIVE_ROUND_TRANSITION_MS,
  markLiveMatchFinalized,
  projectLiveMatchForSeat,
  projectLiveMatchPresentationForSeat,
  transitionLiveMatch,
  type LiveMatchCommand,
  type LiveMatchEvent,
  type LiveMatchState,
  type LiveSeat,
} from '@quiz-gomes/domain';
import type { Env } from '../env.js';
import { ApiError } from '../http/api-error.js';
import {
  LiveMatchRepository,
  type FinalizedLiveMatch,
} from '../repositories/live-match-repository.js';

interface RoomAttachment {
  seat: LiveSeat;
  uid: string;
  userId: string;
}

interface InitializeRoomInput {
  createdAtMs: number;
  firebaseUids: [string, string];
  matchId: string;
  resource: string;
}

interface ClientMessage {
  questionId?: string;
  roundNumber?: number;
  selectedOption?: number;
  type?: string;
}

const ROOM_KEY = 'room';
const RESULT_KEY = 'result';
const PRESENCE_CLEANUP_KEY = 'presence-cleanup-pending';
const REPLACED_SOCKET_CODE = 4_000;
const FINALIZATION_RETRY_MS = 1_000;
const SAFE_INITIALIZATION_CODES = new Set([
  'PLAYER_BUSY',
  'PROFILE_REQUIRED',
  'QUESTION_POOL_EMPTY',
  'QUESTION_POOL_INCONSISTENT',
  'QUESTION_POOL_INSUFFICIENT',
]);

function safeInitializationCode(error: unknown): string {
  return error instanceof ApiError && SAFE_INITIALIZATION_CODES.has(error.code)
    ? error.code
    : 'MATCH_INITIALIZATION_FAILED';
}

function readAttachment(socket: WebSocket): RoomAttachment | null {
  return socket.deserializeAttachment() as RoomAttachment | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function parseClientMessage(message: string): ClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(message);
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  if (value.type === 'HEARTBEAT' || value.type === 'READY' || value.type === 'CANCEL') {
    return hasOnlyKeys(value, ['type']) ? { type: value.type } : null;
  }
  if (value.type === 'ROUND_READY') {
    return hasOnlyKeys(value, ['type', 'roundNumber']) && Number.isInteger(value.roundNumber)
      ? { roundNumber: value.roundNumber as number, type: value.type }
      : null;
  }
  if (value.type === 'ANSWER') {
    return hasOnlyKeys(value, ['type', 'roundNumber', 'questionId', 'selectedOption']) &&
      Number.isInteger(value.roundNumber) && typeof value.questionId === 'string' &&
      Number.isInteger(value.selectedOption)
      ? {
          questionId: value.questionId,
          roundNumber: value.roundNumber as number,
          selectedOption: value.selectedOption as number,
          type: value.type,
        }
      : null;
  }
  return null;
}

export class MatchRoom {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/initialize') return this.initialize(request);
    if (request.method === 'POST' && url.pathname === '/system-failure') return this.systemFailure();
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade necessário', { status: 426 });
    }
    return this.connect(request);
  }

  async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (typeof message !== 'string' || message.length > 2_048) {
      this.sendError(socket, 'INVALID_MESSAGE', 'Mensagem inválida.');
      return;
    }
    const input = parseClientMessage(message);
    if (input === null) {
      this.sendError(socket, 'INVALID_MESSAGE', 'Mensagem inválida.');
      return;
    }
    if (input.type === 'HEARTBEAT') {
      this.safeSend(socket, { serverNow: Date.now(), type: 'PONG' });
      return;
    }
    const player = readAttachment(socket);
    if (player === null) {
      this.sendError(socket, 'INVALID_CONNECTION', 'Conexão sem jogador.');
      return;
    }
    let command: LiveMatchCommand;
    if (input.type === 'READY') command = { seat: player.seat, type: 'LOBBY_READY' };
    else if (input.type === 'ROUND_READY' && input.roundNumber !== undefined) {
      command = { roundNumber: input.roundNumber, seat: player.seat, type: 'ROUND_READY' };
    } else if (input.type === 'ANSWER' && input.questionId !== undefined &&
      input.roundNumber !== undefined && input.selectedOption !== undefined) {
      command = {
        questionId: input.questionId,
        roundNumber: input.roundNumber,
        seat: player.seat,
        selectedOption: input.selectedOption,
        type: 'ANSWER',
      };
    } else if (input.type === 'CANCEL') command = { seat: player.seat, type: 'CANCEL' };
    else {
      this.sendError(socket, 'INVALID_MESSAGE', 'Mensagem inválida.');
      return;
    }
    try {
      await this.applyCommand(command, Date.now(), socket);
    } catch (error) {
      if (error instanceof LiveMatchCommandError) {
        this.sendError(socket, error.code, error.message);
        return;
      }
      throw error;
    }
  }

  async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    if (code === REPLACED_SOCKET_CODE) return;
    const player = readAttachment(socket);
    if (player === null) return;
    const state = await this.state();
    if (state === null || ['FINALIZING', 'FINISHED', 'VOID'].includes(state.phase)) return;
    await this.applyCommand({ seat: player.seat, type: 'DISCONNECT' }, Date.now());
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket, 1_006);
  }

  async alarm(): Promise<void> {
    const state = await this.state();
    if (state === null) return;
    if (state.phase === 'FINISHED' || state.phase === 'VOID') {
      if (await this.ctx.storage.get<FinalizedLiveMatch>(RESULT_KEY) === undefined) {
        const summary = await this.restoreTerminalSummary(state);
        if (summary === null) {
          await this.ctx.storage.setAlarm(Date.now() + FINALIZATION_RETRY_MS);
          return;
        }
        for (const socket of this.ctx.getWebSockets()) this.sendTerminal(socket, state, summary);
      }
      if (await this.ctx.storage.get<boolean>(PRESENCE_CLEANUP_KEY) === true) {
        await this.finishPresenceCleanup();
      }
      return;
    }
    if (state.phase === 'FINALIZING') {
      await this.tryFinalize(state);
      return;
    }
    await this.applyCommand({ type: 'ALARM' }, Date.now());
  }

  private repository(): LiveMatchRepository {
    return new LiveMatchRepository(this.env.CORE_DB, this.env.QUESTIONS_DB);
  }

  private async initialize(request: Request): Promise<Response> {
    const existing = await this.state();
    if (existing !== null) return this.initializationResponse(existing);
    let input: InitializeRoomInput;
    try {
      input = await request.json<InitializeRoomInput>();
    } catch {
      return Response.json({ error: 'invalid_initialization' }, { status: 400 });
    }
    if (!Array.isArray(input.firebaseUids) || input.firebaseUids.length !== 2 ||
      input.firebaseUids.some((uid) => typeof uid !== 'string' || uid.length === 0 || uid.length > 128) ||
      typeof input.matchId !== 'string' || typeof input.resource !== 'string' ||
      !Number.isFinite(input.createdAtMs)) {
      return Response.json({ error: 'invalid_initialization' }, { status: 400 });
    }
    const repository = this.repository();
    let state: LiveMatchState;
    try {
      state = await repository.initialize(input);
    } catch (error) {
      return this.initializationFailure(input.matchId, error);
    }
    try {
      await this.save(state);
      await this.syncAlarm(state);
    } catch (initializationError) {
      const failed = transitionLiveMatch(state, { type: 'SYSTEM_FAILURE' }, Date.now()).state;
      try {
        await this.persistFinalized(failed, await repository.finalize(failed), false);
      } catch (cleanupError) {
        throw new AggregateError(
          [initializationError, cleanupError],
          'A sala falhou ao persistir e ao liberar sua inicialização.',
          { cause: cleanupError },
        );
      }
      return this.initializationFailure(input.matchId, initializationError);
    }
    return this.initializationResponse(state, 201);
  }

  private initializationFailure(matchId: string, error: unknown): Response {
    const code = safeInitializationCode(error);
    console.warn(JSON.stringify({ code, event: 'match_initialization_failed', matchId }));
    return Response.json({ error: { code } }, {
      status: error instanceof ApiError && SAFE_INITIALIZATION_CODES.has(error.code) ? error.status : 500,
    });
  }

  private initializationResponse(state: LiveMatchState, status = 200): Response {
    return Response.json({
      matchId: state.matchId,
      presentations: state.players.map((player) => ({
        presentation: projectLiveMatchPresentationForSeat(state, player.seat),
        uid: player.firebaseUid,
      })),
      status: state.phase,
    }, { status });
  }

  private async systemFailure(): Promise<Response> {
    const state = await this.state();
    if (state === null) return Response.json({ status: 'missing' }, { status: 404 });
    if (state.phase === 'FINISHED' || state.phase === 'VOID') return Response.json({ status: state.phase });
    if (state.phase === 'FINALIZING') {
      await this.tryFinalize(state);
      return Response.json({ status: (await this.state())?.phase ?? 'FINALIZING' });
    }
    await this.applyCommand({ type: 'SYSTEM_FAILURE' }, Date.now());
    return Response.json({ status: 'VOID' });
  }

  private async connect(request: Request): Promise<Response> {
    const uid = request.headers.get('X-QG-Authenticated-Uid');
    const terminalOnly = request.headers.get('X-QG-Terminal-Only') === '1';
    if (uid === null) return new Response('Não autorizado', { status: 401 });
    const state = await this.state();
    if (state === null) return new Response('Sala não encontrada', { status: 404 });
    const player = state.players.find((entry) => entry.firebaseUid === uid);
    if (player === undefined) return new Response('Jogador não pertence à sala', { status: 403 });

    const sameUser = this.ctx.getWebSockets().find((socket) => readAttachment(socket)?.uid === uid);
    sameUser?.close(REPLACED_SOCKET_CODE, 'Reconectado em outra conexão');
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (client === undefined || server === undefined) return new Response('WebSocket indisponível', { status: 500 });
    server.serializeAttachment({ seat: player.seat, uid, userId: player.userId } satisfies RoomAttachment);
    this.ctx.acceptWebSocket(server);

    if (state.phase === 'FINISHED' || state.phase === 'VOID') {
      const summary = await this.restoreTerminalSummary(state);
      if (summary !== null) this.sendTerminal(server, state, summary);
      else await this.deferTerminal(server, state);
    } else if (state.phase === 'FINALIZING') {
      if (!await this.tryFinalize(state)) await this.deferTerminal(server, state);
    } else if (terminalOnly) {
      await this.connectForTerminalOnly(server, state, player.seat);
    } else {
      const transition = transitionLiveMatch(state, { seat: player.seat, type: 'CONNECT' }, Date.now());
      await this.save(transition.state);
      await this.syncAlarm(transition.state);
      if (transition.event.type === 'FINALIZE') {
        if (!await this.tryFinalize(transition.state)) await this.deferTerminal(server, transition.state);
      } else if (transition.event.type === 'RESUMED') {
        await this.setPlayersActivity(transition.state.startedAtMs === null ? 'preparing' : 'playing');
        this.broadcastState('RESUMED', transition.state);
      } else {
        if (transition.event.type === 'CONNECTED' && transition.state.phase === 'LOBBY') {
          await this.setPlayersActivity('preparing');
        }
        this.sendState(server, 'ROOM_STATE', transition.state);
        this.broadcastState('MATCH_STATE', transition.state, server);
      }
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  private async connectForTerminalOnly(
    socket: WebSocket,
    state: LiveMatchState,
    seat: LiveSeat,
  ): Promise<void> {
    const transition = state.phase === 'PAUSED'
      ? transitionLiveMatch(state, { type: 'ALARM' }, Date.now())
      : transitionLiveMatch(state, { seat, type: 'DISCONNECT' }, Date.now());
    await this.save(transition.state);
    await this.syncAlarm(transition.state);
    if (transition.event.type === 'FINALIZE') {
      if (!await this.tryFinalize(transition.state)) this.safeSend(socket, { type: 'MATCH_FINALIZING' });
      return;
    }
    if (transition.event.type === 'PAUSED') {
      await this.setPlayersActivity('reconnecting');
      this.broadcastState('PAUSED_FOR_RECONNECT', transition.state, socket);
    }
    this.safeSend(socket, { type: 'MATCH_FINALIZING' });
  }

  private async applyCommand(command: LiveMatchCommand, nowMs: number, source?: WebSocket): Promise<void> {
    const current = await this.state();
    if (current === null) throw new LiveMatchCommandError('ROOM_NOT_FOUND', 'Sala não encontrada.');
    const transition = transitionLiveMatch(current, command, nowMs);
    if (transition.event.type === 'QUESTION_AVAILABLE' && current.startedAtMs === null) {
      await this.repository().markStarted(current.matchId);
    }
    await this.save(transition.state);
    await this.syncAlarm(transition.state);
    await this.publishEvent(transition.event, transition.state, source);
    if (transition.event.type === 'FINALIZE' && !await this.tryFinalize(transition.state)) {
      this.broadcastState('MATCH_FINALIZING', transition.state);
    }
  }

  private async publishEvent(event: LiveMatchEvent, state: LiveMatchState, source?: WebSocket): Promise<void> {
    if (event.type === 'NOOP') {
      if (source !== undefined) this.sendState(source, 'MATCH_STATE', state);
      return;
    }
    if (event.type === 'PREPARING') {
      this.broadcastState('PREPARING', state);
      return;
    }
    if (event.type === 'QUESTION_AVAILABLE') {
      await this.setPlayersActivity('playing');
      this.broadcastState('ROUND_QUESTION', state, undefined, { transitionMs: LIVE_ROUND_TRANSITION_MS });
      return;
    }
    if (event.type === 'ROUND_STARTED') {
      this.broadcastState('ROUND_STARTED', state);
      return;
    }
    if (event.type === 'ANSWER_ACCEPTED' || event.type === 'ROUND_RESOLVED' || event.type === 'LOBBY_READY') {
      this.broadcastState(event.type === 'ROUND_RESOLVED' ? 'ROUND_RESOLVED' : 'MATCH_STATE', state);
      return;
    }
    if (event.type === 'PAUSED') {
      await this.setPlayersActivity('reconnecting');
      this.broadcastState('PAUSED_FOR_RECONNECT', state);
      return;
    }
    if (event.type === 'RESUMED') {
      await this.setPlayersActivity(state.startedAtMs === null ? 'preparing' : 'playing');
      this.broadcastState('RESUMED', state);
      return;
    }
    if (event.type === 'CONNECTED') {
      if (source !== undefined) this.sendState(source, 'ROOM_STATE', state);
      return;
    }
  }

  private async finalize(state: LiveMatchState): Promise<void> {
    const summary = await this.repository().finalize(state);
    await this.persistFinalized(state, summary, true);
  }

  private async tryFinalize(state: LiveMatchState): Promise<boolean> {
    try {
      await this.finalize(state);
      return true;
    } catch {
      console.error(JSON.stringify({ code: 'MATCH_FINALIZATION_RETRY', event: 'match_finalization_failed', matchId: state.matchId }));
      await this.ctx.storage.setAlarm(Date.now() + FINALIZATION_RETRY_MS);
      return false;
    }
  }

  private async restoreTerminalSummary(state: LiveMatchState): Promise<FinalizedLiveMatch | null> {
    const stored = await this.ctx.storage.get<FinalizedLiveMatch>(RESULT_KEY);
    if (stored !== undefined) return stored;
    const persisted = await this.repository().readFinalized(state);
    if (persisted === null) return null;
    await this.ctx.storage.put(RESULT_KEY, persisted);
    return persisted;
  }

  private async deferTerminal(socket: WebSocket, state: LiveMatchState): Promise<void> {
    this.sendState(socket, 'MATCH_FINALIZING', state);
    await this.ctx.storage.setAlarm(Date.now() + FINALIZATION_RETRY_MS);
  }

  private async persistFinalized(
    state: LiveMatchState,
    summary: FinalizedLiveMatch,
    notifyPlayers: boolean,
  ): Promise<void> {
    const finalized = markLiveMatchFinalized(state);
    await this.ctx.storage.put({
      [PRESENCE_CLEANUP_KEY]: true,
      [RESULT_KEY]: summary,
      [ROOM_KEY]: finalized,
    });
    if (notifyPlayers) {
      for (const socket of this.ctx.getWebSockets()) this.sendTerminal(socket, finalized, summary);
    }
    await this.finishPresenceCleanup();
  }

  private async finishPresenceCleanup(): Promise<void> {
    try {
      await this.setPlayersActivity('idle');
      await this.ctx.storage.delete(PRESENCE_CLEANUP_KEY);
      await this.ctx.storage.deleteAlarm();
    } catch {
      await this.ctx.storage.put(PRESENCE_CLEANUP_KEY, true);
      await this.ctx.storage.setAlarm(Date.now() + FINALIZATION_RETRY_MS);
    }
  }

  private sendTerminal(socket: WebSocket, state: LiveMatchState, summary: FinalizedLiveMatch): void {
    const attachment = readAttachment(socket);
    if (attachment === null) return;
    const viewer = summary.players[attachment.seat - 1];
    const opponent = summary.players[attachment.seat === 1 ? 1 : 0];
    if (viewer === undefined || opponent === undefined) return;
    const cancelledBySeat = state.pendingOutcome?.kind === 'VOID'
      && state.pendingOutcome.reason === 'CANCELLED'
      ? state.pendingOutcome.cancelledBySeat
      : undefined;
    const cancelledByPlayer = cancelledBySeat === undefined
      ? undefined
      : state.players[cancelledBySeat - 1];
    this.safeSend(socket, {
      ...(cancelledByPlayer === undefined ? {} : {
        cancelledBy: { displayName: cancelledByPlayer.displayName, seat: cancelledByPlayer.seat },
      }),
      match: projectLiveMatchForSeat(state, attachment.seat, Date.now()),
      result: {
        opponent: { result: opponent.result, score: opponent.score },
        viewer: {
          knowledgeAfter: viewer.knowledgeAfter,
          knowledgeBefore: viewer.knowledgeBefore,
          knowledgeDelta: viewer.knowledgeDelta,
          result: viewer.result,
          score: viewer.score,
          xpDelta: viewer.xpDelta,
        },
      },
      type: summary.status === 'FINISHED' ? 'MATCH_FINISHED' : 'MATCH_VOID',
      voidReason: summary.status === 'VOID' ? summary.reason : undefined,
    });
  }

  private sendState(socket: WebSocket, type: string, state: LiveMatchState, extra: object = {}): void {
    const attachment = readAttachment(socket);
    if (attachment === null) return;
    this.safeSend(socket, {
      ...extra,
      match: projectLiveMatchForSeat(state, attachment.seat, Date.now()),
      type,
    });
  }

  private broadcastState(type: string, state: LiveMatchState, except?: WebSocket, extra: object = {}): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== except) this.sendState(socket, type, state, extra);
    }
  }

  private safeSend(socket: WebSocket, payload: object): void {
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      // A confirmação de conexão virá pelo callback de close/error; nunca altera resultado aqui.
    }
  }

  private sendError(socket: WebSocket, code: string, message: string): void {
    this.safeSend(socket, { code, message, type: 'ERROR' });
  }

  private async state(): Promise<LiveMatchState | null> {
    return await this.ctx.storage.get<LiveMatchState>(ROOM_KEY) ?? null;
  }

  private async save(state: LiveMatchState): Promise<void> {
    await this.ctx.storage.put(ROOM_KEY, state);
  }

  private async syncAlarm(state: LiveMatchState): Promise<void> {
    if (state.phase === 'FINISHED' || state.phase === 'VOID') {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    if (state.phase === 'FINALIZING') {
      await this.ctx.storage.setAlarm(Date.now() + FINALIZATION_RETRY_MS);
      return;
    }
    if (state.phase === 'PAUSED' && state.pause !== null) {
      await this.ctx.storage.setAlarm(state.pause.graceDeadlineMs);
      return;
    }
    if (state.phaseDeadlineMs !== null) await this.ctx.storage.setAlarm(state.phaseDeadlineMs);
  }

  private async setPlayersActivity(to: 'idle' | 'playing' | 'preparing' | 'reconnecting'): Promise<void> {
    const state = await this.state();
    if (state === null) return;
    await Promise.all(state.players.map(async (player) => {
      const id = this.env.PRESENCE_HUB.idFromName(player.firebaseUid);
      const response = await this.env.PRESENCE_HUB.get(id).fetch('https://presence.internal/transition', {
        body: JSON.stringify({
          from: ['preparing', 'playing', 'reconnecting'],
          fromResource: state.matchId,
          resource: to === 'idle' ? null : state.matchId,
          to,
        }),
        method: 'POST',
      });
      if (to !== 'idle' || response.ok) return;
      const rejected = await response.json<{ state?: { activity?: string; resource?: string | null } }>();
      if (rejected.state?.activity === 'idle' || rejected.state?.resource !== state.matchId) return;
      throw new Error('Presence da partida terminal ainda não pôde voltar a idle.');
    }));
  }
}
