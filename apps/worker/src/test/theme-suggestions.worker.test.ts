import { env, SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { issueRealFirebaseTestToken } from './firebase-test-token.js';

describe('votação "Qual tema você quer ver?"', () => {
  let restore: (() => void) | null = null;
  let adminUserId: string | null = null;
  afterEach(async () => {
    restore?.();
    restore = null;
    if (adminUserId !== null) {
      await env.CORE_DB.prepare('DELETE FROM user_roles WHERE user_id = ?1').bind(adminUserId).run();
      await env.CORE_DB.prepare('DELETE FROM audit_logs WHERE actor_user_id = ?1').bind(adminUserId).run();
      adminUserId = null;
    }
  });

  it('ADMIN cria candidato; jogador vota uma vez, desfaz e não vota em candidato encerrado', async () => {
    const prefix = `ts-${crypto.randomUUID().slice(0, 6)}`;
    adminUserId = `${prefix}-admin`;
    const playerId = `${prefix}-player`;
    await env.CORE_DB.batch([
      ...[[adminUserId, `${prefix}-fa`, 0], [playerId, `${prefix}-fp`, 1]].flatMap(([id, uid, index]) => [
        env.CORE_DB.prepare('INSERT INTO users (id, firebase_uid) VALUES (?1, ?2)').bind(id, uid),
        env.CORE_DB.prepare('INSERT INTO user_profiles (user_id, public_id, display_name) VALUES (?1, ?2, ?3)')
          .bind(id, `#QT${prefix.replaceAll('-', '').toUpperCase().slice(0, 6)}${index}`, `Pessoa ${index}`),
      ]),
      env.CORE_DB.prepare("INSERT INTO user_roles (user_id, role) VALUES (?1, 'ADMIN')").bind(adminUserId),
    ]);

    const player = await issueRealFirebaseTestToken(`${prefix}-fp`);
    restore = player.restore;
    const forbidden = await SELF.fetch('https://quiz.test/api/admin/theme-suggestions', {
      body: JSON.stringify({ name: 'Tentativa' }), headers: { Authorization: `Bearer ${player.token}`, 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect(forbidden.status).toBe(403);
    player.restore();

    const admin = await issueRealFirebaseTestToken(`${prefix}-fa`);
    restore = admin.restore;
    const created = await SELF.fetch('https://quiz.test/api/admin/theme-suggestions', {
      body: JSON.stringify({ description: 'Cavaleiros e dragões', name: `Tema ${prefix}` }),
      headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
      method: 'POST',
    });
    expect(created.status).toBe(201);
    const { suggestion } = await created.json<{ suggestion: { id: string } }>();
    admin.restore();

    const voter = await issueRealFirebaseTestToken(`${prefix}-fp`);
    restore = voter.restore;
    const auth = { Authorization: `Bearer ${voter.token}` };
    const voteUrl = `https://quiz.test/api/theme-suggestions/${suggestion.id}/vote`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const voted = await SELF.fetch(voteUrl, { headers: auth, method: 'PUT' });
      expect(await voted.json()).toMatchObject({ suggestion: { voteCount: 1, voted: true } });
    }
    const listed = await SELF.fetch('https://quiz.test/api/theme-suggestions', { headers: auth });
    const list = await listed.json<{ suggestions: Array<{ id: string; voted: boolean }> }>();
    expect(list.suggestions.find((item) => item.id === suggestion.id)).toMatchObject({ voted: true });
    const undone = await SELF.fetch(voteUrl, { headers: auth, method: 'DELETE' });
    expect(await undone.json()).toMatchObject({ suggestion: { voteCount: 0, voted: false } });

    await env.CORE_DB.prepare("UPDATE theme_suggestions SET status = 'CLOSED' WHERE id = ?1").bind(suggestion.id).run();
    const closed = await SELF.fetch(voteUrl, { headers: auth, method: 'PUT' });
    expect(closed.status).toBe(409);
    expect(await env.CORE_DB.prepare('SELECT COUNT(*) AS total FROM theme_suggestion_votes WHERE suggestion_id = ?1')
      .bind(suggestion.id).first()).toEqual({ total: 0 });

    const anonymous = await SELF.fetch('https://quiz.test/api/theme-suggestions');
    expect(anonymous.status).toBe(200);
  });
});
