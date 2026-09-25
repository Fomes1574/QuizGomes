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

interface QueueActivityEntry {
  count: number;
  expiresAt: number;
}

/** `themeId:mode`, exatamente o recurso que a rota de fila já valida. */
const QUEUE_RESOURCE = /^([a-z0-9_-]{1,128}):(CASUAL|RANKED)$/i;
/** Rede de segurança: ninguém espera mais de 60 s, então 70 s sem notícia é resíduo. */
const QUEUE_ACTIVITY_TTL_MS = 70_000;
/** Várias entradas/saídas seguidas viram um único aviso para todos os sockets. */
const QUEUE_BROADCAST_INTERVAL_MS = 1_500;
const QUEUE_ACTIVITY_KEY = 'queue-activity';

/** Tema da fila de um amigo, só quando ele está de fato procurando partida. */
function queueThemeOf(activity: PlayerActivity, resource: string | null | undefined): string | undefined {
  if (activity !== 'matchmaking' || typeof resource !== 'string') return undefined;
  return QUEUE_RESOURCE.exec(resource)?.[1];
}

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
  private lastQueueBroadcast = 0;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('PING', 'PONG'));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/activity' && request.method === 'POST') {
      const input = await request.json<{ activity: PlayerActivity; presenceObjectId: string; resource?: string | null }>();
      if (!PLAYER_ACTIVITIES.has(input.activity) || typeof input.presenceObjectId !== 'string') {
        return Response.json({ error: 'INVALID_PRESENCE' }, { status: 400 });
      }
      const subjects = new Map<string, SocialSocketAttachment>();
      for (const socket of this.ctx.getWebSockets()) {
        const session = attachment(socket);
        if (session?.presenceObjectId === input.presenceObjectId) subjects.set(session.userId, session);
      }
      await Promise.all([...subjects.values()].map((subject) => this.publishPresence(
        subject, { activity: input.activity, resource: input.resource ?? null },
      )));
      return Response.json({ ok: true });
    }
    if (url.pathname === '/queue-activity' && request.method === 'POST') {
      const input = await request.json<{ count?: unknown; resource?: unknown }>();
      if (typeof input.resource !== 'string' || !QUEUE_RESOURCE.test(input.resource) ||
        typeof input.count !== 'number' || !Number.isSafeInteger(input.count) || input.count < 0 || input.count > 10_000) {
        return Response.json({ error: 'INVALID_QUEUE_ACTIVITY' }, { status: 400 });
      }
      const queues = await this.queueActivity();
      if (input.count === 0) delete queues[input.resource];
      else queues[input.resource] = { count: input.count, expiresAt: Date.now() + QUEUE_ACTIVITY_TTL_MS };
      await this.ctx.storage.put(QUEUE_ACTIVITY_KEY, queues);
      await this.scheduleQueueBroadcast();
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
        const queueThemeId = queueThemeOf(state.activity, state.resource);
        return { presence: publicPresence(state.activity), ...(queueThemeId === undefined ? {} : { queueThemeId }), revision, userId };
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
    if (url.pathname === '/notify' && request.method === 'POST') {
      // Evento social tipado no canal que já existe: sem segundo WebSocket e sem polling.
      const input = await request.json<{ event: Record<string, unknown>; userIds: string[] }>();
      if (!Array.isArray(input.userIds) || input.userIds.length > 100 ||
        input.userIds.some((userId) => typeof userId !== 'string') ||
        typeof input.event !== 'object' || input.event === null) {
        return Response.json({ error: 'INVALID_NOTIFICATION' }, { status: 400 });
      }
      const payload = JSON.stringify(input.event);
      if (payload.length > 4_096) return Response.json({ error: 'INVALID_NOTIFICATION' }, { status: 400 });
      for (const userId of [...new Set(input.userIds.filter((value) => value.length > 0))]) {
        for (const socket of this.ctx.getWebSockets(`user:${userId}`)) this.send(socket, payload);
      }
      return Response.json({ ok: true });
    }
    if (url.pathname === '/count' && request.method === 'GET') {
      return Response.json({ onlineCount: this.users().size });
    }
    if (url.pathname === '/online' && request.method === 'POST') {
      // Usado só para não duplicar um push quando o destinatário já está com o
      // canal social aberto (foreground) — nunca para decidir presença de amigo.
      const input = await request.json<SocialInvalidation>();
      if (!Array.isArray(input.userIds) || input.userIds.length > 100 ||
        input.userIds.some((userId) => typeof userId !== 'string')) {
        return Response.json({ error: 'INVALID_PRESENCE' }, { status: 400 });
      }
      const online = input.userIds.filter((userId) => this.ctx.getWebSockets(`user:${userId}`).length > 0);
      return Response.json({ online });
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
    const queues = await this.queueActivity();
    // Filas vazias são o padrão: o cliente já nasce com zero, sem mensagem extra.
    if (Object.keys(queues).length > 0) this.send(server, this.queueActivityPayload(queues));
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
    known?: { activity: PlayerActivity; resource: string | null },
    disconnected?: WebSocket,
  ): Promise<void> {
    if (subject.publicId === undefined || subject.presenceObjectId === undefined) return;
    const connected = this.ctx.getWebSockets(`user:${subject.userId}`).some((socket) => socket !== disconnected);
    if (disconnected === undefined && !connected) return;
    if (disconnected !== undefined && connected) return;
    const revision = this.nextRevision();
    let presence: FriendPresence = 'OFFLINE';
    let queueThemeId: string | undefined;
    if (connected) {
      let current = known;
      if (current === undefined) {
        const response = await this.env.PRESENCE_HUB
          .get(this.env.PRESENCE_HUB.idFromString(subject.presenceObjectId))
          .fetch('https://presence.internal/state');
        current = await response.json<ActivityState>();
      }
      presence = publicPresence(current.activity);
      queueThemeId = queueThemeOf(current.activity, current.resource);
    }
    const recipients = await new SocialRepository(this.env.CORE_DB).friendPresenceTargets(subject.userId);
    if (recipients.length === 0) return;
    const payload = JSON.stringify({
      presence,
      publicId: subject.publicId,
      ...(queueThemeId === undefined ? {} : { queueThemeId }),
      revision,
      type: 'FRIEND_PRESENCE_CHANGED',
    });
    for (const friend of recipients) {
      for (const socket of this.ctx.getWebSockets(`user:${friend.userId}`)) this.send(socket, payload);
    }
  }

  async alarm(): Promise<void> {
    await this.broadcastQueueActivity();
  }

  private async queueActivity(): Promise<Record<string, QueueActivityEntry>> {
    const stored = await this.ctx.storage.get<Record<string, QueueActivityEntry>>(QUEUE_ACTIVITY_KEY) ?? {};
    const now = Date.now();
    for (const [resource, entry] of Object.entries(stored)) {
      if (entry.expiresAt <= now) delete stored[resource];
    }
    return stored;
  }

  private queueActivityPayload(queues: Record<string, QueueActivityEntry>): string {
    const entries = Object.entries(queues)
      .flatMap(([resource, entry]) => {
        const match = QUEUE_RESOURCE.exec(resource);
        return match?.[1] === undefined || match[2] === undefined
          ? []
          : [{ count: entry.count, mode: match[2].toUpperCase(), themeId: match[1] }];
      })
      .sort((left, right) => right.count - left.count)
      .slice(0, 200);
    return JSON.stringify({ queues: entries, type: 'QUEUE_ACTIVITY' });
  }

  private async scheduleQueueBroadcast(): Promise<void> {
    const now = Date.now();
    if (now - this.lastQueueBroadcast >= QUEUE_BROADCAST_INTERVAL_MS) {
      await this.broadcastQueueActivity();
      return;
    }
    if (await this.ctx.storage.getAlarm() === null) {
      await this.ctx.storage.setAlarm(this.lastQueueBroadcast + QUEUE_BROADCAST_INTERVAL_MS);
    }
  }

  private async broadcastQueueActivity(): Promise<void> {
    this.lastQueueBroadcast = Date.now();
    const payload = this.queueActivityPayload(await this.queueActivity());
    for (const socket of this.ctx.getWebSockets()) this.send(socket, payload);
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
