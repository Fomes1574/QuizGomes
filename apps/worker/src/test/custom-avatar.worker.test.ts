import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { UserRepository } from '../repositories/user-repository.js';

const USER_ID = 'avatar-user-11111111-1111-4111-8111-111111111111';
const FIREBASE_UID = 'avatar-firebase-owner';
const AVATAR_256_WEBP = 'UklGRsAAAABXRUJQVlA4ILQAAAAwEQCdASoAAQABPpFIoU0lpCMiICgAsBIJaW7hdrEe3AAAFBjpyHvtk5H/PJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32xwAD+/ygT//D+/jVH//6En/wSf/BJ+5E8PunBQAAAAAAAAAA=';

function avatarBytes(): ArrayBuffer {
  return Uint8Array.from(atob(AVATAR_256_WEBP), (character) => character.charCodeAt(0)).buffer;
}

beforeAll(async () => {
  await env.CORE_DB.batch([
    env.CORE_DB.prepare('INSERT INTO users (id, firebase_uid) VALUES (?1, ?2)').bind(USER_ID, FIREBASE_UID),
    env.CORE_DB.prepare(
      `INSERT INTO user_profiles (user_id, public_id, display_name, photo_url)
       VALUES (?1, '#QGAVATAR1', 'Avatar Owner', 'https://lh3.googleusercontent.com/fallback-real')`,
    ).bind(USER_ID),
  ]);
});

describe('avatar personalizado no runtime Workers', () => {
  it('troca, versiona, serve com cache imutável e remove sem guardar o original', async () => {
    const repository = new UserRepository(env.CORE_DB);
    const bytes = avatarBytes();
    const first = await repository.replaceCustomAvatar(FIREBASE_UID, bytes);
    expect(first?.customAvatarUrl).toBe(`/api/avatars/${USER_ID}/v1.webp`);
    expect(first?.photoUrl).toBe('https://lh3.googleusercontent.com/fallback-real');
    expect(JSON.stringify(first)).not.toContain(AVATAR_256_WEBP.slice(0, 32));
    expect(await env.CORE_DB.prepare(
      `SELECT active, content_type, width, height, byte_length, length(image_data) AS stored_length
         FROM user_custom_avatars WHERE user_id = ?1`,
    ).bind(USER_ID).first()).toEqual({
      active: 1,
      byte_length: bytes.byteLength,
      content_type: 'image/webp',
      height: 256,
      stored_length: bytes.byteLength,
      width: 256,
    });

    const image = await SELF.fetch(`https://quiz.test${first?.customAvatarUrl}`);
    expect(image.status).toBe(200);
    expect(image.headers.get('Content-Type')).toBe('image/webp');
    expect(image.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(await image.arrayBuffer()).toEqual(bytes);
    const notModified = await SELF.fetch(`https://quiz.test${first?.customAvatarUrl}`, {
      headers: { 'If-None-Match': image.headers.get('ETag') ?? '' },
    });
    expect(notModified.status).toBe(304);

    const replacement = await repository.replaceCustomAvatar(FIREBASE_UID, bytes);
    expect(replacement?.customAvatarUrl).toBe(`/api/avatars/${USER_ID}/v2.webp`);
    expect(await SELF.fetch(`https://quiz.test/api/avatars/${USER_ID}/v1.webp`).then((response) => response.status))
      .toBe(404);
    expect(await env.CORE_DB.prepare('SELECT COUNT(*) AS total FROM user_custom_avatars WHERE user_id = ?1')
      .bind(USER_ID).first()).toEqual({ total: 1 });

    const removed = await repository.removeCustomAvatar(FIREBASE_UID);
    expect(removed?.customAvatarUrl).toBeNull();
    expect(removed?.photoUrl).toBe('https://lh3.googleusercontent.com/fallback-real');
    expect(await env.CORE_DB.prepare(
      'SELECT active, version, image_data, byte_length FROM user_custom_avatars WHERE user_id = ?1',
    ).bind(USER_ID).first()).toEqual({ active: 0, byte_length: null, image_data: null, version: 3 });
    expect(await SELF.fetch(`https://quiz.test/api/avatars/${USER_ID}/v2.webp`).then((response) => response.status))
      .toBe(404);
  });

  it('faz a mutação somente pela identidade autenticada e bloqueia upload anônimo', async () => {
    const response = await SELF.fetch('https://quiz.test/api/profile/avatar', {
      body: avatarBytes(),
      headers: { 'Content-Type': 'image/webp', 'X-User-Id': 'arbitrario' },
      method: 'PUT',
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
    expect((await new UserRepository(env.CORE_DB).findByFirebaseUid(FIREBASE_UID))?.customAvatarUrl).toBeNull();
  });

  it('impede estados inválidos diretamente no D1', async () => {
    const invalidId = 'avatar-user-invalid-state';
    await env.CORE_DB.batch([
      env.CORE_DB.prepare('INSERT INTO users (id, firebase_uid) VALUES (?1, ?2)').bind(invalidId, 'avatar-invalid-firebase'),
      env.CORE_DB.prepare(
        "INSERT INTO user_profiles (user_id, public_id, display_name) VALUES (?1, '#QGAVATAR2', 'Avatar Invalid')",
      ).bind(invalidId),
    ]);
    await expect(env.CORE_DB.prepare(
      `INSERT INTO user_custom_avatars
       (user_id, active, content_type, width, height, byte_length, image_data)
       VALUES (?1, 1, 'image/svg+xml', 256, 256, 1, ?2)`,
    ).bind(invalidId, new Uint8Array([1]).buffer).run()).rejects.toThrow(/CHECK constraint failed/);
    await expect(env.CORE_DB.prepare(
      `INSERT INTO user_custom_avatars
       (user_id, active, content_type, width, height, byte_length, image_data)
       VALUES (?1, 1, 'image/webp', 512, 512, 1, ?2)`,
    ).bind(invalidId, new Uint8Array([1]).buffer).run()).rejects.toThrow(/CHECK constraint failed/);
    await expect(env.CORE_DB.prepare(
      `INSERT INTO user_custom_avatars
       (user_id, active, content_type, width, height, byte_length, image_data)
       VALUES (?1, 1, 'image/webp', 256, 256, 51201, ?2)`,
    ).bind(invalidId, new Uint8Array(51_201).buffer).run()).rejects.toThrow(/CHECK constraint failed/);
  });
});
