import { decodeProtectedHeader, importSPKI, importX509, jwtVerify, type JWTPayload } from 'jose';
import type { AuthenticatedUser } from '../env.js';
import { ApiError } from '../http/api-error.js';

const CERTIFICATES_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const CLOCK_TOLERANCE_SECONDS = 5;

interface CertificateCache {
  certificates: ReadonlyMap<string, string>;
  expiresAtMs: number;
}

let certificateCache: CertificateCache | null = null;

function maxAgeMs(cacheControl: string | null): number {
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl ?? '');
  return Number(match?.[1] ?? 300) * 1_000;
}

async function fetchCertificates(fetcher: typeof fetch, force = false): Promise<CertificateCache> {
  const now = Date.now();
  if (!force && certificateCache !== null && certificateCache.expiresAtMs > now) return certificateCache;
  const response = await fetcher(CERTIFICATES_URL, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new ApiError(503, 'AUTH_KEYS_UNAVAILABLE', 'Não foi possível validar a sessão agora.');
  const raw = await response.json();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ApiError(503, 'AUTH_KEYS_INVALID', 'As chaves de autenticação recebidas são inválidas.');
  }
  const entries = Object.entries(raw).filter(
    (entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string',
  );
  if (entries.length === 0) throw new ApiError(503, 'AUTH_KEYS_INVALID', 'Nenhuma chave de autenticação foi recebida.');
  certificateCache = {
    certificates: new Map(entries),
    expiresAtMs: now + maxAgeMs(response.headers.get('Cache-Control')),
  };
  return certificateCache;
}

function claimString(payload: JWTPayload, name: string): string | null {
  const value = payload[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function verifyFirebaseIdToken(
  token: string,
  projectId: string,
  fetcher: typeof fetch = fetch,
): Promise<AuthenticatedUser> {
  if (token.length === 0 || token.length > 8_192) throw new ApiError(401, 'INVALID_TOKEN', 'Sessão inválida.');
  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    header = decodeProtectedHeader(token);
  } catch {
    throw new ApiError(401, 'INVALID_TOKEN', 'Sessão inválida.');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length === 0) {
    throw new ApiError(401, 'INVALID_TOKEN_HEADER', 'Sessão inválida.');
  }

  let keys = await fetchCertificates(fetcher);
  let certificate = keys.certificates.get(header.kid);
  if (certificate === undefined) {
    keys = await fetchCertificates(fetcher, true);
    certificate = keys.certificates.get(header.kid);
  }
  if (certificate === undefined) throw new ApiError(401, 'UNKNOWN_TOKEN_KEY', 'Sessão inválida.');

  try {
    const key = certificate.includes('BEGIN CERTIFICATE')
      ? await importX509(certificate, 'RS256')
      : await importSPKI(certificate, 'RS256');
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['RS256'],
      audience: projectId,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      issuer: `https://securetoken.google.com/${projectId}`,
    });
    const nowSeconds = Math.floor(Date.now() / 1_000);
    if (
      typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 128 ||
      typeof payload.exp !== 'number' || payload.exp <= nowSeconds ||
      typeof payload.iat !== 'number' || payload.iat > nowSeconds + CLOCK_TOLERANCE_SECONDS ||
      typeof payload.auth_time !== 'number' || payload.auth_time > nowSeconds + CLOCK_TOLERANCE_SECONDS
    ) {
      throw new Error('claims');
    }
    return {
      email: claimString(payload, 'email'),
      emailVerified: payload.email_verified === true,
      name: claimString(payload, 'name'),
      picture: claimString(payload, 'picture'),
      uid: payload.sub,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, 'INVALID_TOKEN', 'A sessão expirou ou é inválida.');
  }
}

export function bearerToken(request: Request): string {
  const authorization = request.headers.get('Authorization');
  if (authorization === null) throw new ApiError(401, 'AUTH_REQUIRED', 'Entre com sua conta para continuar.');
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (match?.[1] === undefined) throw new ApiError(401, 'INVALID_AUTH_HEADER', 'Cabeçalho de autenticação inválido.');
  return match[1];
}

export function resetCertificateCacheForTests(): void {
  certificateCache = null;
}
