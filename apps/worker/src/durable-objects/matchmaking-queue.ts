import type { Env } from '../env.js';
import {
  divisionIndexForKnowledge,
  rankedMatchmakingDivisionBand,
  type LiveMatchPresentationProjection,
} from '@quiz-gomes/domain';

interface QueueAttachment {
  /** O cliente manda PING periódico; só esses sockets podem ser tidos como mortos por silêncio. */
  heartbeat?: boolean;
  joinedAt: number;
  knowledge: number;
  resource: string;
  /** Token da reserva de presença desta busca. Ausente em sockets de antes do deploy. */
  token?: string;
  uid: string;
}

interface RoomInitializationResult {
  error?: { code?: string };
  presentations?: Array<{
    presentation?: LiveMatchPresentationProjection;
    uid?: string;
  }>;
}

const SAFE_MATCH_FAILURE_CODES = new Set([
  'PLAYER_BUSY',
  'PROFILE_REQUIRED',
  'QUESTION_POOL_EMPTY',
  'QUESTION_POOL_INCONSISTENT',
  'QUESTION_POOL_INSUFFICIENT',
]);
const QUEUE_TIMEOUT_MS = 60_000;
/** O cliente pinga a cada 10 s; 25 s sem PING é conexão morta (celular sem rede, aba morta). */
export const QUEUE_SILENCE_LIMIT_MS = 25_000;
const SUPERSEDED_CODE = 4_103;
const SILENT_CODE = 4_104;
const RANKED_RECHECK_MS = [15_000, 30_000, 45_000] as const;

/**
 * Socket com batimento que ficou em silêncio além do limite: conexão morta
 * (rede caída, aba encerrada sem close). Sockets sem batimento (cliente
 * antigo) nunca são julgados por silêncio.
 */
export function isSilentQueueSocket(input: {
  heartbeat: boolean; joinedAt: number; lastPingAt: number | null; now: number;
}): boolean {
  if (!input.heartbeat) return false;
  return input.now - Math.max(input.lastPingAt ?? input.joinedAt, input.joinedAt) > QUEUE_SILENCE_LIMIT_MS;
}

function safeMatchFailureCode(value: unknown): string {
  return typeof value === 'string' && SAFE_MATCH_FAILURE_CODES.has(value)
    ? value
    : 'MATCH_INITIALIZATION_FAILED';
}

function attachment(socket: WebSocket): QueueAttachment | null {
  return socket.deserializeAttachment() as QueueAttachment | null;
}

