interface SocialSocketAttachment {
  userId: string;
}

interface SocialInvalidation {
  userIds: string[];
}

function attachment(socket: WebSocket): SocialSocketAttachment | null {
  return socket.deserializeAttachment() as SocialSocketAttachment | null;
}

export class SocialRealtimeHub {
  constructor(private readonly ctx: DurableObjectState) {
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('PING', 'PONG'));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/invalidate' && request.method === 'POST') {
      const input = await request.json<SocialInvalidation>();
      const unique = [...new Set(input.userIds.filter((userId) => userId.length > 0))];
      const payload = JSON.stringify({ revision: crypto.randomUUID(), type: 'SOCIAL_INVALIDATED' });
      for (const userId of unique) {
        for (const socket of this.ctx.getWebSockets(`user:${userId}`)) this.send(socket, payload);
      }
      return Response.json({ ok: true });
    }
    if (url.pathname === '/count' && request.method === 'GET') {
      return Response.json({ onlineCount: this.users().size });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade necessário', { status: 426 });
    }
    const userId = request.headers.get('X-QG-Authenticated-User-Id');
    if (userId === null || userId.length === 0 || userId.length > 128) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    const previousCount = this.users().size;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (client === undefined || server === undefined) {
      return new Response('WebSocket indisponível', { status: 500 });
    }
    server.serializeAttachment({ userId } satisfies SocialSocketAttachment);
    this.ctx.acceptWebSocket(server, [`user:${userId}`]);
    const nextCount = this.users().size;
    if (nextCount !== previousCount) this.broadcastCount(nextCount);
    else this.send(server, JSON.stringify({ count: nextCount, type: 'ONLINE_COUNT' }));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (message === 'PING') {
      this.send(socket, 'PONG');
      return;
    }
    this.send(socket, JSON.stringify({ code: 'INVALID_MESSAGE', type: 'ERROR' }));
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    this.remove(socket);
    try { socket.close(code, reason); } catch { /* Socket já encerrado pelo runtime. */ }
  }

  webSocketError(socket: WebSocket): void {
    this.remove(socket);
    try { socket.close(1_011, 'Conexão social indisponível'); } catch { /* Socket já encerrado. */ }
  }

  private users(except?: WebSocket): Set<string> {
    return new Set(this.ctx.getWebSockets()
      .filter((socket) => socket !== except)
      .map((socket) => attachment(socket)?.userId)
      .filter((userId): userId is string => userId !== undefined));
  }

  private remove(socket: WebSocket): void {
    const userId = attachment(socket)?.userId;
    if (userId === undefined) return;
    const remaining = this.users(socket);
    if (!remaining.has(userId)) this.broadcastCount(remaining.size, socket);
  }

  private broadcastCount(count: number, except?: WebSocket): void {
    const payload = JSON.stringify({ count, type: 'ONLINE_COUNT' });
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== except) this.send(socket, payload);
    }
  }

  private send(socket: WebSocket, payload: string): void {
    try { socket.send(payload); } catch { /* Close/error fará a limpeza autoritativa. */ }
  }
}
