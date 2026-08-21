import type { Env } from '../env.js';
import type { SocialRepository } from '../repositories/social-repository.js';

const OAUTH_ENDPOINT = 'https://oauth2.googleapis.com/token';
const MESSAGING_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

interface CachedAccessToken {
  expiresAtMs: number;
  projectId: string;
  token: string;
}

let cachedAccessToken: CachedAccessToken | null = null;

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function encodedJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function privateKeyBytes(pem: string): Uint8Array<ArrayBuffer> {
  const encoded = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replaceAll(/\s/g, '');
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}

async function signedAssertion(account: ServiceAccount): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const unsigned = `${encodedJson({ alg: 'RS256', typ: 'JWT' })}.${encodedJson({
    aud: OAUTH_ENDPOINT,
    exp: issuedAt + 3_600,
    iat: issuedAt,
    iss: account.client_email,
    scope: MESSAGING_SCOPE,
  })}`;
  const keyBytes = privateKeyBytes(account.private_key);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes,
    { hash: 'SHA-256', name: 'RSASSA-PKCS1-v1_5' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

function accountFrom(env: Env): ServiceAccount | null {
  if (env.FCM_SERVICE_ACCOUNT_JSON === undefined || env.FCM_SERVICE_ACCOUNT_JSON.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const account = parsed as Partial<ServiceAccount>;
    if (typeof account.client_email !== 'string'
      || typeof account.private_key !== 'string'
      || account.project_id !== env.FIREBASE_PROJECT_ID) return null;
    return account as ServiceAccount;
  } catch {
    return null;
  }
}

export class SocialPushService {
  constructor(
    private readonly env: Env,
    private readonly repository: SocialRepository,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  get configured(): boolean {
    return accountFrom(this.env) !== null;
  }

  async sendFriendRequest(input: {
    origin: string;
    requestId: string;
    senderDisplayName: string;
    senderUserId: string;
    targetUserId: string;
  }): Promise<void> {
    const account = accountFrom(this.env);
    if (account === null || await this.repository.blocked(input.senderUserId, input.targetUserId)) return;
    const installations = await this.repository.enabledInstallations(input.targetUserId);
    if (installations.length === 0) return;
    let accessToken: string;
    try {
      accessToken = await this.accessToken(account);
    } catch {
      console.warn(JSON.stringify({ code: 'FCM_AUTH_UNAVAILABLE', requestId: input.requestId }));
      return;
    }
    await Promise.allSettled(installations.map(async (installationId) => {
      try {
        const response = await this.fetcher(
          `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.env.FIREBASE_PROJECT_ID)}/messages:send`,
          {
            body: JSON.stringify({
              message: {
                data: {
                  body: `${input.senderDisplayName} quer adicionar você no Quiz Gomes`,
                  requestId: input.requestId,
                  title: 'Novo pedido de amizade',
                  type: 'FRIEND_REQUEST',
                  url: '/social?section=pedidos',
                },
                fid: installationId,
                webpush: {
                  fcm_options: { link: `${input.origin}/social?section=pedidos` },
                  headers: { TTL: '86400', Urgency: 'normal' },
                },
              },
            }),
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            method: 'POST',
          },
        );
        if (response.ok) {
          await this.repository.markInstallationSuccess(installationId);
          return;
        }
        const result = await response.json<{ error?: { details?: Array<{ errorCode?: string }>; status?: string } }>()
          .catch(() => null);
        const detailCode = result?.error?.details?.find((detail) => detail.errorCode !== undefined)?.errorCode;
        if (response.status === 404 || detailCode === 'UNREGISTERED') {
          await this.repository.disableInstallation(installationId);
        }
        console.warn(JSON.stringify({
          code: detailCode ?? result?.error?.status ?? 'FCM_DELIVERY_FAILED',
          requestId: input.requestId,
          status: response.status,
        }));
      } catch {
        console.warn(JSON.stringify({ code: 'FCM_DELIVERY_UNAVAILABLE', requestId: input.requestId }));
      }
    }));
  }

  private async accessToken(account: ServiceAccount): Promise<string> {
    if (cachedAccessToken !== null
      && cachedAccessToken.projectId === this.env.FIREBASE_PROJECT_ID
      && cachedAccessToken.expiresAtMs > Date.now() + 60_000) {
      return cachedAccessToken.token;
    }
    const assertion = await signedAssertion(account);
    const response = await this.fetcher(OAUTH_ENDPOINT, {
      body: new URLSearchParams({
        assertion,
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    });
    if (!response.ok) throw new Error('FCM_OAUTH_FAILED');
    const payload = await response.json<{ access_token?: string; expires_in?: number }>();
    if (typeof payload.access_token !== 'string') throw new Error('FCM_OAUTH_INVALID');
    cachedAccessToken = {
      expiresAtMs: Date.now() + (payload.expires_in ?? 3_600) * 1_000,
      projectId: this.env.FIREBASE_PROJECT_ID,
      token: payload.access_token,
    };
    return payload.access_token;
  }
}

export function resetSocialPushCacheForTests(): void {
  cachedAccessToken = null;
}
