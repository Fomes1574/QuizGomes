import { DIRECT_CHALLENGE_TIMEOUT_MS, type Difficulty } from '@quiz-gomes/domain';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth-context.js';
import { useSocial } from '../features/social-context.js';
import { apiRequest } from '../lib/api.js';
import { prepareMatchRoom, preloadMatchPresentationAssets } from '../lib/preloaded-match-room.js';
import type { ChallengeKind } from '../lib/challenges.js';

export type FriendChallengeStatus = 'idle' | 'sending' | 'waiting';

interface WaitingChallenge {
  challengeId: string;
  displayName: string;
  expiresAtMs: number;
}

function remainingSeconds(expiresAtMs: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((expiresAtMs - now) / 1_000));
}

/**
 * Envio de desafio a um amigo a partir da tela do tema.
 *
 * O cliente nunca decide elegibilidade nem expiração: apenas apresenta a contagem
 * derivada do prazo autoritativo e reage ao evento `CHALLENGE_STARTED` que chega
 * pelo canal social existente.
 */
export function useFriendChallenge(themeSlug: string) {
  const { getToken } = useAuth();
  const { consumeStartedChallenge, startedChallenge } = useSocial();
  const navigate = useNavigate();
  const [status, setStatus] = useState<FriendChallengeStatus>('idle');
  const [waiting, setWaiting] = useState<WaitingChallenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const navigatingRef = useRef(false);

  useEffect(() => {
    if (waiting === null) return undefined;
    let timer: number | null = null;
    const tick = () => {
      const left = remainingSeconds(waiting.expiresAtMs);
      setSecondsLeft(left);
      if (left <= 0) {
        // O servidor é quem expira; a tela apenas para de esperar.
        setWaiting(null);
        setStatus('idle');
        setError('O convite expirou.');
        return;
      }
      timer = window.setTimeout(tick, 250);
    };
    tick();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [waiting]);

  useEffect(() => {
    if (startedChallenge === null || navigatingRef.current) return;
    const started = consumeStartedChallenge();
    if (started === null) return;
    navigatingRef.current = true;
    preloadMatchPresentationAssets(started.opponent, started.preload);
    // A limpeza de estado acontece na continuação assíncrona, junto da navegação.
    void prepareMatchRoom(started.roomId, getToken)
      .catch(() => undefined)
      .finally(() => {
        setWaiting(null);
        setStatus('idle');
        void navigate(`/partida/${started.roomId}`, {
          state: {
            matchOrigin: {
              difficulty: 'EASY',
              mode: 'CASUAL',
              returnTo: `/temas/${encodeURIComponent(themeSlug)}`,
            },
          },
        });
      });
  }, [consumeStartedChallenge, getToken, navigate, startedChallenge, themeSlug]);

  const challenge = useCallback(async (input: {
    difficulty: Difficulty;
    displayName: string;
    kind: ChallengeKind;
    publicId: string;
  }) => {
    setError(null);
    setStatus('sending');
    try {
      const response = await apiRequest<{ challengeId: string; halfReady?: boolean; roomId?: string }>('/api/challenges', {
        body: {
          difficulty: input.difficulty,
          kind: input.kind,
          publicId: input.publicId,
          themeSlug,
        },
        getToken,
        method: 'POST',
      });
      if (input.kind === 'DIRECT' && response.roomId === undefined) {
        setWaiting({
          challengeId: response.challengeId,
          displayName: input.displayName,
          expiresAtMs: Date.now() + DIRECT_CHALLENGE_TIMEOUT_MS,
        });
        setStatus('waiting');
        return;
      }
      setStatus('idle');
      if (input.kind === 'ASYNC' && response.halfReady === true) {
        // Quem desafia depois joga a própria metade imediatamente.
        void navigate(`/desafio/${response.challengeId}`);
      }
    } catch (reason) {
      setStatus('idle');
      setError(reason instanceof Error ? reason.message : 'Não foi possível enviar o desafio.');
    }
  }, [getToken, navigate, themeSlug]);

  const cancel = useCallback(async () => {
    const current = waiting;
    if (current === null) return;
    setWaiting(null);
    setStatus('idle');
    try {
      await apiRequest(`/api/challenges/${current.challengeId}/cancel`, { getToken, method: 'POST' });
    } catch {
      // O servidor já pode ter encerrado o convite; a tela volta ao estado livre de qualquer forma.
    }
  }, [getToken, waiting]);

  return {
    cancel,
    challenge,
    error,
    secondsLeft,
    status,
    waitingFor: waiting?.displayName ?? null,
  };
}
