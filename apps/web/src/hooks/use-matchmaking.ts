import type { MatchMode, PublicQuestion } from '@quiz-gomes/domain';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth-context.js';
import { apiRequest, websocketUrl } from '../lib/api.js';
import { captureDuelOrigins } from '../lib/match-handoff.js';
import {
  MATCH_FOUND_ENTRY_MS,
  MATCH_FOUND_EXIT_MS,
  MATCH_FOUND_HOLD_MS,
  MATCH_FOUND_PRESENTATION_MS,
} from '../lib/matchmaking-presentation.js';
import {
  discardPreparedMatchRoom,
  prepareMatchRoom,
  preloadMatchPresentationAssets,
  type MatchFoundOpponent,
  type MatchFoundPreload,
} from '../lib/preloaded-match-room.js';

const SEARCH_DURATION_MS = 60_000;
const SEARCH_EXIT_MS = 260;
/**
 * Celular em segundo plano por mais que isso (ex.: foi mandar o link no
 * WhatsApp) pausa a busca. Se a partida fosse formada com o jogador fora, a
 * sala anularia por falta de prontidão e o adversário perderia a viagem.
 */
export const BACKGROUND_PAUSE_MS = 20_000;
const FOUND_TITLE = 'Partida encontrada! · QUIZ GOMES';

function isTouchDevice(): boolean {
  try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; }
}

const MATCH_FAILURE_MESSAGES: Record<string, string> = {
  PLAYER_BUSY: 'Um dos jogadores já está em outra partida.',
  PROFILE_REQUIRED: 'Um dos jogadores precisa concluir o perfil.',
  QUESTION_POOL_EMPTY: 'Este tema ainda não possui perguntas suficientes.',
  QUESTION_POOL_INCONSISTENT: 'O banco de perguntas deste tema está em manutenção.',
  QUESTION_POOL_INSUFFICIENT: 'As perguntas recentes deste tema foram esgotadas para estes jogadores.',
  RECENT_QUESTIONS_EXHAUSTED: 'As perguntas recentes deste tema foram esgotadas para estes jogadores.',
};

export function matchmakingFailureMessage(code?: string): string {
  return code === undefined
    ? 'Não foi possível formar a partida.'
    : MATCH_FAILURE_MESSAGES[code] ?? 'Não foi possível formar a partida.';
}

export type MatchmakingStatus =
  | 'cancelling'
  | 'idle'
  | 'leaving-opponent'
  | 'paused'
  | 'presenting-opponent'
  | 'searching'
  | 'timed-out';

interface MatchFoundMessage {
  opponent: MatchFoundOpponent;
  preload: MatchFoundPreload;
  roomId: string;
  type: 'MATCH_FOUND';
}

interface RealtimeMessage {
  code?: string;
  opponent?: MatchFoundOpponent;
  preload?: { firstQuestion?: PublicQuestion };
  roomId?: string;
  timeoutAt?: number;
  type?: string;
}

