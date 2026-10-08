import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { ThemeAchievementRepository } from '../repositories/theme-achievement-repository.js';
import { ThemeRepository } from '../repositories/theme-repository.js';
import { fixture, themeIdOf, userAt } from './challenge-fixture.worker.js';

describe('Temas em destaque', () => {
  it('só tema jogável entra, há um limite, e ocultar tira do destaque', async () => {
    const themes = new ThemeRepository(env.CORE_DB);
    // Começa do zero: outras suítes podem ter deixado algo em destaque.
    await env.CORE_DB.prepare('UPDATE themes SET featured_at = NULL').run();
    const ids = await Promise.all([0, 1, 2].map(async () => themeIdOf((await fixture(0)).themeSlug)));
    const [first, second, third] = ids as [string, string, string];

    expect((await themes.setThemeFeatured({ featured: true, limit: 2, themeId: first })).featured).toBe(true);
    await themes.setThemeFeatured({ featured: true, limit: 2, themeId: second });
    await expect(themes.setThemeFeatured({ featured: true, limit: 2, themeId: third }))
      .rejects.toMatchObject({ code: 'FEATURED_LIMIT', status: 409 });
    // Repetir o mesmo tema não conta como um a mais.
    await themes.setThemeFeatured({ featured: true, limit: 2, themeId: second });

    const listed = await themes.listThemes('', null, 100);
    expect(listed.filter((theme) => theme.featured === true).map((theme) => theme.id).sort()).toEqual([first, second].sort());
    expect(listed.find((theme) => theme.id === third)).not.toHaveProperty('featured');

    await themes.setThemeHidden({ hidden: true, themeId: first });
    await themes.setThemeHidden({ hidden: false, themeId: first });
    expect((await themes.findThemeForAdmin(first))?.featured).toBeUndefined();
    await themes.setThemeFeatured({ featured: true, limit: 2, themeId: third });

    await themes.setThemeHidden({ hidden: true, themeId: second });
    await expect(themes.setThemeFeatured({ featured: true, limit: 2, themeId: second }))
      .rejects.toMatchObject({ code: 'THEME_NOT_PLAYABLE' });
    await env.CORE_DB.prepare('UPDATE themes SET featured_at = NULL').run();
  });
});

describe('Coleções por categoria', () => {
  it('conta temas com título só nas categorias em que a pessoa jogou', async () => {
    const { themeSlug, users } = await fixture(1);
    const { themeSlug: otherSlug } = await fixture(0);
    const user = userAt(users, 0);
    const [themeId, otherId] = [await themeIdOf(themeSlug), await themeIdOf(otherSlug)];
    const repository = new ThemeAchievementRepository(env.CORE_DB);
    expect(await repository.collections(user.id)).toEqual([]);

    await env.CORE_DB.batch([
      env.CORE_DB.prepare('INSERT INTO theme_rankings (user_id, theme_id, knowledge, ranked_matches, wins) VALUES (?1, ?2, 100, 2, 1)').bind(user.id, themeId),
      env.CORE_DB.prepare('INSERT INTO theme_rankings (user_id, theme_id, knowledge, ranked_matches, wins) VALUES (?1, ?2, 0, 1, 0)').bind(user.id, otherId),
      env.CORE_DB.prepare("INSERT INTO user_theme_achievements (user_id, theme_id, achievement_id) VALUES (?1, ?2, 'FIRST_WIN')").bind(user.id, themeId),
    ]);
    const collection = (await repository.collections(user.id)).find((entry) => entry.categoryId === 'challenge-category');
    expect(collection?.withTitle).toBe(1);
    expect(collection?.total).toBeGreaterThanOrEqual(2);
  });
});