export class MatchmakingQueue {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {
    // Responder PING sem acordar o DO: o batimento sai de graça e o horário
    // da última resposta serve para detectar sockets fantasmas.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('PING', 'PONG'));
  }

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
    const token = request.headers.get('X-QG-Search-Token');
    const current: QueueAttachment = {
      ...(request.headers.get('X-QG-Heartbeat') === '1' ? { heartbeat: true } : {}),
      joinedAt: Date.now(),
      knowledge,
      resource,
      ...(token === null ? {} : { token }),
      uid,
    };
    // Uma busca nova do mesmo jogador substitui qualquer socket antigo dele
    // nesta fila (F5, aba duplicada): o antigo nunca vira adversário fantasma.
    for (const entry of this.waitingSockets()) {
      if (entry.value.uid === uid) this.closeQuietly(entry.socket, SUPERSEDED_CODE, 'Busca substituída');
    }
    server.serializeAttachment(current);
    this.ctx.acceptWebSocket(server);
    const timeoutAt = current.joinedAt + QUEUE_TIMEOUT_MS;
    server.send(JSON.stringify({ type: 'SEARCHING', timeoutAt }));
    await this.tryPair(server);
    await this.scheduleNextAlarm();
    this.reportActivity(resource);
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Fecha uma dupla quando o socket informado encontra candidato elegível.
   * Também é chamado pelo alarme: sem isso, duas pessoas que entram antes da
   * banda rankeada alargar só seriam reavaliadas se uma terceira entrasse.
   */
  private async tryPair(server: WebSocket): Promise<boolean> {
    if (!this.ctx.getWebSockets().includes(server)) return false;
    const current = attachment(server);
    if (current === null) return false;
    // O recurso já validado pela rota é sempre `themeId:mode`: todo socket
    // desta instância de DO compartilha o mesmo tema e modo.
    const isRanked = current.resource.split(':')[1] === 'RANKED';
    const currentDivision = divisionIndexForKnowledge(current.knowledge);
    const now = Date.now();
    for (const entry of this.waitingSockets()) {
      if (entry.socket !== server && this.isSilent(entry, now)) await this.evictSilent(entry);
    }
    const candidates = this.waitingSockets()
      .filter((entry) => entry.socket !== server && entry.value.uid !== current.uid)
      .filter((entry) => entry.socket.readyState === 1)
      .filter((entry) => (
        // Partida normal nunca usa Conhecimento: qualquer candidato do mesmo tema serve.
        !isRanked || Math.abs(divisionIndexForKnowledge(entry.value.knowledge) - currentDivision)
          <= rankedMatchmakingDivisionBand(now - entry.value.joinedAt)
      ))
      .sort((left, right) => {
        if (isRanked) {
          const distance = Math.abs(divisionIndexForKnowledge(left.value.knowledge) - currentDivision)
            - Math.abs(divisionIndexForKnowledge(right.value.knowledge) - currentDivision);
          if (distance !== 0) return distance;
        }
        return left.value.joinedAt - right.value.joinedAt;
      });

    let opponent: (typeof candidates)[number] | undefined;
    for (const candidate of candidates) {
      if (await this.sociallyCompatible(current.uid, candidate.value.uid)) {
        opponent = candidate;
        break;
      }
    }
    if (opponent === undefined) return false;

      const roomId = crypto.randomUUID();
      const room = this.env.MATCH_ROOM.get(this.env.MATCH_ROOM.idFromName(roomId));
      let initialization: RoomInitializationResult | null;
      let initializationFailureCode = 'MATCH_INITIALIZATION_FAILED';
      try {
        const response = await room.fetch('https://room.internal/initialize', {
          body: JSON.stringify({
            createdAtMs: Date.now(),
            firebaseUids: [opponent.value.uid, current.uid],
            kind: 'MATCHMAKING',
            matchId: roomId,
            resource: current.resource,
          }),
          method: 'POST',
        });
        const result = await response.json<RoomInitializationResult>();
        initialization = response.ok ? result : null;
        if (!response.ok) initializationFailureCode = safeMatchFailureCode(result.error?.code);
      } catch {
        initialization = null;
      }
      const currentPresentation = initialization?.presentations?.find((entry) => entry.uid === current.uid)?.presentation;
      const opponentPresentation = initialization?.presentations?.find((entry) => entry.uid === opponent.value.uid)?.presentation;
      if (currentPresentation === undefined || opponentPresentation === undefined) {
        const payload = JSON.stringify({ code: initializationFailureCode, type: 'MATCH_FAILED' });
        server.send(payload);
        opponent.socket.send(payload);
        await Promise.all([
          this.transition(opponent.value.uid, ['matchmaking'], 'idle', null, opponent.value.resource, opponent.value.token),
          this.transition(current.uid, ['matchmaking'], 'idle', null, current.resource, current.token),
        ]);
        server.close(4_101, 'Partida indisponível');
        opponent.socket.close(4_101, 'Partida indisponível');
        return true;
      }
      const reservations = await Promise.all([
        this.transition(opponent.value.uid, ['matchmaking'], 'preparing', roomId, opponent.value.resource, opponent.value.token),
        this.transition(current.uid, ['matchmaking'], 'preparing', roomId, current.resource, current.token),
      ]);
      if (!reservations.every(Boolean)) {
        // Só quem não conseguiu reservar sai da fila. Quem reservou volta a
        // esperar com a mesma busca: um adversário fantasma não custa a
        // partida de quem está de fato ali.
        const sides = [
          { entry: opponent, reserved: reservations[0] === true },
          { entry: { socket: server, value: current }, reserved: reservations[1] === true },
        ];
        for (const side of sides) {
          if (side.reserved) {
            const restored = await this.transition(
              side.entry.value.uid, ['preparing'], 'matchmaking', side.entry.value.resource, roomId, undefined, side.entry.value.token,
            );
            if (restored) continue;
          }
          this.safeSend(side.entry.socket, JSON.stringify({ code: 'PLAYER_BUSY', type: 'MATCH_FAILED' }));
          this.closeQuietly(side.entry.socket, 4_101, 'Reserva inválida');
          if (side.reserved) await this.release(side.entry.value.uid, side.entry.value.resource, roomId, side.entry.value.token);
        }
        // A sala é anulada só depois: a limpeza dela nunca alcança quem já
        // voltou para a fila (a presença não aponta mais para esta sala).
        try {
          await room.fetch('https://room.internal/system-failure', { method: 'POST' });
        } catch {
          // O alarme autoritativo da sala mantém a limpeza como fallback sistêmico.
        }
        return false;
      }
      server.send(JSON.stringify({ ...currentPresentation, type: 'MATCH_FOUND', roomId }));
      opponent.socket.send(JSON.stringify({ ...opponentPresentation, type: 'MATCH_FOUND', roomId }));
      server.close(1000, 'Pareado');
      opponent.socket.close(1000, 'Pareado');
      this.reportActivity(current.resource);
      return true;
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const value = attachment(socket);
    if (value !== null) {
      await this.transition(value.uid, ['matchmaking'], 'idle', null, value.resource, value.token);
      this.reportActivity(value.resource, socket);
    }
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const waiting = this.waitingSockets();
    for (const entry of waiting) {
      if (entry.value.joinedAt + QUEUE_TIMEOUT_MS <= now) {
        entry.socket.send(JSON.stringify({ type: 'TIMEOUT' }));
        entry.socket.close(1000, 'Tempo de busca encerrado');
      }
    }
    // Reavaliar nos marcos 15/30/45 s é o que torna a expansão da banda
    // efetiva mesmo quando nenhum jogador novo entra na fila.
    for (const entry of this.waitingSockets()) {
      if (entry.value.joinedAt + QUEUE_TIMEOUT_MS > now && await this.tryPair(entry.socket)) break;
    }
    await this.scheduleNextAlarm();
    const resource = waiting[0]?.value.resource;
    if (resource !== undefined) this.reportActivity(resource);
  }

