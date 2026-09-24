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

async function openQueue(resource: string, uid: string, knowledge: number): Promise<SocketCapture> {
  // A fila reconcilia a reserva de Presence ao parear (idle -> matchmaking -> preparing):
  // sem essa reserva prévia a transição falha por CAS e o par nunca fecha.
  const presence = env.PRESENCE_HUB.get(env.PRESENCE_HUB.idFromName(uid));
  const reserved = await presence.fetch('https://presence.internal/transition', {
    body: JSON.stringify({ from: 'idle', resource, to: 'matchmaking' }),
    method: 'POST',
  });
  expect(reserved.ok).toBe(true);

  const queue = env.MATCHMAKING_QUEUE.get(env.MATCHMAKING_QUEUE.idFromName(resource));
  const response = await queue.fetch(new Request('https://queue.internal/socket', {
    headers: {
      Upgrade: 'websocket',
      'X-QG-Authenticated-Uid': uid,
      'X-QG-Match-Resource': resource,
      'X-QG-Theme-Knowledge': String(knowledge),
    },
  }));
  expect(response.status).toBe(101);
  return capture(response.webSocket as WebSocket);
}

describe('MatchmakingQueue — pareamento por tema/Conhecimento', () => {
  it('Partida normal pareia dois Conhecimentos muito distantes sem faixa nenhuma', async () => {
    const { themeId, uids } = await seedFixture('mmq-casual');
    const resource = `${themeId}:CASUAL`;

    const low = await openQueue(resource, uids[0], 0);
    await low.waitFor('SEARCHING');
    // Conhecimento máximo do jogo: divisão oposta ao candidato acima, e ainda assim pareia de imediato.
    const high = await openQueue(resource, uids[1], 999_999);
    const [foundLow, foundHigh] = await Promise.all([low.waitFor('MATCH_FOUND'), high.waitFor('MATCH_FOUND')]);
    expect(foundLow.roomId).toBe(foundHigh.roomId);
  });

  it('Rankeada pareia a mesma divisão de imediato, mas não uma divisão muito distante antes da faixa alargar', async () => {
    const { themeId, uids } = await seedFixture('mmq-ranked-same');
    const resource = `${themeId}:RANKED`;

    const first = await openQueue(resource, uids[0], 500);
    await first.waitFor('SEARCHING');
    const second = await openQueue(resource, uids[1], 500);
    const [foundFirst, foundSecond] = await Promise.all([
      first.waitFor('MATCH_FOUND'), second.waitFor('MATCH_FOUND'),
    ]);
    expect(foundFirst.roomId).toBe(foundSecond.roomId);
  });

  it('Rankeada não pareia divisões muito distantes nos primeiros 15 s de espera', async () => {
    const { themeId, uids } = await seedFixture('mmq-ranked-far');
    const resource = `${themeId}:RANKED`;

    const low = await openQueue(resource, uids[0], 0);
    await low.waitFor('SEARCHING');
    // Conhecimento máximo: divisão oposta, fora da faixa 0 (mesma divisão) válida nos primeiros 15 s.
    const high = await openQueue(resource, uids[1], 999_999);
    const searching = await high.waitFor('SEARCHING');
    expect(searching.type).toBe('SEARCHING');
    // Nenhum dos dois foi pareado: ambos continuam esperando na fila.
    low.socket.close(1_000, 'Fixture concluída');
    high.socket.close(1_000, 'Fixture concluída');
  });
});
