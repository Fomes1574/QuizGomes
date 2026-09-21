import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { ThemeRepository } from '../repositories/theme-repository.js';
import { fixture, userAt } from './challenge-fixture.worker.js';

describe('M11 — categorias e moderação de temas', () => {
  it('cria categoria, recusa nome/slug duplicado e edita com CAS por revisão', async () => {
    const themes = new ThemeRepository(env.CORE_DB);
    const created = await themes.createCategory({ name: 'Categoria Editorial A', slug: 'categoria-editorial-a', sortOrder: 5 });
    expect(created).toMatchObject({ name: 'Categoria Editorial A', revision: 1, status: 'ACTIVE' });

    await expect(themes.createCategory({ name: 'Categoria Editorial A', slug: 'outro-slug', sortOrder: 1 }))
      .rejects.toMatchObject({ code: 'CATEGORY_ALREADY_EXISTS' });
    await expect(themes.createCategory({ name: 'Outro Nome', slug: 'categoria-editorial-a', sortOrder: 1 }))
      .rejects.toMatchObject({ code: 'CATEGORY_ALREADY_EXISTS' });

    // CAS: revisão desatualizada não aplica.
    await expect(themes.updateCategory({
      expectedRevision: 99, id: created.id, name: 'Renomeada', sortOrder: 5, status: 'ACTIVE',
    })).rejects.toMatchObject({ code: 'CATEGORY_CONFLICT' });

    const updated = await themes.updateCategory({
      expectedRevision: 1, id: created.id, name: 'Categoria Renomeada', sortOrder: 9, status: 'DISABLED',
    });
    expect(updated).toEqual({
      id: created.id, name: 'Categoria Renomeada', revision: 2, slug: 'categoria-editorial-a',
      sortOrder: 9, status: 'DISABLED',
    });

    const admin = await themes.listCategoriesForAdmin();
    expect(admin.find((category) => category.id === created.id)).toEqual(updated);
    // Categoria desativada não aparece na listagem pública.
    expect((await themes.listCategories()).some((category) => category.id === created.id)).toBe(false);
  });

  it('editar categoria inexistente falha com CATEGORY_NOT_FOUND', async () => {
    const themes = new ThemeRepository(env.CORE_DB);
    await expect(themes.updateCategory({
      expectedRevision: 1, id: 'categoria-fantasma', name: 'x', sortOrder: 0, status: 'ACTIVE',
    })).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND', status: 404 });
  });

  it('aprovar tema PENDING publica e concede OWNER a quem propôs, com CAS por revisão', async () => {
    const { users } = await fixture(1);
    const proposer = userAt(users, 0);
    const themes = new ThemeRepository(env.CORE_DB);
    const category = await themes.createCategory({ name: 'Categoria Proposta', slug: 'categoria-proposta', sortOrder: 0 });
    const proposed = await themes.submitTheme({
      categoryId: category.id, description: 'Descrição válida o suficiente.', name: 'Tema Proposto', userId: proposer.id,
    });

    const beforeAccess = await themes.themeEditAccess(proposed.id, proposer.id);
    expect(beforeAccess).toEqual({ origin: 'USER', owned: false });

    // CAS: revisão errada não aprova.
    await expect(themes.approveTheme({ expectedRevision: 99, themeId: proposed.id }))
      .rejects.toMatchObject({ code: 'THEME_CONFLICT' });

    const approved = await themes.approveTheme({ expectedRevision: 1, themeId: proposed.id });
    expect(approved).toMatchObject({ id: proposed.id, revision: 2, status: 'ACTIVE' });

    const afterAccess = await themes.themeEditAccess(proposed.id, proposer.id);
    expect(afterAccess).toEqual({ origin: 'USER', owned: true });

    // Reaprovar (já ACTIVE) não é permitido: só PENDING pode virar ACTIVE.
    await expect(themes.approveTheme({ expectedRevision: 2, themeId: proposed.id }))
      .rejects.toMatchObject({ code: 'THEME_CONFLICT' });
  });

  it('rejeitar tema PENDING grava a nota e nunca concede OWNER', async () => {
    const { users } = await fixture(1);
    const proposer = userAt(users, 0);
    const themes = new ThemeRepository(env.CORE_DB);
    const category = await themes.createCategory({ name: 'Categoria Rejeição', slug: 'categoria-rejeicao', sortOrder: 0 });
    const proposed = await themes.submitTheme({
      categoryId: category.id, description: 'Descrição válida o suficiente.', name: 'Tema Rejeitado', userId: proposer.id,
    });

    const rejected = await themes.rejectTheme({
      expectedRevision: 1, note: 'Fora do escopo do catálogo.', themeId: proposed.id,
    });
    expect(rejected).toMatchObject({ rejectionNote: 'Fora do escopo do catálogo.', revision: 2, status: 'REJECTED' });
    expect(await themes.themeEditAccess(proposed.id, proposer.id)).toEqual({ origin: 'USER', owned: false });
  });

  it('editar tema (ADMIN ou OWNER) usa CAS e recusa categoria inválida', async () => {
    const { users } = await fixture(1);
    const proposer = userAt(users, 0);
    const themes = new ThemeRepository(env.CORE_DB);
    const category = await themes.createCategory({ name: 'Categoria Edição', slug: 'categoria-edicao', sortOrder: 0 });
    const otherCategory = await themes.createCategory({ name: 'Categoria Destino', slug: 'categoria-destino', sortOrder: 1 });
    const proposed = await themes.submitTheme({
      categoryId: category.id, description: 'Descrição válida o suficiente.', name: 'Tema Editável', userId: proposer.id,
    });
    await themes.approveTheme({ expectedRevision: 1, themeId: proposed.id });

    await expect(themes.editTheme({
      categoryId: 'categoria-inexistente', description: 'Nova descrição válida.',
      expectedRevision: 2, name: 'Tema Editado', themeId: proposed.id,
    })).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' });

    await expect(themes.editTheme({
      categoryId: otherCategory.id, description: 'Nova descrição válida.',
      expectedRevision: 99, name: 'Tema Editado', themeId: proposed.id,
    })).rejects.toMatchObject({ code: 'THEME_CONFLICT' });

    const edited = await themes.editTheme({
      categoryId: otherCategory.id, description: 'Nova descrição válida.',
      expectedRevision: 2, name: 'Tema Editado', themeId: proposed.id,
    });
    expect(edited).toMatchObject({
      categoryId: otherCategory.id, description: 'Nova descrição válida.', name: 'Tema Editado', revision: 3,
    });
  });

  it('desativar tema ACTIVE preserva CAS e falha em tema PENDING', async () => {
    const { users } = await fixture(1);
    const proposer = userAt(users, 0);
    const themes = new ThemeRepository(env.CORE_DB);
    const category = await themes.createCategory({ name: 'Categoria Desativação', slug: 'categoria-desativacao', sortOrder: 0 });
    const proposed = await themes.submitTheme({
      categoryId: category.id, description: 'Descrição válida o suficiente.', name: 'Tema Desativável', userId: proposer.id,
    });

    await expect(themes.deactivateTheme({ expectedRevision: 1, themeId: proposed.id }))
      .rejects.toMatchObject({ code: 'THEME_CONFLICT' });

    await themes.approveTheme({ expectedRevision: 1, themeId: proposed.id });
    const deactivated = await themes.deactivateTheme({ expectedRevision: 2, themeId: proposed.id });
    expect(deactivated).toMatchObject({ revision: 3, status: 'DISABLED' });
    // Tema desativado não aparece mais no catálogo público.
    expect(await themes.findTheme(proposed.id)).toBeNull();
  });

  it('themeEditAccess distingue OFFICIAL de USER e nunca concede posse a um tema oficial', async () => {
    const { users } = await fixture(1);
    const someone = userAt(users, 0);
    const themes = new ThemeRepository(env.CORE_DB);
    const category = await themes.createCategory({ name: 'Categoria Oficial', slug: 'categoria-oficial', sortOrder: 0 });
    const officialId = crypto.randomUUID();
    await env.CORE_DB.prepare(
      `INSERT INTO themes (id, category_id, slug, name, description, status, origin, question_shard_id)
       VALUES (?1, ?2, ?3, 'Tema Oficial', 'Descrição oficial válida.', 'ACTIVE', 'OFFICIAL', 'questions-01')`,
    ).bind(officialId, category.id, 'tema-oficial-editorial-test').run();

    expect(await themes.themeEditAccess(officialId, someone.id)).toEqual({ origin: 'OFFICIAL', owned: false });
    expect(await themes.themeEditAccess('tema-fantasma', someone.id)).toBeNull();
  });
});
