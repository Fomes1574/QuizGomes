import { SignJWT } from 'jose';

/**
 * Emite um Firebase ID Token real (RS256, claims completas) assinado por um
 * par de chaves gerado na hora, e substitui `globalThis.fetch` para responder
 * ao endpoint de certificados do Google com a chave pública correspondente.
 *
 * Isso existe porque `SELF` roda o Worker `main` de verdade, bundlado por
 * Wrangler — não passa pelo grafo de módulos do Vite, então `vi.mock` nos
 * módulos do próprio Worker não tem efeito nele. Só uma substituição real de
 * `globalThis.fetch` (que roda no mesmo isolate) alcança `verifyFirebaseIdToken`.
 * Chame `restore()` no `afterEach`/`finally` do teste para não vazar o mock.
 */
export async function issueRealFirebaseTestToken(
  uid: string,
  projectId = 'quizgomes-cbc48',
): Promise<{ restore: () => void; token: string }> {
  const certificatesUrl = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
  const keyPair = await crypto.subtle.generateKey(
    { hash: 'SHA-256', modulusLength: 2_048, name: 'RSASSA-PKCS1-v1_5', publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );
  const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(spki)));
  const pem = `-----BEGIN PUBLIC KEY-----\n${(base64.match(/.{1,64}/g) ?? []).join('\n')}\n-----END PUBLIC KEY-----\n`;
  const kid = `test-key-${crypto.randomUUID()}`;
  const now = Math.floor(Date.now() / 1_000);
  const token = await new SignJWT({ auth_time: now })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setAudience(projectId)
    .setIssuer(`https://securetoken.google.com/${projectId}`)
    .setSubject(uid)
    .setIssuedAt(now)
    .setExpirationTime(now + 3_600)
    .sign(keyPair.privateKey);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === certificatesUrl) {
      return Response.json({ [kid]: pem }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
    }
    return originalFetch(input, init);
  };

  return { restore: () => { globalThis.fetch = originalFetch; }, token };
}
