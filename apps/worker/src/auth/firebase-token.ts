import {
  decodeProtectedHeader,
  errors,
  importSPKI,
  importX509,
  jwtVerify,
  type JWTPayload,
} from 'jose';
import type { AuthenticatedUser } from '../env.js';
import { ApiError } from '../http/api-error.js';

const CERTIFICATES_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const CLOCK_TOLERANCE_SECONDS = 5;

interface CertificateCache {
  certificates: ReadonlyMap<string, string>;
  expiresAtMs: number;
}

export type FirebaseTokenDiagnosticStage = 'claims' | 'configuration' | 'header' | 'keys' | 'signature';

export type FirebaseTokenDiagnosticReason =
  | 'ALGORITHM_INVALID'
  | 'AUDIENCE_INVALID'
  | 'AUTH_TIME_INVALID'
  | 'CLAIMS_INVALID'
  | 'EXPIRATION_INVALID'
  | 'ISSUED_AT_INVALID'
  | 'ISSUER_INVALID'
  | 'KEY_ID_MISSING'
  | 'KEY_IMPORT_FAILED'
  | 'KEY_UNKNOWN'
  | 'KEYS_INVALID'
  | 'KEYS_UNAVAILABLE'
  | 'PROJECT_ID_INVALID'
  | 'SIGNATURE_INVALID'
  | 'SUBJECT_INVALID'
  | 'TOKEN_FORMAT_INVALID'
  | 'TOKEN_SIZE_INVALID'
  | 'VERIFICATION_FAILED';

export interface FirebaseTokenDiagnostic {
  event: 'firebase_id_token_rejected';
  reason: FirebaseTokenDiagnosticReason;
  stage: FirebaseTokenDiagnosticStage;
}

export type FirebaseTokenDiagnosticLogger = (diagnostic: FirebaseTokenDiagnostic) => void;

class FirebaseTokenFailure extends Error {
  constructor(
    readonly diagnostic: FirebaseTokenDiagnostic,
    readonly status = 401,
    readonly publicCode = 'INVALID_TOKEN',
    readonly publicMessage = 'A sessão expirou ou é inválida.',
  ) {
    super(`${diagnostic.stage}:${diagnostic.reason}`);
    this.name = 'FirebaseTokenFailure';
  }
}

let certificateCache: CertificateCache | null = null;

function fail(
  stage: FirebaseTokenDiagnosticStage,
  reason: FirebaseTokenDiagnosticReason,
  options: { code?: string; message?: string; status?: number } = {},
): never {
  throw new FirebaseTokenFailure(
    { event: 'firebase_id_token_rejected', reason, stage },
    options.status,
    options.code,
    options.message,
  );
}

function defaultDiagnosticLogger(diagnostic: FirebaseTokenDiagnostic): void {
  console.warn(diagnostic);
}

function maxAgeMs(cacheControl: string | null): number {
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl ?? '');
  return Number(match?.[1] ?? 300) * 1_000;
}

