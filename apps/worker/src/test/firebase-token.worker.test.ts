import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCertificateCacheForTests, verifyFirebaseIdToken } from '../auth/firebase-token.js';

// Fixture inteiramente sintética: não é credencial e não foi emitida por um projeto Firebase real.
const SYNTHETIC_X509_CERTIFICATE = "-----BEGIN CERTIFICATE-----\nMIIDQTCCAimgAwIBAgIURmxaWeFSuTqGwPbzn0gSe3LHzLUwDQYJKoZIhvcNAQEL\nBQAwMDEuMCwGA1UEAwwlUVVJWiBHT01FUyBzeW50aGV0aWMgRmlyZWJhc2UgZml4\ndHVyZTAeFw0yNjA4MTExODI1NDZaFw0zNjA4MDgxODI1NDZaMDAxLjAsBgNVBAMM\nJVFVSVogR09NRVMgc3ludGhldGljIEZpcmViYXNlIGZpeHR1cmUwggEiMA0GCSqG\nSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCucTHdwRY4g0flSbR0nIP/Y9dwLK5zoeqi\nq8a6q2N4lftyzLkug8R+rryPQKL+Ucr0AAZoJDZW1A6evbHOd7PM77Lq5WQEYiCW\nwLiXN7MAaTSdtyln10d4AoLFwWlcOYaOI710KssYIf2KKOI98ZLsMcDZd9O55uqO\nQ614U2POeoRYELI/EZNLZCv2l2F74uurbFb+IyhallPOXj0W7rb/3zln8zuLX+hC\nUAzz9cJJUSqDYVOZYqfl7NCOhrln8tJlDmeU93UN/K8aRPHP9KSjpy8xiCdzUfd+\n+XJwtJrBD84ktHDPq69UfWfwaPRmiMj3KriKoJMkbyNwMwu7BELbAgMBAAGjUzBR\nMB0GA1UdDgQWBBSro/fqBXXQYP1VvcCfTgHjX6mt6jAfBgNVHSMEGDAWgBSro/fq\nBXXQYP1VvcCfTgHjX6mt6jAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUA\nA4IBAQAFfUluTZ25bv3I5O8qg+rZ3bfmh4IZ6GEtMJUst7b/WM15Q/7b2N2+bg0X\nivPC7PVfXIYAFe2MYtkirA5CxQeFBgs+cSU4DRtl9pWi5uprmEpUlmcNn9P9NLNW\nEW8qZ9TkggTw+X9oYTKZ/tYuCVQ/jSw/aqujyT5DhV4J3v1Dro8Yx3EZrO6dkOuY\nwsVfueNQVv6Lw6X9QgJiIsvvSvyPAgDGEazEPW+bTMqdgj4M8Rk9uE6Kj1FxdjD+\nMMJCeK+oeZe3LLNUJ0vCBZBsRkcy2yBAZS1s9hDA3crArK8Xh/epPepFurzInpsE\nqKh1KAucF4zsLZBtoPNPLvw+7ZQ/\n-----END CERTIFICATE-----\n";
const SYNTHETIC_FIREBASE_TOKEN = [
  "eyJhbGciOiJSUzI1NiIsImtpZCI6InN5bnRoZXRpYy14NTA5LWtleSIsInR5cCI6IkpXVCJ9",
  "eyJhdXRoX3RpbWUiOjE3ODY0NDk1OTAsImVtYWlsIjoiZml4dHVyZUBleGFtcGxlLnRlc3QiLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwibmFtZSI6IkZpeHR1cmUgRmlyZWJhc2UiLCJwaWN0dXJlIjoiaHR0cHM6Ly9leGFtcGxlLnRlc3QvYXZhdGFyLnBuZyIsInVzZXJfaWQiOiJmaXJlYmFzZS1maXh0dXJlLXVpZCIsImZpcmViYXNlIjp7ImlkZW50aXRpZXMiOnsiZ29vZ2xlLmNvbSI6WyJmaXh0dXJlLWdvb2dsZS1pZCJdLCJlbWFpbCI6WyJmaXh0dXJlQGV4YW1wbGUudGVzdCJdfSwic2lnbl9pbl9wcm92aWRlciI6Imdvb2dsZS5jb20ifSwiYXVkIjoicXVpemdvbWVzLWNiYzQ4IiwiZXhwIjoxNzg2NDUzMjAwLCJpYXQiOjE3ODY0NDk2MDAsImlzcyI6Imh0dHBzOi8vc2VjdXJldG9rZW4uZ29vZ2xlLmNvbS9xdWl6Z29tZXMtY2JjNDgiLCJzdWIiOiJmaXJlYmFzZS1maXh0dXJlLXVpZCJ9",
  "rRBqZGCZcLzxYd7WPev5B1vTSSUd-6Vm6uXV5SswKhfercHdmN96ekyUvjwxkDmzrhB4EZw7urGp2jl0un6tRO0sBYs76_LI8PzfL-QjxsJ9FsVOoFlVgr1-agwaPVOvQVByjwqk4G1P8BrJasN7QgnvHKhYIyqdnx-hRIrwRcX3VLo37DQQsHRPzNmNM3Nzf5V_ozqBcTmGFlP1HR2AyNoxXC66BH6kY4IqNIT02Gse5SyB4xrdujZ_ES8sulJWHPUAOzdHK5NIwrBiBooV7LbncHS1g-K1Xldz5lcI22ecC95meAzZ1pX2xPV_ogTpWI-gKtS7NpvnE4kzeOpY3w",
].join('.');

describe('Firebase ID Token no runtime Workers', () => {
  beforeEach(() => resetCertificateCacheForTests());
  afterEach(() => vi.useRealTimers());

  it('verifica RS256, X.509 e a estrutura completa de claims Firebase no workerd', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T12:00:10Z'));
    const fetcher = (() => Promise.resolve(Response.json(
      { 'synthetic-x509-key': SYNTHETIC_X509_CERTIFICATE },
      { headers: { 'Cache-Control': 'public, max-age=3600' } },
    ))) as typeof fetch;

    await expect(verifyFirebaseIdToken(
      SYNTHETIC_FIREBASE_TOKEN,
      'quizgomes-cbc48',
      fetcher,
      () => undefined,
    )).resolves.toEqual({
      email: 'fixture@example.test',
      emailVerified: true,
      name: 'Fixture Firebase',
      picture: 'https://example.test/avatar.png',
      uid: 'firebase-fixture-uid',
    });
  });
});
