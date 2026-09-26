import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

interface TestMessage {
  roomId?: string;
  timeoutAt?: number;
  type?: string;
}

interface SocketCapture {
  socket: WebSocket;
  waitFor(type: string): Promise<TestMessage>;
}

function capture(socket: WebSocket): SocketCapture {
  const messages: TestMessage[] = [];
  const waiters: Array<{ resolve: (message: TestMessage) => void; type: string }> = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as TestMessage;
    const waiterIndex = waiters.findIndex((waiter) => waiter.type === message.type);
    const waiter = waiters[waiterIndex];
    if (waiter !== undefined) {
      waiters.splice(waiterIndex, 1);
      waiter.resolve(message);
    } else {
      messages.push(message);
    }
  });
  socket.accept();
  return {
    socket,
    waitFor: (type: string) => {
      const existingIndex = messages.findIndex((message) => message.type === type);
      const existing = messages[existingIndex];
      if (existing !== undefined) {
        messages.splice(existingIndex, 1);
        return Promise.resolve(existing);
      }
      return new Promise<TestMessage>((resolve, reject) => {
        waiters.push({ resolve, type });
        setTimeout(() => reject(new Error(`Timeout aguardando ${type}.`)), 2_000);
      });
    },
  };
}

/**
 * Fixture mínima: um tema com pool único de 10 perguntas ativas (cobre
 * RANKED, que exige mais) e dois usuários prontos para parear.
 */
async function seedFixture(prefix: string): Promise<{
  themeId: string;
  uids: [string, string];
}> {
  const themeId = `${prefix}-theme`;
  const poolId = `${themeId}:pool`;
  const uids: [string, string] = [`${prefix}-firebase-1`, `${prefix}-firebase-2`];
  const userIds: [string, string] = [`${prefix}-user-1`, `${prefix}-user-2`];
  await env.CORE_DB.batch([
    env.CORE_DB.prepare(
      `INSERT OR IGNORE INTO categories (id, slug, name, sort_order)
       VALUES ('test-mmq-category', 'test-mmq-category', 'Categoria matchmaking', 999)`,
    ),
    env.CORE_DB.prepare('INSERT INTO users (id, firebase_uid) VALUES (?1, ?2)').bind(userIds[0], uids[0]),
    env.CORE_DB.prepare('INSERT INTO users (id, firebase_uid) VALUES (?1, ?2)').bind(userIds[1], uids[1]),
    env.CORE_DB.prepare(
      'INSERT INTO user_profiles (user_id, public_id, display_name) VALUES (?1, ?2, ?3)',
    ).bind(userIds[0], `#QG${prefix.toUpperCase()}1`, `${prefix} Jogador 1`),
    env.CORE_DB.prepare(
      'INSERT INTO user_profiles (user_id, public_id, display_name) VALUES (?1, ?2, ?3)',
    ).bind(userIds[1], `#QG${prefix.toUpperCase()}2`, `${prefix} Jogador 2`),
    env.CORE_DB.prepare(
      `INSERT INTO themes
        (id, category_id, slug, name, description, status, origin, question_shard_id, active_question_count)
       VALUES (?1, 'test-mmq-category', ?2, ?3, 'Fixture sintética de matchmaking.', 'ACTIVE', 'OFFICIAL', 'questions-01', 10)`,
    ).bind(themeId, themeId, `${prefix} Tema`),
  ]);
  const questionStatements = [env.QUESTIONS_DB.prepare(
    `INSERT INTO question_pools (id, theme_id, difficulty, active_count)
     VALUES (?1, ?2, 'MEDIUM', 10)`,
  ).bind(poolId, themeId)];
  for (let index = 1; index <= 10; index += 1) {
    questionStatements.push(env.QUESTIONS_DB.prepare(
      `INSERT INTO questions
        (id, pool_id, active_slot, prompt, option_a, option_b, option_c, option_d, correct_option, content_hash, status)
       VALUES (?1, ?2, ?3, ?4, 'Correta', 'B', 'C', 'D', 0, ?5, 'ACTIVE')`,
    ).bind(`${prefix}-q-${index}`, poolId, index, `[FIXTURE] Pergunta ${index}?`, `${prefix}-hash-${index}`));
  }
  await env.QUESTIONS_DB.batch(questionStatements);
  return { themeId, uids };
}



async function presenceTransition(uid: string, body: Record<string, unknown>): Promise<Response> {
  return env.PRESENCE_HUB.get(env.PRESENCE_HUB.idFromName(uid)).fetch('https://presence.internal/transition', {
    body: JSON.stringify(body), method: 'POST',
  });
}

async function presenceState(uid: string): Promise<{ activity: string; resource: string | null; token?: string | null }> {
  return env.PRESENCE_HUB.get(env.PRESENCE_HUB.idFromName(uid)).fetch('https://presence.internal/state')
    .then((response) => response.json());
}

