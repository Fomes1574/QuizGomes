import {
  AsyncHalfCommandError,
  createAsyncHalfState,
  LIVE_ROUND_TRANSITION_MS,
  markAsyncHalfFinalized,
  projectAsyncHalf,
  sealedAnswersOf,
  transitionAsyncHalf,
  type AsyncHalfCommand,
  type AsyncHalfEvent,
  type AsyncHalfSeat,
  type AsyncHalfState,
  isTerminalHalf,
} from '@quiz-gomes/domain';
import type { Env } from '../env.js';
import { ChallengeRepository } from '../repositories/challenge-repository.js';
import { notifyChallengeUpdated } from '../services/challenge-notifier.js';

/**
 * Sala de uma metade do desafio assíncrono.
 *
 * Por que um Durable Object próprio: a metade assíncrona é um jogador só contra o
 * relógio, e a regra do M8 exige detecção AUTORITATIVA de desconexão com graça
 * exata de 7 s. Isso não cabe em HTTP puro, porque não há conexão para observar, e
 * não cabe no `MatchRoom`, que é uma máquina de dois assentos simultâneos e está
 * FROZEN — encaixar uma metade solo ali exigiria forjar o segundo assento dentro de
 * um motor congelado. O DO aqui não recria nada: scoring, timer, graça e resolução
 * vêm das mesmas primitivas do domínio usadas pela partida simultânea.
 */

interface HalfAttachment {
  userId: string;
}

interface InitializeInput {
  challengeId: string;
  createdAtMs: number;
  seat: AsyncHalfSeat;
  userId: string;
}

interface ClientMessage {
  questionId?: string;
  roundNumber?: number;
  selectedOption?: number;
  type?: string;
}

const STATE_KEY = 'half';
const SEALED_KEY = 'sealed-pending';
const REPLACED_SOCKET_CODE = 4_000;
const FINALIZATION_RETRY_MS = 1_000;

function readAttachment(socket: WebSocket): HalfAttachment | null {
  return socket.deserializeAttachment() as HalfAttachment | null;
}

function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

