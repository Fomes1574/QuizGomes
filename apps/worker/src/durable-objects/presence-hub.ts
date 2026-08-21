import type { Env } from '../env.js';

export type PlayerActivity = 'idle' | 'matchmaking' | 'invite' | 'preparing' | 'playing' | 'reconnecting' | 'finished';

export interface ActivityState {
  activity: PlayerActivity;
  resource: string | null;
  updatedAt: number;
}

const IDLE: ActivityState = { activity: 'idle', resource: null, updatedAt: 0 };

export class PresenceHub {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/state') {
      return Response.json(await this.state());
    }
    if (request.method === 'POST' && url.pathname === '/transition') {
      const input = await request.json<{
        from: PlayerActivity | PlayerActivity[];
        fromResource?: string | null;
        resource: string | null;
        to: PlayerActivity;
      }>();
      const state = await this.state();
      const allowedFrom = Array.isArray(input.from) ? input.from : [input.from];
      if (!allowedFrom.includes(state.activity) ||
        (input.fromResource !== undefined && input.fromResource !== state.resource)) {
        return Response.json({ error: 'PLAYER_BUSY', state }, { status: 409 });
      }
      const next: ActivityState = { activity: input.to, resource: input.resource, updatedAt: Date.now() };
      await this.ctx.storage.put('activity', next);
      for (const socket of this.ctx.getWebSockets()) socket.send(JSON.stringify({ type: 'PRESENCE', ...next }));
      if (state.activity !== next.activity) {
        this.ctx.waitUntil(this.env.SOCIAL_REALTIME_HUB
          .get(this.env.SOCIAL_REALTIME_HUB.idFromName('global'))
          .fetch('https://social.internal/activity', {
            body: JSON.stringify({ activity: next.activity, presenceObjectId: this.ctx.id.toString() }),
            method: 'POST',
          }).then(() => undefined).catch(() => {
            console.error(JSON.stringify({ code: 'SOCIAL_PRESENCE_UNAVAILABLE', event: 'friend_presence_failed' }));
          }));
      }
      return Response.json(next);
    }
    if (request.method === 'POST' && url.pathname === '/claim') {
      const input = await request.json<{ activities: PlayerActivity[]; resource: string }>();
      const state = await this.state();
      if (!input.activities.includes(state.activity) || state.resource !== input.resource) {
        return Response.json({ error: 'PLAYER_BUSY', state }, { status: 409 });
      }
      return Response.json(state);
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
