import { env, SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import type { RankedOutcome } from '@quiz-gomes/domain';
import { ThemeAchievementRepository } from '../repositories/theme-achievement-repository.js';
import { recordRankedRewards, resolvePlayerTitle } from '../services/player-title-service.js';
import { titleShowcase, updateTitleShowcase } from '../services/title-showcase-service.js';
import { issueRealFirebaseTestToken } from './firebase-test-token.js';
import { fixture, themeIdOf, userAt, type FixtureUser } from './challenge-fixture.worker.js';

const SMALL_TOP = { CORE_DB: env.CORE_DB, TOP_TITLE_MIN_PLAYERS: '3' };

function outcome(overrides: Partial<RankedOutcome> = {}): RankedOutcome {
  return {
    knowledgeAfter: 75,
    knowledgeBefore: 0,
    opponentKnowledgeBefore: 0,
    opponentScore: 40,
    result: 'WIN',
    score: 90,
    ...overrides,
  };
}

async function setRanking(user: FixtureUser, themeId: string, knowledge: number, completed: number): Promise<void> {
  await env.CORE_DB.batch([
    env.CORE_DB.prepare(
      `INSERT INTO theme_rankings (user_id, theme_id, knowledge, ranked_matches, wins)
       VALUES (?1, ?2, ?3, ?4, 1)
       ON CONFLICT (user_id, theme_id) DO UPDATE SET knowledge = ?3, ranked_matches = ?4`,
    ).bind(user.id, themeId, knowledge, completed),
    env.CORE_DB.prepare(
      `INSERT INTO user_theme_progress (user_id, theme_id, completed_ranked)
       VALUES (?1, ?2, ?3)
       ON CONFLICT (user_id, theme_id) DO UPDATE SET completed_ranked = ?3`,
    ).bind(user.id, themeId, completed),
  ]);
}

describe('Conquistas por tema', () => {
  it('a primeira vitória Rankeada dá "Estreou vencendo" e a mesma partida nunca conta duas vezes', async () => {
    const { themeSlug, users } = await fixture(1);
    const themeId = await themeIdOf(themeSlug);
    const user = userAt(users, 0);
    const repository = new ThemeAchievementRepository(env.CORE_DB);
    const matchId = crypto.randomUUID();

    expect(await repository.recordRanked(user.id, themeId, matchId, outcome())).toEqual(['FIRST_WIN']);
    // Finalização repetida da mesma sala: nada muda.
    expect(await repository.recordRanked(user.id, themeId, matchId, outcome())).toBeNull();
    const progress = await env.CORE_DB.prepare(
      'SELECT completed_ranked, win_streak FROM user_theme_progress WHERE user_id = ?1 AND theme_id = ?2',
    ).bind(user.id, themeId).first<{ completed_ranked: number; win_streak: number }>();
    expect(progress).toEqual({ completed_ranked: 1, win_streak: 1 });

    // Outra vitória: a conquista já existe, então não volta como nova.
    expect(await repository.recordRanked(user.id, themeId, crypto.randomUUID(), outcome())).toEqual([]);
  });

  it('subir de liga, atropelar e derrubar um gigante viram conquistas na hora', async () => {
    const { themeSlug, users } = await fixture(1);
    const themeId = await themeIdOf(themeSlug);
    const user = userAt(users, 0);
    const repository = new ThemeAchievementRepository(env.CORE_DB);
    const earned = await repository.recordRanked(user.id, themeId, crypto.randomUUID(), outcome({
      knowledgeAfter: 2_560,
      knowledgeBefore: 2_490,
      opponentKnowledgeBefore: 4_300,
      opponentScore: 50,
      score: 120,
    }));
    expect(earned).toEqual(expect.arrayContaining(['FIRST_PROMOTION', 'TIER_BRONZE', 'FIRST_WIN', 'GIANT_SLAYER', 'ROUT']));
  });

  it('abandono zera a sequência e não conta como Rankeada concluída', async () => {
    const { themeSlug, users } = await fixture(1);
    const themeId = await themeIdOf(themeSlug);
    const user = userAt(users, 0);
    const repository = new ThemeAchievementRepository(env.CORE_DB);
    await repository.recordRanked(user.id, themeId, crypto.randomUUID(), outcome());
    await repository.recordRanked(user.id, themeId, crypto.randomUUID(), outcome({ knowledgeAfter: 45, knowledgeBefore: 75, result: 'ABANDONED' }));
    const progress = await env.CORE_DB.prepare(
      'SELECT completed_ranked, win_streak, unbeaten_matches FROM user_theme_progress WHERE user_id = ?1 AND theme_id = ?2',
    ).bind(user.id, themeId).first();
    expect(progress).toEqual({ completed_ranked: 1, unbeaten_matches: 0, win_streak: 0 });
  });
});

describe('Top do tema', () => {
  it('só existe com gente suficiente, exige 5 Rankeadas e empate divide a posição', async () => {
    const { themeSlug, users } = await fixture(5);
    const themeId = await themeIdOf(themeSlug);
    const [a, b, c, d, e] = [0, 1, 2, 3, 4].map((index) => userAt(users, index)) as [FixtureUser, FixtureUser, FixtureUser, FixtureUser, FixtureUser];
    const repository = new ThemeAchievementRepository(env.CORE_DB, 3);

    await setRanking(a, themeId, 900, 6);
    await setRanking(b, themeId, 900, 6);
    expect(await repository.topPosition(a.id, themeId)).toBeNull(); // só 2 qualificados

    await setRanking(c, themeId, 500, 5);
    await setRanking(d, themeId, 2_000, 4); // muito Conhecimento, poucas partidas
    await setRanking(e, themeId, 0, 9); // jogou muito, mas está zerado
    expect(await repository.topPosition(a.id, themeId)).toBe(1);
    expect(await repository.topPosition(b.id, themeId)).toBe(1);
    expect(await repository.topPosition(c.id, themeId)).toBe(3);
    expect(await repository.topPosition(d.id, themeId)).toBeNull();
    expect(await repository.topPosition(e.id, themeId)).toBeNull();
    // Conta desativada sai do Top e não ocupa posição.
    await env.CORE_DB.prepare('UPDATE users SET disabled_at = CURRENT_TIMESTAMP WHERE id = ?1').bind(a.id).run();
    expect(await repository.topPosition(c.id, themeId)).toBeNull(); // população caiu para 2
  });

  it('o título segue a ordem: Top do tema da partida, Top fixado, título permanente', async () => {
    const { themeSlug, users } = await fixture(3);
    const { themeSlug: otherSlug } = await fixture(0);
    const themeId = await themeIdOf(themeSlug);
    const otherId = await themeIdOf(otherSlug);
    const [a, b, c] = [0, 1, 2].map((index) => userAt(users, index)) as [FixtureUser, FixtureUser, FixtureUser];
    await setRanking(a, themeId, 900, 6);
    await setRanking(b, themeId, 700, 6);
    await setRanking(c, themeId, 500, 6);
    const themeName = (await env.CORE_DB.prepare('SELECT name FROM themes WHERE id = ?1').bind(themeId).first<{ name: string }>())?.name;

    expect(await resolvePlayerTitle(SMALL_TOP, b.id, themeId)).toEqual({ label: `Top 2 em ${themeName}`, position: 2, style: 'silver' });
    // Fora do tema e sem nada escolhido: sem título.
    expect(await resolvePlayerTitle(SMALL_TOP, b.id, otherId)).toBeNull();

    await new ThemeAchievementRepository(env.CORE_DB).recordRanked(b.id, themeId, crypto.randomUUID(), outcome({ knowledgeAfter: 775, knowledgeBefore: 700 }));
    await updateTitleShowcase(SMALL_TOP, b.id, { equippedId: `T:${themeId}:FIRST_WIN` });
    expect(await resolvePlayerTitle(SMALL_TOP, b.id, otherId)).toEqual({ label: `Estreou vencendo em ${themeName}`, style: 'feat' });

    await updateTitleShowcase(SMALL_TOP, b.id, { equippedId: `TOP:${themeId}` });
    expect((await resolvePlayerTitle(SMALL_TOP, b.id, otherId))?.label).toBe(`Top 2 em ${themeName}`);
    // Saiu do Top: volta ao título permanente guardado.
    await setRanking(b, themeId, 0, 6);
    expect((await resolvePlayerTitle(SMALL_TOP, b.id, otherId))?.label).toBe(`Estreou vencendo em ${themeName}`);

    // Com o Top automático desligado, o tema da partida não muda nada.
    await setRanking(b, themeId, 700, 6);
    await updateTitleShowcase(SMALL_TOP, b.id, { autoTop: false, equippedId: `T:${themeId}:FIRST_WIN` });
    expect((await resolvePlayerTitle(SMALL_TOP, b.id, themeId))?.label).toBe(`Estreou vencendo em ${themeName}`);
  });

  it('a Rankeada devolve o que mudou: títulos novos e a posição antes e depois', async () => {
    const { themeSlug, users } = await fixture(3);
    const themeId = await themeIdOf(themeSlug);
    const [a, b, c] = [0, 1, 2].map((index) => userAt(users, index)) as [FixtureUser, FixtureUser, FixtureUser];
    await setRanking(a, themeId, 900, 6);
    await setRanking(b, themeId, 820, 6);
    await setRanking(c, themeId, 500, 6);

    // A sala já aplicou o resultado no ranking: b venceu a.
    const matchId = crypto.randomUUID();
    await env.CORE_DB.prepare('UPDATE theme_rankings SET knowledge = 950 WHERE user_id = ?1 AND theme_id = ?2').bind(b.id, themeId).run();
    await env.CORE_DB.prepare('UPDATE theme_rankings SET knowledge = 860 WHERE user_id = ?1 AND theme_id = ?2').bind(a.id, themeId).run();
    const rewards = await recordRankedRewards(SMALL_TOP, matchId, themeId, [
      { correctAnswers: 6, outcome: outcome({ knowledgeAfter: 950, knowledgeBefore: 820 }), topBefore: 2, userId: b.id },
      { correctAnswers: 6, outcome: outcome({ knowledgeAfter: 860, knowledgeBefore: 900, result: 'LOSS' }), topBefore: 1, userId: a.id },
    ]);
    expect(rewards.get(b.id)?.top).toEqual({ after: 1, before: 2 });
    expect(rewards.get(b.id)?.achievements.map((achievement) => achievement.id)).toContain('FIRST_WIN');
    expect(rewards.get(a.id)?.top).toEqual({ after: 2, before: 1 });
    // Repetir a finalização não devolve nada de novo.
    expect((await recordRankedRewards(SMALL_TOP, matchId, themeId, [
      { correctAnswers: 6, outcome: outcome(), topBefore: 2, userId: b.id },
    ])).size).toBe(0);
  });
});

describe('Vitrine de títulos (API)', () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it('lista o que é seu, o que falta, e só deixa usar ou destacar o que é seu', async () => {
    const { themeSlug } = await fixture(0);
    const themeId = await themeIdOf(themeSlug);
    const uid = `vitrine-${crypto.randomUUID().slice(0, 8)}`;
    const session = await issueRealFirebaseTestToken(uid);
    restore = session.restore;
    const auth = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
    expect((await SELF.fetch('https://quiz.test/api/profile/me', {
      body: JSON.stringify({ displayName: 'Vitrine Viva' }), headers: auth, method: 'POST',
    })).status).toBe(201);
    const userId = (await env.CORE_DB.prepare('SELECT id FROM users WHERE firebase_uid = ?1').bind(uid).first<{ id: string }>())?.id ?? '';

    const empty = await (await SELF.fetch('https://quiz.test/api/profile/titles', { headers: auth })).json<{ possible: number; titles: unknown[] }>();
    // Conta nova: nada conquistado; o primeiro título à vista é o do nível 5.
    expect(empty).toMatchObject({ possible: 1, titles: [{ id: 'N:5', label: 'Curioso', locked: { ratio: 0 } }] });

    // Histórico de Ouro já registrado no ranking: a vitrine garante as conquistas que ele prova.
    await env.CORE_DB.batch([
      env.CORE_DB.prepare('INSERT INTO theme_rankings (user_id, theme_id, knowledge, ranked_matches, wins) VALUES (?1, ?2, 15500, 12, 8)').bind(userId, themeId),
      env.CORE_DB.prepare('INSERT INTO user_theme_progress (user_id, theme_id, completed_ranked) VALUES (?1, ?2, 12)').bind(userId, themeId),
    ]);
    const showcase = await titleShowcase(env, userId);
    const ownedIds = showcase.titles.filter((title) => title.locked === undefined).map((title) => title.id);
    expect(ownedIds).toEqual(expect.arrayContaining([
      `T:${themeId}:FIRST_WIN`, `T:${themeId}:TIER_GOLD`, `T:${themeId}:PLAYED_10`,
    ]));
    expect(ownedIds).not.toContain(`T:${themeId}:TIER_PLATINUM`);
    const platinum = showcase.titles.find((title) => title.id === `T:${themeId}:TIER_PLATINUM`);
    expect(platinum?.locked?.ratio).toBeGreaterThan(0.6);
    expect(showcase.owned).toBeLessThan(showcase.possible);

    const notMine = await SELF.fetch('https://quiz.test/api/profile/titles', {
      body: JSON.stringify({ equippedId: `T:${themeId}:TIER_PLATINUM` }), headers: auth, method: 'PUT',
    });
    expect(notMine.status).toBe(403);
    const notTop = await SELF.fetch('https://quiz.test/api/profile/titles', {
      body: JSON.stringify({ equippedId: `TOP:${themeId}` }), headers: auth, method: 'PUT',
    });
    expect(notTop.status).toBe(403);

    const equipped = await SELF.fetch('https://quiz.test/api/profile/titles', {
      body: JSON.stringify({ equippedId: `T:${themeId}:TIER_GOLD`, pins: [`T:${themeId}:TIER_GOLD`, `T:${themeId}:PLAYED_10`] }),
      headers: auth,
      method: 'PUT',
    });
    expect(equipped.status).toBe(200);
    const saved = await equipped.json<{ current: { label: string }; equippedId: string; pins: string[] }>();
    expect(saved.equippedId).toBe(`T:${themeId}:TIER_GOLD`);
    expect(saved.current.label).toMatch(/^Ouro em /);
    expect(saved.pins).toEqual([`T:${themeId}:TIER_GOLD`, `T:${themeId}:PLAYED_10`]);

    const tooMany = await SELF.fetch('https://quiz.test/api/profile/titles', {
      body: JSON.stringify({ pins: ['T:a:ROUT', 'T:b:ROUT', 'T:c:ROUT', 'T:d:ROUT'] }), headers: auth, method: 'PUT',
    });
    expect(tooMany.status).toBe(400);
    const unknownField = await SELF.fetch('https://quiz.test/api/profile/titles', {
      body: JSON.stringify({ label: 'Top 1 em tudo' }), headers: auth, method: 'PUT',
    });
    expect(unknownField.status).toBe(400);
  });
});
