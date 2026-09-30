import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { UserRepository } from '../repositories/user-repository.js';
import { fixture, userAt } from './challenge-fixture.worker.js';
import { issueRealFirebaseTestToken } from './firebase-test-token.js';

/** Amizade sintética entre dois usuários da fixture. */
async function befriend(a: string, b: string): Promise<void> {
  const [low, high] = a < b ? [a, b] : [b, a];
  await env.CORE_DB.prepare('INSERT OR IGNORE INTO friendships (user_low_id, user_high_id) VALUES (?1, ?2)').bind(low, high).run();
}

describe('excluir conta (LGPD)', () => {
  it('apaga dados de contato e ranking, anonimiza o perfil e desfaz o vínculo com o Google', async () => {
    const { users } = await fixture(2);
    const person = userAt(users, 0);
    const friend = userAt(users, 1);
    await befriend(person.id, friend.id);
    const theme = await env.CORE_DB.prepare('SELECT id FROM themes LIMIT 1').first<{ id: string }>();
    await env.CORE_DB.prepare('INSERT INTO theme_rankings (theme_id, user_id, knowledge) VALUES (?1, ?2, 1200)')
      .bind(theme?.id, person.id).run();
    await env.CORE_DB.prepare('INSERT INTO push_installations (installation_id, user_id) VALUES (?1, ?2)')
      .bind(`sintetico-${crypto.randomUUID()}`, person.id).run();

    const repository = new UserRepository(env.CORE_DB);
    await expect(repository.deleteAccount(person.uid, env.QUESTION_IMAGES)).resolves.toBe('DELETED');

    const profile = await env.CORE_DB.prepare('SELECT display_name, photo_url, public_id FROM user_profiles WHERE user_id = ?1')
      .bind(person.id).first<{ display_name: string; photo_url: string | null; public_id: string }>();
    expect(profile).toMatchObject({ display_name: 'Jogador removido', photo_url: null });
    expect(profile?.public_id).not.toBe(person.publicId);
    const user = await env.CORE_DB.prepare('SELECT firebase_uid, disabled_at FROM users WHERE id = ?1')
      .bind(person.id).first<{ disabled_at: string | null; firebase_uid: string }>();
    expect(user?.firebase_uid).toBe(`deleted:${person.id}`);
    expect(user?.disabled_at).not.toBeNull();

    for (const [table, where] of [
      ['friendships', 'user_low_id = ?1 OR user_high_id = ?1'],
      ['theme_rankings', 'user_id = ?1'],
      ['push_installations', 'user_id = ?1'],
    ] as const) {
      const row = await env.CORE_DB.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${where}`).bind(person.id).first<{ total: number }>();
      expect(row?.total, table).toBe(0);
    }
    // O Google antigo não acha mais a conta: entrar de novo começa do zero.
    expect(await repository.findByFirebaseUid(person.uid)).toBeNull();
    await expect(repository.deleteAccount(person.uid, env.QUESTION_IMAGES)).resolves.toBe('NOT_FOUND');
    // O amigo continua intacto.
    expect(await repository.findByFirebaseUid(friend.uid)).not.toBeNull();
  });

  it('recusa ADMIN e quem está numa partida ao vivo', async () => {
    const { users } = await fixture(2);
    const admin = userAt(users, 0);
    const player = userAt(users, 1);
    const repository = new UserRepository(env.CORE_DB);
    await env.CORE_DB.prepare("INSERT INTO user_roles (user_id, role) VALUES (?1, 'ADMIN')").bind(admin.id).run();
    try {
      await expect(repository.deleteAccount(admin.uid, env.QUESTION_IMAGES)).resolves.toBe('IS_ADMIN');
    } finally {
      await env.CORE_DB.prepare("DELETE FROM user_roles WHERE user_id = ?1 AND role = 'ADMIN'").bind(admin.id).run();
    }

    const theme = await env.CORE_DB.prepare('SELECT id FROM themes LIMIT 1').first<{ id: string }>();
    const matchId = crypto.randomUUID();
    await env.CORE_DB.batch([
      env.CORE_DB.prepare(
        `INSERT INTO matches (id, theme_id, difficulty, mode, kind, status, question_shard_id)
         VALUES (?1, ?2, 'MEDIUM', 'CASUAL', 'MATCHMAKING', 'PLAYING', 'questions-01')`,
      ).bind(matchId, theme?.id),
      env.CORE_DB.prepare('INSERT INTO active_match_players (user_id, match_id) VALUES (?1, ?2)').bind(player.id, matchId),
    ]);
    await expect(repository.deleteAccount(player.uid, env.QUESTION_IMAGES)).resolves.toBe('PLAYING');
    await env.CORE_DB.prepare('DELETE FROM active_match_players WHERE user_id = ?1').bind(player.id).run();
    await expect(repository.deleteAccount(player.uid, env.QUESTION_IMAGES)).resolves.toBe('DELETED');
  });

  it('a rota exige login e a palavra EXCLUIR', async () => {
    const anonymous = await SELF.fetch('https://quiz.test/api/profile/account', {
      body: JSON.stringify({ confirmation: 'EXCLUIR' }), headers: { 'Content-Type': 'application/json' }, method: 'DELETE',
    });
    expect(anonymous.status).toBe(401);

    const { users } = await fixture(1);
    const person = userAt(users, 0);
    const { restore, token } = await issueRealFirebaseTestToken(person.uid);
    try {
      const unconfirmed = await SELF.fetch('https://quiz.test/api/profile/account', {
        body: JSON.stringify({ confirmation: 'sim' }),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        method: 'DELETE',
      });
      expect(unconfirmed.status).toBe(400);
      expect(await new UserRepository(env.CORE_DB).findByFirebaseUid(person.uid)).not.toBeNull();

      const confirmed = await SELF.fetch('https://quiz.test/api/profile/account', {
        body: JSON.stringify({ confirmation: 'EXCLUIR' }),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        method: 'DELETE',
      });
      expect(confirmed.status).toBe(200);
      expect(await new UserRepository(env.CORE_DB).findByFirebaseUid(person.uid)).toBeNull();
    } finally {
      restore();
    }
  });
});
