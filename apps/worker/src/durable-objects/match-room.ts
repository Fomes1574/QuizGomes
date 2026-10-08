import {
  LiveMatchCommandError,
  markLiveMatchFinalized,
  projectLiveMatchForSeat,
  projectLiveMatchPresentationForSeat,
  transitionLiveMatch,
  type LiveMatchCommand,
  type LiveMatchEvent,
  type LiveMatchState,
  type LiveSeat,
  type MatchThemeRewards,
} from '@quiz-gomes/domain';
import type { Env } from '../env.js';
import { ApiError } from '../http/api-error.js';
import {
  LiveMatchRepository,
  type FinalizedLiveMatch,
} from '../repositories/live-match-repository.js';
import { ChallengeRepository } from '../repositories/challenge-repository.js';
import { notifyChallengeUpdated } from '../services/challenge-notifier.js';
import { recordQuestionAnswers } from '../services/question-statistics-service.js';
import { recordValidPlay } from '../services/progression-service.js';
import { AchievementRepository } from '../repositories/achievement-repository.js';
import {
  PHASE_LATE_LOG_MS,
  TransitionQueue,
  measuredSideEffect,
  phaseClock,
  timerDelay,
} from './phase-clock.js';
import {
  recordRankedRewards,
  resolvePlayerTitle,
  themeAchievements,
  type RankedRewardInput,
} from '../services/player-title-service.js';

interface RoomAttachment {
  seat: LiveSeat;
  uid: string;
  userId: string;
}

interface InitializeRoomInput {
  createdAtMs: number;
  firebaseUids: [string, string];
  /** Origem decidida pelo servidor que chamou `/initialize` — nunca pelo cliente. */
  kind: 'DIRECT_LIVE' | 'MATCHMAKING';
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
const REWARDS_KEY = 'theme-rewards';
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

/** Prazo que o relógio da sala está esperando agora (na pausa, a carência). */
function phaseDeadlineOf(state: LiveMatchState): number | null {
  return state.phase === 'PAUSED' && state.pause !== null ? state.pause.graceDeadlineMs : state.phaseDeadlineMs;
}

type PhaseTrigger = 'alarm' | 'message' | 'timer';

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
  // A primeira inicialização atravessa D1 e storage; dois aceites/retries para
  // o MESMO roomId podem chegar nesse await antes de `ROOM_KEY` existir. Sem
  // esta promessa compartilhada, o segundo request vê state nulo, bate no lock
  // de jogador do primeiro e devolve PLAYER_BUSY apesar de ser a mesma sala.
  private initializationInFlight: Promise<LiveMatchState> | null = null;
  /** Cronômetro em memória da fase atual; o alarme do storage é a reserva. */
  private phaseTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly transitions = new TransitionQueue();
  /** Avisos de presença saem na ordem dos eventos, mesmo fora da fila de transições. */
  private readonly presenceUpdates = new TransitionQueue();

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/initialize') return this.initialize(request);
    if (request.method === 'POST' && url.pathname === '/reconcile') return this.reconcile();
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

