import { z } from 'zod';
import { discoveredCount, type ChallengeRecord, type FriendPresence } from '@quiz-gomes/domain';
import { bootstrapAdminUids, hasAdminAccess, requireAdmin, requireUser } from './auth/authorize.js';
import { ChallengeRoom } from './durable-objects/challenge-room.js';
import { MatchRoom } from './durable-objects/match-room.js';
import { MatchmakingQueue } from './durable-objects/matchmaking-queue.js';
import { PresenceHub, type ActivityState } from './durable-objects/presence-hub.js';
import { SocialRealtimeHub } from './durable-objects/social-realtime-hub.js';
import { TicketBroker } from './durable-objects/ticket-broker.js';
import type { Env } from './env.js';
import { ApiError } from './http/api-error.js';
import { readBytes, readJson } from './http/body.js';
import {
  apiErrorResponse,
  applyCors,
  corsHeaders,
  isRequestOriginAllowed,
  json,
  withSecurityHeaders,
} from './http/response.js';
import {
  importBatchSchema,
  profileInputSchema,
  themeArtworkChoiceSchema,
  themeSubmissionSchema,
} from './http/schemas.js';
import { QuestionRepository } from './repositories/question-repository.js';
import { PoolStateRepository } from './repositories/pool-state-repository.js';
import { ThemeRepository } from './repositories/theme-repository.js';
import { UserRepository } from './repositories/user-repository.js';
import { LiveMatchRepository, parseMatchResource } from './repositories/live-match-repository.js';
import { ChallengeRepository } from './repositories/challenge-repository.js';
import { SocialRepository } from './repositories/social-repository.js';
import { QuestionImportService } from './services/question-import-service.js';
import { DirectChallengeService } from './services/direct-challenge-service.js';
import { SocialPushService } from './services/social-push-service.js';
import { inspectWebp, THEME_ARTWORK_MAX_BYTES } from './storage/webp.js';
import { CUSTOM_AVATAR_BYTES, CUSTOM_AVATAR_DIMENSION } from './storage/custom-avatar.js';

export { ChallengeRoom, MatchRoom, MatchmakingQueue, PresenceHub, SocialRealtimeHub, TicketBroker };

const ticketSchema = z.object({
  resource: z.string().min(1).max(256),
  scope: z.enum(['challenge', 'matchmaking', 'presence', 'room', 'social']),
}).strict();

const socialTargetSchema = z.object({
  publicId: z.string().regex(/^#QG[A-Z0-9]{4,32}$/i),
}).strict();

const pushInstallationSchema = z.object({
  installationId: z.string().regex(/^[A-Za-z0-9_-]{10,200}$/),
}).strict();

const challengeCreateSchema = z.object({
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
  kind: z.enum(['DIRECT', 'ASYNC']),
  publicId: z.string().regex(/^#QG[A-Z0-9]{4,32}$/i),
  themeSlug: z.string().min(1).max(160),
}).strict();

// A mesma graça M8 usada pela sala: uma reserva que não conseguiu sequer abrir
// uma metade não pode ocupar a dupla indefinidamente.
const CHALLENGE_INITIAL_GRACE_MS = 7_000;

function validationError(error: z.ZodError): ApiError {
  return new ApiError(400, 'VALIDATION_ERROR', 'Revise os campos enviados.', error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  })));
}

function ticketBroker(env: Env): DurableObjectStub {
  return env.TICKET_BROKER.get(env.TICKET_BROKER.idFromName('global'));
}

function socialRealtimeHub(env: Env): DurableObjectStub {
  return env.SOCIAL_REALTIME_HUB.get(env.SOCIAL_REALTIME_HUB.idFromName('global'));
}

function invalidateSocial(env: Env, context: ExecutionContext, userIds: string[]): void {
  context.waitUntil(socialRealtimeHub(env).fetch('https://social.internal/invalidate', {
    body: JSON.stringify({ userIds }),
    method: 'POST',
  }).then(() => undefined).catch(() => {
    console.error(JSON.stringify({ code: 'SOCIAL_REALTIME_UNAVAILABLE', event: 'social_invalidation_failed' }));
  }));
}

async function releaseTerminalPresence(
  env: Env,
  matches: LiveMatchRepository,
  uid: string,
): Promise<void> {
  const presence = env.PRESENCE_HUB.get(env.PRESENCE_HUB.idFromName(uid));
  const response = await presence.fetch('https://presence.internal/state');
  if (!response.ok) return;
  const state = await response.json<ActivityState>();
  if (state.activity === 'idle' || state.resource === null ||
    !['preparing', 'playing', 'reconnecting', 'finished'].includes(state.activity)) return;
  const membership = await matches.membership(uid, state.resource);
  if (membership === null || !['FINISHED', 'VOID'].includes(membership.matchStatus)) return;
  await presence.fetch('https://presence.internal/transition', {
    body: JSON.stringify({
      from: state.activity,
      fromResource: state.resource,
      resource: null,
      to: 'idle',
    }),
    method: 'POST',
  });
}

async function createRealtimeTicket(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const profile = await new UserRepository(env.CORE_DB).findByFirebaseUid(user.uid);
  if (profile === null) throw new ApiError(409, 'PROFILE_REQUIRED', 'Conclua seu perfil antes de jogar.');
  const parsed = ticketSchema.safeParse(await readJson(request));
  if (!parsed.success) throw validationError(parsed.error);
  const matches = new LiveMatchRepository(env.CORE_DB, env.QUESTIONS_DB);
  if (parsed.data.scope === 'matchmaking') {
    if (parseMatchResource(parsed.data.resource) === null) {
      throw new ApiError(400, 'INVALID_QUEUE', 'A fila escolhida é inválida.');
    }
    if (await matches.activeMatchForFirebaseUid(user.uid) !== null) {
      throw new ApiError(409, 'PLAYER_BUSY', 'Você já está em outra partida.');
    }
  }
  if (parsed.data.scope === 'room') {
    if (!/^[a-f0-9-]{36}$/i.test(parsed.data.resource) ||
      await matches.membership(user.uid, parsed.data.resource) === null) {
      throw new ApiError(403, 'MATCH_ACCESS_DENIED', 'Você não pertence a esta partida.');
    }
  }
  if (parsed.data.scope === 'social' && parsed.data.resource !== 'social') {
    throw new ApiError(400, 'INVALID_REALTIME_RESOURCE', 'Canal social inválido.');
  }
  if (parsed.data.scope === 'challenge') {
    await assertChallengeHalfAccess(env, profile.userId, parsed.data.resource);
  }
  const resource = parsed.data.scope === 'presence' ? user.uid : parsed.data.resource;
  return ticketBroker(env).fetch('https://tickets.internal/create', {
    body: JSON.stringify({ expiresAt: 0, resource, scope: parsed.data.scope, uid: user.uid }),
    headers: { 'X-QG-Authenticated-Uid': user.uid },
    method: 'POST',
  });
}

