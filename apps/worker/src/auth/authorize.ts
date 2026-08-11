import type { AuthenticatedUser, Env } from '../env.js';
import { ApiError } from '../http/api-error.js';
import { bearerToken, verifyFirebaseIdToken } from './firebase-token.js';

type FirebaseTokenVerifier = (token: string, projectId: string) => Promise<AuthenticatedUser>;

export async function requireUser(
  request: Request,
  env: Pick<Env, 'FIREBASE_PROJECT_ID'>,
  verifier: FirebaseTokenVerifier = verifyFirebaseIdToken,
): Promise<AuthenticatedUser> {
  return verifier(bearerToken(request), env.FIREBASE_PROJECT_ID);
}

export function bootstrapAdminUids(env: Pick<Env, 'ADMIN_FIREBASE_UIDS'>): ReadonlySet<string> {
  return new Set((env.ADMIN_FIREBASE_UIDS ?? '').split(',').map((uid) => uid.trim()).filter(Boolean));
}

export async function requireAdmin(
  user: AuthenticatedUser,
  env: Pick<Env, 'ADMIN_FIREBASE_UIDS' | 'CORE_DB'>,
): Promise<void> {
  if (bootstrapAdminUids(env).has(user.uid)) return;
  const row = await env.CORE_DB.prepare(
    `SELECT 1 AS allowed
       FROM user_roles ur
       JOIN users u ON u.id = ur.user_id
      WHERE u.firebase_uid = ?1 AND ur.role = 'ADMIN'
      LIMIT 1`,
  ).bind(user.uid).first<{ allowed: number }>();
  if (row?.allowed !== 1) throw new ApiError(403, 'ADMIN_REQUIRED', 'Acesso exclusivo da administração.');
}

export async function hasAdminAccess(
  user: AuthenticatedUser,
  env: Pick<Env, 'ADMIN_FIREBASE_UIDS' | 'CORE_DB'>,
): Promise<boolean> {
  try {
    await requireAdmin(user, env);
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'ADMIN_REQUIRED') return false;
    throw error;
  }
}
