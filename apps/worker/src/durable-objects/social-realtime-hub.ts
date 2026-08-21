import type { Env } from '../env.js';
import { SocialRepository } from '../repositories/social-repository.js';
import type { ActivityState, PlayerActivity } from './presence-hub.js';

interface SocialSocketAttachment {
  presenceObjectId?: string;
  publicId?: string;
  userId: string;
}

interface SocialInvalidation {
  userIds: string[];
}

type FriendPresence = 'ONLINE' | 'MATCHMAKING' | 'IN_MATCH' | 'RECONNECTING' | 'OFFLINE';

const PLAYER_ACTIVITIES = new Set<PlayerActivity>([
  'idle', 'matchmaking', 'invite', 'preparing', 'playing', 'reconnecting', 'finished',
]);

function publicPresence(activity: PlayerActivity): FriendPresence {
  if (activity === 'matchmaking') return 'MATCHMAKING';
  if (activity === 'reconnecting') return 'RECONNECTING';
  if (activity === 'preparing' || activity === 'playing' || activity === 'finished') return 'IN_MATCH';
  return 'ONLINE';
}

function attachment(socket: WebSocket): SocialSocketAttachment | null {
  return socket.deserializeAttachment() as SocialSocketAttachment | null;
}

export class SocialRealtimeHub {
  private lastRevision = 0;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('PING', 'PONG'));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/activity' && request.method === 'POST') {
      const input = await request.json<{ activity: PlayerActivity; presenceObjectId: string }>();
      if (!PLAYER_ACTIVITIES.has(input.activity) || typeof input.presenceObjectId !== 'string') {
        return Response.json({ error: 'INVALID_PRESENCE' }, { status: 400 });
      }
      const subjects = new Map<string, SocialSocketAttachment>();
      for (const socket of this.ctx.getWebSockets()) {
        const session = attachment(socket);
        if (session?.presenceObjectId === input.presenceObjectId) subjects.set(session.userId, session);
      }
      await Promise.all([...subjects.values()].map((subject) => this.publishPresence(subject, input.activity)));
      return Response.json({ ok: true });
    }
    if (url.pathname === '/snapshot' && request.method === 'POST') {
      const input = await request.json<SocialInvalidation>();
      if (!Array.isArray(input.userIds) || input.userIds.length > 100 ||
        input.userIds.some((userId) => typeof userId !== 'string')) {
        return Response.json({ error: 'INVALID_PRESENCE' }, { status: 400 });
      }
      const revision = this.nextRevision();
      const friends = await Promise.all([...new Set(input.userIds)].map(async (userId) => {
        const session = this.ctx.getWebSockets(`user:${userId}`).map(attachment)
          .find((candidate) => candidate?.presenceObjectId !== undefined);
        if (session?.presenceObjectId === undefined) {
          return { presence: 'OFFLINE' as const, revision, userId };
        }
        const response = await this.env.PRESENCE_HUB
          .get(this.env.PRESENCE_HUB.idFromString(session.presenceObjectId))
          .fetch('https://presence.internal/state');
        const state = await response.json<ActivityState>();
        return { presence: publicPresence(state.activity), revision, userId };
      }));
      return Response.json({ friends, revision });
    }
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
    const publicId = request.headers.get('X-QG-Authenticated-Public-Id');
    const presenceObjectId = request.headers.get('X-QG-Presence-Object-Id');
    if ((publicId === null) !== (presenceObjectId === null) ||
      (publicId !== null && !/^#QG[A-Z0-9]{4,32}$/i.test(publicId))) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    const previousCount = this.users().size;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (client === undefined || server === undefined) {
      return new Response('WebSocket indisponível', { status: 500 });
    }
    const session: SocialSocketAttachment = {
      ...(presenceObjectId === null ? {} : { presenceObjectId }),
      ...(publicId === null ? {} : { publicId }),
      userId,
    };
    server.serializeAttachment(session);
    this.ctx.acceptWebSocket(server, [`user:${userId}`]);
    const nextCount = this.users().size;
    if (nextCount !== previousCount) {
      this.broadcastCount(nextCount);
      if (session.presenceObjectId !== undefined) this.background(this.publishPresence(session));
    }
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
    const session = attachment(socket);
    if (session === null) return;
    const remaining = this.users(socket);
    if (!remaining.has(session.userId)) {
      this.broadcastCount(remaining.size, socket);
      if (session.presenceObjectId !== undefined) this.background(this.publishPresence(session, undefined, socket));
    }
  }

  private async publishPresence(
    subject: SocialSocketAttachment,
    activity?: PlayerActivity,
    disconnected?: WebSocket,
  ): Promise<void> {
    if (subject.publicId === undefined || subject.presenceObjectId === undefined) return;
    const connected = this.ctx.getWebSockets(`user:${subject.userId}`).some((socket) => socket !== disconnected);
    if (disconnected === undefined && !connected) return;
    if (disconnected !== undefined && connected) return;
    const revision = this.nextRevision();
    let presence: FriendPresence = 'OFFLINE';
    if (connected) {
      if (activity === undefined) {
        const response = await this.env.PRESENCE_HUB
          .get(this.env.PRESENCE_HUB.idFromString(subject.presenceObjectId))
          .fetch('https://presence.internal/state');
        activity = (await response.json<ActivityState>()).activity;
      }
      presence = publicPresence(activity);
    }
    const recipients = await new SocialRepository(this.env.CORE_DB).friendPresenceTargets(subject.userId);
    if (recipients.length === 0) return;
    const payload = JSON.stringify({
      presence,
      publicId: subject.publicId,
      revision,
      type: 'FRIEND_PRESENCE_CHANGED',
    });
    for (const friend of recipients) {
      for (const socket of this.ctx.getWebSockets(`user:${friend.userId}`)) this.send(socket, payload);
    }
  }

  private nextRevision(): number {
    this.lastRevision = Math.max(Date.now() * 1_000, this.lastRevision + 1);
    return this.lastRevision;
  }

  private background(task: Promise<void>): void {
    this.ctx.waitUntil(task.catch(() => {
      console.error(JSON.stringify({ code: 'SOCIAL_PRESENCE_UNAVAILABLE', event: 'friend_presence_failed' }));
    }));
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
