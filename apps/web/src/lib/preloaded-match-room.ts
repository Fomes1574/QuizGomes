import type { PublicQuestion } from '@quiz-gomes/domain';
import { apiRequest, websocketUrl } from './api.js';

export interface MatchFoundOpponent {
  customAvatarUrl: string | null;
  displayName: string;
  frameId: string | null;
  knowledge: number;
  photoUrl: string | null;
}

export interface MatchFoundPreload {
  firstQuestion: PublicQuestion;
}

interface BufferedConnection {
  claim(): ClaimedRoomConnection;
  ready: Promise<void>;
  socket: WebSocket;
}

export interface ClaimedRoomConnection {
  messages: string[];
  socket: WebSocket;
}

const preparing = new Map<string, Promise<BufferedConnection>>();
const prepared = new Map<string, BufferedConnection>();
const pending = new Map<string, BufferedConnection>();

function createBufferedConnection(socket: WebSocket): BufferedConnection {
  const messages: string[] = [];
  let claimed = false;
  let opened = socket.readyState === WebSocket.OPEN;
  let roomStateReceived = false;
  let resolveReady: (() => void) | null = null;
  let rejectReady: ((reason?: unknown) => void) | null = null;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const settle = () => {
    if (opened && roomStateReceived) resolveReady?.();
  };
  const handleOpen = () => {
    opened = true;
    settle();
  };
  const handleMessage = (event: MessageEvent) => {
    const message = String(event.data);
    messages.push(message);
    try {
      const payload = JSON.parse(message) as { type?: string };
      if (payload.type === 'ROOM_STATE' || payload.type === 'MATCH_STATE') roomStateReceived = true;
    } catch {
      // A tela da partida exibirá a falha de protocolo ao assumir a conexão.
    }
    settle();
  };
  const handleFailure = () => {
    if (!claimed) rejectReady?.(new Error('Não foi possível preparar a conexão da partida.'));
  };
  socket.addEventListener('open', handleOpen);
  socket.addEventListener('message', handleMessage);
  socket.addEventListener('close', handleFailure);
  socket.addEventListener('error', handleFailure);
  settle();

  return {
    claim: () => {
      claimed = true;
      socket.removeEventListener('open', handleOpen);
      socket.removeEventListener('message', handleMessage);
      socket.removeEventListener('close', handleFailure);
      socket.removeEventListener('error', handleFailure);
      return { messages: [...messages], socket };
    },
    ready,
    socket,
  };
}

export async function prepareMatchRoom(
  roomId: string,
  getToken: (forceRefresh?: boolean) => Promise<string | null>,
): Promise<void> {
  if (prepared.has(roomId)) return;
  let preparation = preparing.get(roomId);
  if (preparation === undefined) {
    preparation = (async () => {
      const token = await getToken();
      if (token === null) throw new Error('Sua sessão expirou. Entre novamente.');
      const ticket = await apiRequest<{ ticket: string }>('/api/realtime/tickets', {
        body: { resource: roomId, scope: 'room' }, getToken, method: 'POST', token,
      });
      const socket = new WebSocket(websocketUrl(`/api/realtime/rooms/${roomId}?ticket=${encodeURIComponent(ticket.ticket)}`));
      const connection = createBufferedConnection(socket);
      pending.set(roomId, connection);
      await connection.ready;
      if (pending.get(roomId) !== connection) {
        throw new Error('A preparação da partida foi cancelada.');
      }
      pending.delete(roomId);
      prepared.set(roomId, connection);
      return connection;
    })();
    preparing.set(roomId, preparation);
  }
  try {
    await preparation;
  } finally {
    pending.delete(roomId);
    preparing.delete(roomId);
  }
}

export function takePreparedMatchRoom(roomId: string): ClaimedRoomConnection | null {
  const connection = prepared.get(roomId);
  if (connection === undefined) return null;
  prepared.delete(roomId);
  return connection.claim();
}

export function discardPreparedMatchRoom(roomId: string): void {
  const connection = prepared.get(roomId);
  const pendingConnection = pending.get(roomId);
  prepared.delete(roomId);
  pending.delete(roomId);
  connection?.socket.close(1_000, 'Preparação descartada');
  pendingConnection?.socket.close(1_000, 'Preparação descartada');
}

function preloadImage(url: string | null): void {
  if (url === null) return;
  const image = new Image();
  image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  image.src = url;
}

export function preloadMatchPresentationAssets(opponent: MatchFoundOpponent, preload: MatchFoundPreload): void {
  preloadImage(opponent.customAvatarUrl ?? opponent.photoUrl);
  preloadImage(preload.firstQuestion.imageUrl ?? null);
}
