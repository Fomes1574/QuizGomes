import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { UserRepository } from '../repositories/user-repository.js';
import { fixture, userAt } from './challenge-fixture.worker.js';

async function secondTheme(categoryId: string, categoryName: string): Promise<string> {
  const themeId = crypto.randomUUID();
  await env.CORE_DB.batch([
    env.CORE_DB.prepare(
      `INSERT OR IGNORE INTO categories (id, slug, name, sort_order) VALUES (?1, ?1, ?2, 1)`,
    ).bind(categoryId, categoryName),
    env.CORE_DB.prepare(
      `INSERT INTO themes
        (id, category_id, slug, name, description, status, origin, question_shard_id, active_question_count)
       VALUES (?1, ?2, ?1, ?3, 'Fixture.', 'ACTIVE', 'OFFICIAL', 'questions-01', 10)`,
    ).bind(themeId, categoryId, `Tema ${themeId}`),
  ]);
  return themeId;
}

describe('M11 — Perfil real: partidas totais e média ordinal por categoria', () => {
  it('soma partidas/vitórias/derrotas/empates de todos os temas Ranqueados', async () => {
    const { users, themeSlug } = await fixture(1);
    const user = userAt(users, 0);
    const users_ = new UserRepository(env.CORE_DB);

    expect(await users_.matchSummary(user.id)).toEqual({ draws: 0, losses: 0, matches: 0, wins: 0 });

    const otherThemeId = await secondTheme('cat-summary-a', 'Categoria Summary A');
    await env.CORE_DB.batch([
      env.CORE_DB.prepare(
        `INSERT INTO theme_rankings (user_id, theme_id, knowledge, ranked_matches, wins, losses, draws)
         VALUES (?1, (SELECT id FROM themes WHERE slug = ?2), 0, 5, 3, 1, 1)`,
      ).bind(user.id, themeSlug),
      env.CORE_DB.prepare(
        'INSERT INTO theme_rankings (user_id, theme_id, knowledge, ranked_matches, wins, losses, draws) VALUES (?1, ?2, 0, 2, 1, 1, 0)',
      ).bind(user.id, otherThemeId),
    ]);

    expect(await users_.matchSummary(user.id)).toEqual({ draws: 1, losses: 2, matches: 7, wins: 4 });
  });

  it('média por categoria só considera temas jogados (ranked_matches > 0), cap em Desafiante I', async () => {
    const { users } = await fixture(1);
    const user = userAt(users, 0);
    const users_ = new UserRepository(env.CORE_DB);

    expect(await users_.categoryAverages(user.id)).toEqual([]);

    const categoryId = 'cat-average-b';
    const playedThemeId = await secondTheme(categoryId, 'Categoria Average B');
    const unplayedThemeId = await secondTheme(categoryId, 'Categoria Average B');
    await env.CORE_DB.batch([
      env.CORE_DB.prepare(
        'INSERT INTO theme_rankings (user_id, theme_id, knowledge, ranked_matches) VALUES (?1, ?2, 0, 3)',
      ).bind(user.id, playedThemeId),
      // Tema com linha mas sem nenhuma Ranqueada: nunca entra na média.
      env.CORE_DB.prepare(
        'INSERT INTO theme_rankings (user_id, theme_id, knowledge, ranked_matches) VALUES (?1, ?2, 500, 0)',
      ).bind(user.id, unplayedThemeId),
    ]);

    const averages = await users_.categoryAverages(user.id);
    expect(averages).toHaveLength(1);
    expect(averages[0]).toMatchObject({
      average: { rank: { division: 'V', tier: 'Latão' }, sampledThemes: 1 },
      categoryName: 'Categoria Average B',
    });
  });

  it('média por categoria satura no cap de Desafiante I mesmo acima do teto de Conhecimento', async () => {
    const { users } = await fixture(1);
    const user = userAt(users, 0);
    const users_ = new UserRepository(env.CORE_DB);
    const categoryId = 'cat-average-c';
    const themeId = await secondTheme(categoryId, 'Categoria Average C');
    await env.CORE_DB.prepare(
      'INSERT INTO theme_rankings (user_id, theme_id, knowledge, ranked_matches) VALUES (?1, ?2, 999999, 1)',
    ).bind(user.id, themeId).run();

    const averages = await users_.categoryAverages(user.id);
    expect(averages[0]?.average.rank).toMatchObject({ division: 'I', tier: 'Desafiante' });
  });
});
