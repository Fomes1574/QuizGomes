import type { Env } from '../env.js';

interface QueueAttachment {
  joinedAt: number;
  knowledge: number;
  resource: string;
  uid: string;
}

function attachment(socket: WebSocket): QueueAttachment | null {
  return socket.deserializeAttachment() as QueueAttachment | null;
}

export class MatchmakingQueue {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Upgrade necessário', { status: 426 });
    const uid = request.headers.get('X-QG-Authenticated-Uid');
    const resource = request.headers.get('X-QG-Match-Resource');
    const knowledge = Number(request.headers.get('X-QG-Theme-Knowledge') ?? 0);
    if (uid === null || resource === null || resource.length === 0 || resource.length > 256 || !Number.isFinite(knowledge)) {
      return new Response('Não autorizado', { status: 401 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (client === undefined || server === undefined) return new Response('WebSocket indisponível', { status: 500 });
    const current: QueueAttachment = { joinedAt: Date.now(), knowledge, resource, uid };
    server.serializeAttachment(current);
    this.ctx.acceptWebSocket(server);
    const existingAlarm = await this.ctx.storage.getAlarm();
    const timeoutAt = current.joinedAt + 60_000;
    if (existingAlarm === null || existingAlarm > timeoutAt) await this.ctx.storage.setAlarm(timeoutAt);

    const candidates = this.ctx.getWebSockets()
      .filter((socket) => socket !== server)
      .map((socket) => ({ socket, value: attachment(socket) }))
      .filter((entry): entry is { socket: WebSocket; value: QueueAttachment } => entry.value !== null && entry.value.uid !== uid)
      .sort((left, right) => {
        const distance = Math.abs(left.value.knowledge - current.knowledge) - Math.abs(right.value.knowledge - current.knowledge);
        return distance !== 0 ? distance : left.value.joinedAt - right.value.joinedAt;
      });

    const opponent = candidates[0];
    if (opponent !== undefined) {
      const roomId = crypto.randomUUID();
      const room = this.env.MATCH_ROOM.get(this.env.MATCH_ROOM.idFromName(roomId));
      let initialized: boolean;
      try {
        const response = await room.fetch('https://room.internal/initialize', {
          body: JSON.stringify({
            createdAtMs: Date.now(),
            firebaseUids: [opponent.value.uid, uid],
            matchId: roomId,
            resource,
          }),
          method: 'POST',
        });
        initialized = response.ok;
      } catch {
        initialized = false;
      }
      if (!initialized) {
        const payload = JSON.stringify({ code: 'MATCH_INITIALIZATION_FAILED', type: 'MATCH_FAILED' });
        server.send(payload);
        opponent.socket.send(payload);
        await Promise.all([
          this.transition(opponent.value.uid, ['matchmaking'], 'idle', null, opponent.value.resource),
          this.transition(uid, ['matchmaking'], 'idle', null, resource),
        ]);
        server.close(4_101, 'Partida indisponível');
        opponent.socket.close(4_101, 'Partida indisponível');
        return new Response(null, { status: 101, webSocket: client });
      }
      const reservations = await Promise.all([
        this.transition(opponent.value.uid, ['matchmaking'], 'preparing', roomId, opponent.value.resource),
        this.transition(uid, ['matchmaking'], 'preparing', roomId, resource),
      ]);
      if (!reservations.every(Boolean)) {
        try {
          await room.fetch('https://room.internal/system-failure', { method: 'POST' });
        } catch {
          // O alarme autoritativo da sala mantém a limpeza como fallback sistêmico.
        }
        const payload = JSON.stringify({ code: 'PLAYER_BUSY', type: 'MATCH_FAILED' });
        server.send(payload);
        opponent.socket.send(payload);
        await Promise.all([
          this.release(opponent.value.uid, opponent.value.resource, roomId),
          this.release(uid, resource, roomId),
        ]);
        server.close(4_101, 'Reserva inválida');
        opponent.socket.close(4_101, 'Reserva inválida');
        return new Response(null, { status: 101, webSocket: client });
      }
      const payload = JSON.stringify({ type: 'MATCH_FOUND', roomId });
      server.send(payload);
      opponent.socket.send(payload);
      server.close(1000, 'Pareado');
      opponent.socket.close(1000, 'Pareado');
    } else {
      server.send(JSON.stringify({ type: 'SEARCHING', timeoutAt }));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const value = attachment(socket);
    if (value !== null) await this.transition(value.uid, ['matchmaking'], 'idle', null, value.resource);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const waiting = this.ctx.getWebSockets()
      .map((socket) => ({ socket, value: attachment(socket) }))
      .filter((entry): entry is { socket: WebSocket; value: QueueAttachment } => entry.value !== null);
    for (const entry of waiting) {
      if (entry.value.joinedAt + 60_000 <= now) {
        entry.socket.send(JSON.stringify({ type: 'TIMEOUT' }));
        entry.socket.close(1000, 'Tempo de busca encerrado');
      }
    }
    const next = waiting.map((entry) => entry.value.joinedAt + 60_000).filter((deadline) => deadline > now).sort((a, b) => a - b)[0];
    if (next !== undefined) await this.ctx.storage.setAlarm(next);
  }

  private async transition(
    uid: string,
    from: string[],
    to: string,
    resource: string | null,
    fromResource?: string,
  ): Promise<boolean> {
    const id = this.env.PRESENCE_HUB.idFromName(uid);
    const response = await this.env.PRESENCE_HUB.get(id).fetch('https://presence.internal/transition', {
      body: JSON.stringify({ from, fromResource, resource, to }),
      method: 'POST',
    });
    return response.ok;
  }

  private async release(uid: string, queueResource: string, roomId: string): Promise<void> {
    if (await this.transition(uid, ['matchmaking'], 'idle', null, queueResource)) return;
    await this.transition(uid, ['preparing'], 'idle', null, roomId);
  }
}
