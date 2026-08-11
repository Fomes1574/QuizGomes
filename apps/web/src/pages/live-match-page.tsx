import type { LiveMatchProjection, MatchResult } from '@quiz-gomes/domain';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../components/button.js';
import { Logo } from '../components/logo.js';
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

const RESULT_LABELS: Record<MatchResult, string> = {
  DRAW: 'Empate',
  LOSS: 'Derrota',
  VOID: 'Partida anulada',
  WIN: 'Vitória',
};

const VOID_LABELS: Record<string, string> = {
  CANCELLED: 'A partida foi cancelada antes do início.',
  INDIVIDUAL_ABANDONMENT: 'A partida foi anulada por abandono.',
  INDIVIDUAL_DISCONNECT: 'A partida foi anulada por perda de conexão.',
  READINESS_TIMEOUT: 'Um jogador não ficou pronto dentro do prazo.',
  SYSTEM_FAILURE: 'A partida foi anulada sem penalidade por falha da sala.',
};

export function LiveMatchPage() {
  const { roomId = '' } = useParams();
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const socketRef = useRef<WebSocket | null>(null);
  const [projection, setProjection] = useState<LiveMatchProjection | null>(null);
  const [deadlineMs, setDeadlineMs] = useState<number | null>(null);
  const [transitioning, setTransitioning] = useState(false);
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
    const acknowledgeRound = (socket: WebSocket, match: LiveMatchProjection, delayMs: number) => {
      if (match.round === undefined) return;
      clearRoundReady();
      setTransitioning(true);
      roundReadyTimer = window.setTimeout(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ roundNumber: match.round?.number, type: 'ROUND_READY' }));
        }
      }, Math.max(0, delayMs));
    };
    const applyProjection = (match: LiveMatchProjection) => {
      setProjection(match);
      updateCountdown(match);
      if (match.phase === 'ANSWERING' && match.remainingMs !== undefined) {
        setDeadlineMs(Date.now() + match.remainingMs);
        setTransitioning(false);
      }
      if (match.phase === 'ROUND_RESULT') {
        setDeadlineMs(Date.now());
        setTransitioning(false);
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
          body: { resource: roomId, scope: 'room' }, method: 'POST', token,
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
            setStatusMessage(`PERGUNTA ${payload.match.round?.number ?? 1} / ${payload.match.round?.total ?? 1}`);
            acknowledgeRound(socket, payload.match, payload.transitionMs ?? 0);
          }
          if (payload.type === 'RESUMED') {
            setStatusMessage('Partida restaurada');
            if (payload.match?.phase === 'ROUND_READY') acknowledgeRound(socket, payload.match, 0);
          }
          if ((payload.type === 'MATCH_FINISHED' || payload.type === 'MATCH_VOID') && payload.result !== undefined) {
            terminalReached = true;
            clearRoundReady();
            setTerminal(payload.voidReason === undefined
              ? { result: payload.result }
              : { result: payload.result, voidReason: payload.voidReason });
          }
        });
        socket.addEventListener('close', () => {
          if (disposed || socketRef.current !== socket || terminalReached) return;
          socketRef.current = null;
          clearRoundReady();
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
      <main className="match-result-screen">
        <Logo />
        <span className={`match-result-badge match-result-badge--${viewer.result.toLocaleLowerCase()}`}>{RESULT_LABELS[viewer.result]}</span>
        <div className="match-result-scores"><strong>{viewer.score}</strong><span>×</span><strong>{opponent.score}</strong></div>
        {viewer.result === 'VOID'
          ? <p>{VOID_LABELS[terminal.voidReason ?? 'SYSTEM_FAILURE'] ?? 'A partida foi anulada.'}</p>
          : <div className="match-result-progress">
              <span><small>XP</small><strong>+{viewer.xpDelta}</strong></span>
              <span><small>Conhecimento</small><strong>{viewer.knowledgeDelta >= 0 ? '+' : ''}{viewer.knowledgeDelta}</strong></span>
              <span><small>Total no tema</small><strong>{viewer.knowledgeAfter}</strong></span>
            </div>}
        <Button onClick={() => { void navigate('/'); }}>Voltar aos temas</Button>
      </main>
    );
  }

  const activeQuestion = projection?.question;
  if (activeQuestion !== undefined && projection?.round !== undefined &&
    (projection.phase === 'ANSWERING' || projection.phase === 'ROUND_RESULT' || projection.phase === 'PAUSED') &&
    deadlineMs !== null) {
    return (
      <>
        <MatchScreen
          deadlineMs={deadlineMs}
          key={`${projection.round.number}:${activeQuestion.id}`}
          onAnswer={(selectedOption) => {
            socketRef.current?.send(JSON.stringify({
              questionId: activeQuestion.id,
              roundNumber: projection.round?.number,
              selectedOption,
              type: 'ANSWER',
            }));
          }}
          opponent={{ name: projection.opponent.displayName, photoUrl: projection.opponent.photoUrl }}
          opponentAnswered={projection.opponent.answered}
          opponentScore={projection.opponent.score}
          playerScore={projection.viewer.score}
          question={activeQuestion}
          resolution={projection.resolution}
          round={projection.round}
          selectedOption={projection.selectedOption}
        />
        {projection.phase === 'PAUSED' && <div aria-live="assertive" className="match-pause-overlay"><strong>AGUARDANDO JOGADOR</strong><span>A partida está totalmente pausada por até 7 segundos.</span></div>}
      </>
    );
  }

  const canCancel = projection === null || projection.phase === 'LOBBY' || projection.phase === 'PREPARING';
  return (
    <main className="match-lobby-screen">
      <Logo />
      {transitioning || projection?.phase === 'ROUND_READY'
        ? <span className="round-transition">{statusMessage}</span>
        : <span className="matchmaking-radar"><span /><span /><i /></span>}
      <h1>{error ?? statusMessage}</h1>
      {countdown !== null && <strong className="countdown">{countdown}</strong>}
      {canCancel && <Button onClick={() => {
        socketRef.current?.send(JSON.stringify({ type: 'CANCEL' }));
        void navigate('/');
      }} variant="ghost">Cancelar e voltar</Button>}
    </main>
  );
}