async function fetchCertificates(fetcher: typeof fetch, force = false): Promise<CertificateCache> {
  const now = Date.now();
  if (!force && certificateCache !== null && certificateCache.expiresAtMs > now) return certificateCache;
  let response: Response;
  try {
    response = await fetcher(CERTIFICATES_URL, { headers: { Accept: 'application/json' } });
  } catch {
    fail('keys', 'KEYS_UNAVAILABLE', {
      code: 'AUTH_KEYS_UNAVAILABLE',
      message: 'Não foi possível validar a sessão agora.',
      status: 503,
    });
  }
  if (!response.ok) {
    fail('keys', 'KEYS_UNAVAILABLE', {
      code: 'AUTH_KEYS_UNAVAILABLE',
      message: 'Não foi possível validar a sessão agora.',
      status: 503,
    });
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    fail('keys', 'KEYS_INVALID', {
      code: 'AUTH_KEYS_INVALID',
      message: 'Não foi possível validar a sessão agora.',
      status: 503,
    });
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail('keys', 'KEYS_INVALID', {
      code: 'AUTH_KEYS_INVALID',
      message: 'Não foi possível validar a sessão agora.',
      status: 503,
    });
  }
  const entries = Object.entries(raw).filter(
    (entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string',
  );
  if (entries.length === 0) {
    fail('keys', 'KEYS_INVALID', {
      code: 'AUTH_KEYS_INVALID',
      message: 'Não foi possível validar a sessão agora.',
      status: 503,
    });
  }
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

function jwtFailure(error: unknown): never {
  if (error instanceof errors.JWTExpired) fail('claims', 'EXPIRATION_INVALID');
  if (error instanceof errors.JWTClaimValidationFailed) {
    switch (error.claim) {
      case 'aud': return fail('claims', 'AUDIENCE_INVALID');
      case 'auth_time': return fail('claims', 'AUTH_TIME_INVALID');
      case 'exp': return fail('claims', 'EXPIRATION_INVALID');
      case 'iat': return fail('claims', 'ISSUED_AT_INVALID');
      case 'iss': return fail('claims', 'ISSUER_INVALID');
      case 'sub': return fail('claims', 'SUBJECT_INVALID');
      default: return fail('claims', 'CLAIMS_INVALID');
    }
  }
  if (error instanceof errors.JWSSignatureVerificationFailed) fail('signature', 'SIGNATURE_INVALID');
  if (error instanceof errors.JOSEAlgNotAllowed) fail('header', 'ALGORITHM_INVALID');
  if (error instanceof errors.JWSInvalid || error instanceof errors.JWTInvalid) {
    fail('header', 'TOKEN_FORMAT_INVALID');
  }
  fail('signature', 'VERIFICATION_FAILED');
}

async function verifyToken(token: string, projectId: string, fetcher: typeof fetch): Promise<AuthenticatedUser> {
  if (typeof projectId !== 'string' || projectId.length === 0 || projectId.length > 128 || projectId.trim() !== projectId) {
    fail('configuration', 'PROJECT_ID_INVALID', {
      code: 'AUTH_CONFIGURATION_INVALID',
      message: 'Não foi possível validar a sessão agora.',
      status: 503,
    });
  }
  if (token.length === 0 || token.length > 8_192) fail('header', 'TOKEN_SIZE_INVALID');
  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    header = decodeProtectedHeader(token);
  } catch {
    fail('header', 'TOKEN_FORMAT_INVALID');
  }
  if (header.alg !== 'RS256') fail('header', 'ALGORITHM_INVALID');
  if (typeof header.kid !== 'string' || header.kid.length === 0) fail('header', 'KEY_ID_MISSING');

  let keys = await fetchCertificates(fetcher);
  let certificate = keys.certificates.get(header.kid);
  if (certificate === undefined) {
    keys = await fetchCertificates(fetcher, true);
    certificate = keys.certificates.get(header.kid);
  }
  if (certificate === undefined) fail('keys', 'KEY_UNKNOWN');

  let key: CryptoKey;
  try {
    key = certificate.includes('BEGIN CERTIFICATE')
      ? await importX509(certificate, 'RS256')
      : await importSPKI(certificate, 'RS256');
  } catch {
    fail('keys', 'KEY_IMPORT_FAILED', {
      code: 'AUTH_KEYS_INVALID',
      message: 'Não foi possível validar a sessão agora.',
      status: 503,
    });
  }

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, key, {
      algorithms: ['RS256'],
      audience: projectId,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      issuer: `https://securetoken.google.com/${projectId}`,
      requiredClaims: ['aud', 'auth_time', 'exp', 'iat', 'iss', 'sub'],
    }));
  } catch (error) {
    jwtFailure(error);
  }

  const nowSeconds = Math.floor(Date.now() / 1_000);
  if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 128) {
    fail('claims', 'SUBJECT_INVALID');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) fail('claims', 'EXPIRATION_INVALID');
  if (typeof payload.iat !== 'number' || payload.iat > nowSeconds + CLOCK_TOLERANCE_SECONDS) {
    fail('claims', 'ISSUED_AT_INVALID');
  }
  if (typeof payload.auth_time !== 'number' || payload.auth_time > nowSeconds + CLOCK_TOLERANCE_SECONDS) {
    fail('claims', 'AUTH_TIME_INVALID');
  }
  return {
    email: claimString(payload, 'email'),
    emailVerified: payload.email_verified === true,
    name: claimString(payload, 'name'),
    picture: claimString(payload, 'picture'),
    uid: payload.sub,
  };
}

export async function verifyFirebaseIdToken(
  token: string,
  projectId: string,
  fetcher: typeof fetch = fetch,
  diagnosticLogger: FirebaseTokenDiagnosticLogger = defaultDiagnosticLogger,
): Promise<AuthenticatedUser> {
  try {
    return await verifyToken(token, projectId, fetcher);
  } catch (error) {
    const failure = error instanceof FirebaseTokenFailure
      ? error
      : new FirebaseTokenFailure({
        event: 'firebase_id_token_rejected',
        reason: 'VERIFICATION_FAILED',
        stage: 'signature',
      });
    try {
      diagnosticLogger(failure.diagnostic);
    } catch {
      // O diagnóstico jamais pode alterar a decisão de autenticação.
    }
    throw new ApiError(failure.status, failure.publicCode, failure.publicMessage);
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
