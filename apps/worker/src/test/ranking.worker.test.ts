import { env, SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { RankingRepository } from '../repositories/ranking-repository.js';
import { SocialRepository } from '../repositories/social-repository.js';
import { playerProfile } from '../services/player-profile-service.js';
import { issueRealFirebaseTestToken } from './firebase-test-token.js';
import { befriend, fixture, themeIdOf, userAt, type FixtureUser } from './challenge-fixture.worker.js';

async function rank(user: FixtureUser, themeId: string, knowledge: number): Promise<void> {
  await env.CORE_DB.prepare(
    `INSERT INTO theme_rankings (user_id, theme_id, knowledge, ranked_matches, wins)
     VALUES (?1, ?2, ?3, 3, 2)
     ON CONFLICT (user_id, theme_id) DO UPDATE SET knowledge = ?3`,
  ).bind(user.id, themeId, knowledge).run();
}

async function block(blocker: FixtureUser, blocked: FixtureUser): Promise<void> {
  await env.CORE_DB.prepare('INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (?1, ?2)')
    .bind(blocker.id, blocked.id).run();
}

describe('Ranking do tema', () => {
  it('ordena por Conhecimento, divide empate, esconde bloqueio sem renumerar e ignora zerados', async () => {
    const { themeSlug, users } = await fixture(6);
    const themeId = await themeIdOf(themeSlug);
    const [a, b, c, d, e, f] = [0, 1, 2, 3, 4, 5].map((index) => userAt(users, index)) as [
      FixtureUser, FixtureUser, FixtureUser, FixtureUser, FixtureUser, FixtureUser,
    ];
    await rank(a, themeId, 900);
    await rank(b, themeId, 700);
    await rank(c, themeId, 700);
    await rank(d, themeId, 300);
    await rank(e, themeId, 0);
    await env.CORE_DB.prepare('UPDATE users SET disabled_at = CURRENT_TIMESTAMP WHERE id = ?1').bind(f.id).run();
    await rank(f, themeId, 5_000);

    const repository = new RankingRepository(env.CORE_DB);
    const open = await repository.leaderboard(themeId, null);
    expect(open.map((entry) => [entry.publicId, entry.position])).toEqual([
      [a.publicId, 1], [b.publicId, 2], [c.publicId, 2], [d.publicId, 4],
    ]);

    await block(b, d); // d foi bloqueado por b: os dois somem um para o outro.
    const seenByD = await repository.leaderboard(themeId, d.id);
    expect(seenByD.map((entry) => [entry.publicId, entry.position, entry.self])).toEqual([
      [a.publicId, 1, false], [c.publicId, 2, false], [d.publicId, 4, true],
    ]);
  });

  it('fora do Top mostra a própria posição com dois vizinhos de cada lado', async () => {
    const { themeSlug, users } = await fixture(8);
    const themeId = await themeIdOf(themeSlug);
    const people = users.map((_, index) => userAt(users, index));
    for (const [index, person] of people.entries()) await rank(person, themeId, 1_000 - index * 100);
    const repository = new RankingRepository(env.CORE_DB);

    const target = people[5] as FixtureUser; // 6º lugar
    const around = await repository.around(themeId, target.id);
    expect(around?.entries.map((entry) => [entry.position, entry.self])).toEqual([
      [4, false], [5, false], [6, true], [7, false], [8, false],
    ]);
    expect(around?.positionCapped).toBe(false);
    expect(await repository.leaderboard(themeId, null, 3)).toHaveLength(3);
    expect(await repository.around(themeId, 'ninguem')).toBeNull();
  });

  it('ranking entre amigos inclui só amigos e a própria pessoa', async () => {
    const { themeSlug, users } = await fixture(4);
    const themeId = await themeIdOf(themeSlug);
    const [me, friend, stranger, quiet] = [0, 1, 2, 3].map((index) => userAt(users, index)) as [FixtureUser, FixtureUser, FixtureUser, FixtureUser];
    await befriend(me, friend);
    await befriend(me, quiet);
    await rank(me, themeId, 400);
    await rank(friend, themeId, 800);
    await rank(stranger, themeId, 2_000);
    const entries = await new RankingRepository(env.CORE_DB).friends(themeId, me.id);
    expect(entries.map((entry) => [entry.publicId, entry.position, entry.self])).toEqual([
      [friend.publicId, 1, false], [me.publicId, 2, true],
    ]);
  });
});

describe('Perfil de outro jogador', () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it('mostra nível, temas, relação e a comparação; bloqueio vira "não encontrado"', async () => {
    const { themeSlug, users } = await fixture(3);
    const themeId = await themeIdOf(themeSlug);
    const [me, other, blocker] = [0, 1, 2].map((index) => userAt(users, index)) as [FixtureUser, FixtureUser, FixtureUser];
    await rank(me, themeId, 400);
    await rank(other, themeId, 1_300);
    await env.CORE_DB.prepare('UPDATE user_profiles SET total_xp = 5000 WHERE user_id = ?1').bind(other.id).run();
    await new SocialRepository(env.CORE_DB).sendRequest(me.id, other.publicId);

    const view = await playerProfile(env, { publicId: me.publicId, userId: me.id }, other.publicId);
    expect(view.relationship).toBe('OUTGOING');
    expect(view.player.publicId).toBe(other.publicId);
    expect(view.player.level).toBeGreaterThan(1);
    expect(view.themes).toEqual([expect.objectContaining({ knowledge: 1_300, slug: themeSlug })]);
    expect(view.comparison).toEqual([expect.objectContaining({ mine: 400, slug: themeSlug, theirs: 1_300 })]);
    expect(view.ranked).toEqual({ draws: 0, losses: 0, matches: 3, wins: 2 });
    // O ID interno nunca sai; só o público.
    expect(view.player).not.toHaveProperty('userId');

    const mine = await playerProfile(env, { publicId: me.publicId, userId: me.id }, me.publicId);
    expect(mine.relationship).toBe('SELF');
    expect(mine.comparison).toEqual([]);

    await block(blocker, me);
    await expect(playerProfile(env, { publicId: me.publicId, userId: me.id }, blocker.publicId))
      .rejects.toMatchObject({ code: 'PLAYER_NOT_FOUND', status: 404 });
    await expect(playerProfile(env, { publicId: me.publicId, userId: me.id }, '#QGNAOEXISTE'))
      .rejects.toMatchObject({ code: 'PLAYER_NOT_FOUND' });
    await expect(playerProfile(env, { publicId: me.publicId, userId: me.id }, 'lixo'))
      .rejects.toMatchObject({ code: 'PLAYER_NOT_FOUND' });
  });

  it('a rota exige login e o ranking de amigos também', async () => {
    const { themeSlug } = await fixture(0);
    expect((await SELF.fetch('https://quiz.test/api/players/QGQUALQUER1')).status).toBe(401);
    expect((await SELF.fetch(`https://quiz.test/api/themes/${themeSlug}/ranking?scope=friends`)).status).toBe(401);
    const open = await SELF.fetch(`https://quiz.test/api/themes/${themeSlug}/ranking`);
    expect(open.status).toBe(200);
    expect(await open.json()).toMatchObject({ around: null, entries: [], scope: 'top' });

    const uid = `perfil-${crypto.randomUUID().slice(0, 8)}`;
    const session = await issueRealFirebaseTestToken(uid);
    restore = session.restore;
    const auth = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
    await SELF.fetch('https://quiz.test/api/profile/me', { body: JSON.stringify({ displayName: 'Visita Boa' }), headers: auth, method: 'POST' });
    expect((await SELF.fetch('https://quiz.test/api/players/QGNAOEXISTE9', { headers: auth })).status).toBe(404);
    const friends = await SELF.fetch(`https://quiz.test/api/themes/${themeSlug}/ranking?scope=friends`, { headers: auth });
    expect(friends.status).toBe(200);
  });
});
