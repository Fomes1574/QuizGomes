import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { ChallengeRepository } from '../repositories/challenge-repository.js';
import { ThemeRepository } from '../repositories/theme-repository.js';
import { fixture, userAt } from './challenge-fixture.worker.js';
import { issueRealFirebaseTestToken } from './firebase-test-token.js';

/** Fixture sintética: categoria + tema ativos, prefixo único por teste. */
async function themeInOwnCategory(label: string): Promise<{ categoryId: string; slug: string; themeId: string }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const categoryId = `vis-cat-${suffix}`;
  const themeId = `vis-theme-${suffix}`;
  const slug = `vis-theme-${suffix}`;
  await env.CORE_DB.batch([
    env.CORE_DB.prepare('INSERT INTO categories (id, slug, name, sort_order) VALUES (?1, ?1, ?2, 50)')
      .bind(categoryId, `Categoria ${label} ${suffix}`),
    env.CORE_DB.prepare(
      `INSERT INTO themes (id, category_id, slug, name, description, status, origin, question_shard_id)
       VALUES (?1, ?2, ?3, ?4, 'Tema sintético de visibilidade.', 'ACTIVE', 'OFFICIAL', 'questions-01')`,
    ).bind(themeId, categoryId, slug, `Tema ${label} ${suffix}`),
  ]);
  return { categoryId, slug, themeId };
}

describe('ocultar tema e categoria', () => {
  it('tema oculto some das listas do jogador e do admin, não abre partida e volta pela aba Ocultos', async () => {
    const { themeId, slug } = await themeInOwnCategory('Oculto');
    const themes = new ThemeRepository(env.CORE_DB);
    expect(await themes.isPlayable(themeId)).toBe(true);

    const hidden = await themes.setThemeHidden({ hidden: true, themeId });
    expect(hidden.hidden).toBe(true);
    expect((await themes.listThemes()).some((theme) => theme.id === themeId)).toBe(false);
    expect(await themes.findTheme(slug)).toBeNull();
    expect((await themes.listThemesForAdmin()).some((theme) => theme.id === themeId)).toBe(false);
    expect((await themes.listThemesForAdmin('', 500, { hidden: true })).map((theme) => theme.id)).toContain(themeId);
    expect(await themes.isPlayable(themeId)).toBe(false);

    const shown = await themes.setThemeHidden({ hidden: false, themeId });
    expect(shown.hidden).toBe(false);
    expect(await themes.findTheme(slug)).not.toBeNull();
    expect((await themes.listThemesForAdmin('', 500, { hidden: true })).some((theme) => theme.id === themeId)).toBe(false);
    expect(await themes.isPlayable(themeId)).toBe(true);
  });

  it('categoria oculta esconde a si mesma e todos os temas dela; não recebe tema movido', async () => {
    const { categoryId, themeId } = await themeInOwnCategory('Categoria oculta');
    const other = await themeInOwnCategory('Vizinho');
    const themes = new ThemeRepository(env.CORE_DB);

    const category = await themes.setCategoryHidden({ hidden: true, id: categoryId });
    expect(category.hidden).toBe(true);
    expect((await themes.listCategories()).some((item) => item.id === categoryId)).toBe(false);
    expect((await themes.listCategoriesForAdmin()).some((item) => item.id === categoryId)).toBe(false);
    expect((await themes.listCategoriesForAdmin({ hidden: true })).map((item) => item.id)).toContain(categoryId);
    expect((await themes.listThemes()).some((theme) => theme.id === themeId)).toBe(false);
    expect((await themes.listThemesForAdmin()).some((theme) => theme.id === themeId)).toBe(false);
    expect(await themes.isPlayable(themeId)).toBe(false);

    // Mover um tema para uma categoria oculta é recusado.
    const neighbour = await themes.findThemeForAdmin(other.themeId);
    await expect(themes.editTheme({
      categoryId, description: 'Tema sintético de visibilidade.', expectedRevision: neighbour?.revision ?? 1,
      name: neighbour?.name ?? 'x', themeId: other.themeId,
    })).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' });

    await themes.setCategoryHidden({ hidden: false, id: categoryId });
    expect(await themes.isPlayable(themeId)).toBe(true);
    expect((await themes.listThemes()).some((theme) => theme.id === themeId)).toBe(true);
  });

  it('mover tema de categoria mantém o tema jogável na categoria nova', async () => {
    const source = await themeInOwnCategory('Origem');
    const target = await themeInOwnCategory('Destino');
    const themes = new ThemeRepository(env.CORE_DB);
    const current = await themes.findThemeForAdmin(source.themeId);
    await expect(themes.moveThemeToCategory({
      categoryId: target.categoryId, expectedRevision: 999, themeId: source.themeId,
    })).rejects.toMatchObject({ code: 'THEME_CONFLICT' });
    const moved = await themes.moveThemeToCategory({
      categoryId: target.categoryId, expectedRevision: current?.revision ?? 1, themeId: source.themeId,
    });
    expect(moved.categoryId).toBe(target.categoryId);
    expect(moved.revision).toBe((current?.revision ?? 1) + 1);
    expect(await themes.isPlayable(source.themeId)).toBe(true);
  });

  it('desafio entre amigos recusa tema oculto', async () => {
    const { users } = await fixture(2);
    const hiddenTheme = await themeInOwnCategory('Desafio');
    const themes = new ThemeRepository(env.CORE_DB);
    await themes.setThemeHidden({ hidden: true, themeId: hiddenTheme.themeId });
    await expect(new ChallengeRepository(env.CORE_DB).create({
      actorUserId: userAt(users, 0).id, kind: 'ASYNC', targetPresence: 'ONLINE',
      targetUserId: userAt(users, 1).id, themeId: hiddenTheme.themeId,
    })).rejects.toMatchObject({ code: 'THEME_UNAVAILABLE' });
  });

  it('rota de ocultar exige login e papel ADMIN', async () => {
    const { themeId } = await themeInOwnCategory('Rota');
    const anonymous = await SELF.fetch(`https://quiz.test/api/admin/themes/${themeId}/visibility`, {
      body: JSON.stringify({ hidden: true }), headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect(anonymous.status).toBe(401);

    const { users } = await fixture(1);
    const player = userAt(users, 0);
    const { restore, token } = await issueRealFirebaseTestToken(player.uid);
    try {
      const forbidden = await SELF.fetch(`https://quiz.test/api/admin/themes/${themeId}/visibility`, {
        body: JSON.stringify({ hidden: true }),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        method: 'POST',
      });
      expect(forbidden.status).toBe(403);
    } finally {
      restore();
    }
    expect(await new ThemeRepository(env.CORE_DB).isPlayable(themeId)).toBe(true);
  });
});
