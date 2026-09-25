import { env, SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { issueRealFirebaseTestToken } from './firebase-test-token.js';

const SYNTHETIC_512_WEBP = 'UklGRh4CAABXRUJQVlA4IBICAACQOgCdASoAAgACPmEwlkikIyIhIAgAgAwJaW7hd2Ee3AAAE9gHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPWAAA/v+qC//+tTIx9GL//+0s/+pZ/9Sz/FQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

function webp(): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(SYNTHETIC_512_WEBP), (character) => character.charCodeAt(0));
}

async function seed(prefix: string): Promise<{ adminUid: string; adminUserId: string; playerUid: string; questionId: string }> {
  const adminUserId = `${prefix}-admin`;
  const playerUserId = `${prefix}-player`;
  const poolId = `${prefix}-theme:pool`;
  const questionId = crypto.randomUUID();
  await env.CORE_DB.batch([
    ...[[adminUserId, `${prefix}-fa`, 0], [playerUserId, `${prefix}-fp`, 1]].flatMap(([id, uid, index]) => [
      env.CORE_DB.prepare('INSERT INTO users (id, firebase_uid) VALUES (?1, ?2)').bind(id, uid),
      env.CORE_DB.prepare('INSERT INTO user_profiles (user_id, public_id, display_name) VALUES (?1, ?2, ?3)')
        .bind(id, `#QI${prefix.replaceAll('-', '').toUpperCase().slice(0, 6)}${index}`, `Pessoa ${index}`),
    ]),
    env.CORE_DB.prepare("INSERT INTO user_roles (user_id, role) VALUES (?1, 'ADMIN')").bind(adminUserId),
  ]);
  await env.QUESTIONS_DB.batch([
    env.QUESTIONS_DB.prepare("INSERT INTO question_pools (id, theme_id, difficulty, active_count) VALUES (?1, ?2, 'MEDIUM', 1)")
      .bind(poolId, `${prefix}-theme`),
    env.QUESTIONS_DB.prepare(
      `INSERT INTO questions (id, pool_id, active_slot, prompt, option_a, option_b, option_c, option_d, correct_option, content_hash, status)
       VALUES (?1, ?2, 1, 'Que foto é esta?', 'A', 'B', 'C', 'D', 0, ?3, 'ACTIVE')`,
    ).bind(questionId, poolId, `hash-${questionId}`),
  ]);
  return { adminUid: `${prefix}-fa`, adminUserId, playerUid: `${prefix}-fp`, questionId };
}

describe('foto de pergunta enviada pelo ADMIN', () => {
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

  it('grava no R2 com chave versionada, troca, remove e limpa o objeto órfão', async () => {
    const prefix = `qi-${crypto.randomUUID().slice(0, 6)}`;
    const fixture = await seed(prefix);
    adminUserId = fixture.adminUserId;
    const url = `https://quiz.test/api/admin/questions/${fixture.questionId}/image`;

    const player = await issueRealFirebaseTestToken(fixture.playerUid);
    restore = player.restore;
    const forbidden = await SELF.fetch(url, {
      body: webp(), headers: { Authorization: `Bearer ${player.token}`, 'Content-Type': 'image/webp' }, method: 'PUT',
    });
    expect(forbidden.status).toBe(403);
    player.restore();

    const admin = await issueRealFirebaseTestToken(fixture.adminUid);
    restore = admin.restore;
    const headers = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'image/webp' };

    const png = await SELF.fetch(url, { body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), headers: { ...headers, 'Content-Type': 'image/png' }, method: 'PUT' });
    expect(png.status).toBe(415);
    const garbage = await SELF.fetch(url, { body: new Uint8Array(64), headers, method: 'PUT' });
    expect(garbage.status).toBe(400);

    const first = await SELF.fetch(url, { body: webp(), headers, method: 'PUT' });
    expect(first.status).toBe(200);
    const firstBody = await first.json<{ question: { imageUrl: string } }>();
    expect(firstBody.question.imageUrl).toMatch(new RegExp(`^/api/question-images/questions/${fixture.questionId}/v\\d+\\.webp$`));
    const firstKey = firstBody.question.imageUrl.replace('/api/question-images/', '');
    const served = await SELF.fetch(`https://quiz.test${firstBody.question.imageUrl}`);
    expect(served.status).toBe(200);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(webp());

    // Rascunho de edição herda a foto: a troca na publicada não pode apagá-la.
    const draftId = crypto.randomUUID();
    await env.QUESTIONS_DB.prepare(
      `INSERT INTO questions (id, pool_id, prompt, option_a, option_b, option_c, option_d, correct_option, content_hash, status, replaces_question_id, image_key, image_bytes)
       VALUES (?1, ?2, 'Que foto é esta? (rev)', 'A', 'B', 'C', 'D', 1, ?3, 'IN_REVIEW', ?4, ?5, ?6)`,
    ).bind(draftId, `${prefix}-theme:pool`, `hash-${draftId}`, fixture.questionId, firstKey, webp().byteLength).run();

    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await SELF.fetch(url, { body: webp(), headers, method: 'PUT' });
    const secondUrl = (await second.json<{ question: { imageUrl: string } }>()).question.imageUrl;
    expect(secondUrl).not.toBe(firstBody.question.imageUrl);
    expect(await env.QUESTION_IMAGES.head(firstKey)).not.toBeNull();

    const removed = await SELF.fetch(url, { headers, method: 'DELETE' });
    expect((await removed.json<{ question: { imageUrl: string | null } }>()).question.imageUrl).toBeNull();
    expect(await env.QUESTION_IMAGES.head(secondUrl.replace('/api/question-images/', ''))).toBeNull();
    expect(await SELF.fetch(`https://quiz.test${secondUrl}`).then((response) => response.status)).toBe(404);
  });
});

describe('revisão de pergunta publicada com foto', () => {
  it('o rascunho herda a foto da versão publicada', async () => {
    const { QuestionEditorialRepository } = await import('../repositories/question-editorial-repository.js');
    const prefix = `qe-${crypto.randomUUID().slice(0, 6)}`;
    const poolId = `${prefix}-theme:pool`;
    const questionId = crypto.randomUUID();
    const key = `questions/${questionId}/v1.webp`;
    await env.QUESTIONS_DB.batch([
      env.QUESTIONS_DB.prepare("INSERT INTO question_pools (id, theme_id, difficulty, active_count) VALUES (?1, ?2, 'MEDIUM', 1)")
        .bind(poolId, `${prefix}-theme`),
      env.QUESTIONS_DB.prepare(
        `INSERT INTO questions (id, pool_id, active_slot, prompt, option_a, option_b, option_c, option_d, correct_option, content_hash, status, image_key, image_bytes)
         VALUES (?1, ?2, 1, 'Onde fica?', 'A', 'B', 'C', 'D', 0, ?3, 'ACTIVE', ?4, 900)`,
      ).bind(questionId, poolId, `hash-${questionId}`, key),
    ]);
    const repository = new QuestionEditorialRepository(env.QUESTIONS_DB);
    const { draftId } = await repository.proposeEdit({
      actorUserId: `${prefix}-admin`, correctOption: 1, options: ['A', 'B', 'C', 'D'], prompt: 'Onde fica isto?', questionId, sources: [],
    });
    const draft = await repository.findForModeration(draftId);
    expect(draft?.imageUrl).toBe(`/api/question-images/${key}`);
  });
});
