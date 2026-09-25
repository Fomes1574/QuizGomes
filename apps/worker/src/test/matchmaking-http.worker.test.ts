import { env, SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { issueRealFirebaseTestToken } from './firebase-test-token.js';

/**
 * Cobre o caminho HTTP real de `/api/realtime/matchmaking` — ticket +
 * handshake de WebSocket através de `SELF.fetch`, exatamente como o cliente
 * faz. Os testes de `matchmaking-queue.worker.test.ts` chamam a Durable
 * Object diretamente e nunca passaram por `requireUser`, pelo ticket broker
 * nem pela reserva de presença; esta suíte existia como lacuna até o bug de
 * "conexão com a fila foi interrompida" relatado em produção.
 */

async function seedTheme(prefix: string): Promise<{ themeId: string; uid: string; userId: string }> {
  const uid = `${prefix}-uid`;
  const userId = `${prefix}-user`;
  const themeId = `${prefix}-theme`;
  const poolId = `${themeId}:pool`;
  await env.CORE_DB.batch([
    env.CORE_DB.prepare(
      `INSERT INTO categories (id, slug, name, sort_order) VALUES (?1, ?1, ?2, 999)`,
    ).bind(`${prefix}-cat`, `Categoria ${prefix}`),
    env.CORE_DB.prepare('INSERT INTO users (id, firebase_uid) VALUES (?1, ?2)').bind(userId, uid),
    env.CORE_DB.prepare(
      'INSERT INTO user_profiles (user_id, public_id, display_name) VALUES (?1, ?2, ?3)',
    ).bind(userId, `#QG${prefix.toUpperCase()}`, 'Jogador de teste'),
    env.CORE_DB.prepare(
      `INSERT INTO themes
        (id, category_id, slug, name, description, status, origin, question_shard_id, active_question_count)
       VALUES (?1, ?2, ?1, ?3, 'Fixture de matchmaking HTTP.', 'ACTIVE', 'OFFICIAL', 'questions-01', 10)`,
    ).bind(themeId, `${prefix}-cat`, `Tema ${prefix}`),
  ]);
  const questionStatements = [env.QUESTIONS_DB.prepare(
    `INSERT INTO question_pools (id, theme_id, difficulty, active_count) VALUES (?1, ?2, 'MEDIUM', 10)`,
  ).bind(poolId, themeId)];
  for (let index = 1; index <= 10; index += 1) {
    questionStatements.push(env.QUESTIONS_DB.prepare(
      `INSERT INTO questions
        (id, pool_id, active_slot, prompt, option_a, option_b, option_c, option_d, correct_option, content_hash, status)
       VALUES (?1, ?2, ?3, ?4, 'B', 'C', 'D', 'E', 0, ?5, 'ACTIVE')`,
    ).bind(`${prefix}-q-${index}`, poolId, index, `Pergunta ${index}?`, `${prefix}-hash-${index}`));
  }
  await env.QUESTIONS_DB.batch(questionStatements);
  return { themeId, uid, userId };
}

async function pullTicketAndOpenSocket(token: string, resource: string): Promise<Response> {
  const ticketResponse = await SELF.fetch('https://quiz.test/api/realtime/tickets', {
    body: JSON.stringify({ resource, scope: 'matchmaking' }),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    method: 'POST',
  });
  expect(ticketResponse.status).toBe(200);
  const ticketBody = await ticketResponse.json<{ ticket: string }>();
  const params = new URLSearchParams({ resource, ticket: ticketBody.ticket });
  return SELF.fetch(`https://quiz.test/api/realtime/matchmaking?${params}`, {
    headers: { Upgrade: 'websocket' },
  });
}

describe('/api/realtime/matchmaking — fluxo HTTP real de ponta a ponta', () => {
  let restoreFetch: (() => void) | null = null;
  afterEach(() => {
    restoreFetch?.();
    restoreFetch = null;
  });

  it('cria ticket e abre o socket de busca para um jogador novo, exatamente como o cliente faz', async () => {
    const prefix = `mmhttp-${crypto.randomUUID().slice(0, 8)}`;
    const { themeId, uid } = await seedTheme(prefix);
    const { restore, token } = await issueRealFirebaseTestToken(uid);
    restoreFetch = restore;

    const socketResponse = await pullTicketAndOpenSocket(token, `${themeId}:CASUAL`);
    expect(socketResponse.status).toBe(101);
  });

  it('autocura presença travada em matchmaking de uma tentativa anterior interrompida', async () => {
    const prefix = `mmhttp-stale-${crypto.randomUUID().slice(0, 8)}`;
    const { themeId, uid } = await seedTheme(prefix);
    const { restore, token } = await issueRealFirebaseTestToken(uid);
    restoreFetch = restore;
    const resource = `${themeId}:CASUAL`;

    // Simula uma queda de rede/aba fechada: a presença fica travada em
    // 'matchmaking' sem nenhum socket vivo por trás, como uma tentativa
    // anterior que nunca fechou de forma limpa.
    const presence = env.PRESENCE_HUB.get(env.PRESENCE_HUB.idFromName(uid));
    const stuck = await presence.fetch('https://presence.internal/transition', {
      body: JSON.stringify({ from: 'idle', resource: `${themeId}:RANKED`, to: 'matchmaking' }),
      method: 'POST',
    });
    expect(stuck.ok).toBe(true);

    // Sem a autocura, esta chamada falharia com PLAYER_BUSY e o handshake
    // nunca chegaria a 101 — exatamente o bug relatado em produção.
    const socketResponse = await pullTicketAndOpenSocket(token, resource);
    expect(socketResponse.status).toBe(101);

    const state = await (await presence.fetch('https://presence.internal/state')).json<{ activity: string; resource: string | null }>();
    expect(state).toMatchObject({ activity: 'matchmaking', resource });
  });
});
