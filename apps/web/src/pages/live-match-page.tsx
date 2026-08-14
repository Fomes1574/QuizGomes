import { RECONNECT_GRACE_MS, type LiveMatchProjection, type MatchResult } from '@quiz-gomes/domain';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../components/button.js';
import { Logo } from '../components/logo.js';
import {
  MatchConnectionScreen,
  type MatchConnectionScreenKind,
} from '../components/match-connection-screen.js';
import { MatchResultScreen } from '../components/match-result-screen.js';
import {
  MATCH_QUESTION_ENTRANCE_MS,
  MatchRoundTransition,
  roundPresentationDelay,
} from '../components/match-round-transition.js';
import { MatchScreen } from '../components/match-screen.js';
import { useAuth } from '../features/auth-context.js';
import { apiRequest, websocketUrl } from '../lib/api.js';
import { takePreparedMatchRoom } from '../lib/preloaded-match-room.js';

interface TerminalResult {
  opponent: { result: MatchResult; score: number };
  viewer: {
    knowledgeAfter: number;
    knowledgeBefore: number;
    knowledgeDelta: number;
    result: MatchResult;
    score: number;
    xpDelta: number;
  };
}

interface RoomMessage {
  code?: string;
  match?: LiveMatchProjection;
  message?: string;
  result?: TerminalResult;
  transitionMs?: number;
  type?: string;
  voidReason?: string;
}

export type LocalConnectionState = 'CONNECTED' | 'RECONNECTING' | 'SUSPECTED_LOSS' | 'TERMINAL_RECOVERY';

export const MATCH_HEARTBEAT_INTERVAL_MS = 1_500;
export const MATCH_PONG_TIMEOUT_MS = 3_000;
export const MATCH_CONNECTION_EXIT_MS = 180;
export const MATCH_SOCKET_OPEN_TIMEOUT_MS = 2_000;
const CLIENT_CONNECTION_LOSS_CODE = 4_001;
const TERMINAL_RECOVERY_RETRY_MS = 3_000;

interface PauseVisualState {
  deadlineMs: number;
  kind: MatchConnectionScreenKind;
  leaving: boolean;
}

