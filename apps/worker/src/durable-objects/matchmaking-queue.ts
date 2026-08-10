import type { Env } from '../env.js';

interface QueueAttachment {
  joinedAt: number;
  knowledge: number;
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
    const knowledge = Number(request.headers.get('X-QG-Theme-Knowledge') ?? 0);
    if (uid === null || !Number.isFinite(knowledge)) return new Response('Não autorizado', { status: 401 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (client === undefined || server === undefined) return new Response('WebSocket indisponível', { status: 500 });
    const current: QueueAttachment = { joinedAt: Date.now(), knowledge, uid };
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
      const payload = JSON.stringify({ type: 'MATCH_FOUND', roomId });
      server.send(payload);
      opponent.socket.send(payload);
      await Promise.all([
        this.transition(opponent.value.uid, ['matchmaking'], 'preparing', roomId),
        this.transition(uid, ['matchmaking'], 'preparing', roomId),
      ]);
      server.close(1000, 'Pareado');
      opponent.socket.close(1000, 'Pareado');
    } else {
      server.send(JSON.stringify({ type: 'SEARCHING', timeoutAt }));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const value = attachment(socket);
    if (value !== null) await this.transition(value.uid, ['matchmaking'], 'idle', null);
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
  ): Promise<void> {
    const id = this.env.PRESENCE_HUB.idFromName(uid);
    await this.env.PRESENCE_HUB.get(id).fetch('https://presence.internal/transition', {
      body: JSON.stringify({ from, resource, to }),
      method: 'POST',
    });
  }
}
