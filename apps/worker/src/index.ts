import { z } from 'zod';
import { discoveredCount } from '@quiz-gomes/domain';
import { bootstrapAdminUids, hasAdminAccess, requireAdmin, requireUser } from './auth/authorize.js';
import { MatchRoom } from './durable-objects/match-room.js';
import { MatchmakingQueue } from './durable-objects/matchmaking-queue.js';
import { PresenceHub, type ActivityState } from './durable-objects/presence-hub.js';
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
import { QuestionImportService } from './services/question-import-service.js';
import { inspectWebp, THEME_ARTWORK_MAX_BYTES } from './storage/webp.js';
import { CUSTOM_AVATAR_BYTES, CUSTOM_AVATAR_DIMENSION } from './storage/custom-avatar.js';

export { MatchRoom, MatchmakingQueue, PresenceHub, TicketBroker };

const ticketSchema = z.object({
  resource: z.string().min(1).max(256),
  scope: z.enum(['matchmaking', 'presence', 'room']),
}).strict();

function validationError(error: z.ZodError): ApiError {
  return new ApiError(400, 'VALIDATION_ERROR', 'Revise os campos enviados.', error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  })));
}

function ticketBroker(env: Env): DurableObjectStub {
  return env.TICKET_BROKER.get(env.TICKET_BROKER.idFromName('global'));
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
  const resource = parsed.data.scope === 'presence' ? user.uid : parsed.data.resource;
  return ticketBroker(env).fetch('https://tickets.internal/create', {
    body: JSON.stringify({ expiresAt: 0, resource, scope: parsed.data.scope, uid: user.uid }),
    headers: { 'X-QG-Authenticated-Uid': user.uid },
    method: 'POST',
  });
}

async function consumeRealtimeTicket(
  env: Env,
  ticket: string,
  scope: 'matchmaking' | 'presence' | 'room',
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

async function apiRoute(request: Request, env: Env, url: URL): Promise<Response> {
  if (!isRequestOriginAllowed(request, env.ALLOWED_ORIGINS)) {
    throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Origem não autorizada.');
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env.ALLOWED_ORIGINS) });
  if (url.pathname === '/api/health' && request.method === 'GET') {
    return json({ name: 'QUIZ GOMES', status: 'ok', version: '0.1.0' });
  }
  if (url.pathname === '/api/profile/me') return profileRoute(request, env);
  if (url.pathname === '/api/profile/avatar') return profileAvatarRoute(request, env);
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

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) {
    try {
      return applyCors(await apiRoute(request, env, url), request, env.ALLOWED_ORIGINS);
    } catch (error) {
      return applyCors(apiErrorResponse(error), request, env.ALLOWED_ORIGINS);
    }
  }
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return withSecurityHeaders(await handle(request, env));
  },
} satisfies ExportedHandler<Env>;
