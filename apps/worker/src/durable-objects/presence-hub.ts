export type PlayerActivity = 'idle' | 'matchmaking' | 'invite' | 'preparing' | 'playing';

interface ActivityState {
  activity: PlayerActivity;
  resource: string | null;
  updatedAt: number;
}

const IDLE: ActivityState = { activity: 'idle', resource: null, updatedAt: 0 };

export class PresenceHub {
  constructor(private readonly ctx: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/state') {
      return Response.json(await this.state());
    }
    if (request.method === 'POST' && url.pathname === '/transition') {
      const input = await request.json<{
        from: PlayerActivity | PlayerActivity[];
        resource: string | null;
        to: PlayerActivity;
      }>();
      const state = await this.state();
      const allowedFrom = Array.isArray(input.from) ? input.from : [input.from];
      if (!allowedFrom.includes(state.activity)) {
        return Response.json({ error: 'PLAYER_BUSY', state }, { status: 409 });
      }
      const next: ActivityState = { activity: input.to, resource: input.resource, updatedAt: Date.now() };
      await this.ctx.storage.put('activity', next);
      for (const socket of this.ctx.getWebSockets()) socket.send(JSON.stringify({ type: 'PRESENCE', ...next }));
      return Response.json(next);
    }
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      if (client === undefined || server === undefined) return new Response('WebSocket indisponível', { status: 500 });
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({ type: 'PRESENCE', ...await this.state() }));
      return new Response(null, { status: 101, webSocket: client });
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  private async state(): Promise<ActivityState> {
    return await this.ctx.storage.get<ActivityState>('activity') ?? IDLE;
  }
}