/** Mesmo caminho da rota: reserva com token e abre o socket com batimento. */
async function openSearch(resource: string, uid: string, token: string): Promise<SocketCapture & { closes: number[] }> {
  const state = await presenceState(uid);
  if (state.activity === 'matchmaking') {
    await presenceTransition(uid, { from: 'matchmaking', fromResource: state.resource, resource: null, to: 'idle' });
  }
  expect((await presenceTransition(uid, { from: 'idle', resource, to: 'matchmaking', token })).ok).toBe(true);
  const queue = env.MATCHMAKING_QUEUE.get(env.MATCHMAKING_QUEUE.idFromName(resource));
  const response = await queue.fetch(new Request('https://queue.internal/socket', {
    headers: {
      Upgrade: 'websocket',
      'X-QG-Authenticated-Uid': uid,
      'X-QG-Heartbeat': '1',
      'X-QG-Match-Resource': resource,
      'X-QG-Search-Token': token,
      'X-QG-Theme-Knowledge': '0',
    },
  }));
  expect(response.status).toBe(101);
  const socket = response.webSocket as WebSocket;
  const closes: number[] = [];
  socket.addEventListener('close', (event) => closes.push(event.code));
  return { ...capture(socket), closes };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('fila: token por busca e sockets fantasmas', () => {
  it('presença só aceita liberar/promover com o token da própria busca', async () => {
    const uid = `tok-${crypto.randomUUID()}`;
    expect((await presenceTransition(uid, { from: 'idle', resource: 'x:CASUAL', to: 'matchmaking', token: 'A' })).ok).toBe(true);
    expect((await presenceTransition(uid, { from: 'matchmaking', fromToken: 'B', resource: null, to: 'idle' })).status).toBe(409);
    expect((await presenceState(uid)).activity).toBe('matchmaking');
    expect((await presenceTransition(uid, { from: 'matchmaking', fromToken: 'A', resource: null, to: 'idle' })).ok).toBe(true);
  });

  it('busca nova do mesmo jogador substitui a antiga sem liberar a reserva nova', async () => {
    const { themeId, uids } = await seedFixture(`mmqs-${crypto.randomUUID().slice(0, 6)}`);
    const resource = `${themeId}:CASUAL`;
    const old = await openSearch(resource, uids[0], 'token-antigo');
    await old.waitFor('SEARCHING');
    const fresh = await openSearch(resource, uids[0], 'token-novo');
    await fresh.waitFor('SEARCHING');
    await settle();
    expect(old.closes).toContain(4_103);
    // O close do socket antigo chegou, mas não derrubou a busca nova.
    expect(await presenceState(uids[0])).toMatchObject({ activity: 'matchmaking' });
    const opponent = await openSearch(resource, uids[1], 'token-oponente');
    const [a, b] = await Promise.all([fresh.waitFor('MATCH_FOUND'), opponent.waitFor('MATCH_FOUND')]);
    expect(a.roomId).toBe(b.roomId);
  });

  it('fantasma cuja reserva não vale mais sai sozinho; o adversário real continua na fila', async () => {
    const { themeId, uids } = await seedFixture(`mmqg-${crypto.randomUUID().slice(0, 6)}`);
    const resource = `${themeId}:CASUAL`;
    const ghost = await openSearch(resource, uids[0], 'token-fantasma');
    await ghost.waitFor('SEARCHING');
    // O dono do fantasma já está em outra busca (outra fila): token trocou.
    await presenceTransition(uids[0], { from: 'matchmaking', resource: null, to: 'idle' });
    await presenceTransition(uids[0], { from: 'idle', resource: 'outro-tema:CASUAL', to: 'matchmaking', token: 'token-outra-fila' });

    const real = await openSearch(resource, uids[1], 'token-real');
    await real.waitFor('SEARCHING');
    expect(await ghost.waitFor('MATCH_FAILED')).toMatchObject({ code: 'PLAYER_BUSY' });
    await settle();
    // Quem estava de fato ali segue esperando, com a mesma reserva.
    expect(await presenceState(uids[1])).toMatchObject({ activity: 'matchmaking', resource });
    expect(real.closes).toEqual([]);
    expect(await presenceState(uids[0])).toMatchObject({ activity: 'matchmaking', resource: 'outro-tema:CASUAL' });
    real.socket.close(1_000, 'fim');
  });
});

describe('fila: detecção de silêncio', () => {
  it('só julga quem manda batimento, com folga de 25 s desde o último PING', async () => {
    const { isSilentQueueSocket, QUEUE_SILENCE_LIMIT_MS } = await import('../durable-objects/matchmaking-queue.js');
    const joinedAt = 1_000_000;
    expect(isSilentQueueSocket({ heartbeat: false, joinedAt, lastPingAt: null, now: joinedAt + 600_000 })).toBe(false);
    expect(isSilentQueueSocket({ heartbeat: true, joinedAt, lastPingAt: null, now: joinedAt + QUEUE_SILENCE_LIMIT_MS })).toBe(false);
    expect(isSilentQueueSocket({ heartbeat: true, joinedAt, lastPingAt: null, now: joinedAt + QUEUE_SILENCE_LIMIT_MS + 1 })).toBe(true);
    expect(isSilentQueueSocket({ heartbeat: true, joinedAt, lastPingAt: joinedAt + 20_000, now: joinedAt + 40_000 })).toBe(false);
    expect(isSilentQueueSocket({ heartbeat: true, joinedAt, lastPingAt: joinedAt + 10_000, now: joinedAt + 40_000 })).toBe(true);
  });
});
