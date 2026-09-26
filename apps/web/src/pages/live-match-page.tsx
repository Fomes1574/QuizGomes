import { RECONNECT_GRACE_MS, questionsForMode, type LiveMatchProjection, type MatchResult } from '@quiz-gomes/domain';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../components/button.js';
import { Icon } from '../components/icons.js';
import { Logo } from '../components/logo.js';
import {
  MatchConnectionScreen,
  type MatchConnectionScreenKind,
} from '../components/match-connection-screen.js';
import { MatchLobbyDuel } from '../components/match-lobby-duel.js';
import { MatchResultScreen, type OpponentFriendStatus } from '../components/match-result-screen.js';
import {
  MATCH_QUESTION_ENTRANCE_MS,
  MatchRoundTransition,
  roundPresentationDelay,
} from '../components/match-round-transition.js';
import { MatchScreen } from '../components/match-screen.js';
import { ReportQuestionDialog } from '../components/report-question-dialog.js';
import { useAuth } from '../features/auth-context.js';
import { apiRequest, websocketUrl } from '../lib/api.js';
import { clearDuelHandoff } from '../lib/match-handoff.js';
import { takePreparedMatchRoom } from '../lib/preloaded-match-room.js';
import { QUESTION_IMAGE_READY_CAP_MS, waitForQuestionImage } from '../lib/question-image-ready.js';
import type { SeenQuestion } from '../lib/reports.js';

interface TerminalResult {
  opponent: { result: MatchResult; score: number };
  viewer: {
    knowledgeAfter: number;
    knowledgeBefore: number;
    knowledgeDelta: number;
    personalRecord?: boolean;
    result: MatchResult;
    score: number;
    xpDelta: number;
  };
}

