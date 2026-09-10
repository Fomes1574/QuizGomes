import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { ChallengeRepository } from '../repositories/challenge-repository.js';
import { SocialRepository } from '../repositories/social-repository.js';

interface FixtureUser {
  id: string;
  publicId: string;
  uid: string;
}

let sequence = 0;

async function fixture(count: number): Promise<{ themeSlug: string; users: FixtureUser[] }> {
  sequence += 1;
  const prefix = `chal${sequence}`;
  const users = Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-user-${index}`,
    publicId: `#QG${prefix.toUpperCase()}${index}`,
    uid: `${prefix}-firebase-${index}`,
  }));
  const themeId = `${prefix}-theme`;
  const themeSlug = `${prefix}-theme`;
  await env.CORE_DB.batch([
    env.CORE_DB.prepare(
      `INSERT OR IGNORE INTO categories (id, slug, name, sort_order)
       VALUES ('challenge-category', 'challenge-category', 'Categoria de desafio', 998)`,
    ),
    ...users.flatMap((user) => [
      env.CORE_DB.prepare('INSERT INTO users (id, firebase_uid) VALUES (?1, ?2)').bind(user.id, user.uid),
      env.CORE_DB.prepare(
        'INSERT INTO user_profiles (user_id, public_id, display_name) VALUES (?1, ?2, ?3)',
      ).bind(user.id, user.publicId, `Jogador ${user.id}`),
    ]),
    env.CORE_DB.prepare(
      `INSERT INTO themes
        (id, category_id, slug, name, description, status, origin, question_shard_id, active_question_count)
       VALUES (?1, 'challenge-category', ?2, ?3, 'Fixture.', 'ACTIVE', 'OFFICIAL', 'questions-01', 40)`,
    ).bind(themeId, themeSlug, `Tema ${prefix}`),
  ]);
  return { themeSlug, users };
}

function userAt(users: FixtureUser[], index: number): FixtureUser {
  const user = users[index];
  if (user === undefined) throw new Error('Fixture de desafio incompleta.');
  return user;
}

async function befriend(first: FixtureUser, second: FixtureUser): Promise<void> {
  const social = new SocialRepository(env.CORE_DB);
  const request = await social.sendRequest(first.id, second.publicId);
  await social.acceptRequest(second.id, request.requestId);
}

async function themeIdOf(slug: string): Promise<string> {
  const row = await env.CORE_DB.prepare('SELECT id FROM themes WHERE slug = ?1').bind(slug).first<{ id: string }>();
  if (row === null) throw new Error('Tema ausente.');
  return row.id;
}