export function LiveMatchPage() {
  const { roomId = '' } = useParams();
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const socketRef = useRef<WebSocket | null>(null);
  const [projection, setProjection] = useState<LiveMatchProjection | null>(null);
  const [deadlineMs, setDeadlineMs] = useState<number | null>(null);
  const [roundIntro, setRoundIntro] = useState<{ durationMs: number; number: number; total: number } | null>(null);
  const [statusMessage, setStatusMessage] = useState('Conectando à sala');
  const [error, setError] = useState<string | null>(null);
  const [terminal, setTerminal] = useState<{ result: TerminalResult; voidReason?: string } | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [localConnectionState, setLocalConnectionState] = useState<LocalConnectionState>('CONNECTED');
  const [pauseVisual, setPauseVisual] = useState<PauseVisualState | null>(null);

  useEffect(() => {
    let disposed = false;
    let retryStartedAt: number | null = null;
    let retryTimer: number | null = null;
    let roundReadyTimer: number | null = null;
    let countdownTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let localGraceTimer: number | null = null;
    let pauseExitTimer: number | null = null;
    let socketOpenTimer: number | null = null;
    let generation = 0;
    let terminalReached = false;
    let terminalRecovery = false;
    let connecting = false;
    let connectionState: LocalConnectionState = 'CONNECTED';
    let lastPongAt = 0;
    let pauseKind: MatchConnectionScreenKind | null = null;
    let connect: (() => Promise<void>) | null = null;

    const updateConnectionState = (next: LocalConnectionState) => {
      connectionState = next;
      setLocalConnectionState(next);
    };
    const clearHeartbeat = () => {
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    };
    const clearLocalGrace = () => {
      if (localGraceTimer !== null) window.clearTimeout(localGraceTimer);
      localGraceTimer = null;
    };
    const clearSocketOpen = () => {
      if (socketOpenTimer !== null) window.clearTimeout(socketOpenTimer);
      socketOpenTimer = null;
    };
    const clearPauseExit = () => {
      if (pauseExitTimer !== null) window.clearTimeout(pauseExitTimer);
      pauseExitTimer = null;
    };
    const hidePauseImmediately = () => {
      clearPauseExit();
      pauseKind = null;
      setPauseVisual(null);
    };
    const showPause = (kind: MatchConnectionScreenKind, deadlineMs: number) => {
      clearPauseExit();
      pauseKind = kind;
      setPauseVisual({ deadlineMs, kind, leaving: false });
    };
    const leavePauseAfterResume = () => {
      if (pauseKind === null) {
        updateConnectionState('CONNECTED');
        return;
      }
      clearPauseExit();
      setPauseVisual((current) => current === null ? null : { ...current, leaving: true });
      pauseExitTimer = window.setTimeout(() => {
        pauseExitTimer = null;
        pauseKind = null;
        setPauseVisual(null);
        updateConnectionState('CONNECTED');
      }, MATCH_CONNECTION_EXIT_MS);
    };

    const clearRoundReady = () => {
      if (roundReadyTimer !== null) window.clearTimeout(roundReadyTimer);
      roundReadyTimer = null;
    };
    const clearCountdown = () => {
      if (countdownTimer !== null) window.clearInterval(countdownTimer);
      countdownTimer = null;
      setCountdown(null);
    };
    const clearRetry = () => {
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      retryTimer = null;
    };
    const scheduleRetry = (delayMs: number) => {
      clearRetry();
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        if (connectionState === 'SUSPECTED_LOSS') updateConnectionState('RECONNECTING');
        if (connect !== null) void connect();
      }, delayMs);
    };
    const enterTerminalRecovery = () => {
      terminalRecovery = true;
      updateConnectionState('TERMINAL_RECOVERY');
      clearHeartbeat();
      clearLocalGrace();
      clearSocketOpen();
      hidePauseImmediately();
      clearRoundReady();
      clearCountdown();
      setProjection(null);
      setDeadlineMs(null);
      setRoundIntro(null);
      setError(null);
      setStatusMessage('Confirmando encerramento da partida...');
    };
    const armLocalGrace = () => {
      if (retryStartedAt === null || localGraceTimer !== null) return;
      localGraceTimer = window.setTimeout(() => {
        localGraceTimer = null;
        if (disposed || terminalReached || retryStartedAt === null || connectionState === 'CONNECTED') return;
        const socket = socketRef.current;
        socketRef.current = null;
        clearSocketOpen();
        clearRetry();
        enterTerminalRecovery();
        socket?.close(CLIENT_CONNECTION_LOSS_CODE, 'Graça local encerrada');
        scheduleRetry(0);
      }, Math.max(0, retryStartedAt + RECONNECT_GRACE_MS - Date.now()));
    };
    const updateCountdown = (match: LiveMatchProjection) => {
      clearCountdown();
      if (match.phase !== 'PREPARING' || match.remainingMs === undefined) {
        return;
      }
      const endsAt = Date.now() + match.remainingMs;
      const update = () => setCountdown(Math.max(1, Math.ceil((endsAt - Date.now()) / 1_000)));
      update();
      countdownTimer = window.setInterval(update, 100);
    };
    const acknowledgeRound = (
      socket: WebSocket,
      match: LiveMatchProjection,
      delayMs: number,
      showPresentation = false,
    ) => {
      if (match.round === undefined) return;
      clearRoundReady();
      const presentationMs = Math.max(0, delayMs);
      setRoundIntro(showPresentation ? { ...match.round, durationMs: presentationMs } : null);
      roundReadyTimer = window.setTimeout(() => {
        roundReadyTimer = null;
        setRoundIntro(null);
        if (showPresentation) setStatusMessage('Sincronizando jogadores');
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ roundNumber: match.round?.number, type: 'ROUND_READY' }));
        }
      }, presentationMs);
    };
    const applyProjection = (match: LiveMatchProjection) => {
      setProjection(match);
      updateCountdown(match);
      if (match.phase === 'ANSWERING' && match.remainingMs !== undefined) {
        setDeadlineMs(Date.now() + match.remainingMs);
        setRoundIntro(null);
      }
      if (match.phase === 'ROUND_RESULT') {
        setDeadlineMs(Date.now());
        setRoundIntro(null);
      }
      if (match.phase === 'PAUSED' && match.paused !== undefined) {
        const kind = connectionState === 'CONNECTED' ? 'opponent' : 'local';
        showPause(kind, Date.now() + match.paused.graceRemainingMs);
      }
    };

    const handleMessage = (socket: WebSocket, raw: string) => {
      if (disposed || socketRef.current !== socket) return;
      let payload: RoomMessage;
      try {
        payload = JSON.parse(raw) as RoomMessage;
      } catch {
        setError('A sala enviou uma mensagem inválida.');
        return;
      }
      if (payload.type === 'PONG') {
        if (socketRef.current === socket) lastPongAt = Date.now();
        return;
      }
      if (payload.type === 'ERROR') {
        if (terminalRecovery || payload.code === 'MATCH_NOT_ACTIVE') {
          enterTerminalRecovery();
          return;
        }
        setError(payload.message ?? 'A sala rejeitou esta ação.');
        return;
      }
      if ((payload.type === 'MATCH_FINISHED' || payload.type === 'MATCH_VOID') && payload.result !== undefined) {
        terminalReached = true;
        terminalRecovery = false;
        clearHeartbeat();
        clearLocalGrace();
        clearSocketOpen();
        hidePauseImmediately();
        clearRetry();
        clearRoundReady();
        clearCountdown();
        updateConnectionState('CONNECTED');
        setRoundIntro(null);
        if (payload.match !== undefined) setProjection(payload.match);
        setTerminal(payload.voidReason === undefined
          ? { result: payload.result }
          : { result: payload.result, voidReason: payload.voidReason });
        return;
      }
      if (payload.type === 'MATCH_FINALIZING' ||
        payload.match?.phase === 'FINALIZING' || payload.match?.phase === 'FINISHED' || payload.match?.phase === 'VOID') {
        enterTerminalRecovery();
        return;
      }
      if (payload.match !== undefined) {
        if ((payload.type === 'RESUMED' || payload.type === 'ROOM_STATE') && payload.match.phase !== 'PAUSED') {
          terminalRecovery = false;
          retryStartedAt = null;
          clearLocalGrace();
          leavePauseAfterResume();
        }
        applyProjection(payload.match);
      }
      if (payload.type === 'ROOM_STATE') {
        if (payload.match?.phase === 'LOBBY') socket.send(JSON.stringify({ type: 'READY' }));
        if (payload.match?.phase === 'ROUND_READY') acknowledgeRound(socket, payload.match, 0);
      }
      if (payload.type === 'PREPARING') setStatusMessage('PREPARE-SE PARA A PARTIDA');
      if (payload.type === 'ROUND_QUESTION' && payload.match !== undefined) {
        acknowledgeRound(socket, payload.match, roundPresentationDelay(payload.transitionMs), true);
      }
      if (payload.type === 'RESUMED') {
        setStatusMessage('Partida restaurada');
        if (payload.match?.phase === 'ROUND_READY') acknowledgeRound(socket, payload.match, 0);
      }
    };

    const handleConnectionLoss = (socket?: WebSocket, suspected = false) => {
      if (disposed || terminalReached || (socket !== undefined && socketRef.current !== socket)) return;
      if (socket !== undefined) socketRef.current = null;
      clearHeartbeat();
      clearSocketOpen();
      clearRoundReady();
      setRoundIntro(null);
      const now = Date.now();
      retryStartedAt ??= now;
      armLocalGrace();
      if (!terminalRecovery && now - retryStartedAt < RECONNECT_GRACE_MS) {
        updateConnectionState(suspected ? 'SUSPECTED_LOSS' : 'RECONNECTING');
        showPause('local', retryStartedAt + RECONNECT_GRACE_MS);
        setStatusMessage('Reconectando à partida');
        scheduleRetry(200);
      } else {
        enterTerminalRecovery();
        scheduleRetry(TERMINAL_RECOVERY_RETRY_MS);
      }
    };

    const startHeartbeat = (socket: WebSocket) => {
      clearHeartbeat();
      lastPongAt = Date.now();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'HEARTBEAT' }));
      }
      heartbeatTimer = window.setInterval(() => {
        if (socketRef.current !== socket || socket.readyState !== WebSocket.OPEN) {
          clearHeartbeat();
          return;
        }
        if (Date.now() - lastPongAt >= MATCH_PONG_TIMEOUT_MS) {
          handleConnectionLoss(socket, true);
          socket.close(CLIENT_CONNECTION_LOSS_CODE, 'Conexão sem resposta');
          return;
        }
        socket.send(JSON.stringify({ type: 'HEARTBEAT' }));
      }, MATCH_HEARTBEAT_INTERVAL_MS);
    };

    const bindSocket = (socket: WebSocket, bufferedMessages: string[] = []) => {
      socketRef.current = socket;
      const opened = () => {
        if (socketRef.current !== socket) return;
        clearSocketOpen();
        startHeartbeat(socket);
        setError(null);
        setStatusMessage(terminalRecovery ? 'Confirmando encerramento da partida...' : 'Aguardando jogadores');
      };
      socket.addEventListener('open', opened);
      socket.addEventListener('message', (event) => handleMessage(socket, String(event.data)));
      socket.addEventListener('close', () => {
        handleConnectionLoss(socket);
      });
      socket.addEventListener('error', () => {
        if (socketRef.current === socket) {
          handleConnectionLoss(socket, true);
          socket.close(CLIENT_CONNECTION_LOSS_CODE, 'Erro de conexão');
        }
      });
      if (socket.readyState === WebSocket.OPEN) opened();
      else {
        clearSocketOpen();
        socketOpenTimer = window.setTimeout(() => {
          socketOpenTimer = null;
          if (socketRef.current !== socket || socket.readyState === WebSocket.OPEN) return;
          handleConnectionLoss(socket, true);
          socket.close(CLIENT_CONNECTION_LOSS_CODE, 'Conexão não abriu');
        }, MATCH_SOCKET_OPEN_TIMEOUT_MS);
      }
      bufferedMessages.forEach((message) => handleMessage(socket, message));
    };

    connect = async (): Promise<void> => {
      if (connecting || socketRef.current !== null || disposed || terminalReached) return;
      connecting = true;
      const currentGeneration = ++generation;
      try {
        const token = await getToken();
        if (disposed || currentGeneration !== generation) {
          connecting = false;
          return;
        }
        if (token === null) throw new Error('Sua sessão expirou. Entre novamente.');
        const ticket = await apiRequest<{ ticket: string }>('/api/realtime/tickets', {
          body: { resource: roomId, scope: 'room' }, getToken, method: 'POST', token,
        });
        if (disposed || currentGeneration !== generation) {
          connecting = false;
          return;
        }
        connecting = false;
        const search = new URLSearchParams({ ticket: ticket.ticket });
        if (terminalRecovery) search.set('terminal', '1');
        bindSocket(new WebSocket(websocketUrl(`/api/realtime/rooms/${roomId}?${search}`)));
      } catch (connectError) {
        connecting = false;
        if (disposed || currentGeneration !== generation) return;
        void connectError;
        handleConnectionLoss();
      }
    };

    const prepared = takePreparedMatchRoom(roomId);
    if (prepared === null) void connect();
    else {
      generation += 1;
      bindSocket(prepared.socket, prepared.messages);
    }
    const recoverConnectionNow = () => {
      if (retryStartedAt === null || disposed || terminalReached || socketRef.current !== null || connecting) return;
      clearRetry();
      if (connect !== null) void connect();
    };
    const recoverWhenVisible = () => {
      if (document.visibilityState === 'visible') recoverConnectionNow();
    };
    const handleOffline = () => {
      if (disposed || terminalReached) return;
      generation += 1;
      connecting = false;
      const socket = socketRef.current;
      if (socket !== null) {
        handleConnectionLoss(socket);
        socket.close(CLIENT_CONNECTION_LOSS_CODE, 'Rede indisponível');
      } else {
        handleConnectionLoss();
      }
    };
    window.addEventListener('online', recoverConnectionNow);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', recoverConnectionNow);
    document.addEventListener('visibilitychange', recoverWhenVisible);
    return () => {
      disposed = true;
      generation += 1;
      window.removeEventListener('online', recoverConnectionNow);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', recoverConnectionNow);
      document.removeEventListener('visibilitychange', recoverWhenVisible);
      clearRetry();
      clearRoundReady();
      clearCountdown();
      clearHeartbeat();
      clearLocalGrace();
      clearPauseExit();
      clearSocketOpen();
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close(1_000, 'Tela encerrada');
    };
  }, [getToken, roomId]);

  if (terminal !== null) {
    const { viewer, opponent } = terminal.result;
    return (
      <MatchResultScreen
        knowledgeAfter={viewer.knowledgeAfter}
        knowledgeDelta={viewer.knowledgeDelta}
        onBack={() => { void navigate('/'); }}
        opponent={{
          customAvatarUrl: projection?.opponent.customAvatarUrl ?? null,
          frameId: projection?.opponent.frameId ?? null,
          name: projection?.opponent.displayName ?? 'Adversário',
          photoUrl: projection?.opponent.photoUrl ?? null,
          result: opponent.result,
          score: opponent.score,
        }}
        viewer={{
          customAvatarUrl: projection?.viewer.customAvatarUrl ?? null,
          frameId: projection?.viewer.frameId ?? null,
          name: projection?.viewer.displayName ?? 'Você',
          photoUrl: projection?.viewer.photoUrl ?? null,
          result: viewer.result,
          score: viewer.score,
        }}
        voidReason={terminal.voidReason}
        xpDelta={viewer.xpDelta}
      />
    );
  }

  if (localConnectionState === 'TERMINAL_RECOVERY' || projection?.phase === 'FINALIZING' ||
    projection?.phase === 'FINISHED' || projection?.phase === 'VOID') {
    return (
      <main className="match-lobby-screen">
        <Logo />
        <span aria-hidden="true" className="spinner match-lobby-spinner" />
        <h1>Confirmando encerramento da partida...</h1>
      </main>
    );
  }

  if (pauseVisual !== null) {
    return (
      <MatchConnectionScreen
        deadlineMs={pauseVisual.deadlineMs}
        kind={pauseVisual.kind}
        leaving={pauseVisual.leaving}
      />
    );
  }

  const activeQuestion = projection?.question;
  const preparingQuestion = projection?.phase === 'ROUND_READY';
  if (activeQuestion !== undefined && projection?.round !== undefined &&
    (preparingQuestion || projection.phase === 'ANSWERING' || projection.phase === 'ROUND_RESULT') &&
    (preparingQuestion || deadlineMs !== null)) {
    return (
      <>
        <MatchScreen
          deadlineMs={preparingQuestion ? 0 : deadlineMs ?? 0}
          key={`${projection.round.number}:${activeQuestion.id}`}
          onAnswer={(selectedOption) => {
            socketRef.current?.send(JSON.stringify({
              questionId: activeQuestion.id,
              roundNumber: projection.round?.number,
              selectedOption,
              type: 'ANSWER',
            }));
          }}
          opponent={{
            customAvatarUrl: projection.opponent.customAvatarUrl,
            frameId: projection.opponent.frameId,
            name: projection.opponent.displayName,
            photoUrl: projection.opponent.photoUrl,
          }}
          opponentAnswered={projection.opponent.answered}
          opponentScore={projection.opponent.score}
          player={{
            customAvatarUrl: projection.viewer.customAvatarUrl,
            frameId: projection.viewer.frameId,
            name: projection.viewer.displayName,
            photoUrl: projection.viewer.photoUrl,
          }}
          playerScore={projection.viewer.score}
          preparing={preparingQuestion}
          question={activeQuestion}
          questionPresentationDelayMs={preparingQuestion
            ? roundIntro === null
              ? -MATCH_QUESTION_ENTRANCE_MS
              : Math.max(0, roundIntro.durationMs - MATCH_QUESTION_ENTRANCE_MS)
            : 0}
          remainingMs={projection.phase === 'ANSWERING'
            ? projection.remainingMs ?? 0
            : 0}
          resolution={projection.resolution}
          round={projection.round}
          selectedOption={projection.selectedOption}
        />
        {roundIntro !== null && (
          <MatchRoundTransition
            durationMs={roundIntro.durationMs}
            number={roundIntro.number}
            total={roundIntro.total}
          />
        )}
      </>
    );
  }

  const canCancel = projection === null || projection.phase === 'LOBBY' || projection.phase === 'PREPARING';
  return (
    <main className="match-lobby-screen">
      <Logo />
      {error !== null
        ? <h1>{error}</h1>
        : roundIntro !== null
          ? <MatchRoundTransition durationMs={roundIntro.durationMs} number={roundIntro.number} total={roundIntro.total} />
          : (
            <>
              <span aria-hidden="true" className="spinner match-lobby-spinner" />
              <h1>{statusMessage}</h1>
            </>
          )}
      {countdown !== null && <strong className="countdown">{countdown}</strong>}
      {canCancel && <Button onClick={() => {
        socketRef.current?.send(JSON.stringify({ type: 'CANCEL' }));
        void navigate('/');
      }} variant="ghost">Cancelar e voltar</Button>}
    </main>
  );
}
