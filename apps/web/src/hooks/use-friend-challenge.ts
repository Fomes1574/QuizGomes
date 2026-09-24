import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth-context.js';
import { useChallenges } from '../features/challenge-context.js';
import { apiRequest } from '../lib/api.js';
import type { ChallengeKind } from '../lib/challenges.js';

export type FriendChallengeStatus = 'idle' | 'sending';

interface CreateChallengeResponse {
  challengeId: string;
  expiresAt: string | null;
  halfReady?: boolean;
  roomId?: string;
}

/**
 * Envio de desafio a partir da tela do tema.
 *
 * O hook só cria o desafio. A espera do convite direto e o aceite remoto pertencem
 * ao `ChallengeProvider` global: manter isso aqui deixava a espera morrer junto com
 * a página e o aceite chegava sem ninguém para entrar na sala.
 */
export function useFriendChallenge(themeSlug: string) {
  const { getToken } = useAuth();
  const { refreshChallenges, trackPendingDirect } = useChallenges();
  const navigate = useNavigate();
  const [status, setStatus] = useState<FriendChallengeStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const challenge = useCallback(async (input: {
    displayName: string;
    kind: ChallengeKind;
    publicId: string;
  }) => {
    setError(null);
    setStatus('sending');
    try {
      const response = await apiRequest<CreateChallengeResponse>('/api/challenges', {
        body: {
          kind: input.kind,
          publicId: input.publicId,
          themeSlug,
        },
        getToken,
        method: 'POST',
      });
      setStatus('idle');

      if (input.kind === 'ASYNC' && response.halfReady === true) {
        // Quem desafia depois joga a própria metade imediatamente.
        void navigate(`/desafio/${response.challengeId}`);
        return;
      }
      if (input.kind === 'DIRECT' && typeof response.roomId === 'string') {
        // Convite cruzado já virou partida.
        void navigate(`/partida/${response.roomId}`);
        return;
      }
      if (input.kind === 'DIRECT' && response.expiresAt !== null) {
        const expiresAtMs = Date.parse(response.expiresAt);
        if (Number.isFinite(expiresAtMs)) {
          trackPendingDirect({
            challengeId: response.challengeId,
            displayName: input.displayName,
            expiresAtMs,
          });
        }
      }
      await refreshChallenges();
    } catch (reason) {
      setStatus('idle');
      setError(reason instanceof Error ? reason.message : 'Não foi possível enviar o desafio.');
    }
  }, [getToken, navigate, refreshChallenges, themeSlug, trackPendingDirect]);

  return { challenge, error, status };
}