interface MatchOrigin {
  mode: MatchMode;
  returnTo: string;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function elapsedSearchSeconds(timeoutAt: number | null, now = Date.now()): number {
  if (timeoutAt === null || !Number.isFinite(timeoutAt)) return 0;
  const startedAt = timeoutAt - SEARCH_DURATION_MS;
  return Math.max(0, Math.min(60, Math.floor((now - startedAt) / 1_000)));
}

function isQuestion(value: unknown): value is PublicQuestion {
  if (typeof value !== 'object' || value === null) return false;
  const question = value as Partial<PublicQuestion>;
  return typeof question.id === 'string'
    && typeof question.prompt === 'string'
    && Array.isArray(question.options)
    && question.options.length === 4
    && question.options.every((option) => typeof option === 'string')
    && (question.imageUrl === null || typeof question.imageUrl === 'string');
}

function matchFoundMessage(message: RealtimeMessage): MatchFoundMessage | null {
  const opponent = message.opponent;
  const firstQuestion = message.preload?.firstQuestion;
  if (message.type !== 'MATCH_FOUND' || typeof message.roomId !== 'string' ||
    opponent === undefined || typeof opponent.displayName !== 'string' ||
    (opponent.customAvatarUrl !== null && typeof opponent.customAvatarUrl !== 'string') ||
    (opponent.photoUrl !== null && typeof opponent.photoUrl !== 'string') ||
    (opponent.frameId !== null && typeof opponent.frameId !== 'string') ||
    !Number.isFinite(opponent.knowledge) || !isQuestion(firstQuestion)) return null;
  return {
    opponent,
    preload: { firstQuestion },
    roomId: message.roomId,
    type: 'MATCH_FOUND',
  };
}

export function useMatchmaking() {
  const { getToken, profile } = useAuth();
  const navigate = useNavigate();
  const socketRef = useRef<WebSocket | null>(null);
  const exitTimerRef = useRef<number | null>(null);
  const presentationGenerationRef = useRef(0);
  const preparedRoomRef = useRef<string | null>(null);
  const originRef = useRef<MatchOrigin | null>(null);
  const navigatingRef = useRef(false);
  const statusRef = useRef<MatchmakingStatus>('idle');
  const lastStartRef = useRef<{ mode: MatchMode; themeId: string; themeSlug?: string | undefined } | null>(null);
  const wentHiddenRef = useRef(false);
  const [status, setStatusState] = useState<MatchmakingStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [timeoutAt, setTimeoutAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [opponent, setOpponent] = useState<MatchFoundOpponent | null>(null);
  const [preparing, setPreparing] = useState(false);

  const setStatus = useCallback((next: MatchmakingStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  useEffect(() => {
    if (status !== 'searching' || timeoutAt === null) return undefined;
    let timer: number | null = null;
    const update = () => {
      const elapsed = elapsedSearchSeconds(timeoutAt);
      setElapsedSeconds((current) => current === elapsed ? current : elapsed);
      if (elapsed >= 60) return;
      const startedAt = timeoutAt - SEARCH_DURATION_MS;
      const remainder = Math.max(0, Date.now() - startedAt) % 1_000;
      timer = window.setTimeout(update, remainder === 0 ? 1_000 : 1_000 - remainder);
    };
    update();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [status, timeoutAt]);

  useEffect(() => () => {
    presentationGenerationRef.current += 1;
    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
    socketRef.current?.close(1_000, 'Tela encerrada');
    if (!navigatingRef.current && preparedRoomRef.current !== null) {
      discardPreparedMatchRoom(preparedRoomRef.current);
    }
  }, []);

  const pause = useCallback(() => {
    const socket = socketRef.current;
    socketRef.current = null;
    socket?.close(1_000, 'Pausado em segundo plano');
    setTimeoutAt(null);
    setStatus('paused');
  }, [setStatus]);

  useEffect(() => {
    if (status !== 'searching' || typeof document === 'undefined') return undefined;
    const touch = isTouchDevice();
    let hiddenAt: number | null = document.visibilityState === 'hidden' ? Date.now() : null;
    let timer: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        wentHiddenRef.current = true;
        hiddenAt = Date.now();
        // No Android o JS segue rodando: o timer pausa no prazo. No iOS ele
        // congela, e a checagem ao voltar cobre o caso.
        if (touch) timer = window.setTimeout(pause, BACKGROUND_PAUSE_MS);
        return;
      }
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      const hiddenFor = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (touch && hiddenFor >= BACKGROUND_PAUSE_MS && statusRef.current === 'searching') pause();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [pause, status]);

  const cancel = useCallback(() => {
    socketRef.current?.close(1_000, 'Cancelado pelo jogador');
    socketRef.current = null;
    setTimeoutAt(null);
    setPreparing(false);
    setStatus('cancelling');
    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = null;
      setOpponent(null);
      setStatus('idle');
    }, SEARCH_EXIT_MS);
  }, [setStatus]);

  const presentMatch = useCallback(async (message: MatchFoundMessage) => {
    const generation = ++presentationGenerationRef.current;
    preparedRoomRef.current = message.roomId;
    setOpponent(message.opponent);
    setPreparing(false);
    setTimeoutAt(null);
    setStatus('presenting-opponent');
    preloadMatchPresentationAssets(message.opponent, message.preload);
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      // Aba de desktop escondida: o título avisa sem som nem notificação.
      const previousTitle = document.title;
      document.title = FOUND_TITLE;
      const restore = () => {
        if (document.visibilityState !== 'visible') return;
        if (document.title === FOUND_TITLE) document.title = previousTitle;
        document.removeEventListener('visibilitychange', restore);
      };
      document.addEventListener('visibilitychange', restore);
    }

    let essentialsReady = false;
    const essentials = Promise.all([
      import('../pages/live-match-page.js'),
      prepareMatchRoom(message.roomId, getToken),
    ]).then(() => { essentialsReady = true; });
    void delay(MATCH_FOUND_PRESENTATION_MS).then(() => {
      if (!essentialsReady && generation === presentationGenerationRef.current) setPreparing(true);
    });
    try {
      await Promise.all([delay(MATCH_FOUND_ENTRY_MS + MATCH_FOUND_HOLD_MS), essentials]);
      if (generation !== presentationGenerationRef.current) return;
      setStatus('leaving-opponent');
      await delay(MATCH_FOUND_EXIT_MS);
      if (generation !== presentationGenerationRef.current) return;
      navigatingRef.current = true;
      // Guarda a posição atual dos retratos para o lobby continuar o movimento de onde ele parou.
      captureDuelOrigins(typeof document === 'undefined' ? null : document, message.roomId, 'presentation');
      const origin = originRef.current;
      if (origin === null) void navigate(`/partida/${message.roomId}`);
      else void navigate(`/partida/${message.roomId}`, { state: { matchOrigin: origin } });
    } catch (preloadError) {
      if (generation !== presentationGenerationRef.current) return;
      discardPreparedMatchRoom(message.roomId);
      preparedRoomRef.current = null;
      setError(preloadError instanceof Error ? preloadError.message : 'Não foi possível preparar a partida.');
      setPreparing(true);
    }
  }, [getToken, navigate, setStatus]);

  const start = useCallback(async (themeId: string, mode: MatchMode, themeSlug?: string) => {
    lastStartRef.current = { mode, themeId, themeSlug };
    wentHiddenRef.current = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    originRef.current = themeSlug === undefined ? null : {
      mode,
      returnTo: `/temas/${encodeURIComponent(themeSlug)}`,
    };
    setError(null);
    setOpponent(null);
    setPreparing(false);
    setElapsedSeconds(0);
    setTimeoutAt(null);
    if (profile === null) {
      setError('Entre e conclua seu perfil antes de buscar uma partida.');
      return;
    }
    const token = await getToken();
    if (token === null) {
      setError('Sua sessão expirou. Entre novamente.');
      return;
    }
    const resource = `${themeId}:${mode}`;
    try {
      const ticket = await apiRequest<{ expiresAt: number; ticket: string }>('/api/realtime/tickets', {
        body: { resource, scope: 'matchmaking' }, getToken, method: 'POST', token,
      });
      const params = new URLSearchParams({ resource, ticket: ticket.ticket });
      const socket = new WebSocket(websocketUrl(`/api/realtime/matchmaking?${params}`));
      socketRef.current = socket;
      setStatus('searching');
      socket.addEventListener('message', (event) => {
        let message: RealtimeMessage;
        try {
          message = JSON.parse(String(event.data)) as RealtimeMessage;
        } catch {
          setError('A fila enviou uma mensagem inválida.');
          return;
        }
        if (message.type === 'SEARCHING' && Number.isFinite(message.timeoutAt)) {
          setTimeoutAt(message.timeoutAt as number);
          return;
        }
        const found = matchFoundMessage(message);
        if (found !== null) {
          socketRef.current = null;
          void presentMatch(found);
          return;
        }
        if (message.type === 'TIMEOUT') {
          socketRef.current = null;
          setElapsedSeconds(60);
          setStatus('timed-out');
          return;
        }
        if (message.type === 'MATCH_FAILED') {
          socketRef.current = null;
          setError(matchmakingFailureMessage(message.code));
          setStatus('idle');
        }
      });
      socket.addEventListener('close', (event) => {
        if (socketRef.current !== socket) return;
        socketRef.current = null;
        if (statusRef.current === 'searching' && event.code !== 1_000) {
          // O sistema derrubou o socket com o app em segundo plano: isso é
          // uma pausa, não um erro. O jogador escolhe voltar para a fila.
          if (wentHiddenRef.current && isTouchDevice()) {
            setTimeoutAt(null);
            setStatus('paused');
            return;
          }
          setError('A conexão com a fila foi interrompida.');
          setStatus('idle');
        }
      });
      socket.addEventListener('error', () => {
        if (socketRef.current !== socket) return;
        setError('A conexão com a fila foi interrompida.');
      });
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Não foi possível entrar na fila.');
      setStatus('idle');
    }
  }, [getToken, presentMatch, profile, setStatus]);

  const resume = useCallback(() => {
    const last = lastStartRef.current;
    if (last === null) return;
    void start(last.themeId, last.mode, last.themeSlug);
  }, [start]);

  return { cancel, elapsedSeconds, error, opponent, paused: status === 'paused', preparing, resume, start, status, timeoutAt };
}