/**
 * Acesso à metade assíncrona: só participa quem é dono da metade que está aberta
 * agora. O primeiro jogador joga em FIRST_PLAYER_ACTIVE; o segundo, só depois de
 * aceitar, em SECOND_PLAYER_ACTIVE. Nenhum dos dois alcança a metade do outro.
 */
async function assertChallengeHalfAccess(
  env: Env,
  userId: string,
  challengeId: string,
): Promise<{ seat: 'FIRST' | 'SECOND' }> {
  if (!/^[a-f0-9-]{36}$/i.test(challengeId)) {
    throw new ApiError(403, 'CHALLENGE_ACCESS_DENIED', 'Você não pertence a este desafio.');
  }
  const challenge = await new ChallengeRepository(env.CORE_DB).byId(challengeId);
  if (challenge === null || challenge.kind !== 'ASYNC') {
    throw new ApiError(403, 'CHALLENGE_ACCESS_DENIED', 'Você não pertence a este desafio.');
  }
  if (challenge.firstPlayerUserId === userId && challenge.status === 'FIRST_PLAYER_ACTIVE') {
    return { seat: 'FIRST' };
  }
  if (challenge.secondPlayerUserId === userId && challenge.status === 'SECOND_PLAYER_ACTIVE') {
    return { seat: 'SECOND' };
  }
  throw new ApiError(403, 'CHALLENGE_ACCESS_DENIED', 'Você não pertence a este desafio.');
}

async function consumeRealtimeTicket(
  env: Env,
  ticket: string,
  scope: 'challenge' | 'matchmaking' | 'presence' | 'room' | 'social',
  resource: string,
): Promise<string> {
  const response = await ticketBroker(env).fetch('https://tickets.internal/consume', {
    body: JSON.stringify({ resource, scope, ticket }),
    method: 'POST',
  });
  if (!response.ok) throw new ApiError(401, 'INVALID_REALTIME_TICKET', 'O acesso em tempo real expirou.');
  const result = await response.json<{ uid: string }>();
  return result.uid;
}

async function realtimeRoute(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    throw new ApiError(426, 'WEBSOCKET_REQUIRED', 'Esta rota exige WebSocket.');
  }
  const ticket = url.searchParams.get('ticket');
  if (ticket === null || ticket.length > 128) throw new ApiError(401, 'REALTIME_TICKET_REQUIRED', 'Acesso em tempo real inválido.');

  if (url.pathname === '/api/realtime/presence') {
    const resource = url.searchParams.get('resource') ?? '';
    const uid = await consumeRealtimeTicket(env, ticket, 'presence', resource);
    const stub = env.PRESENCE_HUB.get(env.PRESENCE_HUB.idFromName(uid));
    return stub.fetch(new Request('https://presence.internal/socket', { headers: { Upgrade: 'websocket' } }));
  }

  const challengeMatch = /^\/api\/realtime\/challenges\/([a-f0-9-]{36})$/i.exec(url.pathname);
  if (challengeMatch?.[1] !== undefined) {
    const challengeId = challengeMatch[1];
    const uid = await consumeRealtimeTicket(env, ticket, 'challenge', challengeId);
    const profile = await new UserRepository(env.CORE_DB).findByFirebaseUid(uid);
    if (profile === null) throw new ApiError(409, 'PROFILE_REQUIRED', 'Conclua seu perfil antes de jogar.');
    const { seat } = await assertChallengeHalfAccess(env, profile.userId, challengeId);
    const stub = env.CHALLENGE_ROOM.get(env.CHALLENGE_ROOM.idFromName(`${challengeId}:${seat}`));
    const ready = await stub.fetch('https://challenge.internal/initialize', {
      body: JSON.stringify({ challengeId, createdAtMs: Date.now(), seat, userId: profile.userId }),
      method: 'POST',
    });
    if (!ready.ok) {
      const failure = await ready.json<{ error?: { code?: string } }>();
      throw new ApiError(409, failure.error?.code ?? 'CHALLENGE_UNAVAILABLE', 'Este desafio não está disponível.');
    }
    return stub.fetch(new Request('https://challenge.internal/socket', {
      headers: { Upgrade: 'websocket', 'X-QG-Authenticated-User-Id': profile.userId },
    }));
  }

  if (url.pathname === '/api/realtime/social') {
    const uid = await consumeRealtimeTicket(env, ticket, 'social', 'social');
    const profile = await new UserRepository(env.CORE_DB).findByFirebaseUid(uid);
    if (profile === null) throw new ApiError(409, 'PROFILE_REQUIRED', 'Conclua seu perfil antes de acessar o Social.');
    return socialRealtimeHub(env).fetch(new Request('https://social.internal/socket', {
      headers: {
        Upgrade: 'websocket',
        'X-QG-Authenticated-Public-Id': profile.publicId,
        'X-QG-Authenticated-User-Id': profile.userId,
        'X-QG-Presence-Object-Id': env.PRESENCE_HUB.idFromName(uid).toString(),
      },
    }));
  }

  if (url.pathname === '/api/realtime/matchmaking') {
    const resource = url.searchParams.get('resource') ?? '';
    const queueConfiguration = parseMatchResource(resource);
    if (queueConfiguration === null) throw new ApiError(400, 'INVALID_QUEUE', 'A fila escolhida é inválida.');
    const { themeId } = queueConfiguration;
    const uid = await consumeRealtimeTicket(env, ticket, 'matchmaking', resource);
    const userRow = await env.CORE_DB.prepare('SELECT id FROM users WHERE firebase_uid = ?1 AND disabled_at IS NULL')
      .bind(uid).first<{ id: string }>();
    if (userRow === null) throw new ApiError(409, 'PROFILE_REQUIRED', 'Conclua seu perfil antes de jogar.');
    const matches = new LiveMatchRepository(env.CORE_DB, env.QUESTIONS_DB);
    if (await matches.activeMatchForFirebaseUid(uid) !== null) {
      throw new ApiError(409, 'PLAYER_BUSY', 'Você já está em outra partida.');
    }
    await releaseTerminalPresence(env, matches, uid);
    const ranking = await env.CORE_DB.prepare(
      'SELECT knowledge FROM theme_rankings WHERE user_id = ?1 AND theme_id = ?2',
    ).bind(userRow.id, themeId).first<{ knowledge: number }>();
    const presence = env.PRESENCE_HUB.get(env.PRESENCE_HUB.idFromName(uid));
    const reserved = await presence.fetch('https://presence.internal/transition', {
      body: JSON.stringify({ from: 'idle', resource, to: 'matchmaking' }),
      method: 'POST',
    });
    if (!reserved.ok) throw new ApiError(409, 'PLAYER_BUSY', 'Você já está em outra atividade.');
    const queue = env.MATCHMAKING_QUEUE.get(env.MATCHMAKING_QUEUE.idFromName(resource));
    const response = await queue.fetch(new Request('https://queue.internal/socket', {
      headers: {
        Upgrade: 'websocket',
        'X-QG-Authenticated-Uid': uid,
        'X-QG-Match-Resource': resource,
        'X-QG-Theme-Knowledge': String(ranking?.knowledge ?? 0),
      },
    }));
    if (response.status !== 101) {
      await presence.fetch('https://presence.internal/transition', {
        body: JSON.stringify({ from: 'matchmaking', resource: null, to: 'idle' }),
        method: 'POST',
      });
    }
    return response;
  }

  const roomMatch = /^\/api\/realtime\/rooms\/([a-f0-9-]{36})$/i.exec(url.pathname);
  if (roomMatch?.[1] !== undefined) {
    const roomId = roomMatch[1];
    const terminalOnly = url.searchParams.get('terminal') === '1';
    const uid = await consumeRealtimeTicket(env, ticket, 'room', roomId);
    const membership = await new LiveMatchRepository(env.CORE_DB, env.QUESTIONS_DB).membership(uid, roomId);
    if (membership === null) throw new ApiError(403, 'MATCH_ACCESS_DENIED', 'Você não pertence a esta partida.');
    const presence = env.PRESENCE_HUB.get(env.PRESENCE_HUB.idFromName(uid));
    if (membership.matchStatus === 'PREPARING' || membership.matchStatus === 'PLAYING') {
      const claimed = await presence.fetch('https://presence.internal/claim', {
        body: JSON.stringify({ activities: ['preparing', 'playing', 'reconnecting'], resource: roomId }),
        method: 'POST',
      });
      if (!claimed.ok) throw new ApiError(409, 'PLAYER_BUSY', 'Você já está em outra atividade.');
    }
    const room = env.MATCH_ROOM.get(env.MATCH_ROOM.idFromName(roomId));
    return room.fetch(new Request('https://room.internal/socket', {
      headers: {
        Upgrade: 'websocket',
        'X-QG-Authenticated-Uid': uid,
        'X-QG-Terminal-Only': terminalOnly ? '1' : '0',
      },
    }));
  }

  throw new ApiError(404, 'NOT_FOUND', 'Rota em tempo real não encontrada.');
}

