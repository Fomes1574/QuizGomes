import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ThemeRepository } from '../repositories/theme-repository.js';

const CATEGORY_ID = 'category-synthetic-theme-artwork-test';
const THEME_ID = 'theme-synthetic-theme-artwork-test';
const THEME_SLUG = 'tema-sintetico-arte-worker-test';
const SYNTHETIC_512_WEBP = 'UklGRh4CAABXRUJQVlA4IBICAACQOgCdASoAAgACPmEwlkikIyIhIAgAgAwJaW7hd2Ee3AAAE9gHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPWAAA/v+qC//+tTIx9GL//+0s/+pZ/9Sz/FQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

function imageBytes(): ArrayBuffer {
  return Uint8Array.from(atob(SYNTHETIC_512_WEBP), (character) => character.charCodeAt(0)).buffer;
}

beforeAll(async () => {
  const data = imageBytes();
  await env.CORE_DB.batch([
    env.CORE_DB.prepare(
      "INSERT INTO categories (id, slug, name, sort_order, status) VALUES (?1, ?2, ?3, 2147482000, 'ACTIVE')",
    ).bind(CATEGORY_ID, 'categoria-sintetica-arte-worker-test', 'Categoria sintética de arte'),
    env.CORE_DB.prepare(
      `INSERT INTO themes (
         id, category_id, slug, name, description, cover_image_key, status, origin,
         question_shard_id, artwork_kind, artwork_version
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'ACTIVE', 'OFFICIAL', 'questions-01', 'CUSTOM', 1)`,
    ).bind(THEME_ID, CATEGORY_ID, THEME_SLUG, 'Tema sintético de arte', 'Fixture sintética de arte do tema.', `theme-artwork:${THEME_ID}:v1`),
    env.CORE_DB.prepare(
      `INSERT INTO theme_artwork_blobs (
         theme_id, version, content_type, width, height, byte_length, image_data
       ) VALUES (?1, 1, 'image/webp', 512, 512, ?2, ?3)`,
    ).bind(THEME_ID, data.byteLength, data),
  ]);
});