  async alarm(alarmInfo?: { isRetry?: boolean; retryCount?: number }): Promise<void> {
    const state = await this.state();
    if (state === null) return;
    if (alarmInfo?.isRetry === true) {
      // Repetição depois de uma falha: a Cloudflare espera segundos antes de tentar de novo.
      console.warn(JSON.stringify({ code: 'MATCH_ALARM_RETRY', matchId: state.matchId, phase: state.phase, retryCount: alarmInfo.retryCount ?? null }));
    }
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
    await this.applyCommand({ type: 'ALARM' }, Date.now(), undefined, 'alarm');
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
      (input.kind !== 'DIRECT_LIVE' && input.kind !== 'MATCHMAKING') ||
      !Number.isFinite(input.createdAtMs)) {
      return Response.json({ error: 'invalid_initialization' }, { status: 400 });
    }
    if (this.initializationInFlight !== null) {
      try {
        return this.initializationResponse(await this.initializationInFlight);
      } catch (error) {
        return this.initializationFailure(input.matchId, error);
      }
    }
    const repository = this.repository();
    const initializeOnce = async (): Promise<LiveMatchState> => {
      const state = await repository.initialize(input);
      await this.attachTitles(state);
      try {
        await this.save(state);
        await this.syncAlarm(state);
        return state;
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
        throw initializationError;
      }
    };
    this.initializationInFlight = initializeOnce();
    try {
      return this.initializationResponse(await this.initializationInFlight, 201);
    } catch (error) {
      return this.initializationFailure(input.matchId, error);
    } finally {
      this.initializationInFlight = null;
    }
  }

  /**
   * Título sob o nome de cada jogador e a posição no Top do tema no início
   * (para o resultado dizer se subiu ou caiu). Enfeite: se falhar, a partida
   * segue sem título.
   */
  private async attachTitles(state: LiveMatchState): Promise<void> {
    await Promise.all(state.players.map(async (player) => {
      try {
        player.title = await resolvePlayerTitle(this.env, player.userId, state.themeId);
        player.themeTopPosition = state.mode === 'RANKED'
          ? await themeAchievements(this.env).topPosition(player.userId, state.themeId)
          : null;
      } catch {
        player.title = null;
        player.themeTopPosition = null;
        console.warn(JSON.stringify({ code: 'PLAYER_TITLE_UNAVAILABLE', matchId: state.matchId }));
      }
    }));
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

  /**
   * Sonda interna de ciclo de vida. A existência de uma linha em `matches` não
   * prova que este Durable Object chegou a persistir uma sala; por isso a
   * reconciliação externa consulta este estado, e não o D1, para decidir se a
   * reserva DIRECT ainda é recuperável.
   */
  private async reconcile(): Promise<Response> {
    let state = await this.state();
    if (state === null) return Response.json({ phase: 'MISSING' });

    const deadlineReached = state.phaseDeadlineMs !== null && state.phaseDeadlineMs <= Date.now();
    if (state.phase === 'FINALIZING' || deadlineReached ||
      state.phase === 'FINISHED' || state.phase === 'VOID') {
      await this.alarm();
      state = await this.state();
    }

    if (state !== null && (state.phase === 'FINISHED' || state.phase === 'VOID')) {
      // Também cobre terminais persistidos por versões anteriores que ainda
      // não tenham alcançado a linha de desafio.
      await this.reconcileDirectChallenge(state.matchId);
    }
    return Response.json({ phase: state?.phase ?? 'MISSING' });
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

    if (state.phase === 'FINISHED' || state.phase === 'VOID' || state.phase === 'FINALIZING') {
      await this.connectToTerminal(server, state);
    } else if (terminalOnly) {
      await this.connectForTerminalOnly(server, state, player.seat);
    } else {
      const connected = await this.transitions.run(async () => {
        // Relido dentro da fila: outra transição pode ter passado desde a leitura acima.
        const latest = await this.state() ?? state;
        if (latest.phase === 'FINISHED' || latest.phase === 'VOID' || latest.phase === 'FINALIZING') {
          return { latest, transition: null };
        }
        const transition = transitionLiveMatch(latest, { seat: player.seat, type: 'CONNECT' }, Date.now());
        await this.save(transition.state);
        await this.syncAlarm(transition.state);
        let effects: Promise<void> = Promise.resolve();
        if (transition.event.type === 'RESUMED') {
          this.broadcastState('RESUMED', transition.state);
          effects = this.startEventEffects(transition.event, transition.state, latest, this.ctx.getWebSockets());
        } else if (transition.event.type !== 'FINALIZE') {
          this.sendState(server, 'ROOM_STATE', transition.state);
          this.broadcastState('MATCH_STATE', transition.state, server);
          if (transition.event.type === 'CONNECTED' && transition.state.phase === 'LOBBY') {
            effects = this.updatePresence('preparing', transition.state.matchId);
          }
          if (transition.event.type === 'CONNECTED' && ['ROUND_READY', 'READING', 'ANSWERING', 'ROUND_RESULT'].includes(transition.state.phase)) {
            effects = this.recordRoundDeliveryMeasured(transition.state, [server]);
          }
        }
        return { effects, latest, transition };
      });
      if (connected.transition === null) {
        await this.connectToTerminal(server, connected.latest);
      } else if (connected.transition.event.type === 'FINALIZE') {
        if (!await this.tryFinalize(connected.transition.state)) await this.deferTerminal(server, connected.transition.state);
      } else {
        await connected.effects;
      }
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Sala já decidida: entrega o resultado guardado ou avisa que ele está sendo confirmado. */
  private async connectToTerminal(server: WebSocket, state: LiveMatchState): Promise<void> {
    if (state.phase === 'FINISHED' || state.phase === 'VOID') {
      const summary = await this.restoreTerminalSummary(state);
      if (summary === null) {
        await this.deferTerminal(server, state);
        return;
      }
      this.sendTerminal(server, state, summary);
      const rewards = await this.ctx.storage.get<Record<string, MatchThemeRewards>>(REWARDS_KEY);
      if (rewards !== undefined) this.sendRewards(server, rewards);
      return;
    }
    if (!await this.tryFinalize(state)) await this.deferTerminal(server, state);
  }

  private async connectForTerminalOnly(
    socket: WebSocket,
    state: LiveMatchState,
    seat: LiveSeat,
  ): Promise<void> {
    const outcome = await this.transitions.run(async () => {
      const latest = await this.state() ?? state;
      if (latest.phase === 'FINISHED' || latest.phase === 'VOID' || latest.phase === 'FINALIZING') return null;
      const transition = latest.phase === 'PAUSED'
        ? transitionLiveMatch(latest, { type: 'ALARM' }, Date.now())
        : transitionLiveMatch(latest, { seat, type: 'DISCONNECT' }, Date.now());
      await this.save(transition.state);
      await this.syncAlarm(transition.state);
      let effects: Promise<void> = Promise.resolve();
      if (transition.event.type === 'PAUSED') {
        this.broadcastState('PAUSED_FOR_RECONNECT', transition.state, socket);
        effects = this.updatePresence('reconnecting', transition.state.matchId);
      }
      return { effects, transition };
    });
    if (outcome?.transition.event.type === 'FINALIZE') {
      if (!await this.tryFinalize(outcome.transition.state)) this.safeSend(socket, { type: 'MATCH_FINALIZING' });
      return;
    }
    await outcome?.effects;
    this.safeSend(socket, { type: 'MATCH_FINALIZING' });
  }

  /**
   * Uma transição por vez: lê, decide, grava, rearma os relógios e avisa os
   * jogadores — sem nenhuma chamada de rede externa no meio. Presença e
   * recibo de denúncia saem depois do aviso e nunca atrasam nem travam a
   * rodada (antes, uma falha neles deixava a pergunta sem ser enviada).
   */
  private async applyCommand(
    command: LiveMatchCommand,
    nowMs: number,
    source?: WebSocket,
    trigger: PhaseTrigger = 'message',
  ): Promise<void> {
    const applied = await this.transitions.run(async () => {
      const current = await this.state();
      if (current === null) throw new LiveMatchCommandError('ROOM_NOT_FOUND', 'Sala não encontrada.');
      const deadlineMs = phaseDeadlineOf(current);
      const clockMs = command.type === 'ALARM' ? phaseClock(current.phase, deadlineMs, nowMs) : nowMs;
      const transition = transitionLiveMatch(current, command, clockMs);
      if (command.type === 'ALARM' && transition.event.type === 'NOOP') {
        // Gatilho antes do prazo, ou repetido depois que o outro já passou a
        // fase: nada mudou. Só garante os dois relógios armados.
        await this.rearmAfterIdleTrigger(current, trigger);
        return null;
      }
      if (command.type === 'ALARM' && deadlineMs !== null && clockMs - deadlineMs >= PHASE_LATE_LOG_MS) {
        console.warn(JSON.stringify({
          code: 'MATCH_PHASE_LATE', lateMs: clockMs - deadlineMs, matchId: current.matchId, phase: current.phase, trigger,
        }));
      }
      if (transition.event.type === 'QUESTION_AVAILABLE' && current.startedAtMs === null) {
        await this.repository().markStarted(current.matchId);
      }
      await this.save(transition.state);
      await this.syncAlarm(transition.state);
      const recipients = this.ctx.getWebSockets();
      this.broadcastEvent(transition.event, transition.state, source);
      return {
        effects: this.startEventEffects(transition.event, transition.state, current, recipients),
        transition,
      };
    });
    if (applied === null) return;
    await applied.effects;
    if (applied.transition.event.type === 'FINALIZE' && !await this.tryFinalize(applied.transition.state)) {
      this.broadcastState('MATCH_FINALIZING', applied.transition.state);
    }
  }

  private broadcastEvent(event: LiveMatchEvent, state: LiveMatchState, source?: WebSocket): void {
    if (event.type === 'NOOP') {
      if (source !== undefined) this.sendState(source, 'MATCH_STATE', state);
      return;
    }
    if (event.type === 'PREPARING') {
      this.broadcastState('PREPARING', state);
      return;
    }
    if (event.type === 'QUESTION_AVAILABLE') {
      this.broadcastState('ROUND_QUESTION', state);
      return;
    }
    if (event.type === 'READING_STARTED') {
      // Os dois prontos: 1,5 s de leitura com a pergunta e a foto, sem alternativas.
      this.broadcastState('ROUND_READING', state);
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
      this.broadcastState('PAUSED_FOR_RECONNECT', state);
      return;
    }
    if (event.type === 'RESUMED') {
      this.broadcastState('RESUMED', state);
      return;
    }
    if (event.type === 'CONNECTED') {
      if (source !== undefined) this.sendState(source, 'ROOM_STATE', state);
    }
  }

  /**
   * Efeitos fora do caminho da rodada, disparados já na ordem dos eventos e
   * aguardados só depois que a fila de transições foi liberada. Nunca lançam.
   */
  private startEventEffects(
    event: LiveMatchEvent,
    state: LiveMatchState,
    previous: LiveMatchState,
    recipients: readonly WebSocket[],
  ): Promise<void> {
    const effects: Promise<void>[] = [];
    if (event.type === 'QUESTION_AVAILABLE') {
      // "Jogando" é avisado uma vez, na primeira pergunta; depois só muda na pausa/retomada.
      if (previous.startedAtMs === null) effects.push(this.updatePresence('playing', state.matchId));
      effects.push(this.recordRoundDeliveryMeasured(state, recipients));
    }
    if (event.type === 'PAUSED') effects.push(this.updatePresence('reconnecting', state.matchId));
    if (event.type === 'RESUMED') {
      effects.push(this.updatePresence(state.startedAtMs === null ? 'preparing' : 'playing', state.matchId));
      effects.push(this.recordRoundDeliveryMeasured(state, recipients));
    }
    return Promise.all(effects).then(() => undefined);
  }

  private updatePresence(to: 'playing' | 'preparing' | 'reconnecting', matchId: string): Promise<void> {
    return this.presenceUpdates.run(() => measuredSideEffect(`presence_${to}`, { matchId }, () => this.setPlayersActivity(to)));
  }

  private recordRoundDeliveryMeasured(state: LiveMatchState, recipients: readonly WebSocket[]): Promise<void> {
    // Só existe pergunta entregue a partir da rodada (na preparação ainda não há nenhuma).
    if (!['ROUND_READY', 'READING', 'ANSWERING', 'ROUND_RESULT'].includes(state.phase)) return Promise.resolve();
    return measuredSideEffect('report_view', { matchId: state.matchId }, () => this.recordRoundDelivery(state, recipients));
  }

  /** O gatilho chegou sem nada a fazer: mantém cronômetro e alarme de reserva no prazo atual. */
  private async rearmAfterIdleTrigger(state: LiveMatchState, trigger: PhaseTrigger): Promise<void> {
    const deadlineMs = phaseDeadlineOf(state);
    if (deadlineMs === null) return;
    this.armPhaseTimer(deadlineMs);
    // Dentro do próprio alarme, reagendar exatamente o mesmo instante pode ser
    // tratado como "já executado"; 1 ms depois é inofensivo e garante a reserva.
    if (trigger === 'alarm') await this.ctx.storage.setAlarm(deadlineMs + 1);
  }

  private armPhaseTimer(deadlineMs: number): void {
    this.clearPhaseTimer();
    this.phaseTimer = setTimeout(() => {
      this.phaseTimer = null;
      void this.onPhaseTimer();
    }, timerDelay(deadlineMs, Date.now()));
  }

  private clearPhaseTimer(): void {
    if (this.phaseTimer !== null) clearTimeout(this.phaseTimer);
    this.phaseTimer = null;
  }

  private async onPhaseTimer(): Promise<void> {
    try {
      const state = await this.state();
      if (state === null || state.phase === 'FINALIZING' || state.phase === 'FINISHED' || state.phase === 'VOID') return;
      await this.applyCommand({ type: 'ALARM' }, Date.now(), undefined, 'timer');
    } catch (error) {
      // O alarme de reserva continua agendado no mesmo prazo e tenta de novo.
      console.error(JSON.stringify({
        code: 'MATCH_PHASE_TIMER_FAILED', message: error instanceof Error ? error.message.slice(0, 120) : 'erro desconhecido',
      }));
    }
  }

  private async finalize(state: LiveMatchState): Promise<void> {
    const summary = await this.repository().finalize(state);
    await this.persistFinalized(state, summary, true);
  }

  /**
   * Registra somente os sockets aos quais ROUND_QUESTION será projetado. A
   * composição da sala não é prova de entrega: numa borda de desconexão um
   * jogador pode já não ter recebido o payload. Falha desta telemetria nunca
   * atrasa nem interrompe a partida.
   */
  private async recordRoundDelivery(state: LiveMatchState, sockets: readonly WebSocket[] = this.ctx.getWebSockets()): Promise<void> {
    const question = state.questions[state.roundIndex];
    if (question === undefined) return;
    const recipients = new Set(
      sockets
        .map(readAttachment)
        .filter((attachment): attachment is RoomAttachment => attachment !== null)
        .map((attachment) => attachment.userId),
    );
    if (recipients.size === 0) return;
    try {
      await this.env.CORE_DB.batch([...recipients].map((userId) => this.env.CORE_DB.prepare(
        `INSERT OR IGNORE INTO question_report_views
          (context_kind, context_id, user_id, round_number, question_id)
         VALUES ('MATCH', ?1, ?2, ?3, ?4)`,
      ).bind(state.matchId, userId, state.roundIndex + 1, question.id)));
    } catch {
      // A partida continua: uma falha no recurso não competitivo de denúncia
      // não pode afetar deadline, score, reconexão ou resultado.
      console.error(JSON.stringify({ code: 'REPORT_VIEW_RECORD_FAILED', event: 'match_question_delivery', matchId: state.matchId }));
    }
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
    await this.reconcileDirectChallenge(state.matchId);
    await this.recordMatchStatistics(state.matchId);
    await this.recordMatchProgress(state, summary);
    await this.recordThemeRewards(state, summary);
    await this.finishPresenceCleanup();
  }

  /**
   * Conquistas e Top do tema depois de uma Rankeada. Chegam num aviso à
   * parte (MATCH_REWARDS), logo depois do resultado: se falharem, o
   * resultado já foi entregue e nada competitivo muda.
   */
  private async recordThemeRewards(state: LiveMatchState, summary: FinalizedLiveMatch): Promise<void> {
    if (state.mode !== 'RANKED') return;
    if (await this.ctx.storage.get(REWARDS_KEY) !== undefined) return;
    const penalizedSeat = state.pendingOutcome?.kind === 'VOID' ? state.pendingOutcome.penalizedSeat : null;
    const inputs: RankedRewardInput[] = [];
    summary.players.forEach((player, index) => {
      const opponent = summary.players[index === 0 ? 1 : 0];
      const result = summary.status === 'FINISHED'
        ? player.result
        : penalizedSeat === player.seat ? 'ABANDONED' : null;
      if (opponent === undefined || (result !== 'WIN' && result !== 'LOSS' && result !== 'DRAW' && result !== 'ABANDONED')) return;
      inputs.push({
        correctAnswers: 0,
        outcome: {
          knowledgeAfter: player.knowledgeAfter,
          knowledgeBefore: player.knowledgeBefore,
          opponentKnowledgeBefore: opponent.knowledgeBefore,
          opponentScore: opponent.score,
          result,
          score: player.score,
        },
        topBefore: state.players[player.seat - 1]?.themeTopPosition ?? null,
        userId: player.userId,
      });
    });
    if (inputs.length === 0) return;
    try {
      const correct = await this.env.CORE_DB.prepare(
        'SELECT user_id, SUM(is_correct) AS correct FROM match_answers WHERE match_id = ?1 GROUP BY user_id',
      ).bind(state.matchId).all<{ correct: number | null; user_id: string }>();
      for (const input of inputs) {
        input.correctAnswers = correct.results.find((row) => row.user_id === input.userId)?.correct ?? 0;
      }
      const rewards = await recordRankedRewards(this.env, state.matchId, state.themeId, inputs);
      const stored = Object.fromEntries(rewards);
      await this.ctx.storage.put(REWARDS_KEY, stored);
      for (const socket of this.ctx.getWebSockets()) this.sendRewards(socket, stored);
    } catch {
      console.error(JSON.stringify({ code: 'THEME_REWARDS_RECORD_FAILED', matchId: state.matchId }));
    }
  }

  private sendRewards(socket: WebSocket, rewards: Record<string, MatchThemeRewards>): void {
    const attachment = readAttachment(socket);
    const mine = attachment === null ? undefined : rewards[attachment.userId];
    if (mine === undefined) return;
    if (mine.achievements.length === 0 && mine.top.after === mine.top.before) return;
    this.safeSend(socket, { rewards: mine, type: 'MATCH_REWARDS' });
  }

  /**
   * Missões e streak só avançam para uma partida genuinamente `FINISHED` —
   * nunca `VOID` — e leem as respostas de volta de `match_answers`, com a
   * mesma idempotência por retry que as estatísticas de pergunta já têm.
   */
  private async recordMatchProgress(state: LiveMatchState, summary: FinalizedLiveMatch): Promise<void> {
    if (summary.status !== 'FINISHED') return;
    try {
      const rows = await this.env.CORE_DB.prepare(
        `SELECT user_id, COUNT(*) AS total_answers, SUM(is_correct) AS correct_answers
           FROM match_answers WHERE match_id = ?1 GROUP BY user_id`,
      ).bind(state.matchId).all<{ correct_answers: number; total_answers: number; user_id: string }>();
      const nowMs = Date.now();
      await Promise.all(rows.results.map((row) => recordValidPlay(this.env.CORE_DB, {
        correctAnswers: row.correct_answers,
        nowMs,
        themeId: state.themeId,
        totalAnswers: row.total_answers,
        userId: row.user_id,
      })));
      const achievements = new AchievementRepository(this.env.CORE_DB);
      await Promise.all(summary.players
        .filter((player) => player.personalRecord === true)
        .map((player) => achievements.evaluatePersonalRecord(player.userId, state.themeId, state.mode)));
    } catch {
      console.error(JSON.stringify({ code: 'PROGRESSION_RECORD_FAILED', event: 'match_progress', matchId: state.matchId }));
    }
  }

  /**
   * Estatísticas de pergunta são lidas de volta do resultado já persistido
   * (`match_answers`/`match_questions`), nunca do estado em memória: assim
   * funcionam igual numa finalização nova ou num retry que só repete o
   * `persistFinalized` de um resultado já aplicado. `recordQuestionAnswers`
   * tem sua própria idempotência por ledger, então retry nunca duplica.
   */
  private async recordMatchStatistics(matchId: string): Promise<void> {
    try {
      const rows = await this.env.CORE_DB.prepare(
        `SELECT ma.round_number, ma.user_id, ma.selected_option, ma.remaining_ms, ma.is_correct, mq.question_id
           FROM match_answers ma
           JOIN match_questions mq ON mq.match_id = ma.match_id AND mq.round_number = ma.round_number
          WHERE ma.match_id = ?1`,
      ).bind(matchId).all<{
        is_correct: number; question_id: string; remaining_ms: number;
        round_number: number; selected_option: number | null; user_id: string;
      }>();
      await recordQuestionAnswers(this.env.QUESTIONS_DB, rows.results.map((row) => ({
        contextId: matchId,
        contextKind: 'MATCH' as const,
        correct: row.is_correct === 1,
        questionId: row.question_id,
        remainingMs: row.remaining_ms,
        roundNumber: row.round_number,
        selectedOption: row.selected_option,
        userId: row.user_id,
      })));
    } catch {
      console.error(JSON.stringify({ code: 'QUESTION_STATISTICS_RECORD_FAILED', event: 'match_statistics', matchId }));
    }
  }

  private async reconcileDirectChallenge(matchId: string): Promise<void> {
    try {
      const result = await new ChallengeRepository(this.env.CORE_DB).reconcileDirectMatchId(matchId);
      if (result.changed && result.challengeId !== null && result.participants !== null) {
        await notifyChallengeUpdated(this.env, result.challengeId, result.participants);
      }
    } catch {
      // Leitura/criação de desafio reaplica a convergência bounded como fallback.
      console.error(JSON.stringify({ code: 'CHALLENGE_DIRECT_RECONCILE_FAILED', event: 'challenge_direct_terminal' }));
    }
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
          personalRecord: viewer.personalRecord === true,
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

  /** Cronômetro em memória no prazo exato e alarme do storage como reserva, no mesmo prazo. */
  private async syncAlarm(state: LiveMatchState): Promise<void> {
    if (state.phase === 'FINISHED' || state.phase === 'VOID') {
      this.clearPhaseTimer();
      await this.ctx.storage.deleteAlarm();
      return;
    }
    if (state.phase === 'FINALIZING') {
      this.clearPhaseTimer();
      await this.ctx.storage.setAlarm(Date.now() + FINALIZATION_RETRY_MS);
      return;
    }
    const deadlineMs = phaseDeadlineOf(state);
    if (deadlineMs === null) {
      this.clearPhaseTimer();
      return;
    }
    this.armPhaseTimer(deadlineMs);
    await this.ctx.storage.setAlarm(deadlineMs);
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
