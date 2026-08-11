import type { Difficulty, MatchMode } from '@quiz-gomes/domain';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth-context.js';
import { apiRequest, websocketUrl } from '../lib/api.js';

type MatchmakingStatus = 'idle' | 'searching' | 'timed-out';

export function useMatchmaking() {
  const { getToken, profile } = useAuth();
  const navigate = useNavigate();
  const socketRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<number | null>(null);
  const [status, setStatus] = useState<MatchmakingStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const cancel = useCallback(() => {
    socketRef.current?.close(1000, 'Cancelado pelo jogador');
    socketRef.current = null;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setStatus('idle');
  }, []);

  useEffect(() => cancel, [cancel]);

  const start = useCallback(async (themeId: string, difficulty: Difficulty, mode: MatchMode) => {
    setError(null);
    if (profile === null) {
      setError('Entre e conclua seu perfil antes de buscar uma partida.');
      return;
    }
    const token = await getToken();
    if (token === null) {
      setError('Sua sessão expirou. Entre novamente.');
      return;
    }
    const resource = `${themeId}:${difficulty}:${mode}`;
    try {
      const ticket = await apiRequest<{ expiresAt: number; ticket: string }>('/api/realtime/tickets', {
        body: { resource, scope: 'matchmaking' }, getToken, method: 'POST', token,
      });
      const params = new URLSearchParams({ resource, ticket: ticket.ticket });
      const socket = new WebSocket(websocketUrl(`/api/realtime/matchmaking?${params}`));
      socketRef.current = socket;
      setStatus('searching');
      timerRef.current = window.setTimeout(() => {
        socket.close(1000, 'Tempo de busca encerrado');
        socketRef.current = null;
        setStatus('timed-out');
      }, 60_000);
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as { roomId?: string; type?: string };
        if (message.type === 'MATCH_FOUND' && message.roomId !== undefined) {
          if (timerRef.current !== null) window.clearTimeout(timerRef.current);
          socketRef.current = null;
          void navigate(`/partida/${message.roomId}`);
        }
        if (message.type === 'TIMEOUT') {
          if (timerRef.current !== null) window.clearTimeout(timerRef.current);
          socketRef.current = null;
          setStatus('timed-out');
        }
      });
      socket.addEventListener('error', () => {
        setError('A conexão com a fila foi interrompida.');
        setStatus('idle');
      });
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Não foi possível entrar na fila.');
      setStatus('idle');
    }
  }, [getToken, navigate, profile]);

  return { cancel, error, start, status };
}
