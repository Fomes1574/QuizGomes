import { env, SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { issueRealFirebaseTestToken } from './firebase-test-token.js';
import { fixture, themeIdOf, userAt } from './challenge-fixture.worker.js';

async function finishedMatch(themeId: string, firstUserId: string, secondUserId: string, finishedAgoMs: number, status = 'FINISHED'): Promise<string> {
  const matchId = crypto.randomUUID();
  const finishedAt = new Date(Date.now() - finishedAgoMs).toISOString().replace('T', ' ').slice(0, 19);
  await env.CORE_DB.batch([
    env.CORE_DB.prepare(
      `INSERT INTO matches (id, theme_id, difficulty, mode, kind, status, question_shard_id, winner_user_id, finished_at)
       VALUES (?1, ?2, 'MEDIUM', 'RANKED', 'MATCHMAKING', ?3, 'questions-01', ?4, ?5)`,
    ).bind(matchId, themeId, status, firstUserId, finishedAt),
    env.CORE_DB.prepare('INSERT INTO match_players (match_id, user_id, seat, score) VALUES (?1, ?2, 1, 80)').bind(matchId, firstUserId),
    env.CORE_DB.prepare('INSERT INTO match_players (match_id, user_id, seat, score) VALUES (?1, ?2, 2, 60)').bind(matchId, secondUserId),
  ]);
  return matchId;
}

describe('Revanche imediata', () => {
  let restore: (() => void) | null = null;
  afterEach(() => { restore?.(); restore = null; });

  it('só participantes de partida recém-concluída pedem revanche, no mesmo tema e sempre Normal', async () => {
    const { themeSlug, users } = await fixture(3);
    const themeId = await themeIdOf(themeSlug);
    const [first, second, outsider] = [userAt(users, 0), userAt(users, 1), userAt(users, 2)];
    const session = await issueRealFirebaseTestToken(first.uid);
    restore = session.restore;
    const auth = { Authorization: `Bearer ${session.token}` };

    const fresh = await finishedMatch(themeId, first.id, second.id, 20_000);
    const accepted = await SELF.fetch(`https://quiz.test/api/social/rematch/${fresh}`, { headers: auth, method: 'POST' });
    expect(accepted.status).toBe(200);
    // Partida de origem é Rankeada, mas a revanche nunca é: Rankeada só na fila pública.
    expect(await accepted.json()).toMatchObject({ mode: 'CASUAL', resource: `${themeId}:CASUAL`, themeSlug });

    const old = await finishedMatch(themeId, first.id, second.id, 4 * 60_000);
    expect((await SELF.fetch(`https://quiz.test/api/social/rematch/${old}`, { headers: auth, method: 'POST' })).status).toBe(409);

    const voided = await finishedMatch(themeId, first.id, second.id, 10_000, 'VOID');
    expect((await SELF.fetch(`https://quiz.test/api/social/rematch/${voided}`, { headers: auth, method: 'POST' })).status).toBe(404);

    const others = await finishedMatch(themeId, second.id, outsider.id, 10_000);
    expect((await SELF.fetch(`https://quiz.test/api/social/rematch/${others}`, { headers: auth, method: 'POST' })).status).toBe(404);

    // Bloqueio: nenhum convite chega a quem bloqueou.
    await env.CORE_DB.prepare('INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (?1, ?2)').bind(second.id, first.id).run();
    const blocked = await finishedMatch(themeId, first.id, second.id, 10_000);
    expect((await SELF.fetch(`https://quiz.test/api/social/rematch/${blocked}`, { headers: auth, method: 'POST' })).status).toBe(404);
  });

  it('a fila privada recusa revanche Rankeada ou de outro tema', async () => {
    const { themeSlug, users } = await fixture(2);
    const themeId = await themeIdOf(themeSlug);
    const [first, second] = [userAt(users, 0), userAt(users, 1)];
    const session = await issueRealFirebaseTestToken(first.uid);
    restore = session.restore;
    const matchId = await finishedMatch(themeId, first.id, second.id, 5_000);
    const resource = `${themeId}:RANKED`;
    const ticket = await SELF.fetch('https://quiz.test/api/realtime/tickets', {
      body: JSON.stringify({ resource, scope: 'matchmaking' }),
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const { ticket: value } = await ticket.json<{ ticket: string }>();
    const params = new URLSearchParams({ rematch: matchId, resource, ticket: value });
    const response = await SELF.fetch(`https://quiz.test/api/realtime/matchmaking?${params}`, { headers: { Upgrade: 'websocket' } });
    expect(response.status).toBe(400);
  });
});
