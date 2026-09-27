import type { Env } from '../env.js';
import { SocialRepository } from '../repositories/social-repository.js';
import type { ActivityState, PlayerActivity } from './presence-hub.js';

interface SocialSocketAttachment {
  /**
   * Última atividade conhecida (vinda da PresenceHub). Guardada no próprio
   * socket para o retrato de presença dos amigos não precisar consultar uma
   * PresenceHub por amigo a cada abertura da Social.
   */
  activity?: PlayerActivity;
  /** Quando `activity` foi confirmada; passado o prazo, o retrato reconsulta. */
  activityAt?: number;
  connectedAt?: number;
  presenceObjectId?: string;
  publicId?: string;
  resource?: string | null;
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
/** O cliente pinga a cada 45 s; 2 min de silêncio é conexão morta (rede caída sem close). */
export const SOCIAL_SILENCE_LIMIT_MS = 120_000;
/**
 * A atividade chega por /activity a cada mudança; mesmo assim, depois de
 * 1 min sem confirmação o retrato consulta a PresenceHub de novo (um aviso
 * perdido nunca deixa o amigo "preso" num estado velho).
 */
const ACTIVITY_CACHE_MS = 60_000;
/** Entradas e saídas seguidas viram um único número "online" para todos. */
const ONLINE_COUNT_INTERVAL_MS = 1_000;

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

/** Socket que já recebeu close (inclusive por silêncio) não conta como online. */
function isOpen(socket: WebSocket): boolean {
  return socket.readyState === 1;
}

function attachment(socket: WebSocket): SocialSocketAttachment | null {
  return socket.deserializeAttachment() as SocialSocketAttachment | null;
}

export class SocialRealtimeHub {
  private lastRevision = 0;
  private lastQueueBroadcast = 0;
  private queuePending = false;
  private lastCountBroadcast = 0;
  private countPending = false;
  private readonly sentCounts = new WeakMap<WebSocket, number>();

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
      const known = { activity: input.activity, activityAt: Date.now(), resource: input.resource ?? null };
      // Tag por PresenceHub: só os sockets daquela pessoa, sem varrer todos.
      for (const socket of this.ctx.getWebSockets(`presence:${input.presenceObjectId}`)) {
        const session = attachment(socket);
        if (session?.presenceObjectId !== input.presenceObjectId) continue;
        const updated = { ...session, ...known };
        socket.serializeAttachment(updated);
        subjects.set(session.userId, updated);
      }
      await Promise.all([...subjects.values()].map((subject) => this.publishPresence(subject, known)));
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
        const session = this.ctx.getWebSockets(`user:${userId}`).filter(isOpen).map(attachment)
          .find((candidate) => candidate?.presenceObjectId !== undefined);
        if (session?.presenceObjectId === undefined) {
          return { presence: 'OFFLINE' as const, revision, userId };
        }
        // A atividade já chega por /activity; só um socket antigo, sem ela
        // guardada, ainda custa uma consulta à PresenceHub.
        const fresh = session.activity !== undefined && Date.now() - (session.activityAt ?? 0) <= ACTIVITY_CACHE_MS;
        const state = !fresh || session.activity === undefined
          ? await this.readActivity(session)
          : { activity: session.activity, resource: session.resource ?? null };
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
      this.sweepSilent();
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
      this.sweepSilent();
      const online = input.userIds.filter((userId) => this.ctx.getWebSockets(`user:${userId}`).some(isOpen));
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
    this.sweepSilent();
    const session: SocialSocketAttachment = {
      connectedAt: Date.now(),
      ...(presenceObjectId === null ? {} : { presenceObjectId }),
      ...(publicId === null ? {} : { publicId }),
      userId,
    };
    server.serializeAttachment(session);
    this.ctx.acceptWebSocket(server, [
      `user:${userId}`,
      ...(presenceObjectId === null ? [] : [`presence:${presenceObjectId}`]),
    ]);
    const nextCount = this.users().size;
    // Quem chega recebe o número na hora; os outros, no máximo 1 vez por segundo.
    this.sendCount(server, nextCount);
    if (nextCount !== previousCount) {
      await this.scheduleCountBroadcast({ skip: server });
      if (session.presenceObjectId !== undefined) this.background(this.publishPresence(session));
    }
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
      .filter((socket) => socket !== except && isOpen(socket))
      .map((socket) => attachment(socket)?.userId)
      .filter((userId): userId is string => userId !== undefined));
  }

  private remove(socket: WebSocket): void {
    const session = attachment(socket);
    if (session === null) return;
    const remaining = this.users(socket);
    if (!remaining.has(session.userId)) {
      this.background(this.scheduleCountBroadcast({ leaving: socket }));
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
      const current = known ?? await this.readActivity(subject);
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

  /** Consulta a PresenceHub e guarda a resposta nos sockets da pessoa. */
  private async readActivity(subject: SocialSocketAttachment): Promise<{ activity: PlayerActivity; resource: string | null }> {
    const response = await this.env.PRESENCE_HUB
      .get(this.env.PRESENCE_HUB.idFromString(subject.presenceObjectId!))
      .fetch('https://presence.internal/state');
    const state = await response.json<ActivityState>();
    const known = { activity: state.activity, activityAt: Date.now(), resource: state.resource ?? null };
    for (const socket of this.ctx.getWebSockets(`user:${subject.userId}`)) {
      const session = attachment(socket);
      if (session?.presenceObjectId === subject.presenceObjectId) socket.serializeAttachment({ ...session, ...known });
    }
    return known;
  }

  async alarm(): Promise<void> {
    this.sweepSilent();
    const countOnly = this.countPending && !this.queuePending;
    if (this.countPending) this.broadcastCount({});
    // Depois de hibernar as marcas em memória somem: na dúvida, reenvia as filas.
    if (!countOnly) await this.broadcastQueueActivity();
  }

  /**
   * Online muda a cada entrada e saída; avisar todos a cada uma seria
   * quadrático com muita gente. O primeiro aviso sai na hora e os seguintes
   * dentro de 1 s viram um só, pelo alarme.
   */
  private async scheduleCountBroadcast(sockets: { leaving?: WebSocket; skip?: WebSocket }): Promise<void> {
    const now = Date.now();
    if (now - this.lastCountBroadcast >= ONLINE_COUNT_INTERVAL_MS) {
      this.broadcastCount(sockets);
      return;
    }
    this.countPending = true;
    await this.ensureAlarm(this.lastCountBroadcast + ONLINE_COUNT_INTERVAL_MS);
  }

  private async ensureAlarm(at: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at) await this.ctx.storage.setAlarm(at);
  }

  /**
   * Fecha sockets que pararam de pingar (celular sem rede, aba morta sem
   * close). Sem isso a pessoa continuaria "online" até o TCP expirar.
   */
  private sweepSilent(now = Date.now()): void {
    for (const socket of this.ctx.getWebSockets()) {
      const session = attachment(socket);
      if (session?.connectedAt === undefined) continue;
      const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(socket)?.getTime() ?? session.connectedAt;
      if (now - Math.max(lastPing, session.connectedAt) <= SOCIAL_SILENCE_LIMIT_MS) continue;
      this.remove(socket);
      try { socket.close(4_104, 'Sem sinal'); } catch { /* Já encerrado. */ }
    }
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
    this.queuePending = true;
    await this.ensureAlarm(this.lastQueueBroadcast + QUEUE_BROADCAST_INTERVAL_MS);
  }

  private async broadcastQueueActivity(): Promise<void> {
    this.lastQueueBroadcast = Date.now();
    this.queuePending = false;
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

  /**
   * Número atual, sempre recontado. `leaving` é o socket saindo (não conta e
   * não recebe); `skip` é quem acabou de chegar e já recebeu o número.
   */
  private broadcastCount({ leaving, skip }: { leaving?: WebSocket; skip?: WebSocket }): void {
    this.lastCountBroadcast = Date.now();
    this.countPending = false;
    const count = this.users(leaving).size;
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== leaving && socket !== skip) this.sendCount(socket, count);
    }
  }

  /** Não repete para um socket o número que ele já tem. */
  private sendCount(socket: WebSocket, count: number): void {
    if (this.sentCounts.get(socket) === count) return;
    this.sentCounts.set(socket, count);
    this.send(socket, JSON.stringify({ count, type: 'ONLINE_COUNT' }));
  }

  private send(socket: WebSocket, payload: string): void {
    try { socket.send(payload); } catch { /* Close/error fará a limpeza autoritativa. */ }
  }
}
