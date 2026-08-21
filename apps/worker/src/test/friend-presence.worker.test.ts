import { env, SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerActivity } from '../durable-objects/presence-hub.js';
import { SocialRepository } from '../repositories/social-repository.js';

interface FixtureUser {
  id: string;
  publicId: string;
  uid: string;
}

interface PresenceEvent {
  count?: number;
  presence?: string;
  publicId?: string;
  revision?: number;
  type: string;
}

interface Session {
  events: PresenceEvent[];
  socket: WebSocket;
  waitFor: (type: string, publicId?: string) => Promise<PresenceEvent>;
}

const openSockets: WebSocket[] = [];

function hub(): DurableObjectStub {
  return env.SOCIAL_REALTIME_HUB.get(env.SOCIAL_REALTIME_HUB.idFromName('global'));
}

async function fixture(friendships: boolean[] = [true]): Promise<FixtureUser[]> {
  const prefix = crypto.randomUUID().slice(0, 8);
  const users = Array.from({ length: friendships.length + 1 }, (_, index) => ({
    id: `presence-${prefix}-${index}`,
    publicId: `#QG${prefix.replaceAll('-', '').toUpperCase()}${index}`,
    uid: `presence-firebase-${prefix}-${index}`,
  }));
  const root = users[0];
  if (root === undefined) throw new Error('Fixture de presença ausente.');
  await env.CORE_DB.batch([
    ...users.flatMap((user, index) => [
      env.CORE_DB.prepare('INSERT INTO users (id, firebase_uid) VALUES (?1, ?2)').bind(user.id, user.uid),
      env.CORE_DB.prepare(
        'INSERT INTO user_profiles (user_id, public_id, display_name) VALUES (?1, ?2, ?3)',
      ).bind(user.id, user.publicId, `Amigo ${index}`),
    ]),
    ...friendships.flatMap((linked, index) => {
      const friend = users[index + 1];
      if (!linked || friend === undefined) return [];
      const [low, high] = root.id < friend.id ? [root.id, friend.id] : [friend.id, root.id];
      return [env.CORE_DB.prepare(
        'INSERT INTO friendships (user_low_id, user_high_id) VALUES (?1, ?2)',
      ).bind(low, high)];
    }),
  ]);
  return users;
}

function at(users: FixtureUser[], index: number): FixtureUser {
  const user = users[index];
  if (user === undefined) throw new Error('Usuário sintético ausente.');
  return user;
}

async function open(user: FixtureUser): Promise<Session> {
  const response = await hub().fetch(new Request('https://social.internal/socket', {
    headers: {
      Upgrade: 'websocket',
      'X-QG-Authenticated-Public-Id': user.publicId,
      'X-QG-Authenticated-User-Id': user.id,
      'X-QG-Presence-Object-Id': env.PRESENCE_HUB.idFromName(user.uid).toString(),
    },
  }));
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null) throw new Error('WebSocket de presença ausente.');
  const events: PresenceEvent[] = [];
  socket.addEventListener('message', (message) => {
    events.push(JSON.parse(String(message.data)) as PresenceEvent);
  });
  socket.accept();
  openSockets.push(socket);
  return {
    events,
    socket,
    waitFor: async (type, publicId) => {
      let found: PresenceEvent | undefined;
      await expect.poll(() => {
        const index = events.findIndex((event) => event.type === type &&
          (publicId === undefined || event.publicId === publicId));
        if (index < 0) return false;
        found = events.splice(index, 1)[0];
        return true;
      }, { timeout: 3_000 }).toBe(true);
      if (found === undefined) throw new Error('Evento de presença ausente.');
      return found;
    },
  };
}

async function transition(user: FixtureUser, from: PlayerActivity, to: PlayerActivity): Promise<void> {
  const result = await env.PRESENCE_HUB.get(env.PRESENCE_HUB.idFromName(user.uid))
    .fetch('https://presence.internal/transition', {
      body: JSON.stringify({ from, resource: to === 'idle' ? null : 'synthetic-resource', to }),
      method: 'POST',
    });
  expect(result.ok).toBe(true);
}