async function profileRoute(request: Request, env: Env): Promise<Response> {
  const identity = await requireUser(request, env);
  const repository = new UserRepository(env.CORE_DB);
  if (request.method === 'GET') {
    const profile = await repository.findByFirebaseUid(identity.uid);
    if (profile === null) throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Perfil ainda não criado.');
    return json({ profile, role: await hasAdminAccess(identity, env) ? 'ADMIN' : 'PLAYER' });
  }
  if (request.method === 'POST' || request.method === 'PATCH') {
    const parsed = profileInputSchema.safeParse(await readJson(request));
    if (!parsed.success) throw validationError(parsed.error);
    const profile = request.method === 'POST'
      ? await repository.ensureProfile(identity, parsed.data.displayName, bootstrapAdminUids(env).has(identity.uid))
      : await repository.updateDisplayName(identity.uid, parsed.data.displayName);
    if (profile === null) throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Crie o perfil antes de editá-lo.');
    return json({ profile, role: await hasAdminAccess(identity, env) ? 'ADMIN' : 'PLAYER' }, { status: request.method === 'POST' ? 201 : 200 });
  }
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
}

async function profileAvatarRoute(request: Request, env: Env): Promise<Response> {
  const identity = await requireUser(request, env);
  const repository = new UserRepository(env.CORE_DB);
  let profile;
  if (request.method === 'PUT') {
    if (request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'image/webp') {
      throw new ApiError(415, 'AVATAR_TYPE_INVALID', 'Envie o avatar reencodado em WebP.');
    }
    const data = await readBytes(request, CUSTOM_AVATAR_BYTES, new ApiError(
      413,
      'AVATAR_TOO_LARGE',
      'O avatar deve ter no máximo 50 KB.',
    ));
    const dimensions = inspectWebp(data);
    if (dimensions?.width !== CUSTOM_AVATAR_DIMENSION || dimensions.height !== CUSTOM_AVATAR_DIMENSION) {
      throw new ApiError(400, 'AVATAR_INVALID', 'O avatar precisa ser WebP válido de 256 × 256 px, sem metadata.');
    }
    profile = await repository.replaceCustomAvatar(identity.uid, data);
  } else if (request.method === 'DELETE') {
    profile = await repository.removeCustomAvatar(identity.uid);
  } else {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
  }
  if (profile === null) throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Crie o perfil antes de editar o avatar.');
  return json({ profile, role: await hasAdminAccess(identity, env) ? 'ADMIN' : 'PLAYER' });
}

async function customAvatarRoute(
  request: Request,
  repository: UserRepository,
  userId: string,
  version: number,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
  }
  const avatar = await repository.readCustomAvatar(userId, version);
  if (avatar === null) throw new ApiError(404, 'AVATAR_NOT_FOUND', 'Avatar não encontrado.');
  const etag = `"user-avatar:${userId}:v${version}"`;
  const headers = new Headers({
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Length': String(avatar.byteLength),
    'Content-Type': avatar.contentType,
    ETag: etag,
  });
  if (request.headers.get('If-None-Match') === etag) return new Response(null, { headers, status: 304 });
  return new Response(request.method === 'HEAD' ? null : avatar.data, { headers });
}

async function adminImportRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
  const identity = await requireUser(request, env);
  await requireAdmin(identity, env);
  const profile = await new UserRepository(env.CORE_DB).findByFirebaseUid(identity.uid);
  if (profile === null) throw new ApiError(409, 'PROFILE_REQUIRED', 'Conclua seu perfil.');
  const parsed = importBatchSchema.safeParse(await readJson(request));
  if (!parsed.success) throw validationError(parsed.error);
  const idempotencyKey = request.headers.get('Idempotency-Key') ?? '';
  const result = await new QuestionImportService(env.CORE_DB, env.QUESTIONS_DB)
    .import(profile.userId, idempotencyKey, parsed.data.questions);
  return json(result, { status: result.status === 'APPLIED' ? 201 : 200 });
}