describe('M9C+M10 — desafios entre amigos no runtime Workers/D1', () => {
  it('exige amizade e recusa alvo bloqueado ou desconhecido', async () => {
    const { users } = await fixture(3);
    const challenger = userAt(users, 0);
    const stranger = userAt(users, 1);
    const blockedFriend = userAt(users, 2);
    const repository = new ChallengeRepository(env.CORE_DB);

    await expect(repository.friendTarget(challenger.id, stranger.publicId)).rejects.toMatchObject({
      code: 'USER_UNAVAILABLE', status: 404,
    });

    await befriend(challenger, blockedFriend);
    await expect(repository.friendTarget(challenger.id, blockedFriend.publicId)).resolves.toBe(blockedFriend.id);
    await new SocialRepository(env.CORE_DB).block(challenger.id, blockedFriend.publicId);
    await expect(repository.friendTarget(challenger.id, blockedFriend.publicId)).rejects.toMatchObject({
      code: 'USER_UNAVAILABLE', status: 404,
    });
  });

  it('"Desafiar agora" só vale para amigo Online; "Desafiar depois" aceita qualquer presença', async () => {
    const { themeSlug, users } = await fixture(2);
    const challenger = userAt(users, 0);
    const friend = userAt(users, 1);
    await befriend(challenger, friend);
    const repository = new ChallengeRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);

    for (const presence of ['OFFLINE', 'MATCHMAKING', 'IN_MATCH', 'RECONNECTING'] as const) {
      await expect(repository.create({
        actorUserId: challenger.id,
        difficulty: 'EASY',
        kind: 'DIRECT',
        targetPresence: presence,
        targetUserId: friend.id,
        themeId,
      })).rejects.toMatchObject({ code: 'FRIEND_UNAVAILABLE', status: 409 });
    }

    const async = await repository.create({
      actorUserId: challenger.id,
      difficulty: 'HARD',
      kind: 'ASYNC',
      targetPresence: 'OFFLINE',
      targetUserId: friend.id,
      themeId,
    });
    expect(async.created).toBe(true);
    const stored = await repository.byId(async.challengeId);
    expect(stored?.status).toBe('FIRST_PLAYER_ACTIVE');
    expect(stored?.expiresAtMs).toBeNull();
  });

  it('mantém no máximo um desafio por dupla e libera terceiros', async () => {
    const { themeSlug, users } = await fixture(3);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    const third = userAt(users, 2);
    await befriend(first, second);
    await befriend(first, third);
    await befriend(second, third);
    const repository = new ChallengeRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);
    const base = { difficulty: 'EASY', kind: 'ASYNC', targetPresence: 'ONLINE', themeId } as const;

    const created = await repository.create({ ...base, actorUserId: first.id, targetUserId: second.id });
    expect(created.created).toBe(true);

    // O mesmo desafiante não abre um segundo desafio para a mesma pessoa.
    await expect(repository.create({ ...base, actorUserId: first.id, targetUserId: second.id }))
      .rejects.toMatchObject({ code: 'CHALLENGE_ALREADY_ACTIVE', status: 409 });

    // O cruzado vira concordância, sem criar registro novo e sem trocar o primeiro jogador.
    const crossed = await repository.create({ ...base, actorUserId: second.id, targetUserId: first.id });
    expect(crossed.created).toBe(false);
    expect(crossed.challengeId).toBe(created.challengeId);
    const agreed = await repository.byId(created.challengeId);
    expect(agreed?.secondPlayerAgreed).toBe(true);
    expect(agreed?.firstPlayerUserId).toBe(first.id);

    // Outras duplas continuam livres.
    await expect(repository.create({ ...base, actorUserId: first.id, targetUserId: third.id }))
      .resolves.toMatchObject({ created: true });
    await expect(repository.create({ ...base, actorUserId: second.id, targetUserId: third.id }))
      .resolves.toMatchObject({ created: true });
  });

  it('cancelamento e recusa são idempotentes por CAS e limpam o payload competitivo', async () => {
    const { themeSlug, users } = await fixture(2);
    const challenger = userAt(users, 0);
    const friend = userAt(users, 1);
    await befriend(challenger, friend);
    const repository = new ChallengeRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);
    const created = await repository.create({
      actorUserId: challenger.id,
      difficulty: 'EASY',
      kind: 'ASYNC',
      targetPresence: 'ONLINE',
      targetUserId: friend.id,
      themeId,
    });
    await env.CORE_DB.batch([
      env.CORE_DB.prepare(
        `INSERT INTO challenge_questions
          (challenge_id, round_number, question_id, pool_slot, public_snapshot_json, correct_option)
         VALUES (?1, 1, 'q-1', 1, '{}', 0)`,
      ).bind(created.challengeId),
      env.CORE_DB.prepare(
        `INSERT INTO challenge_answers
          (challenge_id, round_number, user_id, selected_option, remaining_ms, is_correct, score)
         VALUES (?1, 1, ?2, 0, 8000, 1, 18)`,
      ).bind(created.challengeId, challenger.id),
    ]);

    const record = await repository.byId(created.challengeId);
    if (record === null) throw new Error('Desafio ausente.');
    expect(await repository.applyAction(record, { actorUserId: challenger.id, type: 'CANCEL' })).toBe(true);
    // Retry, double tap ou outra aba com a mesma revisão não reaplica nada: o CAS recusa.
    expect(await repository.applyAction(record, { actorUserId: challenger.id, type: 'CANCEL' })).toBe(false);
    // Relendo o estado já encerrado, a regra recusa antes mesmo de tocar o banco.
    const settled = await repository.byId(created.challengeId);
    if (settled === null) throw new Error('Desafio ausente.');
    await expect(repository.applyAction(settled, { actorUserId: challenger.id, type: 'CANCEL' }))
      .rejects.toMatchObject({ code: 'CHALLENGE_NOT_ACTIVE' });

    expect(await repository.byId(created.challengeId)).toMatchObject({ status: 'CANCELLED' });
    expect(await env.CORE_DB.prepare(
      'SELECT COUNT(*) AS total FROM challenge_questions WHERE challenge_id = ?1',
    ).bind(created.challengeId).first()).toEqual({ total: 0 });
    expect(await env.CORE_DB.prepare(
      'SELECT COUNT(*) AS total FROM challenge_answers WHERE challenge_id = ?1',
    ).bind(created.challengeId).first()).toEqual({ total: 0 });
    // A dupla volta a aceitar desafio depois do encerramento.
    await expect(repository.create({
      actorUserId: challenger.id,
      difficulty: 'EASY',
      kind: 'ASYNC',
      targetPresence: 'ONLINE',
      targetUserId: friend.id,
      themeId,
    })).resolves.toMatchObject({ created: true });
  });

  it('expira o convite direto em 30 s sem tratar como recusa e libera novo desafio', async () => {
    const { themeSlug, users } = await fixture(2);
    const challenger = userAt(users, 0);
    const friend = userAt(users, 1);
    await befriend(challenger, friend);
    const themeId = await themeIdOf(themeSlug);
    let now = Date.parse('2026-09-10T12:00:00.000Z');
    const repository = new ChallengeRepository(env.CORE_DB, () => new Date(now));
    const created = await repository.create({
      actorUserId: challenger.id,
      difficulty: 'EASY',
      kind: 'DIRECT',
      targetPresence: 'ONLINE',
      targetUserId: friend.id,
      themeId,
    });

    expect(await repository.forUser(friend.id, now)).toHaveLength(1);
    now += 29_999;
    expect(await repository.expireStaleDirect()).toEqual([]);
    expect(await repository.forUser(friend.id, now)).toHaveLength(1);

    now += 1;
    // Vencido some da lista mesmo antes da varredura.
    expect(await repository.forUser(friend.id, now)).toEqual([]);
    expect(await repository.expireStaleDirect()).toEqual([created.challengeId]);
    expect(await repository.byId(created.challengeId)).toMatchObject({ status: 'EXPIRED' });

    const again = await repository.create({
      actorUserId: challenger.id,
      difficulty: 'EASY',
      kind: 'DIRECT',
      targetPresence: 'ONLINE',
      targetUserId: friend.id,
      themeId,
    });
    expect(again.created).toBe(true);
  });

  it('desfazer amizade e bloquear encerram o desafio pendente sem gerar resultado', async () => {
    for (const mode of ['unfriend', 'block'] as const) {
      const { themeSlug, users } = await fixture(2);
      const challenger = userAt(users, 0);
      const friend = userAt(users, 1);
      await befriend(challenger, friend);
      const repository = new ChallengeRepository(env.CORE_DB);
      const social = new SocialRepository(env.CORE_DB);
      const created = await repository.create({
        actorUserId: challenger.id,
        difficulty: 'MEDIUM',
        kind: 'ASYNC',
        targetPresence: 'ONLINE',
        targetUserId: friend.id,
        themeId: await themeIdOf(themeSlug),
      });

      if (mode === 'unfriend') await social.removeFriend(challenger.id, friend.publicId);
      else await social.block(challenger.id, friend.publicId);
      await repository.endForRelationship(challenger.id, friend.id);

      expect(await repository.byId(created.challengeId), mode).toMatchObject({ status: 'CANCELLED' });
      expect(await env.CORE_DB.prepare(
        'SELECT COUNT(*) AS total FROM result_ledger WHERE match_id = ?1',
      ).bind(created.challengeId).first(), mode).toEqual({ total: 0 });
    }
  });

  it('partida já iniciada sobrevive a desfazer amizade e a bloqueio', async () => {
    const { themeSlug, users } = await fixture(2);
    const challenger = userAt(users, 0);
    const friend = userAt(users, 1);
    await befriend(challenger, friend);
    const repository = new ChallengeRepository(env.CORE_DB);
    const created = await repository.create({
      actorUserId: challenger.id,
      difficulty: 'MEDIUM',
      kind: 'ASYNC',
      targetPresence: 'ONLINE',
      targetUserId: friend.id,
      themeId: await themeIdOf(themeSlug),
    });
    await env.CORE_DB.prepare(
      "UPDATE challenges SET status = 'SECOND_PLAYER_ACTIVE' WHERE id = ?1",
    ).bind(created.challengeId).run();

    await repository.endForRelationship(challenger.id, friend.id);
    expect(await repository.byId(created.challengeId)).toMatchObject({ status: 'SECOND_PLAYER_ACTIVE' });
  });

  it('todas as rotas de desafio exigem autenticação e não aceitam identidade arbitrária', async () => {
    const requests: Array<[string, RequestInit]> = [
      ['/api/challenges', {}],
      ['/api/challenges', {
        body: JSON.stringify({ difficulty: 'EASY', kind: 'DIRECT', publicId: '#QGFAKE123', themeSlug: 'x' }),
        headers: { 'Content-Type': 'application/json', 'X-User-Id': 'arbitrary' },
        method: 'POST',
      }],
      [`/api/challenges/${crypto.randomUUID()}/accept`, {
        headers: { 'X-User-Id': 'arbitrary' },
        method: 'POST',
      }],
    ];
    for (const [path, options] of requests) {
      const response = await SELF.fetch(`https://quiz.test${path}`, options);
      expect(response.status, path).toBe(401);
      expect(response.headers.get('Cache-Control'), path).toBe('no-store');
    }
  });
});
