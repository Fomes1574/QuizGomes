import { exportSPKI, generateKeyPair, SignJWT } from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrapAdminUids } from '../auth/authorize.js';
import { bearerToken, resetCertificateCacheForTests, verifyFirebaseIdToken } from '../auth/firebase-token.js';

const PROJECT_ID = 'quizgomes-cbc48';

describe('validação Firebase ID Token', () => {
  beforeEach(() => resetCertificateCacheForTests());

  async function fixture(overrides: {
    audience?: string;
    authTime?: number;
    issuer?: string;
    subject?: string;
  } = {}) {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const now = Math.floor(Date.now() / 1_000);
    const token = await new SignJWT({
      auth_time: overrides.authTime ?? now - 10,
      email: 'jogador@example.com',
      email_verified: true,
      name: 'Jogador',
      picture: 'https://lh3.googleusercontent.com/avatar',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setAudience(overrides.audience ?? PROJECT_ID)
      .setExpirationTime(now + 3_600)
      .setIssuedAt(now - 10)
      .setIssuer(overrides.issuer ?? `https://securetoken.google.com/${PROJECT_ID}`)
      .setSubject(overrides.subject ?? 'firebase-uid-123')
      .sign(privateKey);
    const publicPem = await exportSPKI(publicKey);
    const fetcher = (() => Promise.resolve(new Response(JSON.stringify({ 'test-key': publicPem }), {
      headers: { 'Cache-Control': 'public, max-age=3600', 'Content-Type': 'application/json' },
    }))) as typeof fetch;
    return { fetcher, now, token };
  }

  it('aceita assinatura e claims válidos e usa sub como UID', async () => {
    const { fetcher, token } = await fixture();
    await expect(verifyFirebaseIdToken(token, PROJECT_ID, fetcher)).resolves.toEqual({
      email: 'jogador@example.com',
      emailVerified: true,
      name: 'Jogador',
      picture: 'https://lh3.googleusercontent.com/avatar',
      uid: 'firebase-uid-123',
    });
  });

  it('rejeita audience e issuer de outro projeto', async () => {
    const wrongAudience = await fixture({ audience: 'outro-projeto' });
    await expect(verifyFirebaseIdToken(wrongAudience.token, PROJECT_ID, wrongAudience.fetcher)).rejects.toMatchObject({
      code: 'INVALID_TOKEN', status: 401,
    });
    resetCertificateCacheForTests();
    const wrongIssuer = await fixture({ issuer: 'https://securetoken.google.com/outro-projeto' });
    await expect(verifyFirebaseIdToken(wrongIssuer.token, PROJECT_ID, wrongIssuer.fetcher)).rejects.toMatchObject({
      code: 'INVALID_TOKEN', status: 401,
    });
  });

  it('rejeita auth_time futuro e subject vazio', async () => {
    const future = await fixture({ authTime: Math.floor(Date.now() / 1_000) + 100 });
    await expect(verifyFirebaseIdToken(future.token, PROJECT_ID, future.fetcher)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    resetCertificateCacheForTests();
    const emptySubject = await fixture({ subject: '' });
    await expect(verifyFirebaseIdToken(emptySubject.token, PROJECT_ID, emptySubject.fetcher)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('exige Bearer e não aceita formato falsificado', () => {
    expect(() => bearerToken(new Request('https://example.test'))).toThrowError(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
    expect(() => bearerToken(new Request('https://example.test', { headers: { Authorization: 'Basic abc' } })))
      .toThrowError(expect.objectContaining({ code: 'INVALID_AUTH_HEADER' }));
    expect(bearerToken(new Request('https://example.test', { headers: { Authorization: 'Bearer token' } }))).toBe('token');
  });

  it('bootstrap ADMIN usa somente lista exata de UIDs', () => {
    const admins = bootstrapAdminUids({ ADMIN_FIREBASE_UIDS: 'uid-a, uid-b' });
    expect(admins.has('uid-a')).toBe(true);
    expect(admins.has('UID-A')).toBe(false);
    expect(admins.has('admin@example.com')).toBe(false);
  });
});
