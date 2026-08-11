import { base64url, exportSPKI, generateKeyPair, SignJWT } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapAdminUids, requireUser } from '../auth/authorize.js';
import { bearerToken, resetCertificateCacheForTests, verifyFirebaseIdToken } from '../auth/firebase-token.js';

const PROJECT_ID = 'quizgomes-cbc48';
const ignoreDiagnostic = () => undefined;

describe('validação Firebase ID Token', () => {
  beforeEach(() => resetCertificateCacheForTests());

  async function fixture(overrides: {
    audience?: string;
    authTimeOffset?: number;
    certificateKid?: string;
    expirationOffset?: number;
    issuedAtOffset?: number;
    issuer?: string;
    subject?: string;
  } = {}) {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const now = Math.floor(Date.now() / 1_000);
    const token = await new SignJWT({
      auth_time: now + (overrides.authTimeOffset ?? -10),
      email: 'jogador@example.com',
      email_verified: true,
      firebase: {
        identities: { 'google.com': ['google-fixture-id'] },
        sign_in_provider: 'google.com',
      },
      name: 'Jogador',
      picture: 'https://lh3.googleusercontent.com/avatar',
      user_id: overrides.subject ?? 'firebase-uid-123',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })
      .setAudience(overrides.audience ?? PROJECT_ID)
      .setExpirationTime(now + (overrides.expirationOffset ?? 3_600))
      .setIssuedAt(now + (overrides.issuedAtOffset ?? -10))
      .setIssuer(overrides.issuer ?? `https://securetoken.google.com/${PROJECT_ID}`)
      .setSubject(overrides.subject ?? 'firebase-uid-123')
      .sign(privateKey);
    const publicPem = await exportSPKI(publicKey);
    const fetcher = (() => Promise.resolve(new Response(JSON.stringify({
      [overrides.certificateKid ?? 'test-key']: publicPem,
    }), {
      headers: { 'Cache-Control': 'public, max-age=3600', 'Content-Type': 'application/json' },
    }))) as typeof fetch;
    return { fetcher, now, token };
  }

  function replaceHeader(token: string, header: Record<string, string>): string {
    const [, payload, signature] = token.split('.');
    return `${base64url.encode(JSON.stringify(header))}.${payload ?? ''}.${signature ?? ''}`;
  }

  it('aceita assinatura e claims Firebase válidos e usa sub como UID', async () => {
    const { fetcher, token } = await fixture();
    await expect(verifyFirebaseIdToken(token, PROJECT_ID, fetcher, ignoreDiagnostic)).resolves.toEqual({
      email: 'jogador@example.com',
      emailVerified: true,
      name: 'Jogador',
      picture: 'https://lh3.googleusercontent.com/avatar',
      uid: 'firebase-uid-123',
    });
  });

  it('classifica audience e issuer incorretos sem afrouxar as claims', async () => {
    const diagnostic = vi.fn();
    const wrongAudience = await fixture({ audience: 'outro-projeto' });
    await expect(verifyFirebaseIdToken(
      wrongAudience.token,
      PROJECT_ID,
      wrongAudience.fetcher,
      diagnostic,
    )).rejects.toMatchObject({ code: 'INVALID_TOKEN', status: 401 });
    expect(diagnostic).toHaveBeenLastCalledWith({
      event: 'firebase_id_token_rejected',
      reason: 'AUDIENCE_INVALID',
      stage: 'claims',
    });

    resetCertificateCacheForTests();
    const wrongIssuer = await fixture({ issuer: 'https://securetoken.google.com/outro-projeto' });
    await expect(verifyFirebaseIdToken(
      wrongIssuer.token,
      PROJECT_ID,
      wrongIssuer.fetcher,
      diagnostic,
    )).rejects.toMatchObject({ code: 'INVALID_TOKEN', status: 401 });
    expect(diagnostic).toHaveBeenLastCalledWith({
      event: 'firebase_id_token_rejected',
      reason: 'ISSUER_INVALID',
      stage: 'claims',
    });
  });

  it('distingue expiração, iat/auth_time futuros e subject vazio', async () => {
    const diagnostic = vi.fn();
    const expired = await fixture({ expirationOffset: -1 });
    await expect(verifyFirebaseIdToken(expired.token, PROJECT_ID, expired.fetcher, diagnostic))
      .rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    expect(diagnostic).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'EXPIRATION_INVALID' }));

    resetCertificateCacheForTests();
    const futureIssue = await fixture({ issuedAtOffset: 100 });
    await expect(verifyFirebaseIdToken(futureIssue.token, PROJECT_ID, futureIssue.fetcher, diagnostic))
      .rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    expect(diagnostic).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'ISSUED_AT_INVALID' }));

    resetCertificateCacheForTests();
    const future = await fixture({ authTimeOffset: 100 });
    await expect(verifyFirebaseIdToken(future.token, PROJECT_ID, future.fetcher, diagnostic))
      .rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    expect(diagnostic).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'AUTH_TIME_INVALID' }));

    resetCertificateCacheForTests();
    const emptySubject = await fixture({ subject: '' });
    await expect(verifyFirebaseIdToken(emptySubject.token, PROJECT_ID, emptySubject.fetcher, diagnostic))
      .rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    expect(diagnostic).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'SUBJECT_INVALID' }));
  });

  it('exige RS256 e kid antes de consultar qualquer chave', async () => {
    const diagnostic = vi.fn();
    const valid = await fixture();
    const invalidAlgorithm = replaceHeader(valid.token, { alg: 'HS256', kid: 'test-key', typ: 'JWT' });
    await expect(verifyFirebaseIdToken(invalidAlgorithm, PROJECT_ID, valid.fetcher, diagnostic))
      .rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    expect(diagnostic).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'ALGORITHM_INVALID', stage: 'header' }));

    const missingKid = replaceHeader(valid.token, { alg: 'RS256', typ: 'JWT' });
    await expect(verifyFirebaseIdToken(missingKid, PROJECT_ID, valid.fetcher, diagnostic))
      .rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    expect(diagnostic).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'KEY_ID_MISSING', stage: 'header' }));
  });

  it('distingue chave desconhecida e assinatura inválida', async () => {
    const diagnostic = vi.fn();
    const unknownKey = await fixture({ certificateKid: 'outra-chave' });
    await expect(verifyFirebaseIdToken(unknownKey.token, PROJECT_ID, unknownKey.fetcher, diagnostic))
      .rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    expect(diagnostic).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'KEY_UNKNOWN', stage: 'keys' }));

    resetCertificateCacheForTests();
    const signed = await fixture();
    const otherKey = await fixture();
    await expect(verifyFirebaseIdToken(signed.token, PROJECT_ID, otherKey.fetcher, diagnostic))
      .rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    expect(diagnostic).toHaveBeenLastCalledWith(expect.objectContaining({
      reason: 'SIGNATURE_INVALID',
      stage: 'signature',
    }));
  });

  it('registra somente diagnóstico seguro, sem token ou PII', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const invalid = await fixture({ audience: 'outro-projeto' });
    await expect(verifyFirebaseIdToken(invalid.token, PROJECT_ID, invalid.fetcher)).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
    expect(consoleWarn).toHaveBeenCalledWith({
      event: 'firebase_id_token_rejected',
      reason: 'AUDIENCE_INVALID',
      stage: 'claims',
    });
    const serializedLogs = JSON.stringify(consoleWarn.mock.calls);
    expect(serializedLogs).not.toContain(invalid.token);
    expect(serializedLogs).not.toContain('jogador@example.com');
    expect(serializedLogs).not.toContain('firebase-uid-123');
  });

  it('exige Bearer e não aceita formato falsificado', () => {
    expect(() => bearerToken(new Request('https://example.test'))).toThrowError(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
    expect(() => bearerToken(new Request('https://example.test', { headers: { Authorization: 'Basic abc' } })))
      .toThrowError(expect.objectContaining({ code: 'INVALID_AUTH_HEADER' }));
    expect(bearerToken(new Request('https://example.test', { headers: { Authorization: 'Bearer token' } }))).toBe('token');
  });

  it('ADMIN não participa da autenticação e é avaliado somente depois do token', async () => {
    const authenticated = {
      email: null,
      emailVerified: false,
      name: null,
      picture: null,
      uid: 'firebase-uid-123',
    };
    const verifier = vi.fn().mockResolvedValue(authenticated);
    const env = {
      ADMIN_FIREBASE_UIDS: 'outro-uid',
      FIREBASE_PROJECT_ID: PROJECT_ID,
    };
    await expect(requireUser(new Request('https://example.test', {
      headers: { Authorization: 'Bearer firebase-id-token' },
    }), env, verifier)).resolves.toEqual(authenticated);
    expect(verifier).toHaveBeenCalledWith('firebase-id-token', PROJECT_ID);
  });

  it('bootstrap ADMIN usa somente lista exata de UIDs', () => {
    const admins = bootstrapAdminUids({ ADMIN_FIREBASE_UIDS: 'uid-a, uid-b' });
    expect(admins.has('uid-a')).toBe(true);
    expect(admins.has('UID-A')).toBe(false);
    expect(admins.has('admin@example.com')).toBe(false);
  });
});
