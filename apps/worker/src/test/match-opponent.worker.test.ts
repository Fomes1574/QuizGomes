import { env, SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { issueRealFirebaseTestToken } from './firebase-test-token.js';

async function seed(prefix: string): Promise<{ matchId: string; outsiderUid: string; uids: [string, string]; userIds: [string, string] }> {
  const userIds: [string, string] = [`${prefix}-u1`, `${prefix}-u2`];
  const uids: [string, string] = [`${prefix}-f1`, `${prefix}-f2`];
  const outsiderId = `${prefix}-u3`;
  const outsiderUid = `${prefix}-f3`;
  const themeId = `${prefix}-theme`;
  const matchId = crypto.randomUUID();
  await env.CORE_DB.batch([
    env.CORE_DB.prepare('INSERT INTO categories (id, slug, name, sort_order) VALUES (?1, ?1, ?2, 999)').bind(`${prefix}-cat`, `Cat ${prefix}`),
    env.CORE_DB.prepare(
      `INSERT INTO themes (id, category_id, slug, name, description, status, origin, question_shard_id)
       VALUES (?1, ?2, ?1, ?3, 'x', 'ACTIVE', 'OFFICIAL', 'questions-01')`,
    ).bind(themeId, `${prefix}-cat`, `Tema ${prefix}`),
    ...[...userIds.map((id, index) => [id, uids[index] as string] as const), [outsiderId, outsiderUid] as const].flatMap(([id, uid], index) => [
      env.CORE_DB.prepare('INSERT INTO users (id, firebase_uid) VALUES (?1, ?2)').bind(id, uid),
      env.CORE_DB.prepare('INSERT INTO user_profiles (user_id, public_id, display_name) VALUES (?1, ?2, ?3)')
        .bind(id, `#QG${prefix.replaceAll('-', '').toUpperCase().slice(0, 6)}${index}`, `Jogador ${index}`),
    ]),
    env.CORE_DB.prepare(
      `INSERT INTO matches (id, theme_id, difficulty, mode, kind, status, question_shard_id)
       VALUES (?1, ?2, 'MEDIUM', 'CASUAL', 'MATCHMAKING', 'FINISHED', 'questions-01')`,
    ).bind(matchId, themeId),
    env.CORE_DB.prepare('INSERT INTO match_players (match_id, user_id, seat, score) VALUES (?1, ?2, 1, 10), (?1, ?3, 2, 5)')
      .bind(matchId, userIds[0], userIds[1]),
  ]);
  return { matchId, outsiderUid, uids, userIds };
}

describe('pedido de amizade ao adversário da partida', () => {
  let restore: (() => void) | null = null;
  afterEach(() => { restore?.(); restore = null; });

  it('descobre o adversário pela partida e nega quem não jogou nela', async () => {
    const prefix = `mo-${crypto.randomUUID().slice(0, 6)}`;
    const fixture = await seed(prefix);
    const outsider = await issueRealFirebaseTestToken(fixture.outsiderUid);
    restore = outsider.restore;
    const denied = await SELF.fetch(`https://quiz.test/api/social/match-opponent/${fixture.matchId}`, {
      headers: { Authorization: `Bearer ${outsider.token}` },
      method: 'POST',
    });
    expect(denied.status).toBe(404);
    outsider.restore();

    const player = await issueRealFirebaseTestToken(fixture.uids[0]);
    restore = player.restore;
    const auth = { Authorization: `Bearer ${player.token}` };
    const before = await SELF.fetch(`https://quiz.test/api/social/match-opponent/${fixture.matchId}`, { headers: auth });
    expect(await before.json()).toEqual({ status: 'NONE' });
    const sent = await SELF.fetch(`https://quiz.test/api/social/match-opponent/${fixture.matchId}`, { headers: auth, method: 'POST' });
    expect(sent.status).toBe(201);
    expect(await sent.json()).toEqual({ status: 'SENT' });
    const repeated = await SELF.fetch(`https://quiz.test/api/social/match-opponent/${fixture.matchId}`, { headers: auth, method: 'POST' });
    expect(repeated.status).toBe(200);
    const requests = await env.CORE_DB.prepare(
      "SELECT sender_user_id, recipient_user_id FROM friend_requests WHERE sender_user_id = ?1 AND status = 'PENDING'",
    ).bind(fixture.userIds[0]).all();
    expect(requests.results).toEqual([{ recipient_user_id: fixture.userIds[1], sender_user_id: fixture.userIds[0] }]);
  });
});
