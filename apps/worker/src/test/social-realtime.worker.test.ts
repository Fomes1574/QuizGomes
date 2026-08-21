import { env, SELF } from 'cloudflare:test';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

interface RealtimeEvent {
  code?: string;
  count?: number;
  revision?: string;
  type?: string;
}

interface SocialCapture {
  messages: Array<RealtimeEvent | string>;
  socket: WebSocket;
  waitFor: (type: string) => Promise<RealtimeEvent | string>;
}

async function open(stub: DurableObjectStub, userId: string): Promise<SocialCapture> {
  const response = await stub.fetch(new Request('https://social.internal/socket', {
    headers: { Upgrade: 'websocket', 'X-QG-Authenticated-User-Id': userId },
  }));
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null) throw new Error('Socket social sintético ausente.');
  const messages: Array<RealtimeEvent | string> = [];
  const listeners: Array<{ resolve: (event: RealtimeEvent | string) => void; type: string }> = [];
  socket.addEventListener('message', (event) => {
    const raw = String(event.data);
    const parsed = raw === 'PONG' ? raw : JSON.parse(raw) as RealtimeEvent;
    const type = typeof parsed === 'string' ? parsed : parsed.type;
    const index = listeners.findIndex((entry) => entry.type === type);
    const waiter = listeners[index];
    if (waiter === undefined) messages.push(parsed);
    else {
      listeners.splice(index, 1);
      waiter.resolve(parsed);
    }
  });
  socket.accept();
  return {
    messages,
    socket,
    waitFor: (type) => {
      const index = messages.findIndex((message) => (
        typeof message === 'string' ? message === type : message.type === type
      ));
      const existing = messages[index];
      if (existing !== undefined) {
        messages.splice(index, 1);
        return Promise.resolve(existing);
      }
      return new Promise((resolve, reject) => {
        const waiter = { resolve, type };
        listeners.push(waiter);
        setTimeout(() => {
          const waiterIndex = listeners.indexOf(waiter);
          if (waiterIndex >= 0) {
            listeners.splice(waiterIndex, 1);
            reject(new Error(`Evento social ${type} não chegou.`));
          }
        }, 2_000);
      });
    },
  };
}

function hub(): DurableObjectStub {
  return env.SOCIAL_REALTIME_HUB.get(env.SOCIAL_REALTIME_HUB.idFromName(crypto.randomUUID()));
}

async function count(stub: DurableObjectStub): Promise<number> {
  const response = await stub.fetch('https://social.internal/count');
  return (await response.json<{ onlineCount: number }>()).onlineCount;
}

describe('Milestone 9A.1 — SocialRealtimeHub hibernável', () => {
  it('conta usuários únicos e atualiza somente quando a primeira/última sessão muda', async () => {
    const stub = hub();
    const firstA = await open(stub, 'user-a');
    expect(await firstA.waitFor('ONLINE_COUNT')).toMatchObject({ count: 1 });
    const secondA = await open(stub, 'user-a');
    expect(await secondA.waitFor('ONLINE_COUNT')).toMatchObject({ count: 1 });
    expect(firstA.messages).toEqual([]);

    const firstB = await open(stub, 'user-b');
    await Promise.all([
      expect(firstA.waitFor('ONLINE_COUNT')).resolves.toMatchObject({ count: 2 }),
      expect(secondA.waitFor('ONLINE_COUNT')).resolves.toMatchObject({ count: 2 }),
      expect(firstB.waitFor('ONLINE_COUNT')).resolves.toMatchObject({ count: 2 }),
    ]);

    secondA.socket.close(1_000, 'Segunda aba encerrada');
    await expect.poll(() => count(stub)).toBe(2);
    expect(firstA.messages).toEqual([]);
    expect(firstB.messages).toEqual([]);

    firstA.socket.close(1_000, 'Última aba encerrada');
    expect(await firstB.waitFor('ONLINE_COUNT')).toMatchObject({ count: 1 });
    expect(await count(stub)).toBe(1);
    firstB.socket.close(1_000, 'Sessão encerrada');
    await expect.poll(() => count(stub)).toBe(0);
  });

  it('entrega invalidação genérica a todas as abas do alvo, sem identificar ator ou bloqueio', async () => {
    const stub = hub();
    const first = await open(stub, 'target-user');
    await first.waitFor('ONLINE_COUNT');
    const second = await open(stub, 'target-user');
    await second.waitFor('ONLINE_COUNT');
    const stranger = await open(stub, 'other-user');
    await Promise.all([
      first.waitFor('ONLINE_COUNT'), second.waitFor('ONLINE_COUNT'), stranger.waitFor('ONLINE_COUNT'),
    ]);

    const delivered = await stub.fetch('https://social.internal/invalidate', {
      body: JSON.stringify({ userIds: ['target-user', 'target-user'] }),
      method: 'POST',
    });
    expect(delivered.ok).toBe(true);
    const [firstEvent, secondEvent] = await Promise.all([
      first.waitFor('SOCIAL_INVALIDATED'), second.waitFor('SOCIAL_INVALIDATED'),
    ]);
    expect(firstEvent).toEqual(secondEvent);
    expect(firstEvent).toMatchObject({ type: 'SOCIAL_INVALIDATED' });
    expect(JSON.stringify(firstEvent)).not.toMatch(/target-user|other-user|block|firebase|email/i);
    expect(stranger.messages).toEqual([]);
    first.socket.close();
    second.socket.close();
    stranger.socket.close();
  });

  it('responde PING por auto-response hibernável e não grava heartbeat em storage', async () => {
    const stub = hub();
    const session = await open(stub, 'heartbeat-user');
    await session.waitFor('ONLINE_COUNT');
    session.socket.send('PING');
    expect(await session.waitFor('PONG')).toBe('PONG');
    const persisted = await runInDurableObject(stub, async (_instance, state) => ({
      autoRequest: state.getWebSocketAutoResponse()?.request,
      autoResponse: state.getWebSocketAutoResponse()?.response,
      keys: [...(await state.storage.list()).keys()],
    }));
    expect(persisted).toEqual({ autoRequest: 'PING', autoResponse: 'PONG', keys: [] });
    session.socket.close();
  });

  it('rejeita sessão sem identidade autenticada e não aceita conexão pública sem ticket', async () => {
    const stub = hub();
    const internal = await stub.fetch(new Request('https://social.internal/socket', {
      headers: { Upgrade: 'websocket' },
    }));
    expect(internal.status).toBe(401);
    const external = await SELF.fetch('https://quiz.test/api/realtime/social', {
      headers: { Upgrade: 'websocket' },
    });
    expect(external.status).toBe(401);
  });

  it('reconecta o mesmo usuário sem duplicar seu total global', async () => {
    const stub = hub();
    const first = await open(stub, 'reconnect-user');
    await first.waitFor('ONLINE_COUNT');
    first.socket.close(1_000, 'Rede alterada');
    await expect.poll(() => count(stub)).toBe(0);
    const returned = await open(stub, 'reconnect-user');
    expect(await returned.waitFor('ONLINE_COUNT')).toMatchObject({ count: 1 });
    expect(await count(stub)).toBe(1);
    returned.socket.close();
  });
});
