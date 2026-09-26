import { env, SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { issueRealFirebaseTestToken } from './firebase-test-token.js';

describe('perfil: conta desativada e nome', () => {
  let restore: (() => void) | null = null;
  afterEach(() => { restore?.(); restore = null; });

  it('conta desativada recebe ACCOUNT_DISABLED, nunca "perfil não criado"', async () => {
    const uid = `disabled-${crypto.randomUUID().slice(0, 8)}`;
    await env.CORE_DB.prepare('INSERT INTO users (id, firebase_uid, disabled_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)')
      .bind(`${uid}-id`, uid).run();
    const session = await issueRealFirebaseTestToken(uid);
    restore = session.restore;
    const auth = { Authorization: `Bearer ${session.token}` };
    const read = await SELF.fetch('https://quiz.test/api/profile/me', { headers: auth });
    expect(read.status).toBe(403);
    expect(await read.json()).toMatchObject({ error: { code: 'ACCOUNT_DISABLED' } });
    const create = await SELF.fetch('https://quiz.test/api/profile/me', {
      body: JSON.stringify({ displayName: 'Novo Nome' }),
      headers: { ...auth, 'Content-Type': 'application/json' },
      method: 'POST',
    });
    expect(create.status).toBe(403);
  });

  it('cria perfil com nome normalizado e recusa nome invisível', async () => {
    const uid = `name-${crypto.randomUUID().slice(0, 8)}`;
    const session = await issueRealFirebaseTestToken(uid);
    restore = session.restore;
    const post = (displayName: string) => SELF.fetch('https://quiz.test/api/profile/me', {
      body: JSON.stringify({ displayName }),
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      method: 'POST',
    });
    expect((await post('​​​')).status).toBe(400);
    const created = await post('  Ana    Luiza ');
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ profile: { displayName: 'Ana Luiza' } });
  });
});
