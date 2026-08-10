import type { Env } from '../env.js';

interface RoomAttachment {
  ready: boolean;
  seat: 1 | 2;
  uid: string;
}

interface RoomState {
  disconnected: Array<{ deadline: number; uid: string }>;
  phase: 'WAITING' | 'PREPARING' | 'PLAYING' | 'VOID';
  startedAt: number | null;
}

const INITIAL_STATE: RoomState = { disconnected: [], phase: 'WAITING', startedAt: null };

function readAttachment(socket: WebSocket): RoomAttachment | null {
  return socket.deserializeAttachment() as RoomAttachment | null;
}

export class MatchRoom {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Upgrade necessário', { status: 426 });
    const uid = request.headers.get('X-QG-Authenticated-Uid');
    if (uid === null) return new Response('Não autorizado', { status: 401 });
    const sockets = this.ctx.getWebSockets();
    const sameUser = sockets.find((socket) => readAttachment(socket)?.uid === uid);
    const occupiedSeats = new Set(sockets.map((socket) => readAttachment(socket)?.seat).filter(Boolean));
    const seat = sameUser !== undefined ? readAttachment(sameUser)?.seat : (!occupiedSeats.has(1) ? 1 : 2);
    if (seat === undefined || (sockets.length >= 2 && sameUser === undefined)) return new Response('Sala cheia', { status: 409 });
    sameUser?.close(4000, 'Reconectado em outra conexão');

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (client === undefined || server === undefined) return new Response('WebSocket indisponível', { status: 500 });
    server.serializeAttachment({ ready: false, seat, uid } satisfies RoomAttachment);
    this.ctx.acceptWebSocket(server);

    const state = await this.state();
    const reconnecting = state.disconnected.find((entry) => entry.uid === uid && entry.deadline >= Date.now());
    if (reconnecting !== undefined) {
      state.disconnected = state.disconnected.filter((entry) => entry.uid !== uid);
      await this.save(state);
      this.broadcast({ type: 'RESUMED' });
    }
    server.send(JSON.stringify({ seat, state, type: 'ROOM_STATE' }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (typeof message !== 'string' || message.length > 2_048) return;
    let input: { type?: string };
    try {
      input = JSON.parse(message) as { type?: string };
    } catch {
      socket.send(JSON.stringify({ code: 'INVALID_MESSAGE', type: 'ERROR' }));
      return;
    }
    if (input.type === 'HEARTBEAT') {
      socket.send(JSON.stringify({ serverNow: Date.now(), type: 'PONG' }));
      return;
    }
    if (input.type === 'CANCEL') {
      const user = readAttachment(socket);
      this.broadcast({ by: user?.uid ?? null, type: 'CANCELLED' });
      await this.setPlayersIdle();
      for (const active of this.ctx.getWebSockets()) active.close(1000, 'Cancelada');
      return;
    }
    if (input.type === 'READY') {
      const current = readAttachment(socket);
      if (current === null) return;
      socket.serializeAttachment({ ...current, ready: true });
      const players = this.ctx.getWebSockets().map(readAttachment).filter((value): value is RoomAttachment => value !== null);
      if (players.length === 2 && players.every((player) => player.ready)) {
        const state: RoomState = { disconnected: [], phase: 'PREPARING', startedAt: Date.now() + 3_000 };
        await this.save(state);
        await this.ctx.storage.setAlarm(state.startedAt ?? Date.now());
        this.broadcast({ startsAt: state.startedAt, type: 'PREPARING' });
      }
    }
  }

  async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    if (code === 4000) return;
    const player = readAttachment(socket);
    const state = await this.state();
    if (player === null) return;
    if (state.phase === 'WAITING' || state.phase === 'PREPARING') {
      this.broadcast({ by: player.uid, type: 'CANCELLED' });
      await this.setPlayersIdle();
      return;
    }
    if (state.phase !== 'PLAYING') return;
    state.disconnected = [...state.disconnected.filter((entry) => entry.uid !== player.uid), { deadline: Date.now() + 7_000, uid: player.uid }];
    if (state.disconnected.length >= 2) {
      state.phase = 'VOID';
      await this.save(state);
      await this.setPlayersIdle();
      return;
    }
    await this.save(state);
    const deadline = state.disconnected[0]?.deadline ?? Date.now() + 7_000;
    await this.ctx.storage.setAlarm(deadline);
    this.broadcast({ deadline, type: 'PAUSED_FOR_RECONNECT' });
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket, 1006);
  }

  async alarm(): Promise<void> {
    const state = await this.state();
    if (state.phase === 'PREPARING' && (state.startedAt ?? Infinity) <= Date.now()) {
      state.phase = 'PLAYING';
      await this.save(state);
      await this.setPlayersActivity('playing');
      this.broadcast({ serverNow: Date.now(), type: 'STARTED' });
      return;
    }
    const expired = state.disconnected.filter((entry) => entry.deadline <= Date.now());
    if (expired.length > 0) {
      state.phase = 'VOID';
      await this.save(state);
      this.broadcast({ disconnectedUid: expired[0]?.uid ?? null, type: 'VOID_DISCONNECT' });
      await this.setPlayersIdle();
    }
  }

  private broadcast(payload: object): void {
    const encoded = JSON.stringify(payload);
    for (const socket of this.ctx.getWebSockets()) socket.send(encoded);
  }

  private async state(): Promise<RoomState> {
    return await this.ctx.storage.get<RoomState>('room') ?? { ...INITIAL_STATE };
  }

  private async save(state: RoomState): Promise<void> {
    await this.ctx.storage.put('room', state);
  }

  private async setPlayersActivity(to: 'idle' | 'playing'): Promise<void> {
    const players = this.ctx.getWebSockets().map(readAttachment).filter((value): value is RoomAttachment => value !== null);
    await Promise.all(players.map(async (player) => {
      const id = this.env.PRESENCE_HUB.idFromName(player.uid);
      await this.env.PRESENCE_HUB.get(id).fetch('https://presence.internal/transition', {
        body: JSON.stringify({ from: ['preparing', 'playing'], resource: null, to }),
        method: 'POST',
      });
    }));
  }

  private async setPlayersIdle(): Promise<void> {
    await this.setPlayersActivity('idle');
  }
}
