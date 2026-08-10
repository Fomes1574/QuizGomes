import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../components/button.js';
import { Logo } from '../components/logo.js';
import { useAuth } from '../features/auth-context.js';
import { apiRequest, websocketUrl } from '../lib/api.js';

export function LiveMatchPage() {
  const { roomId = '' } = useParams();
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const socketRef = useRef<WebSocket | null>(null);
  const [message, setMessage] = useState('Conectando à sala');
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let interval: number | null = null;
    void (async () => {
      const token = await getToken();
      if (token === null) throw new Error('Sessão necessária.');
      const ticket = await apiRequest<{ ticket: string }>('/api/realtime/tickets', {
        body: { resource: roomId, scope: 'room' }, method: 'POST', token,
      });
      socket = new WebSocket(websocketUrl(`/api/realtime/rooms/${roomId}?ticket=${encodeURIComponent(ticket.ticket)}`));
      socketRef.current = socket;
      socket.addEventListener('open', () => {
        setMessage('Aguardando jogador');
        socket?.send(JSON.stringify({ type: 'READY' }));
      });
      socket.addEventListener('message', (event) => {
        const payload = JSON.parse(String(event.data)) as { deadline?: number; startsAt?: number; type?: string };
        if (payload.type === 'PREPARING' && payload.startsAt !== undefined) {
          setMessage('PREPARE-SE PARA A PARTIDA');
          const update = () => setCountdown(Math.max(1, Math.ceil((payload.startsAt! - Date.now()) / 1_000)));
          update();
          interval = window.setInterval(update, 100);
        }
        if (payload.type === 'STARTED') {
          if (interval !== null) clearInterval(interval);
          setCountdown(null);
          setMessage('Preparando a primeira pergunta');
        }
        if (payload.type === 'PAUSED_FOR_RECONNECT') setMessage('AGUARDANDO JOGADOR');
        if (payload.type === 'RESUMED') setMessage('Jogador reconectado');
        if (payload.type === 'VOID_DISCONNECT') setMessage('Partida anulada por perda de conexão');
        if (payload.type === 'CANCELLED') setMessage('A partida foi cancelada');
      });
    })().catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Não foi possível entrar na sala.'));
    return () => {
      if (interval !== null) clearInterval(interval);
      socketRef.current = null;
      socket?.close(1000, 'Tela encerrada');
    };
  }, [getToken, roomId]);

  return (
    <main className="match-lobby-screen">
      <Logo />
      <span className="matchmaking-radar"><span /><span /><i /></span>
      <h1>{message}</h1>
      {countdown !== null && <strong className="countdown">{countdown}</strong>}
      <Button onClick={() => { socketRef.current?.send(JSON.stringify({ type: 'CANCEL' })); void navigate('/'); }} variant="ghost">Cancelar e voltar</Button>
    </main>
  );
}
