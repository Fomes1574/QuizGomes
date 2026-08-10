import { ApiError } from '../http/api-error.js';

interface TicketRecord {
  expiresAt: number;
  resource: string;
  scope: 'matchmaking' | 'presence' | 'room';
  uid: string;
}

function token(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export class TicketBroker {
  constructor(private readonly ctx: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/create') {
      const uid = request.headers.get('X-QG-Authenticated-Uid');
      if (uid === null) return Response.json({ error: 'unauthorized' }, { status: 401 });
      const input = await request.json<TicketRecord>();
      const value = token();
      const record: TicketRecord = { ...input, expiresAt: Date.now() + 30_000, uid };
      await this.ctx.storage.put(`ticket:${value}`, record);
      const currentAlarm = await this.ctx.storage.getAlarm();
      if (currentAlarm === null || currentAlarm > record.expiresAt) await this.ctx.storage.setAlarm(record.expiresAt);
      return Response.json({ expiresAt: record.expiresAt, ticket: value });
    }
    if (request.method === 'POST' && url.pathname === '/consume') {
      const input = await request.json<{ resource: string; scope: TicketRecord['scope']; ticket: string }>();
      const key = `ticket:${input.ticket}`;
      const record = await this.ctx.storage.get<TicketRecord>(key);
      if (record === undefined || record.expiresAt < Date.now() || record.scope !== input.scope || record.resource !== input.resource) {
        if (record !== undefined) await this.ctx.storage.delete(key);
        return Response.json({ error: 'invalid_ticket' }, { status: 401 });
      }
      await this.ctx.storage.delete(key);
      return Response.json({ uid: record.uid });
    }
    throw new ApiError(404, 'NOT_FOUND', 'Rota não encontrada.');
  }

  async alarm(): Promise<void> {
    const records = await this.ctx.storage.list<TicketRecord>({ prefix: 'ticket:' });
    const now = Date.now();
    const expired = [...records.entries()].filter(([, record]) => record.expiresAt <= now).map(([key]) => key);
    if (expired.length > 0) await this.ctx.storage.delete(expired);
    const nextExpiry = [...records.values()].filter((record) => record.expiresAt > now)
      .reduce<number | null>((next, record) => next === null ? record.expiresAt : Math.min(next, record.expiresAt), null);
    if (nextExpiry !== null) await this.ctx.storage.setAlarm(nextExpiry);
  }
}