async function snapshot(users: FixtureUser[]): Promise<Array<{ presence: string; revision: number; userId: string }>> {
  const result = await hub().fetch('https://social.internal/snapshot', {
    body: JSON.stringify({ userIds: users.map((user) => user.id) }),
    method: 'POST',
  });
  return (await result.json<{ friends: Array<{ presence: string; revision: number; userId: string }> }>()).friends;
}

afterEach(() => {
  for (const socket of openSockets.splice(0)) {
    try { socket.close(1_000, 'Teste social concluído'); } catch { /* Sessão já encerrada. */ }
  }
});

describe('Milestone 9B — presença privada entre amigos no runtime Workers', () => {
  it('publica ONLINE/OFFLINE somente na primeira e última sessão do amigo', async () => {
    const users = await fixture();
    const subject = at(users, 0);
    const friend = await open(at(users, 1));
    const first = await open(subject);
    const initial = await friend.waitFor('FRIEND_PRESENCE_CHANGED', subject.publicId);
    expect(initial).toMatchObject({ presence: 'ONLINE', publicId: subject.publicId });
    expect(JSON.stringify(initial)).not.toMatch(/firebase|userId|room|resource|theme|score/i);

    const second = await open(subject);
    expect(friend.events.filter((event) => event.type === 'FRIEND_PRESENCE_CHANGED')).toEqual([]);
    first.socket.close(1_000, 'Primeira aba encerrada');
    await expect.poll(async () => (await snapshot([subject]))[0]?.presence).toBe('ONLINE');
    expect(friend.events.filter((event) => event.type === 'FRIEND_PRESENCE_CHANGED')).toEqual([]);

    second.socket.close(1_000, 'Última aba encerrada');
    expect(await friend.waitFor('FRIEND_PRESENCE_CHANGED', subject.publicId)).toMatchObject({ presence: 'OFFLINE' });
    const returned = await open(subject);
    expect(await friend.waitFor('FRIEND_PRESENCE_CHANGED', subject.publicId)).toMatchObject({ presence: 'ONLINE' });
    returned.socket.close();
  });

  it('projeta matchmaking, partida, reconexão e idle exclusivamente da atividade autoritativa', async () => {
    const users = await fixture();
    const subject = at(users, 0);
    const observer = await open(at(users, 1));
    await open(subject);
    await observer.waitFor('FRIEND_PRESENCE_CHANGED', subject.publicId);

    const states: Array<[PlayerActivity, PlayerActivity, string]> = [
      ['idle', 'matchmaking', 'MATCHMAKING'],
      ['matchmaking', 'preparing', 'IN_MATCH'],
      ['preparing', 'playing', 'IN_MATCH'],
      ['playing', 'reconnecting', 'RECONNECTING'],
      ['reconnecting', 'finished', 'IN_MATCH'],
      ['finished', 'idle', 'ONLINE'],
    ];
    let revision = 0;
    for (const [from, to, expected] of states) {
      await transition(subject, from, to);
      const event = await observer.waitFor('FRIEND_PRESENCE_CHANGED', subject.publicId);
      expect(event.presence).toBe(expected);
      expect(event.revision).toBeGreaterThan(revision);
      revision = event.revision ?? 0;
    }
  });

  it('OFFLINE vence playing residual e snapshot consulta somente sessões conectadas', async () => {
    const users = await fixture();
    const subject = at(users, 0);
    const observer = await open(at(users, 1));
    const player = await open(subject);
    await observer.waitFor('FRIEND_PRESENCE_CHANGED', subject.publicId);
    await transition(subject, 'idle', 'playing');
    expect(await observer.waitFor('FRIEND_PRESENCE_CHANGED', subject.publicId))
      .toMatchObject({ presence: 'IN_MATCH' });
    expect((await snapshot([subject]))[0]).toMatchObject({ presence: 'IN_MATCH' });

    player.socket.close(1_000, 'Última sessão encerrada');
    expect(await observer.waitFor('FRIEND_PRESENCE_CHANGED', subject.publicId))
      .toMatchObject({ presence: 'OFFLINE' });
    expect((await snapshot([subject]))[0]).toMatchObject({ presence: 'OFFLINE' });
    const activity = await env.PRESENCE_HUB.get(env.PRESENCE_HUB.idFromName(subject.uid))
      .fetch('https://presence.internal/state');
    expect(await activity.json()).toMatchObject({ activity: 'playing' });
  });

  it('nunca envia presença para não-amigos e bloqueio/remoção revogam a audiência server-side', async () => {
    const users = await fixture([true, false]);
    const subject = at(users, 0);
    const friend = at(users, 1);
    const stranger = await open(at(users, 2));
    const observer = await open(friend);
    await open(subject);
    await observer.waitFor('FRIEND_PRESENCE_CHANGED', subject.publicId);
    expect(stranger.events.filter((event) => event.type === 'FRIEND_PRESENCE_CHANGED')).toEqual([]);

    const repository = new SocialRepository(env.CORE_DB);
    await repository.block(friend.id, subject.publicId);
    expect(await repository.friendPresenceTargets(subject.id)).toEqual([]);
    expect(await repository.friendPresenceTargets(friend.id)).toEqual([]);
    await transition(subject, 'idle', 'matchmaking');
    expect(observer.events.filter((event) => event.type === 'FRIEND_PRESENCE_CHANGED')).toEqual([]);
    expect(stranger.events.filter((event) => event.type === 'FRIEND_PRESENCE_CHANGED')).toEqual([]);
    const candidates = await repository.search(at(users, 2).id, subject.publicId);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).not.toHaveProperty('presence');
  });

  it('snapshot registra revision anterior a eventos posteriores e preserva invite como ONLINE', async () => {
    const users = await fixture();
    const subject = at(users, 0);
    const observer = await open(at(users, 1));
    await open(subject);
    await observer.waitFor('FRIEND_PRESENCE_CHANGED', subject.publicId);
    const earlier = (await snapshot([subject]))[0];
    expect(earlier).toMatchObject({ presence: 'ONLINE' });
    await transition(subject, 'idle', 'invite');
    const newer = await observer.waitFor('FRIEND_PRESENCE_CHANGED', subject.publicId);
    expect(newer).toMatchObject({ presence: 'ONLINE' });
    expect(newer.revision).toBeGreaterThan(earlier?.revision ?? 0);
  });

  it('nova amizade online recebe snapshot correto e remoção impede qualquer evento futuro', async () => {
    const users = await fixture([false]);
    const subject = at(users, 0);
    const peer = at(users, 1);
    const observer = await open(peer);
    await open(subject);
    expect(observer.events.filter((event) => event.type === 'FRIEND_PRESENCE_CHANGED')).toEqual([]);

    const repository = new SocialRepository(env.CORE_DB);
    const request = await repository.sendRequest(subject.id, peer.publicId);
    await repository.acceptRequest(peer.id, request.requestId);
    expect(await repository.friendPresenceTargets(peer.id))
      .toEqual([{ publicId: subject.publicId, userId: subject.id }]);
    expect((await snapshot([subject]))[0]).toMatchObject({ presence: 'ONLINE' });
    await transition(subject, 'idle', 'matchmaking');
    let current = await observer.waitFor('FRIEND_PRESENCE_CHANGED', subject.publicId);
    if (current.presence === 'ONLINE') {
      current = await observer.waitFor('FRIEND_PRESENCE_CHANGED', subject.publicId);
    }
    expect(current).toMatchObject({ presence: 'MATCHMAKING' });

    await repository.removeFriend(peer.id, subject.publicId);
    expect(await repository.friendPresenceTargets(peer.id)).toEqual([]);
    expect(await repository.friendPresenceTargets(subject.id)).toEqual([]);
    await transition(subject, 'matchmaking', 'idle');
    expect(observer.events.filter((event) => event.type === 'FRIEND_PRESENCE_CHANGED')).toEqual([]);
  });

  it('snapshot público exige autenticação e não existe endpoint de lookup por ID público', async () => {
    const anonymous = await SELF.fetch('https://quiz.test/api/social/presence');
    expect(anonymous.status).toBe(401);
    const guessed = await SELF.fetch('https://quiz.test/api/presence/%23QGPRIVATE');
    expect(guessed.status).toBe(404);
  });
});