interface RoomMessage {
  cancelledBy?: { displayName: string; seat: number };
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
const SLOW_CONNECTION_RETRY_MS = 3_000;

interface PauseVisualState {
  authoritativePause?: {
    graceRemainingMs: number;
    receivedAtMonotonicMs: number;
  };
  kind: MatchConnectionScreenKind;
  leaving: boolean;
  localLossStartedAtMonotonicMs?: number;
}

export function LiveMatchPage({ variant = 'match' }: { variant?: 'challenge' | 'match' } = {}) {
  const { challengeId = '', roomId = '' } = useParams();
  const isChallenge = variant === 'challenge';
  const sessionId = isChallenge ? challengeId : roomId;
  const location = useLocation();
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const socketRef = useRef<WebSocket | null>(null);
  const [projection, setProjection] = useState<LiveMatchProjection | null>(null);
  const [deadlineMs, setDeadlineMs] = useState<number | null>(null);
  const [roundIntro, setRoundIntro] = useState<{ durationMs: number; number: number; total: number } | null>(null);
  const [statusMessage, setStatusMessage] = useState('Conectando à sala');
  const [error, setError] = useState<string | null>(null);
  const [terminal, setTerminal] = useState<{
    cancelledBy?: { displayName: string; seat: number };
    result: TerminalResult;
    voidReason?: string;
  } | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [localConnectionState, setLocalConnectionState] = useState<LocalConnectionState>('CONNECTED');
  const [pauseVisual, setPauseVisual] = useState<PauseVisualState | null>(null);
  const [cancelling, setCancelling] = useState(false);
  // Denúncia de pergunta: só o cliente lembra o que já viu nesta sessão. O
  // servidor nunca confia nesta lista — revalida contra o snapshot selado.
  const [seenQuestions, setSeenQuestions] = useState<SeenQuestion[]>([]);
  const [reportTarget, setReportTarget] = useState<SeenQuestion | null>(null);

  useEffect(() => {
    let disposed = false;
    let retryStartedAtMonotonicMs: number | null = null;
    let retryTimer: number | null = null;
    let roundReadyTimer: number | null = null;
    // Invalida um ROUND_READY que ainda espera a foto quando a rodada muda.
    let roundReadyToken = 0;
    let countdownTimer: number | null = null;
    let heartbeatTimer: number | null = null;
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
    const showLocalLoss = (startedAtMonotonicMs: number) => {
      clearPauseExit();
      pauseKind = 'local';
      setPauseVisual((current) => current?.authoritativePause === undefined
        ? {
          kind: 'local',
          leaving: false,
          localLossStartedAtMonotonicMs: current?.localLossStartedAtMonotonicMs ?? startedAtMonotonicMs,
        }
        : { ...current, kind: 'local', leaving: false });
    };
    const showAuthoritativePause = (kind: MatchConnectionScreenKind, graceRemainingMs: number) => {
      clearPauseExit();
      pauseKind = kind;
      setPauseVisual({
        authoritativePause: { graceRemainingMs, receivedAtMonotonicMs: performance.now() },
        kind,
        leaving: false,
      });
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
      roundReadyToken += 1;
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
      // A foto começa a baixar junto com a apresentação; o teto conta a
      // partir de agora, então apresentação + foto nunca passam de ~4 s.
      const imageReady = waitForQuestionImage(match.question?.imageUrl, Math.max(presentationMs, QUESTION_IMAGE_READY_CAP_MS));
      const token = roundReadyToken;
      roundReadyTimer = window.setTimeout(() => {
        roundReadyTimer = null;
        setRoundIntro(null);
        if (showPresentation) setStatusMessage('Sincronizando jogadores');
        void imageReady.then(() => {
          if (token !== roundReadyToken) return;
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ roundNumber: match.round?.number, type: 'ROUND_READY' }));
          }
        });
      }, presentationMs);
    };
    const applyProjection = (match: LiveMatchProjection) => {
      setProjection(match);
      updateCountdown(match);
      if (match.question !== undefined && match.round !== undefined) {
        const question = match.question;
        const roundNumber = match.round.number;
        setSeenQuestions((current) => (
          current.some((seen) => seen.roundNumber === roundNumber)
            ? current
            : [...current, {
              contextId: sessionId,
              contextKind: isChallenge ? 'CHALLENGE' : 'MATCH',
              prompt: question.prompt,
              questionId: question.id,
              roundNumber,
            }]
        ));
        const resolution = match.resolution;
        if (resolution !== undefined) {
          setSeenQuestions((current) => current.map((seen) => (
            seen.roundNumber !== roundNumber || seen.outcome !== undefined
              ? seen
              : {
                ...seen,
                outcome: {
                  correctOption: resolution.correctOption,
                  options: question.options,
                  selectedOption: resolution.viewer.selectedOption,
                },
              }
          )));
        }
      }
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
        showAuthoritativePause(kind, match.paused.graceRemainingMs);
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
        if (socketRef.current === socket) lastPongAt = performance.now();
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
        clearSocketOpen();
        hidePauseImmediately();
        clearRetry();
        clearRoundReady();
        clearCountdown();
        updateConnectionState('CONNECTED');
        setRoundIntro(null);
        if (payload.match !== undefined) setProjection(payload.match);
        setTerminal({
          ...(payload.cancelledBy === undefined ? {} : { cancelledBy: payload.cancelledBy }),
          ...(payload.voidReason === undefined ? {} : { voidReason: payload.voidReason }),
          result: payload.result,
        });
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
          retryStartedAtMonotonicMs = null;
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
      const now = performance.now();
      retryStartedAtMonotonicMs ??= now;
      if (!terminalRecovery) {
        updateConnectionState(suspected ? 'SUSPECTED_LOSS' : 'RECONNECTING');
        showLocalLoss(retryStartedAtMonotonicMs);
        setStatusMessage('Reconectando à partida');
        scheduleRetry(now - retryStartedAtMonotonicMs < RECONNECT_GRACE_MS ? 200 : SLOW_CONNECTION_RETRY_MS);
      } else {
        scheduleRetry(SLOW_CONNECTION_RETRY_MS);
      }
    };

    const startHeartbeat = (socket: WebSocket) => {
      clearHeartbeat();
      lastPongAt = performance.now();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'HEARTBEAT' }));
      }
      heartbeatTimer = window.setInterval(() => {
        if (socketRef.current !== socket || socket.readyState !== WebSocket.OPEN) {
          clearHeartbeat();
          return;
        }
        if (performance.now() - lastPongAt >= MATCH_PONG_TIMEOUT_MS) {
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
          body: { resource: sessionId, scope: isChallenge ? 'challenge' : 'room' },
          getToken,
          method: 'POST',
          token,
        });
        if (disposed || currentGeneration !== generation) {
          connecting = false;
          return;
        }
        connecting = false;
        const search = new URLSearchParams({ ticket: ticket.ticket });
        if (terminalRecovery) search.set('terminal', '1');
        const path = isChallenge
          ? `/api/realtime/challenges/${sessionId}?${search}`
          : `/api/realtime/rooms/${sessionId}?${search}`;
        bindSocket(new WebSocket(websocketUrl(path)));
      } catch (connectError) {
        connecting = false;
        if (disposed || currentGeneration !== generation) return;
        void connectError;
        handleConnectionLoss();
      }
    };

    // A metade assíncrona nunca vem pré-conectada: ela abre a própria sala ao entrar.
    const prepared = isChallenge ? null : takePreparedMatchRoom(sessionId);
    if (prepared === null) void connect();
    else {
      generation += 1;
      bindSocket(prepared.socket, prepared.messages);
    }
    const recoverConnectionNow = () => {
      if (retryStartedAtMonotonicMs === null || disposed || terminalReached || socketRef.current !== null || connecting) return;
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
      clearPauseExit();
      clearSocketOpen();
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close(1_000, 'Tela encerrada');
    };
  }, [getToken, isChallenge, sessionId]);

  // A continuidade visual pertence a esta sala: sair da partida descarta a geometria guardada.
  useEffect(() => () => clearDuelHandoff(), []);

  // Sequência de acertos é só apresentação local: não entra em placar, XP nem Conhecimento.
  const [streak, setStreak] = useState({ count: 0, round: 0 });
  const resolvedRound = projection?.resolution === undefined ? undefined : projection.round?.number;
  const resolvedCorrect = projection?.resolution?.viewer.correct;
  if (resolvedRound !== undefined && streak.round !== resolvedRound) {
    setStreak({ count: resolvedCorrect === true ? streak.count + 1 : 0, round: resolvedRound });
  }
  const rankedMatch = projection?.round === undefined ? undefined : projection.round.total === questionsForMode('RANKED');

  // Amizade com o adversário: o servidor resolve quem ele é pela própria partida.
  const [friendStatus, setFriendStatus] = useState<{ message?: string; status: OpponentFriendStatus }>({ status: 'idle' });
  const terminalReady = terminal !== null;
  useEffect(() => {
    if (!terminalReady || isChallenge) return undefined;
    let active = true;
    void apiRequest<{ status: 'FRIEND' | 'NONE' }>(`/api/social/match-opponent/${encodeURIComponent(sessionId)}`, { getToken })
      .then((response) => { if (active && response.status === 'FRIEND') setFriendStatus({ status: 'friend' }); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [getToken, isChallenge, sessionId, terminalReady]);
  const addOpponentFriend = () => {
    setFriendStatus({ status: 'sending' });
    void apiRequest<{ status: 'FRIEND' | 'SENT' }>(`/api/social/match-opponent/${encodeURIComponent(sessionId)}`, {
      getToken,
      method: 'POST',
    }).then((response) => setFriendStatus({ status: response.status === 'FRIEND' ? 'friend' : 'sent' }))
      .catch((requestError: unknown) => setFriendStatus({
        message: requestError instanceof Error ? requestError.message : 'Não foi possível enviar o pedido.',
        status: 'error',
      }));
  };

  const matchOrigin = (location.state as {
    matchOrigin?: { mode?: string; returnTo?: string; themeName?: string };
  } | null)?.matchOrigin;

  const cancelledChallenge = isChallenge && terminal?.voidReason === 'CANCELLED';
  const returnTo = matchOrigin?.returnTo;
  const returnMode = matchOrigin?.mode;
  useEffect(() => {
    // Cancelamento explícito do próprio desafio não vira tela de resultado anulado:
    // a saída acontece só depois da confirmação autoritativa do servidor.
    if (!cancelledChallenge) return;
    if (typeof returnTo === 'string' && returnTo.startsWith('/temas/')) {
      // Volta exatamente ao contexto de origem, como no cancelamento da partida.
      void navigate(returnTo, { state: { mode: returnMode } });
      return;
    }
    void navigate('/social');
  }, [cancelledChallenge, navigate, returnMode, returnTo]);

  const playAgain = typeof matchOrigin?.returnTo === 'string' && matchOrigin.returnTo.startsWith('/temas/') && !isChallenge
    ? () => {
      void navigate(matchOrigin.returnTo as string, { state: { autoPlay: true, mode: matchOrigin.mode } });
    }
    : undefined;

  const backToTheme = () => {
    if (typeof matchOrigin?.returnTo === 'string' && matchOrigin.returnTo.startsWith('/temas/')) {
      void navigate(matchOrigin.returnTo, {
        state: { mode: matchOrigin.mode },
      });
      return;
    }
    void navigate('/');
  };

  if (cancelledChallenge) {
    return (
      <main className="match-lobby-screen">
        <Logo />
        <span aria-hidden="true" className="spinner match-lobby-spinner" />
        <h1>Desafio cancelado</h1>
      </main>
    );
  }

  if (terminal !== null) {
    const { viewer, opponent } = terminal.result;
    return (
      <>
      <MatchResultScreen
        addFriend={isChallenge ? undefined : { ...friendStatus, onClick: addOpponentFriend }}
        cancelledBy={terminal.cancelledBy}
        knowledgeAfter={viewer.knowledgeAfter}
        knowledgeDelta={viewer.knowledgeDelta}
        onBack={backToTheme}
        onPlayAgain={playAgain}
        onReport={(question) => setReportTarget(question)}
        personalRecord={viewer.personalRecord === true}
        ranked={rankedMatch}
        themeName={typeof matchOrigin?.themeName === 'string' ? matchOrigin.themeName.slice(0, 80) : null}
        opponent={{
          customAvatarUrl: projection?.opponent.customAvatarUrl ?? null,
          frameId: projection?.opponent.frameId ?? null,
          name: projection?.opponent.displayName ?? 'Adversário',
          photoUrl: projection?.opponent.photoUrl ?? null,
          result: opponent.result,
          score: opponent.score,
        }}
        questions={seenQuestions}
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
      {reportTarget !== null && (
        <ReportQuestionDialog
          contextId={reportTarget.contextId}
          contextKind={reportTarget.contextKind}
          onClose={() => setReportTarget(null)}
          questionId={reportTarget.questionId}
          roundNumber={reportTarget.roundNumber}
        />
      )}
      </>
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
        authoritativePause={pauseVisual.authoritativePause}
        kind={pauseVisual.kind}
        leaving={pauseVisual.leaving}
        localLossStartedAtMonotonicMs={pauseVisual.localLossStartedAtMonotonicMs}
      />
    );
  }

  const activeQuestion = projection?.question;
  const preparingQuestion = projection?.phase === 'ROUND_READY';
  if (activeQuestion !== undefined && projection?.round !== undefined &&
    (preparingQuestion || projection.phase === 'ANSWERING' || projection.phase === 'ROUND_RESULT') &&
    (preparingQuestion || deadlineMs !== null)) {
    const activeRound = projection.round;
    return (
      <>
        <MatchScreen
          deadlineMs={preparingQuestion ? 0 : deadlineMs ?? 0}
          duelRoomId={isChallenge ? undefined : sessionId}
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
          opponentPending={projection.opponentPending ?? false}
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
          streak={streak.count}
        />
        {roundIntro !== null && (
          <MatchRoundTransition
            durationMs={roundIntro.durationMs}
            number={roundIntro.number}
            total={roundIntro.total}
          />
        )}
        {/*
          Discreto de propósito: só um ícone, sem rótulo grande competindo com a pergunta.
          Abrir o diálogo não envia nenhum comando à sala — o timer não sabe que ele existe.
        */}
        {!preparingQuestion && roundIntro === null && (
          <button
            aria-label="Reportar esta pergunta"
            className="report-trigger"
            onClick={() => setReportTarget({
              contextId: sessionId,
              contextKind: isChallenge ? 'CHALLENGE' : 'MATCH',
              prompt: activeQuestion.prompt,
              questionId: activeQuestion.id,
              roundNumber: activeRound.number,
            })}
            type="button"
          ><Icon name="flag" /><span>Reportar</span></button>
        )}
        {reportTarget !== null && (
          <ReportQuestionDialog
            contextId={reportTarget.contextId}
            contextKind={reportTarget.contextKind}
            onClose={() => setReportTarget(null)}
            questionId={reportTarget.questionId}
            roundNumber={reportTarget.roundNumber}
          />
        )}
      </>
    );
  }

  const canCancel = projection === null || projection.phase === 'LOBBY' || projection.phase === 'PREPARING';
  const lobbyDuel = error === null && roundIntro === null && projection !== null
    ? { opponent: projection.opponent, viewer: projection.viewer }
    : null;
  return (
    <main className="match-lobby-screen">
      <Logo />
      {lobbyDuel !== null && (
        <MatchLobbyDuel
          opponent={{
            customAvatarUrl: lobbyDuel.opponent.customAvatarUrl,
            displayName: lobbyDuel.opponent.displayName,
            frameId: lobbyDuel.opponent.frameId,
            photoUrl: lobbyDuel.opponent.photoUrl,
          }}
          roomId={sessionId}
          viewer={{
            customAvatarUrl: lobbyDuel.viewer.customAvatarUrl,
            displayName: lobbyDuel.viewer.displayName,
            frameId: lobbyDuel.viewer.frameId,
            photoUrl: lobbyDuel.viewer.photoUrl,
          }}
        />
      )}
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
      {canCancel && <Button disabled={cancelling} onClick={() => {
        socketRef.current?.send(JSON.stringify({ type: 'CANCEL' }));
        // No desafio a saída espera a confirmação autoritativa; na partida o M8 segue igual.
        if (isChallenge) setCancelling(true);
        else backToTheme();
      }} variant="ghost">{cancelling ? 'Cancelando...' : 'Cancelar e voltar'}</Button>}
    </main>
  );
}