export class ChallengeRoom {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/initialize') return this.initialize(request);
    if (request.method === 'POST' && url.pathname === '/abort') return this.abort();
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
    if (readAttachment(socket) === null) {
      this.sendError(socket, 'INVALID_CONNECTION', 'Conexão sem jogador.');
      return;
    }
    let command: AsyncHalfCommand;
    if (input.type === 'ROUND_READY' && input.roundNumber !== undefined) {
      command = { roundNumber: input.roundNumber, type: 'ROUND_READY' };
    } else if (input.type === 'ANSWER' && input.questionId !== undefined &&
      input.roundNumber !== undefined && input.selectedOption !== undefined) {
      command = {
        questionId: input.questionId,
        roundNumber: input.roundNumber,
        selectedOption: input.selectedOption,
        type: 'ANSWER',
      };
    } else if (input.type === 'CANCEL') {
      command = { type: 'CANCEL' };
    } else {
      this.sendError(socket, 'INVALID_MESSAGE', 'Mensagem inválida.');
      return;
    }
    try {
      await this.applyCommand(command, Date.now());
    } catch (error) {
      if (error instanceof AsyncHalfCommandError) {
        this.sendError(socket, error.code, error.message);
        return;
      }
      throw error;
    }
  }

  async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    if (code === REPLACED_SOCKET_CODE) return;
    if (readAttachment(socket) === null) return;
    const state = await this.state();
    if (state === null || state.phase === 'FINALIZING' || isTerminalHalf(state.phase)) return;
    // Outra aba do mesmo jogador ainda conectada mantém a metade viva.
    if (this.ctx.getWebSockets().some((candidate) => candidate !== socket)) return;
    await this.applyCommand({ type: 'DISCONNECT' }, Date.now());
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket, 1_006);
  }

  async alarm(): Promise<void> {
    const state = await this.state();
    if (state === null) return;
    // Uma metade cancelada já encerrou o desafio: nada mais finaliza aqui.
    if (state.phase === 'CANCELLED') {
      await this.ctx.storage.delete(SEALED_KEY);
      return;
    }
    if (isTerminalHalf(state.phase)) {
      if (await this.ctx.storage.get<boolean>(SEALED_KEY) === true) {
        await this.trySeal(state);
      }
      return;
    }
    if (state.phase === 'FINALIZING') {
      await this.trySeal(state);
      return;
    }
    await this.applyCommand({ type: 'ALARM' }, Date.now());
  }

  /**
   * Encerramento vindo do servidor (cancelar pelo Social, unfriend, bloqueio).
   * Idempotente: uma sala já terminal simplesmente confirma.
   */
  private async abort(): Promise<Response> {
    const state = await this.state();
    if (state === null) return Response.json({ status: 'empty' });
    if (isTerminalHalf(state.phase)) return Response.json({ status: 'already' });
    const cancelled = transitionAsyncHalf(state, { type: 'CANCEL' }, Date.now()).state;
    await this.ctx.storage.put(STATE_KEY, cancelled);
    await this.ctx.storage.delete(SEALED_KEY);
    const payload = JSON.stringify({
      challengeId: cancelled.challengeId,
      match: projectAsyncHalf(cancelled, Date.now()),
      result: {
        opponent: { result: 'VOID', score: 0 },
        viewer: {
          knowledgeAfter: 0, knowledgeBefore: 0, knowledgeDelta: 0,
          result: 'VOID', score: cancelled.score, xpDelta: 0,
        },
      },
      type: 'MATCH_VOID',
      voidReason: 'CANCELLED',
    });
    for (const socket of this.ctx.getWebSockets()) this.safeSend(socket, payload);
    return Response.json({ status: 'cancelled' });
  }

  private repository(): ChallengeRepository {
    return new ChallengeRepository(this.env.CORE_DB);
  }

  private async state(): Promise<AsyncHalfState | null> {
    return await this.ctx.storage.get<AsyncHalfState>(STATE_KEY) ?? null;
  }

  private async initialize(request: Request): Promise<Response> {
    const existing = await this.state();
    if (existing !== null) return Response.json({ status: 'ready' });

    let input: InitializeInput;
    try {
      input = await request.json<InitializeInput>();
    } catch {
      return Response.json({ error: { code: 'INVALID_INITIALIZATION' } }, { status: 400 });
    }
    const challenges = this.repository();
    const challenge = await challenges.byId(input.challengeId);
    if (challenge === null) {
      return Response.json({ error: { code: 'CHALLENGE_NOT_FOUND' } }, { status: 404 });
    }
    const questions = await challenges.questionSet(input.challengeId);
    if (questions.length === 0) {
      return Response.json({ error: { code: 'CHALLENGE_NOT_SEALED' } }, { status: 409 });
    }
    const participants = await this.participants(challenge.firstPlayerUserId, challenge.secondPlayerUserId);
    const viewerId = input.seat === 'FIRST' ? challenge.firstPlayerUserId : challenge.secondPlayerUserId;
    const opponentId = input.seat === 'FIRST' ? challenge.secondPlayerUserId : challenge.firstPlayerUserId;
    const viewer = participants.get(viewerId);
    const opponent = participants.get(opponentId);
    if (viewer === undefined || opponent === undefined) {
      return Response.json({ error: { code: 'PROFILE_REQUIRED' } }, { status: 409 });
    }
    // Só a segunda metade recebe a metade selada — e ainda assim filtrada na projeção.
    const sealedOpponent = input.seat === 'SECOND'
      ? await challenges.sealedHalf(input.challengeId, challenge.firstPlayerUserId)
      : null;

    const state = createAsyncHalfState({
      challengeId: input.challengeId,
      createdAtMs: input.createdAtMs,
      difficulty: challenge.difficulty,
      opponent,
      questions,
      seat: input.seat,
      sealedOpponent,
      viewer,
    });
    await this.ctx.storage.put(STATE_KEY, state);
    await this.ctx.storage.setAlarm(state.phaseDeadlineMs ?? Date.now() + 1_000);
    return Response.json({ status: 'ready' });
  }

  private async participants(firstUserId: string, secondUserId: string) {
    const result = await this.env.CORE_DB.prepare(
      `SELECT p.user_id, p.display_name, p.photo_url, p.equipped_frame_id,
              CASE WHEN a.active = 1 THEN a.version ELSE NULL END AS custom_avatar_version
         FROM user_profiles p
         LEFT JOIN user_custom_avatars a ON a.user_id = p.user_id
        WHERE p.user_id IN (?1, ?2)`,
    ).bind(firstUserId, secondUserId).all<{
      custom_avatar_version: number | null;
      display_name: string;
      equipped_frame_id: string | null;
      photo_url: string | null;
      user_id: string;
    }>();
    return new Map(result.results.map((row) => [row.user_id, {
      customAvatarUrl: row.custom_avatar_version === null
        ? null
        : `/api/avatars/${row.user_id}/v${row.custom_avatar_version}.webp`,
      displayName: row.display_name,
      frameId: row.equipped_frame_id,
      photoUrl: row.photo_url,
    }]));
  }

  private async connect(request: Request): Promise<Response> {
    const userId = request.headers.get('X-QG-Authenticated-User-Id');
    const state = await this.state();
    if (userId === null || state === null) return new Response('Não autorizado', { status: 401 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (client === undefined || server === undefined) return new Response('WebSocket indisponível', { status: 500 });
    for (const socket of this.ctx.getWebSockets()) {
      if (readAttachment(socket)?.userId === userId) socket.close(REPLACED_SOCKET_CODE, 'Sessão substituída');
    }
    server.serializeAttachment({ userId } satisfies HalfAttachment);
    this.ctx.acceptWebSocket(server);
    await this.applyCommand({ type: 'CONNECT' }, Date.now(), server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async applyCommand(
    command: AsyncHalfCommand,
    nowMs: number,
    origin?: WebSocket,
  ): Promise<void> {
    const current = await this.state();
    if (current === null) return;
    const transition = transitionAsyncHalf(current, command, nowMs);
    await this.ctx.storage.put(STATE_KEY, transition.state);
    await this.scheduleAlarm(transition.state);
    this.broadcast(transition.state, transition.event, nowMs, origin);
    if (transition.state.phase === 'CANCELLED') {
      await this.ctx.storage.delete(SEALED_KEY);
      await this.applyCancellation(transition.state);
      return;
    }
    if (transition.state.phase === 'FINALIZING') {
      await this.ctx.storage.put(SEALED_KEY, true);
      await this.trySeal(transition.state);
    }
  }

  /**
   * Cancelamento explícito da própria metade: encerra o desafio no D1, apaga o
   * payload competitivo, libera a dupla e avisa os dois lados. Idempotente — o
   * estado CANCELLED persistido impede qualquer finalização posterior.
   */
  private async applyCancellation(state: AsyncHalfState): Promise<void> {
    const challenges = this.repository();
    const challenge = await challenges.byId(state.challengeId);
    if (challenge === null) return;
    await challenges.cancelChallenge(state.challengeId);
    await notifyChallengeUpdated(this.env, state.challengeId, [
      challenge.firstPlayerUserId,
      challenge.secondPlayerUserId,
    ]);
    const payload = JSON.stringify({
      challengeId: state.challengeId,
      match: projectAsyncHalf(state, Date.now()),
      result: {
        opponent: { result: 'VOID', score: 0 },
        viewer: {
          knowledgeAfter: 0, knowledgeBefore: 0, knowledgeDelta: 0,
          result: 'VOID', score: state.score, xpDelta: 0,
        },
      },
      type: 'MATCH_VOID',
      voidReason: 'CANCELLED',
    });
    for (const socket of this.ctx.getWebSockets()) this.safeSend(socket, payload);
  }

  private async scheduleAlarm(state: AsyncHalfState): Promise<void> {
    if (isTerminalHalf(state.phase)) return;
    const deadline = state.phase === 'FINALIZING'
      ? Date.now() + FINALIZATION_RETRY_MS
      : state.phaseDeadlineMs;
    if (deadline !== null) await this.ctx.storage.setAlarm(deadline);
  }

  private broadcast(
    state: AsyncHalfState,
    event: AsyncHalfEvent,
    nowMs: number,
    origin?: WebSocket,
  ): void {
    const match = projectAsyncHalf(state, nowMs);
    const type = event.type === 'QUESTION_AVAILABLE'
      ? 'ROUND_QUESTION'
      : event.type === 'ROUND_STARTED'
        ? 'ROUND_STARTED'
        : event.type === 'ROUND_RESOLVED'
          ? 'ROUND_RESOLVED'
          : event.type === 'PAUSED'
            ? 'PAUSED_FOR_RECONNECT'
            : event.type === 'RESUMED'
              ? 'RESUMED'
              : 'ROOM_STATE';
    const payload: Record<string, unknown> = { match, type };
    if (event.type === 'QUESTION_AVAILABLE') payload.transitionMs = LIVE_ROUND_TRANSITION_MS;
    const message = JSON.stringify(payload);
    for (const socket of this.ctx.getWebSockets()) this.safeSend(socket, message);
    if (origin !== undefined && !this.ctx.getWebSockets().includes(origin)) {
      this.safeSend(origin, message);
    }
  }

  /**
   * Sela a metade no D1 e avança o desafio. Só depois de a persistência confirmar é
   * que o terminal é anunciado: nada de resultado que existe apenas na memória do DO.
   */
  private async trySeal(state: AsyncHalfState): Promise<void> {
    const challenges = this.repository();
    const challenge = await challenges.byId(state.challengeId);
    if (challenge === null) return;

    if (state.phase === 'VOID') {
      await challenges.voidChallenge(state.challengeId);
      await this.ctx.storage.delete(SEALED_KEY);
      await notifyChallengeUpdated(this.env, state.challengeId, [
        challenge.firstPlayerUserId,
        challenge.secondPlayerUserId,
      ]);
      this.announceTerminal(state, 'MATCH_VOID', 0);
      return;
    }

    const sealed = sealedAnswersOf(state);
    const opponentScore = (state.sealedOpponent ?? [])
      .reduce((total, answer) => total + answer.score, 0);
    try {
      await challenges.sealHalf({
        answers: sealed,
        challengeId: state.challengeId,
        difficulty: state.difficulty,
        isSecondPlayer: state.seat === 'SECOND',
        opponentScore,
        userId: state.seat === 'FIRST' ? challenge.firstPlayerUserId : challenge.secondPlayerUserId,
      });
    } catch {
      await this.ctx.storage.setAlarm(Date.now() + FINALIZATION_RETRY_MS);
      return;
    }
    const finalized = state.phase === 'FINALIZING' ? markAsyncHalfFinalized(state) : state;
    await this.ctx.storage.put(STATE_KEY, finalized);
    await this.ctx.storage.delete(SEALED_KEY);
    // A lista de desafios dos dois lados converge sem polling e sem reload.
    await notifyChallengeUpdated(this.env, state.challengeId, [
      challenge.firstPlayerUserId,
      challenge.secondPlayerUserId,
    ]);
    this.announceTerminal(finalized, 'MATCH_FINISHED', opponentScore);
  }

  private announceTerminal(
    state: AsyncHalfState,
    type: 'MATCH_FINISHED' | 'MATCH_VOID',
    opponentScore: number,
  ): void {
    const waitingForSecond = state.seat === 'FIRST' && type === 'MATCH_FINISHED';
    const result = type === 'MATCH_VOID'
      ? 'VOID'
      : waitingForSecond
        ? 'PENDING'
        : state.score === opponentScore ? 'DRAW' : state.score > opponentScore ? 'WIN' : 'LOSS';
    const payload = JSON.stringify({
      challengeId: state.challengeId,
      match: projectAsyncHalf(state, Date.now()),
      result: {
        opponent: { result: waitingForSecond ? 'PENDING' : result, score: waitingForSecond ? 0 : opponentScore },
        viewer: {
          knowledgeAfter: 0,
          knowledgeBefore: 0,
          knowledgeDelta: 0,
          result,
          score: state.score,
          // XP só é revelado quando o desafio inteiro termina.
          xpDelta: 0,
        },
      },
      type,
      waitingForSecond,
    });
    for (const socket of this.ctx.getWebSockets()) this.safeSend(socket, payload);
  }

  private sendError(socket: WebSocket, code: string, message: string): void {
    this.safeSend(socket, { code, message, type: 'ERROR' });
  }

  private safeSend(socket: WebSocket, payload: unknown): void {
    try {
      socket.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
    } catch {
      // Socket já encerrado: o estado autoritativo permanece no storage do DO.
    }
  }
}
