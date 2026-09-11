import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api.js';
import type { ChallengeView } from '../lib/challenges.js';
import { prepareMatchRoom, preloadMatchPresentationAssets } from '../lib/preloaded-match-room.js';
import { useAuth } from './auth-context.js';
import { useSocial } from './social-context.js';

export interface PendingDirectChallenge {
  challengeId: string;
  displayName: string;
  /** Prazo AUTORITATIVO vindo do servidor; nunca derivado do relógio local. */
  expiresAtMs: number;
}

interface ChallengeContextValue {
  cancelPending: () => Promise<void>;
  challenges: ChallengeView[];
  /** Convite direto que este usuário enviou e ainda aguarda resposta. */
  pendingDirect: PendingDirectChallenge | null;
  refreshChallenges: () => Promise<void>;
  /** Segundos restantes derivados do prazo autoritativo. */
  secondsLeft: number;
  trackPendingDirect: (pending: PendingDirectChallenge) => void;
}

const ChallengeContext = createContext<ChallengeContextValue | null>(null);

function remainingSeconds(expiresAtMs: number): number {
  return Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1_000));
}

/**
 * Estado global dos desafios.
 *
 * A espera de um convite direto NÃO pode viver no hook de uma página: se ela
 * desmonta, o aceite do outro lado chega sem ninguém para escutar e a partida
 * termina anulada. Aqui o convite pendente é recuperado do servidor, a contagem
 * deriva do `expiresAt` autoritativo e `CHALLENGE_STARTED` tem um consumidor
 * único, montado enquanto o app estiver aberto.
 */
export function ChallengeProvider({ children }: { children: ReactNode }) {
  const { getToken, profile } = useAuth();
  const { challengeRevision, consumeStartedChallenge, startedChallenge } = useSocial();
  const navigate = useNavigate();
  const [challenges, setChallenges] = useState<ChallengeView[]>([]);
  const [optimistic, setOptimistic] = useState<PendingDirectChallenge | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const navigatingRef = useRef(false);

  const refreshChallenges = useCallback(async () => {
    if (profile === null) {
      setChallenges([]);
      return;
    }
    try {
      const response = await apiRequest<{ challenges?: ChallengeView[] }>('/api/challenges', { getToken });
      setChallenges(Array.isArray(response.challenges) ? response.challenges : []);
    } catch {
      // Falha transitória não apaga a lista já exibida.
    }
  }, [getToken, profile]);

  useEffect(() => {
    if (profile === null) return;
    queueMicrotask(() => { void refreshChallenges(); });
  }, [challengeRevision, profile, refreshChallenges]);

  /**
   * Convite pendente recuperado do SERVIDOR. É o que faz a espera sobreviver a um
   * reload ou a uma reconexão durante os 30 s.
   */
  const recovered = useMemo<PendingDirectChallenge | null>(() => {
    const mine = challenges.find((challenge) => (
      challenge.kind === 'DIRECT' &&
      challenge.status === 'PENDING_DIRECT' &&
      challenge.role === 'CHALLENGER' &&
      challenge.expiresAt !== null
    ));
    if (mine === undefined || mine.expiresAt === null) return null;
    const expiresAtMs = Date.parse(mine.expiresAt);
    if (!Number.isFinite(expiresAtMs)) return null;
    return { challengeId: mine.id, displayName: mine.challenged.displayName, expiresAtMs };
  }, [challenges]);

  // O otimista cobre só a janela entre criar o convite e a próxima leitura do servidor.
  const candidate = recovered ?? optimistic;
  const pendingDirect = candidate === null || candidate.challengeId === dismissedId ? null : candidate;

  useEffect(() => {
    if (pendingDirect === null) return undefined;
    let timer: number | null = null;
    const expiresAtMs = pendingDirect.expiresAtMs;
    const challengeId = pendingDirect.challengeId;
    const tick = () => {
      const left = remainingSeconds(expiresAtMs);
      setSecondsLeft(left);
      if (left <= 0) {
        // Quem expira é o servidor; a tela apenas para de esperar e libera a navegação.
        setDismissedId(challengeId);
        void refreshChallenges();
        return;
      }
      timer = window.setTimeout(tick, 250);
    };
    timer = window.setTimeout(tick, 0);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [pendingDirect, refreshChallenges]);

  // Consumidor ÚNICO e global do aceite remoto: não depende de nenhuma página montada.
  useEffect(() => {
    if (startedChallenge === null || navigatingRef.current) return;
    const started = consumeStartedChallenge();
    if (started === null) return;
    navigatingRef.current = true;
    preloadMatchPresentationAssets(started.opponent, started.preload);
    void prepareMatchRoom(started.roomId, getToken)
      .catch(() => undefined)
      .finally(() => {
        setOptimistic(null);
        setDismissedId(started.challengeId);
        navigatingRef.current = false;
        void navigate(`/partida/${started.roomId}`);
      });
  }, [consumeStartedChallenge, getToken, navigate, startedChallenge]);

  const trackPendingDirect = useCallback((pending: PendingDirectChallenge) => {
    setDismissedId(null);
    setOptimistic(pending);
  }, []);

  const cancelPending = useCallback(async () => {
    const current = pendingDirect;
    if (current === null) return;
    setDismissedId(current.challengeId);
    setOptimistic(null);
    try {
      await apiRequest(`/api/challenges/${current.challengeId}/cancel`, { getToken, method: 'POST' });
    } catch {
      // O servidor pode já ter encerrado o convite; a navegação é liberada de todo jeito.
    }
    await refreshChallenges();
  }, [getToken, pendingDirect, refreshChallenges]);

  const value = useMemo<ChallengeContextValue>(() => ({
    cancelPending,
    challenges,
    pendingDirect,
    refreshChallenges,
    secondsLeft,
    trackPendingDirect,
  }), [cancelPending, challenges, pendingDirect, refreshChallenges, secondsLeft, trackPendingDirect]);

  return <ChallengeContext value={value}>{children}</ChallengeContext>;
}

export function useChallenges(): ChallengeContextValue {
  const context = useContext(ChallengeContext);
  if (context === null) throw new Error('useChallenges precisa de ChallengeProvider.');
  return context;
}