describe('arte dinâmica de tema no runtime Workers', () => {
  it('lista somente o descritor e entrega o BLOB por URL versionada com cache imutável', async () => {
    const catalogResponse = await SELF.fetch(`https://quiz.test/api/themes?search=${encodeURIComponent('Tema sintético de arte')}`);
    expect(catalogResponse.status).toBe(200);
    const catalogText = await catalogResponse.text();
    expect(catalogText).not.toContain(SYNTHETIC_512_WEBP.slice(0, 48));
    const catalog = JSON.parse(catalogText) as { themes: Array<{ artwork: { kind: string; url: string; version: number } }> };
    expect(catalog.themes).toHaveLength(1);
    expect(catalog.themes[0]?.artwork).toEqual({
      kind: 'CUSTOM',
      url: `/api/theme-artwork/${THEME_ID}/v1.webp`,
      version: 1,
    });

    const imageResponse = await SELF.fetch(`https://quiz.test${catalog.themes[0]?.artwork.url}`);
    expect(imageResponse.status).toBe(200);
    expect(imageResponse.headers.get('Content-Type')).toBe('image/webp');
    expect(imageResponse.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(imageResponse.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await imageResponse.arrayBuffer()).toEqual(imageBytes());

    const notModified = await SELF.fetch(`https://quiz.test${catalog.themes[0]?.artwork.url}`, {
      headers: { 'If-None-Match': imageResponse.headers.get('ETag') ?? '' },
    });
    expect(notModified.status).toBe(304);
  });

  it('substitui a apresentação, remove o BLOB anterior e bloqueia gravação concorrente', async () => {
    const repository = new ThemeRepository(env.CORE_DB);
    const iconTheme = await repository.setArtworkChoice({
      expectedVersion: 1,
      iconKey: 'science',
      kind: 'ICON',
      themeId: THEME_ID,
    });
    expect(iconTheme.artwork).toEqual({ iconKey: 'science', kind: 'ICON', version: 2 });
    expect(await env.CORE_DB.prepare('SELECT COUNT(*) AS total FROM theme_artwork_blobs WHERE theme_id = ?1')
      .bind(THEME_ID).first()).toEqual({ total: 0 });
    await expect(repository.setArtworkChoice({ expectedVersion: 1, kind: 'NONE', themeId: THEME_ID }))
      .rejects.toThrow('ARTWORK_VERSION_CONFLICT');
    expect((await repository.findThemeForAdmin(THEME_ID))?.artwork).toEqual({ iconKey: 'science', kind: 'ICON', version: 2 });

    const oldUrl = await SELF.fetch(`https://quiz.test/api/theme-artwork/${THEME_ID}/v1.webp`);
    expect(oldUrl.status).toBe(404);

    const firstImage = await repository.setCustomArtwork({
      data: imageBytes(), expectedVersion: 2, height: 512, themeId: THEME_ID, width: 512,
    });
    expect(firstImage.artwork).toMatchObject({ kind: 'CUSTOM', version: 3 });
    await expect(repository.setArtworkChoice({ expectedVersion: 2, kind: 'NONE', themeId: THEME_ID }))
      .rejects.toThrow('ARTWORK_VERSION_CONFLICT');
    expect(await env.CORE_DB.prepare(
      'SELECT version, byte_length FROM theme_artwork_blobs WHERE theme_id = ?1',
    ).bind(THEME_ID).first()).toEqual({ byte_length: imageBytes().byteLength, version: 3 });
    await expect(repository.setCustomArtwork({
      data: new Uint8Array([1, 2, 3]).buffer,
      expectedVersion: 2,
      height: 512,
      themeId: THEME_ID,
      width: 512,
    })).rejects.toThrow('ARTWORK_VERSION_CONFLICT');
    expect(await env.CORE_DB.prepare(
      'SELECT byte_length FROM theme_artwork_blobs WHERE theme_id = ?1',
    ).bind(THEME_ID).first()).toEqual({ byte_length: imageBytes().byteLength });
    const replacement = await repository.setCustomArtwork({
      data: imageBytes(), expectedVersion: 3, height: 512, themeId: THEME_ID, width: 512,
    });
    expect(replacement.artwork).toMatchObject({ kind: 'CUSTOM', version: 4 });
    expect(await env.CORE_DB.prepare('SELECT version, COUNT(*) AS total FROM theme_artwork_blobs WHERE theme_id = ?1')
      .bind(THEME_ID).first()).toEqual({ total: 1, version: 4 });
    expect((await repository.setArtworkChoice({ expectedVersion: 4, kind: 'NONE', themeId: THEME_ID })).artwork)
      .toEqual({ kind: 'NONE', version: 5 });
    expect(await env.CORE_DB.prepare('SELECT COUNT(*) AS total FROM theme_artwork_blobs WHERE theme_id = ?1')
      .bind(THEME_ID).first()).toEqual({ total: 0 });
  });

  it('protege toda mutação com autenticação ADMIN', async () => {
    const response = await SELF.fetch(`https://quiz.test/api/admin/themes/${THEME_ID}/artwork`, {
      body: imageBytes(),
      headers: { 'Content-Type': 'image/webp', 'If-Match': '2' },
      method: 'PUT',
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
  });

  it('impede estados inválidos mesmo em escrita direta no D1', async () => {
    const invalidStates: Array<{
      iconKey: string | null;
      id: string;
      kind: string;
      version: number;
    }> = [
      { iconKey: null, id: 'icon-without-key', kind: 'ICON', version: 0 },
      { iconKey: 'unknown', id: 'icon-with-invalid-key', kind: 'ICON', version: 0 },
      { iconKey: 'science', id: 'none-with-key', kind: 'NONE', version: 0 },
      { iconKey: null, id: 'custom-without-version', kind: 'CUSTOM', version: 0 },
    ];

    for (const state of invalidStates) {
      const id = `theme-synthetic-invalid-${state.id}-test`;
      await expect(env.CORE_DB.prepare(
        `INSERT INTO themes (
           id, category_id, slug, name, description, status, origin, question_shard_id,
           artwork_kind, artwork_icon_key, artwork_version
         ) VALUES (?1, ?2, ?3, ?4, 'Fixture inválida.', 'PENDING', 'OFFICIAL',
                   'questions-01', ?5, ?6, ?7)`,
      ).bind(id, CATEGORY_ID, id, `Tema sintético inválido ${state.id}`, state.kind, state.iconKey, state.version).run())
        .rejects.toThrow(/CHECK constraint failed/);
    }

    const customThemeId = 'theme-synthetic-artwork-constraints-test';
    await env.CORE_DB.prepare(
      `INSERT INTO themes (
         id, category_id, slug, name, description, status, origin, question_shard_id,
         artwork_kind, artwork_version
       ) VALUES (?1, ?2, ?3, 'Tema sintético de constraints', 'Fixture sintética.',
                 'PENDING', 'OFFICIAL', 'questions-01', 'CUSTOM', 1)`,
    ).bind(customThemeId, CATEGORY_ID, customThemeId).run();

    const insertBlob = (overrides: {
      byteLength?: number;
      contentType?: string;
      data?: ArrayBuffer;
      height?: number;
      version?: number;
      width?: number;
    } = {}) => env.CORE_DB.prepare(
      `INSERT INTO theme_artwork_blobs (
         theme_id, version, content_type, width, height, byte_length, image_data
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(
      customThemeId,
      overrides.version ?? 1,
      overrides.contentType ?? 'image/webp',
      overrides.width ?? 512,
      overrides.height ?? 512,
      overrides.byteLength ?? 1,
      overrides.data ?? new Uint8Array([0]).buffer,
    ).run();

    await expect(insertBlob({ contentType: 'image/png' })).rejects.toThrow(/CHECK constraint failed/);
    await expect(insertBlob({ height: 255, width: 255 })).rejects.toThrow(/CHECK constraint failed/);
    await expect(insertBlob({ height: 511 })).rejects.toThrow(/CHECK constraint failed/);
    await expect(insertBlob({ byteLength: 61_441 })).rejects.toThrow(/CHECK constraint failed/);
    await expect(insertBlob({ byteLength: 2 })).rejects.toThrow(/CHECK constraint failed/);
    await expect(insertBlob({ version: 2 })).rejects.toThrow(/FOREIGN KEY constraint failed/);

    await insertBlob();
    await expect(insertBlob()).rejects.toThrow(/UNIQUE constraint failed/);
    await expect(env.CORE_DB.prepare(
      `UPDATE themes
          SET artwork_kind = 'ICON', artwork_icon_key = 'science', artwork_version = 2
        WHERE id = ?1`,
    ).bind(customThemeId).run()).rejects.toThrow(/CHECK constraint failed|FOREIGN KEY constraint failed/);
    expect(await env.CORE_DB.prepare(
      'SELECT artwork_kind, artwork_version FROM themes WHERE id = ?1',
    ).bind(customThemeId).first()).toEqual({ artwork_kind: 'CUSTOM', artwork_version: 1 });
    expect(await env.CORE_DB.prepare(
      'SELECT artwork_kind, version, COUNT(*) AS total FROM theme_artwork_blobs WHERE theme_id = ?1',
    ).bind(customThemeId).first()).toEqual({ artwork_kind: 'CUSTOM', total: 1, version: 1 });
  });
});
