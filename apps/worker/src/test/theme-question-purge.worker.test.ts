import { env, SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { purgeThemeQuestions } from '../services/theme-question-purge-service.js';
import { issueRealFirebaseTestToken } from './firebase-test-token.js';
import { fixture, themeIdOf, userAt } from './challenge-fixture.worker.js';

const imageKey = () => `questions/${crypto.randomUUID()}/v1.webp`;

async function putImage(key: string): Promise<void> {
  await env.QUESTION_IMAGES.put(key, new Uint8Array([82, 73, 70, 70]), { httpMetadata: { contentType: 'image/webp' } });
}

async function count(db: D1Database, sql: string, ...binds: unknown[]): Promise<number> {
  return (await db.prepare(sql).bind(...binds).first<{ total: number }>())?.total ?? 0;
}

describe('Apagar todas as perguntas de um tema', () => {
  it('apaga perguntas, fotos e cópias em partes, sem tocar no tema nem em outro tema', async () => {
    const { themeSlug, users } = await fixture(2);
    const { themeSlug: otherSlug } = await fixture(0);
    const themeId = await themeIdOf(themeSlug);
    const otherId = await themeIdOf(otherSlug);
    const [player, other] = [userAt(users, 0), userAt(users, 1)];
    const poolId = `${themeId}:pool`;
    const [own, shared] = [imageKey(), imageKey()];
    await putImage(own);
    await putImage(shared);
    await env.QUESTIONS_DB.batch([
      env.QUESTIONS_DB.prepare('UPDATE questions SET image_key = ?1 WHERE id = ?2').bind(own, `${poolId}-q-1`),
      env.QUESTIONS_DB.prepare('UPDATE questions SET image_key = ?1 WHERE id = ?2').bind(shared, `${poolId}-q-2`),
      // A mesma foto usada por uma pergunta de outro tema: tem que ficar.
      env.QUESTIONS_DB.prepare('UPDATE questions SET image_key = ?1 WHERE id = ?2').bind(shared, `${otherId}:pool-q-1`),
      env.QUESTIONS_DB.prepare(
        "INSERT INTO question_sources (id, question_id, url) VALUES (?1, ?2, 'https://exemplo.test/fonte')",
      ).bind(crypto.randomUUID(), `${poolId}-q-3`),
      env.QUESTIONS_DB.prepare('INSERT INTO question_statistics (question_id, answer_count) VALUES (?1, 4)').bind(`${poolId}-q-3`),
    ]);

    // Uma partida encerrada que usou a pergunta 1, com resposta e denúncia.
    const matchId = crypto.randomUUID();
    await env.CORE_DB.batch([
      env.CORE_DB.prepare(
        `INSERT INTO matches (id, theme_id, difficulty, mode, kind, status, question_shard_id)
         VALUES (?1, ?2, 'MEDIUM', 'CASUAL', 'MATCHMAKING', 'FINISHED', 'questions-01')`,
      ).bind(matchId, themeId),
      env.CORE_DB.prepare(
        `INSERT INTO match_questions (match_id, round_number, question_id, pool_slot, public_snapshot_json, correct_option_sealed)
         VALUES (?1, 1, ?2, 1, '{"prompt":"[FIXTURE] 1?"}', 'selado')`,
      ).bind(matchId, `${poolId}-q-1`),
      env.CORE_DB.prepare(
        `INSERT INTO match_answers (match_id, round_number, user_id, selected_option, remaining_ms, is_correct, score)
         VALUES (?1, 1, ?2, 0, 5000, 1, 15)`,
      ).bind(matchId, player.id),
      env.CORE_DB.prepare(
        `INSERT INTO question_report_views (context_kind, context_id, user_id, round_number, question_id)
         VALUES ('MATCH', ?1, ?2, 1, ?3)`,
      ).bind(matchId, player.id, `${poolId}-q-1`),
      env.CORE_DB.prepare(
        `INSERT INTO question_reports (id, reporter_user_id, question_id, context_kind, context_id, round_number, reason)
         VALUES (?1, ?2, ?3, 'MATCH', ?4, 1, 'INCORRECT')`,
      ).bind(crypto.randomUUID(), player.id, `${poolId}-q-1`, matchId),
      env.CORE_DB.prepare('INSERT INTO theme_rankings (user_id, theme_id, knowledge, ranked_matches, wins) VALUES (?1, ?2, 300, 2, 1)').bind(other.id, themeId),
      env.CORE_DB.prepare('INSERT INTO user_pool_states (user_id, pool_id, state_blob) VALUES (?1, ?2, X\'00\')').bind(player.id, poolId),
    ]);

    // Tema visível: recusa.
    await expect(purgeThemeQuestions(env, { confirmName: `Tema ${themeSlug.replace('-theme', '')}`, themeId }))
      .rejects.toMatchObject({ code: 'THEME_NOT_HIDDEN' });
    await env.CORE_DB.prepare('UPDATE themes SET hidden_at = CURRENT_TIMESTAMP WHERE id = ?1').bind(themeId).run();
    const name = (await env.CORE_DB.prepare('SELECT name FROM themes WHERE id = ?1').bind(themeId).first<{ name: string }>())?.name ?? '';
    // Nome errado: recusa.
    await expect(purgeThemeQuestions(env, { confirmName: 'outro tema', themeId }))
      .rejects.toMatchObject({ code: 'CONFIRMATION_MISMATCH' });

    // 16 perguntas em partes de 40: uma chamada basta, mas o laço é o mesmo do painel.
    let step = await purgeThemeQuestions(env, { confirmName: `  ${name.toUpperCase()} `, themeId });
    let total = step.deletedQuestions;
    while (step.remaining > 0) {
      step = await purgeThemeQuestions(env, { confirmName: name, themeId });
      total += step.deletedQuestions;
    }
    expect(total).toBe(16);

    expect(await count(env.QUESTIONS_DB, 'SELECT COUNT(*) AS total FROM questions WHERE pool_id = ?1', poolId)).toBe(0);
    expect(await count(env.QUESTIONS_DB, "SELECT COUNT(*) AS total FROM question_sources WHERE question_id LIKE ?1", `${poolId}-%`)).toBe(0);
    expect(await count(env.QUESTIONS_DB, "SELECT COUNT(*) AS total FROM question_statistics WHERE question_id LIKE ?1", `${poolId}-%`)).toBe(0);
    expect(await env.QUESTIONS_DB.prepare('SELECT active_count FROM question_pools WHERE id = ?1').bind(poolId).first()).toEqual({ active_count: 0 });
    expect(await count(env.CORE_DB, 'SELECT COUNT(*) AS total FROM match_questions WHERE match_id = ?1', matchId)).toBe(0);
    expect(await count(env.CORE_DB, 'SELECT COUNT(*) AS total FROM match_answers WHERE match_id = ?1', matchId)).toBe(0);
    expect(await count(env.CORE_DB, 'SELECT COUNT(*) AS total FROM question_reports WHERE context_id = ?1', matchId)).toBe(0);
    expect(await count(env.CORE_DB, 'SELECT COUNT(*) AS total FROM question_report_views WHERE context_id = ?1', matchId)).toBe(0);
    expect(await count(env.CORE_DB, 'SELECT COUNT(*) AS total FROM user_pool_states WHERE pool_id = ?1', poolId)).toBe(0);

    // Foto só deste tema sumiu; a compartilhada ficou.
    expect(await env.QUESTION_IMAGES.head(own)).toBeNull();
    expect(await env.QUESTION_IMAGES.head(shared)).not.toBeNull();

    // O tema, a partida (placar) e o ranking continuam; o outro tema também.
    expect(await env.CORE_DB.prepare('SELECT active_question_count FROM themes WHERE id = ?1').bind(themeId).first()).toEqual({ active_question_count: 0 });
    expect(await count(env.CORE_DB, 'SELECT COUNT(*) AS total FROM matches WHERE id = ?1', matchId)).toBe(1);
    expect(await count(env.CORE_DB, 'SELECT COUNT(*) AS total FROM theme_rankings WHERE theme_id = ?1', themeId)).toBe(1);
    expect(await count(env.QUESTIONS_DB, 'SELECT COUNT(*) AS total FROM questions WHERE pool_id = ?1', `${otherId}:pool`)).toBe(16);

    // Tema já vazio: chamar de novo é inofensivo.
    expect(await purgeThemeQuestions(env, { confirmName: name, themeId })).toEqual({ deletedImages: 0, deletedQuestions: 0, remaining: 0 });
  });

  it('com partida acontecendo no tema, não apaga nada', async () => {
    const { themeSlug } = await fixture(0);
    const themeId = await themeIdOf(themeSlug);
    await env.CORE_DB.batch([
      env.CORE_DB.prepare('UPDATE themes SET hidden_at = CURRENT_TIMESTAMP WHERE id = ?1').bind(themeId),
      env.CORE_DB.prepare(
        `INSERT INTO matches (id, theme_id, difficulty, mode, kind, status, question_shard_id)
         VALUES (?1, ?2, 'MEDIUM', 'RANKED', 'MATCHMAKING', 'PLAYING', 'questions-01')`,
      ).bind(crypto.randomUUID(), themeId),
    ]);
    const name = (await env.CORE_DB.prepare('SELECT name FROM themes WHERE id = ?1').bind(themeId).first<{ name: string }>())?.name ?? '';
    await expect(purgeThemeQuestions(env, { confirmName: name, themeId })).rejects.toMatchObject({ code: 'THEME_IN_PLAY' });
    expect(await count(env.QUESTIONS_DB, 'SELECT COUNT(*) AS total FROM questions WHERE pool_id = ?1', `${themeId}:pool`)).toBe(16);
  });
});

describe('Rota de apagar perguntas', () => {
  let restore: (() => void) | undefined;
  afterEach(() => { restore?.(); restore = undefined; });

  it('só ADMIN usa', async () => {
    const { themeSlug } = await fixture(0);
    const themeId = await themeIdOf(themeSlug);
    const uid = `purge-${crypto.randomUUID().slice(0, 8)}`;
    const session = await issueRealFirebaseTestToken(uid);
    restore = session.restore;
    const auth = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
    await SELF.fetch('https://quiz.test/api/profile/me', { body: JSON.stringify({ displayName: 'Sem Poder' }), headers: auth, method: 'POST' });
    const response = await SELF.fetch(`https://quiz.test/api/admin/themes/${themeId}/questions/purge`, {
      body: JSON.stringify({ confirmName: 'x' }), headers: auth, method: 'POST',
    });
    expect(response.status).toBe(403);
    expect(await count(env.QUESTIONS_DB, 'SELECT COUNT(*) AS total FROM questions WHERE pool_id = ?1', `${themeId}:pool`)).toBe(16);
  });
});
