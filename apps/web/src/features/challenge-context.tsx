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

export interface EndedDirectChallenge {
  displayName: string;
  /**
   * A lista autoritativa só devolve desafios vivos: uma vez que este some dela,
   * o servidor não diz mais qual dos terminais (recusa, cancelamento, bloqueio)
   * foi. `EXPIRED` é a exceção — o relógio local, sincronizado ao prazo
   * autoritativo, prova isso sem precisar perguntar.
   */
  reason: 'EXPIRED' | 'UNAVAILABLE';
}

interface ChallengeContextValue {
  cancelPending: () => Promise<void>;
  challenges: ChallengeView[];
  /** Convite que acabou de terminar sem virar sala — para uma mensagem breve, não silêncio. */
  dismissEndedChallenge: () => void;
  endedChallenge: EndedDirectChallenge | null;
  /**
   * Ponto ÚNICO de entrada numa sala DIRECT — usado pelo aceite HTTP síncrono,
   * pelo push `CHALLENGE_STARTED` e pela recuperação por lista. Os três podem
   * disparar para a mesma sala; só o primeiro efetivamente navega.
   */
  enterDirectRoom: (roomId: string, challengeId: string) => void;
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
  const [endedChallenge, setEndedChallenge] = useState<EndedDirectChallenge | null>(null);
  const navigatingRef = useRef(false);
  // Sequência monotônica de leituras autoritativas DISPARADAS (não concluídas):
  // incrementada antes de cada chamada. `trackPendingDirect` grava em que
  // sequência o otimista nasceu; só uma leitura que INICIOU depois dele pode
  // provar que ele terminou — uma já em voo quando ele nasceu é lida antes do
  // convite existir no servidor, e não pode ser usada contra ele.
  const refreshSequenceRef = useRef(0);
  const [optimisticSinceSequence, setOptimisticSinceSequence] = useState<number | null>(null);
  const [settledSequence, setSettledSequence] = useState(0);
  // Compartilhado entre o consumidor realtime e a recuperação por lista: a
  // mesma sala nunca navega duas vezes, venha o aviso de onde vier.
  const navigatedRoomIdsRef = useRef<Set<string>>(new Set());