  /**
   * Quantas pessoas distintas esperam nesta fila agora. Sockets que esta
   * instância já mandou fechar (pareados, tempo esgotado) não contam.
   */
  private waitingCount(except?: WebSocket): number {
    return new Set(this.waitingSockets()
      .filter((entry) => entry.socket !== except && entry.socket.readyState === 1)
      .map((entry) => entry.value.uid)).size;
  }

  /**
   * Contagem pública da fila para a tela de temas. Só um número por
   * tema+modo, nunca quem está esperando; melhor-esforço e fora do caminho
   * crítico do pareamento.
   */
  private reportActivity(resource: string, except?: WebSocket): void {
    const count = this.waitingCount(except);
    this.ctx.waitUntil(this.env.SOCIAL_REALTIME_HUB
      .get(this.env.SOCIAL_REALTIME_HUB.idFromName('global'))
      .fetch('https://social.internal/queue-activity', {
        body: JSON.stringify({ count, resource }),
        method: 'POST',
      })
      .then(() => undefined)
      .catch(() => {
        console.error(JSON.stringify({ code: 'QUEUE_ACTIVITY_UNAVAILABLE', event: 'queue_activity_failed' }));
      }));
  }

  private waitingSockets(): Array<{ socket: WebSocket; value: QueueAttachment }> {
    return this.ctx.getWebSockets()
      .map((socket) => ({ socket, value: attachment(socket) }))
      .filter((entry): entry is { socket: WebSocket; value: QueueAttachment } => entry.value !== null);
  }

  private async scheduleNextAlarm(): Promise<void> {
    const now = Date.now();
    const deadlines = this.waitingSockets().flatMap((entry) => {
      const base = entry.value.joinedAt;
      const ranked = entry.value.resource.split(':')[1] === 'RANKED';
      return [
        ...(ranked ? RANKED_RECHECK_MS.map((offset) => base + offset) : []),
        base + QUEUE_TIMEOUT_MS,
      ];
    }).filter((deadline) => deadline > now);
    const next = deadlines.sort((left, right) => left - right)[0];
    if (next !== undefined) await this.ctx.storage.setAlarm(next);
  }

  private async transition(
    uid: string,
    from: string[],
    to: string,
    resource: string | null,
    fromResource?: string,
    fromToken?: string,
    token?: string,
  ): Promise<boolean> {
    const id = this.env.PRESENCE_HUB.idFromName(uid);
    const response = await this.env.PRESENCE_HUB.get(id).fetch('https://presence.internal/transition', {
      body: JSON.stringify({
        from,
        fromResource,
        ...(fromToken === undefined ? {} : { fromToken }),
        resource,
        to,
        ...(token === undefined ? {} : { token }),
      }),
      method: 'POST',
    });
    return response.ok;
  }

  private isSilent(entry: { socket: WebSocket; value: QueueAttachment }, now: number): boolean {
    return isSilentQueueSocket({
      heartbeat: entry.value.heartbeat === true,
      joinedAt: entry.value.joinedAt,
      lastPingAt: this.ctx.getWebSocketAutoResponseTimestamp(entry.socket)?.getTime() ?? null,
      now,
    });
  }

  private async evictSilent(entry: { socket: WebSocket; value: QueueAttachment }): Promise<void> {
    this.closeQuietly(entry.socket, SILENT_CODE, 'Sem sinal');
    await this.transition(entry.value.uid, ['matchmaking'], 'idle', null, entry.value.resource, entry.value.token);
  }

  private closeQuietly(socket: WebSocket, code: number, reason: string): void {
    try { socket.close(code, reason); } catch { /* Já encerrado. */ }
  }

  private safeSend(socket: WebSocket, payload: string): void {
    try { socket.send(payload); } catch { /* A limpeza vem pelo close. */ }
  }

  private async sociallyCompatible(firstUid: string, secondUid: string): Promise<boolean> {
    const blocked = await this.env.CORE_DB.prepare(
      `SELECT 1 AS incompatible
         FROM user_blocks b
         JOIN users blocker ON blocker.id = b.blocker_user_id
         JOIN users blocked ON blocked.id = b.blocked_user_id
        WHERE (blocker.firebase_uid = ?1 AND blocked.firebase_uid = ?2)
           OR (blocker.firebase_uid = ?2 AND blocked.firebase_uid = ?1)
        LIMIT 1`,
    ).bind(firstUid, secondUid).first();
    return blocked === null;
  }

  private async release(uid: string, queueResource: string, roomId: string, token?: string): Promise<void> {
    if (await this.transition(uid, ['matchmaking'], 'idle', null, queueResource, token)) return;
    await this.transition(uid, ['preparing'], 'idle', null, roomId);
  }
}