function artworkMutationError(error: unknown): never {
  if (error instanceof Error && error.message === 'THEME_NOT_FOUND') {
    throw new ApiError(404, 'THEME_NOT_FOUND', 'Tema não encontrado.');
  }
  if (error instanceof Error && error.message === 'ARTWORK_VERSION_CONFLICT') {
    throw new ApiError(409, 'ARTWORK_VERSION_CONFLICT', 'A arte deste tema foi alterada em outra sessão. Recarregue e tente novamente.');
  }
  if (error instanceof Error && error.message === 'INVALID_ARTWORK_ICON') {
    throw new ApiError(400, 'INVALID_ARTWORK_ICON', 'O ícone padrão escolhido não está disponível.');
  }
  throw error;
}

function expectedArtworkVersion(request: Request): number {
  const value = request.headers.get('If-Match') ?? '';
  const match = /^(?:W\/)?"?(\d+)"?$/.exec(value.trim());
  const version = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new ApiError(428, 'ARTWORK_VERSION_REQUIRED', 'Recarregue o tema antes de salvar a arte.');
  }
  return version;
}

async function adminThemesRoute(request: Request, env: Env, url: URL): Promise<Response> {
  const identity = await requireUser(request, env);
  await requireAdmin(identity, env);
  if (request.method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
  const search = (url.searchParams.get('search') ?? '').trim().slice(0, 80);
  return json({ themes: await new ThemeRepository(env.CORE_DB).listThemesForAdmin(search) });
}

async function adminThemeArtworkRoute(request: Request, env: Env, themeId: string): Promise<Response> {
  const identity = await requireUser(request, env);
  await requireAdmin(identity, env);
  const themes = new ThemeRepository(env.CORE_DB);
  try {
    if (request.method === 'PATCH') {
      const parsed = themeArtworkChoiceSchema.safeParse(await readJson(request));
      if (!parsed.success) throw validationError(parsed.error);
      return json({ theme: await themes.setArtworkChoice({ ...parsed.data, themeId }) });
    }
    if (request.method === 'PUT') {
      if (request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'image/webp') {
        throw new ApiError(415, 'ARTWORK_TYPE_INVALID', 'Envie a imagem reencodada em WebP.');
      }
      const data = await readBytes(request, THEME_ARTWORK_MAX_BYTES, new ApiError(
        413,
        'ARTWORK_TOO_LARGE',
        'A imagem do tema deve ter no máximo 60 KB.',
      ));
      const dimensions = inspectWebp(data);
      if (dimensions === null) {
        throw new ApiError(400, 'ARTWORK_INVALID', 'A imagem precisa ser WebP quadrada, válida, sem metadata e ter de 256 a 512 px.');
      }
      const theme = await themes.setCustomArtwork({
        data,
        expectedVersion: expectedArtworkVersion(request),
        height: dimensions.height,
        themeId,
        width: dimensions.width,
      });
      return json({ theme });
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
  } catch (error) {
    artworkMutationError(error);
  }
}

async function themeArtworkRoute(
  request: Request,
  themes: ThemeRepository,
  themeId: string,
  version: number,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
  }
  const artwork = await themes.readArtwork(themeId, version);
  if (artwork === null) throw new ApiError(404, 'THEME_ARTWORK_NOT_FOUND', 'Arte do tema não encontrada.');
  const etag = `"theme-artwork:${themeId}:v${version}"`;
  const headers = new Headers({
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Length': String(artwork.byteLength),
    'Content-Type': artwork.contentType,
    ETag: etag,
  });
  if (request.headers.get('If-None-Match') === etag) return new Response(null, { headers, status: 304 });
  return new Response(request.method === 'HEAD' ? null : artwork.data, { headers });
}

function notifySocial(
  env: Env,
  context: ExecutionContext,
  userIds: string[],
  event: Record<string, unknown>,
): void {
  context.waitUntil(socialRealtimeHub(env).fetch('https://social.internal/notify', {
    body: JSON.stringify({ event, userIds }),
    method: 'POST',
  }).then(() => undefined).catch(() => {
    console.error(JSON.stringify({ code: 'SOCIAL_REALTIME_UNAVAILABLE', event: 'challenge_notification_failed' }));
  }));
}

async function friendPresenceOf(env: Env, userId: string): Promise<FriendPresence> {
  const response = await socialRealtimeHub(env).fetch('https://social.internal/snapshot', {
    body: JSON.stringify({ userIds: [userId] }),
    method: 'POST',
  });
  if (!response.ok) {
    throw new ApiError(503, 'SOCIAL_PRESENCE_UNAVAILABLE', 'A presença deste amigo está indisponível.');
  }
  const snapshot = await response.json<{ friends: Array<{ presence: FriendPresence; userId: string }> }>();
  return snapshot.friends.find((friend) => friend.userId === userId)?.presence ?? 'OFFLINE';
}

/**
 * Sinal interno para as salas de metade encerrarem. Idempotente e best-effort: o
 * estado autoritativo do desafio já foi persistido antes desta chamada.
 */
async function abortChallengeRooms(env: Env, challengeId: string): Promise<void> {
  await Promise.all((['FIRST', 'SECOND'] as const).map(async (seat) => {
    try {
      await env.CHALLENGE_ROOM
        .get(env.CHALLENGE_ROOM.idFromName(`${challengeId}:${seat}`))
        .fetch('https://challenge.internal/abort', { method: 'POST' });
    } catch {
      console.error(JSON.stringify({ code: 'CHALLENGE_ROOM_UNAVAILABLE', event: 'challenge_abort_failed' }));
    }
  }));
}

/**
 * Convergência bounded acionada somente em leitura, criação ou ação de desafio.
 * MatchRoom/ChallengeRoom são a fonte da partida; D1 é corrigido aqui quando uma
 * finalização foi interrompida entre os dois. Não há cron, polling ou varredura
 * global: no máximo 50 linhas vivas do próprio usuário.
 */
async function reconcileChallengeLifecycle(
  env: Env,
  context: ExecutionContext,
  challenges: ChallengeRepository,
  userId: string,
): Promise<void> {
  const nowMs = Date.now();
  const expired = await challenges.expireStaleDirect(userId);
  for (const entry of expired) {
    notifySocial(env, context, entry.participants, {
      challengeId: entry.id,
      type: 'CHALLENGE_UPDATED',
    });
  }

  for (const challenge of await challenges.liveLifecycleForUser(userId)) {
    let changed = false;
    if (challenge.kind === 'DIRECT') {
      changed = await challenges.reconcileDirectMatch(challenge);
      const hasNoRoom = challenge.matchId === null ||
        await challenges.directMatchStatus(challenge.matchId) === null;
      if (!changed && ['PREPARING', 'ACTIVE'].includes(challenge.status) &&
        hasNoRoom && nowMs - challenge.updatedAtMs >= CHALLENGE_INITIAL_GRACE_MS) {
        // PREPARING sem match e ACTIVE sem MatchRoom recuperável são reservas
        // quebradas; depois da graça autoritativa elas viram VOID e liberam a dupla.
        changed = await challenges.voidOrphanedLive(
          challenge,
          nowMs - CHALLENGE_INITIAL_GRACE_MS,
        );
      }
    } else if (challenge.status === 'FIRST_PLAYER_ACTIVE' || challenge.status === 'SECOND_PLAYER_ACTIVE') {
      const seat = challenge.status === 'FIRST_PLAYER_ACTIVE' ? 'FIRST' : 'SECOND';
      let phase: string | null = null;
      try {
        const response = await env.CHALLENGE_ROOM
          .get(env.CHALLENGE_ROOM.idFromName(`${challenge.id}:${seat}`))
          .fetch('https://challenge.internal/reconcile', { method: 'POST' });
        if (response.ok) phase = (await response.json<{ phase?: string }>()).phase ?? null;
      } catch {
        // A próxima operação real tenta de novo; o fallback abaixo só toca em
        // reserva velha cujo DO não existe, nunca em uma metade reconectável.
      }
      if (phase === 'MISSING' && nowMs - challenge.updatedAtMs >= CHALLENGE_INITIAL_GRACE_MS) {
        changed = await challenges.voidOrphanedLive(
          challenge,
          nowMs - CHALLENGE_INITIAL_GRACE_MS,
        );
      }
    }
    if (changed) {
      notifySocial(env, context, [challenge.firstPlayerUserId, challenge.secondPlayerUserId], {
        challengeId: challenge.id,
        type: 'CHALLENGE_UPDATED',
      });
    }
  }
}

async function challengeRoute(request: Request, env: Env, url: URL, context: ExecutionContext): Promise<Response> {
  const identity = await requireUser(request, env);
  const users = new UserRepository(env.CORE_DB);
  const profile = await users.findByFirebaseUid(identity.uid);
  if (profile === null) throw new ApiError(409, 'PROFILE_REQUIRED', 'Conclua seu perfil antes de desafiar.');
  const challenges = new ChallengeRepository(env.CORE_DB);

  if (url.pathname === '/api/challenges' && request.method === 'GET') {
    await reconcileChallengeLifecycle(env, context, challenges, profile.userId);
    return json({ challenges: await challenges.forUser(profile.userId) });
  }

  if (url.pathname === '/api/challenges' && request.method === 'POST') {
    const parsed = challengeCreateSchema.safeParse(await readJson(request));
    if (!parsed.success) throw validationError(parsed.error);
    const targetUserId = await challenges.friendTarget(profile.userId, parsed.data.publicId);
    // Libera uma reserva terminal antes de consultar o índice único da dupla.
    await reconcileChallengeLifecycle(env, context, challenges, profile.userId);
    const theme = await env.CORE_DB.prepare(
      "SELECT id FROM themes WHERE slug = ?1 COLLATE NOCASE AND status = 'ACTIVE'",
    ).bind(parsed.data.themeSlug).first<{ id: string }>();
    if (theme === null) throw new ApiError(404, 'THEME_UNAVAILABLE', 'Este tema não está disponível.');
    const created = await challenges.create({
      actorUserId: profile.userId,
      difficulty: parsed.data.difficulty,
      kind: parsed.data.kind,
      targetPresence: parsed.data.kind === 'DIRECT'
        ? await friendPresenceOf(env, targetUserId)
        : 'OFFLINE',
      targetUserId,
      themeId: theme.id,
    });
    // O convite cruzado vira aceite do convite existente, nunca um segundo registro.
    if (created.crossAccepted) {
      return await acceptChallenge(env, context, challenges, users, profile.userId, created.challengeId);
    }
    if (parsed.data.kind === 'ASYNC' && created.created) {
      // O conjunto é sorteado e selado aqui, uma única vez, e servirá os dois jogadores.
      try {
        await challenges.sealQuestionSet(created.challengeId, theme.id, parsed.data.difficulty, env.QUESTIONS_DB);
      } catch (error) {
        await challenges.voidChallenge(created.challengeId);
        throw error;
      }
    }
    notifySocial(env, context, [targetUserId, profile.userId], {
      challengeId: created.challengeId,
      type: 'CHALLENGE_UPDATED',
    });
    const stored = await challenges.byId(created.challengeId);
    return json({
      challengeId: created.challengeId,
      created: created.created,
      // O prazo vem do servidor: o cliente nunca deriva expiração de relógio local.
      expiresAt: stored?.expiresAtMs === null || stored?.expiresAtMs === undefined
        ? null
        : new Date(stored.expiresAtMs).toISOString(),
      ...(parsed.data.kind === 'ASYNC' ? { halfReady: true } : {}),
    });
  }

  const action = /^\/api\/challenges\/([a-f0-9-]{36})\/(accept|decline|cancel)$/i.exec(url.pathname);
  if (action?.[1] !== undefined && action[2] !== undefined && request.method === 'POST') {
    await reconcileChallengeLifecycle(env, context, challenges, profile.userId);
    const challenge = await challenges.byId(action[1]);
    if (challenge === null) throw new ApiError(404, 'CHALLENGE_NOT_FOUND', 'Este desafio não existe mais.');
    if (action[2] === 'accept') {
      return await acceptChallenge(env, context, challenges, users, profile.userId, challenge.id);
    }
    const applied = await challenges.applyAction(challenge, {
      actorUserId: profile.userId,
      type: action[2] === 'cancel' ? 'CANCEL' : 'DECLINE',
    });
    if (!applied) throw new ApiError(409, 'CHALLENGE_CONFLICT', 'Este desafio mudou de estado. Atualize a tela.');
    // A sala da metade aberta precisa parar de finalizar; sem isso ela selaria depois do cancelamento.
    if (challenge.kind === 'ASYNC') await abortChallengeRooms(env, challenge.id);
    notifySocial(env, context, [challenge.firstPlayerUserId, challenge.secondPlayerUserId], {
      challengeId: challenge.id,
      type: 'CHALLENGE_UPDATED',
    });
    return json({ ok: true });
  }

  throw new ApiError(404, 'NOT_FOUND', 'Rota de desafio não encontrada.');
}

/**
 * Aceite do desafio assíncrono: o segundo jogador começa a metade dele na hora.
 *
 * Não existe estado intermediário de "aceito esperando": o CAS leva direto de
 * WAITING_FOR_SECOND para SECOND_PLAYER_ACTIVE, e a partir daí cancelar e recusar
 * deixam de ser permitidos.
 */
async function acceptAsyncChallenge(
  env: Env,
  context: ExecutionContext,
  challenges: ChallengeRepository,
  challenge: ChallengeRecord,
  actorUserId: string,
): Promise<Response> {
  if (challenge.secondPlayerUserId !== actorUserId) {
    throw new ApiError(403, 'NOT_CHALLENGED', 'Só quem foi desafiado pode aceitar.');
  }
  if (challenge.status !== 'WAITING_FOR_SECOND') {
    throw new ApiError(409, 'CHALLENGE_NOT_PENDING', 'Este desafio não aguarda você agora.');
  }
  const claimed = await env.CORE_DB.prepare(
    `UPDATE challenges SET status = 'SECOND_PLAYER_ACTIVE', updated_at = ?1, revision = revision + 1
      WHERE id = ?2 AND revision = ?3 AND status = 'WAITING_FOR_SECOND'`,
  ).bind(new Date().toISOString(), challenge.id, challenge.revision).run();
  if ((claimed.meta.changes ?? 0) !== 1) {
    throw new ApiError(409, 'CHALLENGE_CONFLICT', 'Este desafio mudou de estado. Atualize a tela.');
  }
  notifySocial(env, context, [challenge.firstPlayerUserId, challenge.secondPlayerUserId], {
    challengeId: challenge.id,
    type: 'CHALLENGE_UPDATED',
  });
  void challenges;
  return json({ challengeId: challenge.id, half: 'SECOND' });
}

/**
 * Aceite do desafio simultâneo: revalida tudo server-side no instante do aceite e
 * entrega a sala do MatchRoom existente. O cliente nunca decide elegibilidade.
 */
async function acceptChallenge(
  env: Env,
  context: ExecutionContext,
  challenges: ChallengeRepository,
  users: UserRepository,
  actorUserId: string,
  challengeId: string,
): Promise<Response> {
  const challenge = await challenges.byId(challengeId);
  if (challenge === null) throw new ApiError(404, 'CHALLENGE_NOT_FOUND', 'Este desafio não existe mais.');
  if (challenge.secondPlayerUserId !== actorUserId) {
    throw new ApiError(403, 'NOT_CHALLENGED', 'Só quem foi desafiado pode aceitar.');
  }
  if (challenge.kind === 'ASYNC') return await acceptAsyncChallenge(env, context, challenges, challenge, actorUserId);
  if (challenge.status !== 'PENDING_DIRECT') {
    throw new ApiError(409, 'CHALLENGE_NOT_PENDING', 'Este desafio não aguarda aceite.');
  }
  if (challenge.expiresAtMs !== null && Date.now() >= challenge.expiresAtMs) {
    await challenges.applyAction(challenge, { type: 'EXPIRE' });
    notifySocial(env, context, [challenge.firstPlayerUserId, challenge.secondPlayerUserId], {
      challengeId: challenge.id,
      type: 'CHALLENGE_UPDATED',
    });
    throw new ApiError(409, 'CHALLENGE_EXPIRED', 'Este convite expirou.');
  }
  // A amizade e a ausência de bloqueio são revalidadas no instante do aceite.
  const stillFriends = await env.CORE_DB.prepare(
    `SELECT 1 AS ok FROM friendships
      WHERE user_low_id = MIN(?1, ?2) AND user_high_id = MAX(?1, ?2)
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks b
           WHERE (b.blocker_user_id = ?1 AND b.blocked_user_id = ?2)
              OR (b.blocker_user_id = ?2 AND b.blocked_user_id = ?1)
        )`,
  ).bind(challenge.firstPlayerUserId, challenge.secondPlayerUserId).first();
  if (stillFriends === null) throw new ApiError(404, 'USER_UNAVAILABLE', 'Este usuário não está disponível.');

  const uids = await users.firebaseUidsFor([challenge.firstPlayerUserId, challenge.secondPlayerUserId]);
  const challengerUid = uids.get(challenge.firstPlayerUserId);
  const challengedUid = uids.get(challenge.secondPlayerUserId);
  if (challengerUid === undefined || challengedUid === undefined) {
    throw new ApiError(409, 'PROFILE_REQUIRED', 'Um dos jogadores precisa concluir o perfil.');
  }

  // CAS: só um aceite atravessa, mesmo com múltiplas abas ou retries.
  const claimed = await env.CORE_DB.prepare(
    `UPDATE challenges SET status = 'PREPARING', updated_at = ?1, revision = revision + 1
      WHERE id = ?2 AND revision = ?3 AND status = 'PENDING_DIRECT'`,
  ).bind(new Date().toISOString(), challenge.id, challenge.revision).run();
  if ((claimed.meta.changes ?? 0) !== 1) {
    throw new ApiError(409, 'CHALLENGE_CONFLICT', 'Este desafio mudou de estado. Atualize a tela.');
  }

  let started;
  try {
    started = await new DirectChallengeService(env).start(challenge, [challengerUid, challengedUid]);
  } catch (error) {
    await env.CORE_DB.prepare(
      `UPDATE challenges SET status = 'VOID', updated_at = ?1, revision = revision + 1
        WHERE id = ?2 AND status = 'PREPARING'`,
    ).bind(new Date().toISOString(), challenge.id).run();
    await challenges.cleanupPayload(challenge.id);
    notifySocial(env, context, [challenge.firstPlayerUserId, challenge.secondPlayerUserId], {
      challengeId: challenge.id,
      type: 'CHALLENGE_UPDATED',
    });
    throw error;
  }

  await env.CORE_DB.prepare(
    `UPDATE challenges SET status = 'ACTIVE', match_id = ?1, updated_at = ?2, revision = revision + 1
      WHERE id = ?3 AND status = 'PREPARING'`,
  ).bind(started.roomId, new Date().toISOString(), challenge.id).run();

  notifySocial(env, context, [challenge.firstPlayerUserId], {
    challengeId: challenge.id,
    opponent: started.presentations.get(challengerUid)?.opponent,
    preload: started.presentations.get(challengerUid)?.preload,
    roomId: started.roomId,
    type: 'CHALLENGE_STARTED',
  });
  return json({
    challengeId: challenge.id,
    opponent: started.presentations.get(challengedUid)?.opponent,
    preload: started.presentations.get(challengedUid)?.preload,
    roomId: started.roomId,
  });
}

async function socialRoute(request: Request, env: Env, url: URL, context: ExecutionContext): Promise<Response> {
  const identity = await requireUser(request, env);
  const profile = await new UserRepository(env.CORE_DB).findByFirebaseUid(identity.uid);
  if (profile === null) throw new ApiError(409, 'PROFILE_REQUIRED', 'Conclua seu perfil antes de acessar o Social.');
  const social = new SocialRepository(env.CORE_DB);
  const challenges = new ChallengeRepository(env.CORE_DB);
  const push = new SocialPushService(env, social);

  if (url.pathname === '/api/social' && request.method === 'GET') {
    return json(await social.snapshot(profile.userId));
  }
  if (url.pathname === '/api/social/summary' && request.method === 'GET') {
    return json({ pendingCount: await social.pendingCount(profile.userId), pushConfigured: push.configured });
  }
  if (url.pathname === '/api/social/presence' && request.method === 'GET') {
    const friends = await social.friendPresenceTargets(profile.userId);
    if (friends.length === 0) return json({ friends: [], revision: 0 });
    const response = await socialRealtimeHub(env).fetch('https://social.internal/snapshot', {
      body: JSON.stringify({ userIds: friends.map((friend) => friend.userId) }),
      method: 'POST',
    });
    if (!response.ok) {
      throw new ApiError(503, 'SOCIAL_PRESENCE_UNAVAILABLE', 'A presença dos seus amigos está indisponível.');
    }
    const snapshot = await response.json<{
      friends: Array<{ presence: string; revision: number; userId: string }>;
      revision: number;
    }>();
    const identities = new Map(friends.map((friend) => [friend.userId, friend.publicId]));
    return json({
      friends: snapshot.friends.flatMap((friend) => {
        const publicId = identities.get(friend.userId);
        return publicId === undefined ? [] : [{ presence: friend.presence, publicId, revision: friend.revision }];
      }),
      revision: snapshot.revision,
    });
  }
  if (url.pathname === '/api/social/search' && request.method === 'GET') {
    return json({ users: await social.search(profile.userId, url.searchParams.get('q') ?? '') });
  }
  if (url.pathname === '/api/social/requests' && request.method === 'POST') {
    const parsed = socialTargetSchema.safeParse(await readJson(request));
    if (!parsed.success) throw validationError(parsed.error);
    const result = await social.sendRequest(profile.userId, parsed.data.publicId);
    if (result.created) invalidateSocial(env, context, [profile.userId, result.targetUserId]);
    if (result.created && push.configured) {
      context.waitUntil(push.sendFriendRequest({
        origin: url.origin,
        requestId: result.requestId,
        senderDisplayName: profile.displayName,
        senderUserId: profile.userId,
        targetUserId: result.targetUserId,
      }));
    }
    return json({ created: result.created, request: { id: result.requestId } }, { status: result.created ? 201 : 200 });
  }
  const requestAction = /^\/api\/social\/requests\/([a-f0-9-]{36})\/(accept|reject|cancel)$/i.exec(url.pathname);
  if (requestAction?.[1] !== undefined && requestAction[2] !== undefined && request.method === 'POST') {
    if (requestAction[2] === 'accept') await social.acceptRequest(profile.userId, requestAction[1]);
    if (requestAction[2] === 'reject') await social.rejectRequest(profile.userId, requestAction[1]);
    if (requestAction[2] === 'cancel') await social.cancelRequest(profile.userId, requestAction[1]);
    const affected = await env.CORE_DB.prepare(
      'SELECT sender_user_id, recipient_user_id FROM friend_requests WHERE id = ?1',
    ).bind(requestAction[1]).first<{ recipient_user_id: string; sender_user_id: string }>();
    if (affected !== null) invalidateSocial(env, context, [affected.sender_user_id, affected.recipient_user_id]);
    return json({ ok: true });
  }
  if (url.pathname === '/api/social/friends' && request.method === 'DELETE') {
    const parsed = socialTargetSchema.safeParse(await readJson(request));
    if (!parsed.success) throw validationError(parsed.error);
    await social.removeFriend(profile.userId, parsed.data.publicId);
    const target = await env.CORE_DB.prepare('SELECT user_id FROM user_profiles WHERE public_id = ?1 COLLATE NOCASE')
      .bind(parsed.data.publicId).first<{ user_id: string }>();
    if (target !== null) {
      // Desafios pendentes da dupla morrem junto; partida já iniciada é preservada.
      for (const ended of await challenges.endForRelationship(profile.userId, target.user_id)) {
        if (ended.kind === 'ASYNC') await abortChallengeRooms(env, ended.id);
        notifySocial(env, context, [profile.userId, target.user_id], {
          challengeId: ended.id,
          type: 'CHALLENGE_UPDATED',
        });
      }
      invalidateSocial(env, context, [profile.userId, target.user_id]);
    }
    return json({ ok: true });
  }
  if (url.pathname === '/api/social/blocks') {
    if (request.method === 'GET') return json({ users: await social.blockedUsers(profile.userId) });
    if (request.method === 'POST' || request.method === 'DELETE') {
      const parsed = socialTargetSchema.safeParse(await readJson(request));
      if (!parsed.success) throw validationError(parsed.error);
      if (request.method === 'POST') await social.block(profile.userId, parsed.data.publicId);
      else await social.unblock(profile.userId, parsed.data.publicId);
      const target = await env.CORE_DB.prepare('SELECT user_id FROM user_profiles WHERE public_id = ?1 COLLATE NOCASE')
        .bind(parsed.data.publicId).first<{ user_id: string }>();
      if (target !== null) {
        if (request.method === 'POST') {
          for (const ended of await challenges.endForRelationship(profile.userId, target.user_id)) {
            if (ended.kind === 'ASYNC') await abortChallengeRooms(env, ended.id);
            notifySocial(env, context, [profile.userId, target.user_id], {
              challengeId: ended.id,
              type: 'CHALLENGE_UPDATED',
            });
          }
        }
        invalidateSocial(env, context, [profile.userId, target.user_id]);
      }
      return json({ ok: true });
    }
  }
  if (url.pathname === '/api/social/mutes' && (request.method === 'POST' || request.method === 'DELETE')) {
    const parsed = socialTargetSchema.safeParse(await readJson(request));
    if (!parsed.success) throw validationError(parsed.error);
    if (request.method === 'POST') await social.muteFriend(profile.userId, parsed.data.publicId);
    else await social.unmuteFriend(profile.userId, parsed.data.publicId);
    // Silenciar é privado de quem silencia: o outro lado não recebe invalidação.
    invalidateSocial(env, context, [profile.userId]);
    return json({ muted: request.method === 'POST' });
  }
  if (url.pathname === '/api/social/push/installations'
    && (request.method === 'POST' || request.method === 'DELETE')) {
    const parsed = pushInstallationSchema.safeParse(await readJson(request));
    if (!parsed.success) throw validationError(parsed.error);
    if (request.method === 'POST') await social.registerInstallation(profile.userId, parsed.data.installationId);
    else await social.unregisterInstallation(profile.userId, parsed.data.installationId);
    return json({ enabled: request.method === 'POST' });
  }
  throw new ApiError(404, 'NOT_FOUND', 'Rota social não encontrada.');
}

async function apiRoute(request: Request, env: Env, url: URL, context: ExecutionContext): Promise<Response> {
  if (!isRequestOriginAllowed(request, env.ALLOWED_ORIGINS)) {
    throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Origem não autorizada.');
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env.ALLOWED_ORIGINS) });
  if (url.pathname === '/api/health' && request.method === 'GET') {
    return json({ name: 'QUIZ GOMES', status: 'ok', version: '0.1.0' });
  }
  if (url.pathname === '/api/profile/me') return profileRoute(request, env);
  if (url.pathname === '/api/profile/avatar') return profileAvatarRoute(request, env);
  if (url.pathname === '/api/social' || url.pathname.startsWith('/api/social/')) {
    return socialRoute(request, env, url, context);
  }
  if (url.pathname === '/api/challenges' || url.pathname.startsWith('/api/challenges/')) {
    return challengeRoute(request, env, url, context);
  }
  if (url.pathname === '/api/realtime/tickets' && request.method === 'POST') return createRealtimeTicket(request, env);
  if (url.pathname.startsWith('/api/realtime/') && request.headers.get('Upgrade') !== null) return realtimeRoute(request, env, url);
  if (url.pathname === '/api/admin/questions/import') return adminImportRoute(request, env);
  if (url.pathname === '/api/admin/themes') return adminThemesRoute(request, env, url);

  const adminArtworkMatch = /^\/api\/admin\/themes\/([a-z0-9_-]{1,128})\/artwork$/i.exec(url.pathname);
  if (adminArtworkMatch?.[1] !== undefined) {
    return adminThemeArtworkRoute(request, env, decodeURIComponent(adminArtworkMatch[1]));
  }

  const themes = new ThemeRepository(env.CORE_DB);
  const customAvatarMatch = /^\/api\/avatars\/([a-z0-9_-]{1,128})\/v([1-9]\d*)\.webp$/i.exec(url.pathname);
  if (customAvatarMatch?.[1] !== undefined && customAvatarMatch[2] !== undefined) {
    const version = Number(customAvatarMatch[2]);
    if (!Number.isSafeInteger(version)) throw new ApiError(404, 'NOT_FOUND', 'Rota não encontrada.');
    return customAvatarRoute(request, new UserRepository(env.CORE_DB), decodeURIComponent(customAvatarMatch[1]), version);
  }
  const artworkMatch = /^\/api\/theme-artwork\/([a-z0-9_-]{1,128})\/v([1-9]\d*)\.webp$/i.exec(url.pathname);
  if (artworkMatch?.[1] !== undefined && artworkMatch[2] !== undefined) {
    const version = Number(artworkMatch[2]);
    if (!Number.isSafeInteger(version)) throw new ApiError(404, 'NOT_FOUND', 'Rota não encontrada.');
    return themeArtworkRoute(request, themes, decodeURIComponent(artworkMatch[1]), version);
  }
  if (url.pathname === '/api/categories' && request.method === 'GET') return json({ categories: await themes.listCategories() });
  if (url.pathname === '/api/themes' && request.method === 'GET') {
    const search = (url.searchParams.get('search') ?? '').trim().slice(0, 80);
    const categoryId = url.searchParams.get('category');
    return json({ themes: await themes.listThemes(search, categoryId) });
  }
  if (url.pathname === '/api/themes' && request.method === 'POST') {
    const identity = await requireUser(request, env);
    const profile = await new UserRepository(env.CORE_DB).findByFirebaseUid(identity.uid);
    if (profile === null) throw new ApiError(409, 'PROFILE_REQUIRED', 'Conclua seu perfil antes de criar um tema.');
    const parsed = themeSubmissionSchema.safeParse(await readJson(request));
    if (!parsed.success) throw validationError(parsed.error);
    try {
      return json({ theme: await themes.submitTheme({ ...parsed.data, userId: profile.userId }) }, { status: 201 });
    } catch (error) {
      if (error instanceof Error && error.message === 'CATEGORY_NOT_FOUND') {
        throw new ApiError(400, 'CATEGORY_NOT_FOUND', 'A categoria escolhida não está disponível.');
      }
      if (error instanceof Error && /UNIQUE constraint failed: themes\.name/i.test(error.message)) {
        throw new ApiError(409, 'THEME_ALREADY_EXISTS', 'Já existe um tema com esse nome.');
      }
      throw error;
    }
  }
  const themeMatch = /^\/api\/themes\/([^/]+)$/.exec(url.pathname);
  if (themeMatch?.[1] !== undefined && request.method === 'GET') {
    const theme = await themes.findTheme(decodeURIComponent(themeMatch[1]));
    if (theme === null) throw new ApiError(404, 'THEME_NOT_FOUND', 'Tema não encontrado.');
    const questionRepository = new QuestionRepository(env.QUESTIONS_DB);
    const [topFive, questionCounts] = await Promise.all([
      themes.topFive(theme.id),
      questionRepository.activeCounts(theme.id),
    ]);
    let personal: null | {
      discoveredPercentage: number;
      knowledge: number;
      position: number | null;
      rankedMatches: number;
    } = null;
    if (request.headers.get('Authorization') !== null) {
      const identity = await requireUser(request, env);
      const profile = await new UserRepository(env.CORE_DB).findByFirebaseUid(identity.uid);
      if (profile !== null) {
        const pools = await questionRepository.poolsByTheme(theme.id);
        const states = await Promise.all(pools.map((pool) => new PoolStateRepository(env.CORE_DB).read(profile.userId, pool.id, pool.version)));
        const activeTotal = pools.reduce((total, pool) => total + pool.activeCount, 0);
        const discoveredTotal = pools.reduce((total, pool, index) => {
          const state = states[index];
          return total + (state === undefined ? 0 : discoveredCount(state.state, pool.activeCount));
        }, 0);
        const ranking = await themes.personalRanking(theme.id, profile.userId);
        personal = {
          discoveredPercentage: activeTotal === 0 ? 0 : (discoveredTotal / activeTotal) * 100,
          ...ranking,
        };
      }
    }
    return json({ personal, questionCounts, theme, topFive });
  }
  throw new ApiError(404, 'NOT_FOUND', 'Rota não encontrada.');
}

async function handle(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) {
    try {
      return applyCors(await apiRoute(request, env, url, context), request, env.ALLOWED_ORIGINS);
    } catch (error) {
      return applyCors(apiErrorResponse(error), request, env.ALLOWED_ORIGINS);
    }
  }
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    return withSecurityHeaders(await handle(request, env, context));
  },
} satisfies ExportedHandler<Env>;
