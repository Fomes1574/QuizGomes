import type { LiveMatchProjection, MatchResult } from '@quiz-gomes/domain';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../components/button.js';
import { Logo } from '../components/logo.js';
import { MatchResultScreen } from '../components/match-result-screen.js';
import {
  MATCH_QUESTION_ENTRANCE_MS,
  MatchRoundTransition,
  roundPresentationDelay,
} from '../components/match-round-transition.js';
import { MatchScreen } from '../components/match-screen.js';
import { useAuth } from '../features/auth-context.js';
import { apiRequest, websocketUrl } from '../lib/api.js';

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

  useEffect(() => {
    let disposed = false;
    let retryStartedAt: number | null = null;
    let retryTimer: number | null = null;
    let roundReadyTimer: number | null = null;
    let countdownTimer: number | null = null;
    let generation = 0;
    let terminalReached = false;

    const clearRoundReady = () => {
      if (roundReadyTimer !== null) window.clearTimeout(roundReadyTimer);
      roundReadyTimer = null;
    };
    const updateCountdown = (match: LiveMatchProjection) => {
      if (countdownTimer !== null) window.clearInterval(countdownTimer);
      if (match.phase !== 'PREPARING' || match.remainingMs === undefined) {
        countdownTimer = null;
        setCountdown(null);
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
      if (match.phase === 'PAUSED') setStatusMessage('AGUARDANDO JOGADOR');
    };

    const connect = async (): Promise<void> => {
      const currentGeneration = ++generation;
      try {
        const token = await getToken();
        if (disposed || currentGeneration !== generation) return;
        if (token === null) throw new Error('Sua sessão expirou. Entre novamente.');
        const ticket = await apiRequest<{ ticket: string }>('/api/realtime/tickets', {
          body: { resource: roomId, scope: 'room' }, getToken, method: 'POST', token,
        });
        if (disposed || currentGeneration !== generation) return;
        const socket = new WebSocket(websocketUrl(`/api/realtime/rooms/${roomId}?ticket=${encodeURIComponent(ticket.ticket)}`));
        socketRef.current = socket;
        socket.addEventListener('open', () => {
          if (socketRef.current !== socket) return;
          retryStartedAt = null;
          setError(null);
          setStatusMessage('Aguardando jogadores');
        });
        socket.addEventListener('message', (event) => {
          let payload: RoomMessage;
          try {
            payload = JSON.parse(String(event.data)) as RoomMessage;
          } catch {
            setError('A sala enviou uma mensagem inválida.');
            return;
          }
          if (payload.type === 'ERROR') {
            setError(payload.message ?? 'A sala rejeitou esta ação.');
            return;
          }
          if (payload.match !== undefined) applyProjection(payload.match);
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
          if ((payload.type === 'MATCH_FINISHED' || payload.type === 'MATCH_VOID') && payload.result !== undefined) {
            terminalReached = true;
            clearRoundReady();
            setRoundIntro(null);
            setTerminal(payload.voidReason === undefined
              ? { result: payload.result }
              : { result: payload.result, voidReason: payload.voidReason });
          }
        });
        socket.addEventListener('close', () => {
          if (disposed || socketRef.current !== socket || terminalReached) return;
          socketRef.current = null;
          clearRoundReady();
          setRoundIntro(null);
          setStatusMessage('Reconectando à partida');
          const now = Date.now();
          retryStartedAt ??= now;
          if (now - retryStartedAt >= 7_000) {
            setError('Não foi possível restaurar a conexão dentro de 7 segundos.');
            return;
          }
          retryTimer = window.setTimeout(() => { void connect(); }, 200);
        });
        socket.addEventListener('error', () => {
          if (socketRef.current === socket) setStatusMessage('Reconectando à partida');
        });
      } catch (connectError) {
        if (disposed) return;
        const now = Date.now();
        retryStartedAt ??= now;
        if (now - retryStartedAt < 7_000) {
          retryTimer = window.setTimeout(() => { void connect(); }, 250);
        } else {
          setError(connectError instanceof Error ? connectError.message : 'Não foi possível entrar na sala.');
        }
      }
    };

    void connect();
    return () => {
      disposed = true;
      generation += 1;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      clearRoundReady();
      if (countdownTimer !== null) window.clearInterval(countdownTimer);
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
          frameId: projection?.opponent.frameId ?? null,
          name: projection?.opponent.displayName ?? 'Adversário',
          photoUrl: projection?.opponent.photoUrl ?? null,
          result: opponent.result,
          score: opponent.score,
        }}
        viewer={{
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

  const activeQuestion = projection?.question;
  const preparingQuestion = projection?.phase === 'ROUND_READY';
  if (activeQuestion !== undefined && projection?.round !== undefined &&
    (preparingQuestion || projection.phase === 'ANSWERING' || projection.phase === 'ROUND_RESULT' || projection.phase === 'PAUSED') &&
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
            frameId: projection.opponent.frameId,
            name: projection.opponent.displayName,
            photoUrl: projection.opponent.photoUrl,
          }}
          opponentAnswered={projection.opponent.answered}
          opponentScore={projection.opponent.score}
          paused={projection.phase === 'PAUSED'}
          pausedRemainingMs={projection.phase === 'PAUSED' && projection.paused?.phase === 'ANSWERING'
            ? projection.paused.phaseRemainingMs
            : undefined}
          player={{
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
            : projection.phase === 'PAUSED' && projection.paused?.phase === 'ANSWERING'
              ? projection.paused.phaseRemainingMs
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
        {projection.phase === 'PAUSED' && <div aria-live="assertive" className="match-pause-overlay"><strong>AGUARDANDO JOGADOR</strong><span>A partida está totalmente pausada por até 7 segundos.</span></div>}
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
              <span className="matchmaking-radar"><span /><span /><i /></span>
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