  const refreshChallenges = useCallback(async () => {
    if (profile === null) {
      setChallenges([]);
      return;
    }
    refreshSequenceRef.current += 1;
    const sequence = refreshSequenceRef.current;
    try {
      const response = await apiRequest<{ challenges?: ChallengeView[] }>('/api/challenges', { getToken });
      setChallenges(Array.isArray(response.challenges) ? response.challenges : []);
      setSettledSequence(sequence);
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

  // O otimista só vale enquanto o servidor não tiver falado sobre ESTE convite
  // ainda: uma leitura que já estava em voo quando ele nasceu reflete um
  // instante anterior à criação, e "não achei" nela não prova nada. Só uma
  // leitura que começou depois dele é autoridade o bastante para substituí-lo.
  const authoritativeOptimistic = optimistic === null
    ? undefined
    : challenges.find((entry) => entry.id === optimistic.challengeId);
  const optimisticListIsFresh = optimisticSinceSequence !== null && settledSequence > optimisticSinceSequence;
  const optimisticStillPending = optimistic !== null && (
    authoritativeOptimistic === undefined ? !optimisticListIsFresh : authoritativeOptimistic.status === 'PENDING_DIRECT'
  );
  const candidate = recovered ?? (optimisticStillPending ? optimistic : null);
  const pendingDirect = candidate === null || candidate.challengeId === dismissedId ? null : candidate;

  // O otimista para de valer assim que uma leitura FRESCA fala — vira sala (o
  // efeito de recuperação abaixo navega) ou simplesmente não existe mais
  // (terminou sem nunca virar sala: recusa, cancelamento, bloqueio ou desfazer
  // amizade).
  useEffect(() => {
    if (optimistic === null || !optimisticListIsFresh) return;
    if (authoritativeOptimistic !== undefined && authoritativeOptimistic.status === 'PENDING_DIRECT') return;
    const endedWithoutRoom = authoritativeOptimistic === undefined;
    const displayName = optimistic.displayName;
    queueMicrotask(() => {
      setOptimistic(null);
      if (endedWithoutRoom) setEndedChallenge({ displayName, reason: 'UNAVAILABLE' });
    });
  }, [authoritativeOptimistic, optimisticListIsFresh, optimistic]);

  useEffect(() => {
    if (pendingDirect === null) return undefined;
    let timer: number | null = null;
    const expiresAtMs = pendingDirect.expiresAtMs;
    const challengeId = pendingDirect.challengeId;
    const displayName = pendingDirect.displayName;
    const tick = () => {
      const left = remainingSeconds(expiresAtMs);
      setSecondsLeft(left);
      if (left <= 0) {
        // Quem expira é o servidor; a tela apenas para de esperar e libera a navegação.
        setDismissedId(challengeId);
        setEndedChallenge({ displayName, reason: 'EXPIRED' });
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

  const enterDirectRoom = useCallback((roomId: string, challengeId: string) => {
    if (navigatedRoomIdsRef.current.has(roomId)) return;
    navigatedRoomIdsRef.current.add(roomId);
    setOptimistic(null);
    setDismissedId(challengeId);
    void navigate(`/partida/${roomId}`);
  }, [navigate]);

  // Consumidor ÚNICO e global do aceite remoto: não depende de nenhuma página montada.
  useEffect(() => {
    if (startedChallenge === null || navigatingRef.current) return;
    const started = consumeStartedChallenge();
    if (started === null) return;
    if (navigatedRoomIdsRef.current.has(started.roomId)) return;
    navigatingRef.current = true;
    preloadMatchPresentationAssets(started.opponent, started.preload);
    void getToken()
      .then((token) => {
        // Sessão expirada não é uma falha transitória de preparo: navegar sem
        // token só troca uma tela de espera por uma sala inacessível.
        if (token === null) throw new Error('SESSION_EXPIRED');
        return prepareMatchRoom(started.roomId, getToken).catch(() => undefined);
      })
      .then(() => { enterDirectRoom(started.roomId, started.challengeId); })
      .catch(() => undefined)
      .finally(() => { navigatingRef.current = false; });
  }, [consumeStartedChallenge, enterDirectRoom, getToken, startedChallenge]);

  // Recuperação por lista: cobre reload, reconexão e o desafiante perdendo o
  // push CHALLENGE_STARTED — os dois lados de um DIRECT já reservado entram
  // pela mesma leitura autoritativa, sem precisar do realtime.
  useEffect(() => {
    for (const challenge of challenges) {
      if (challenge.kind !== 'DIRECT' || challenge.roomId === null) continue;
      if (challenge.status !== 'PREPARING' && challenge.status !== 'ACTIVE') continue;
      enterDirectRoom(challenge.roomId, challenge.id);
    }
  }, [challenges, enterDirectRoom]);

  const dismissEndedChallenge = useCallback(() => setEndedChallenge(null), []);

  const trackPendingDirect = useCallback((pending: PendingDirectChallenge) => {
    setDismissedId(null);
    setOptimisticSinceSequence(refreshSequenceRef.current);
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
    dismissEndedChallenge,
    enterDirectRoom,
    endedChallenge,
    pendingDirect,
    refreshChallenges,
    secondsLeft,
    trackPendingDirect,
  }), [cancelPending, challenges, dismissEndedChallenge, enterDirectRoom, endedChallenge, pendingDirect,
    refreshChallenges, secondsLeft, trackPendingDirect]);

  return <ChallengeContext value={value}>{children}</ChallengeContext>;
}

export function useChallenges(): ChallengeContextValue {
  const context = useContext(ChallengeContext);
  if (context === null) throw new Error('useChallenges precisa de ChallengeProvider.');
  return context;
}
