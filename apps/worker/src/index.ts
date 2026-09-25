import { z } from 'zod';
import { discoveredCount, utcDayKey, type ChallengeRecord, type FriendPresence } from '@quiz-gomes/domain';
import { bootstrapAdminUids, hasAdminAccess, requireAdmin, requireUser } from './auth/authorize.js';
import { ChallengeRoom } from './durable-objects/challenge-room.js';
import { MatchRoom } from './durable-objects/match-room.js';
import { MatchmakingQueue } from './durable-objects/matchmaking-queue.js';
import { PresenceHub, type ActivityState } from './durable-objects/presence-hub.js';
import { SocialRealtimeHub } from './durable-objects/social-realtime-hub.js';
import { TicketBroker } from './durable-objects/ticket-broker.js';
import type { Env } from './env.js';
import { ApiError } from './http/api-error.js';
import { readBytes, readJson, readText } from './http/body.js';
import {
  apiErrorResponse,
  applyCors,
  corsHeaders,
  isRequestOriginAllowed,
  json,
  withSecurityHeaders,
} from './http/response.js';
import {
  categoryCreationSchema,
  categoryUpdateSchema,
  importBatchSchema,
  profileInputSchema,
  questionBatchApprovalSchema,
  questionEditorialSchema,
  questionEditSchema,
  questionRejectionSchema,
  reportCreationSchema,
  reportResolutionSchema,
  themeArtworkChoiceSchema,
  themeEditSchema,
  themeModerationCasSchema,
  themeRejectionSchema,
  themeSubmissionSchema,
} from './http/schemas.js';
import { AuditLogRepository } from './repositories/audit-log-repository.js';
import { MissionRepository } from './repositories/mission-repository.js';
import { QuestionEditorialRepository } from './repositories/question-editorial-repository.js';
import { QuestionRepository } from './repositories/question-repository.js';
import { PoolStateRepository } from './repositories/pool-state-repository.js';
import { ReportRepository, type ReportRecord } from './repositories/report-repository.js';
import { StreakRepository } from './repositories/streak-repository.js';
import { ThemeRepository } from './repositories/theme-repository.js';
import { UserRepository } from './repositories/user-repository.js';
import { LiveMatchRepository, parseMatchResource } from './repositories/live-match-repository.js';
import { ChallengeRepository } from './repositories/challenge-repository.js';
import { SocialRepository } from './repositories/social-repository.js';
import { QuestionImportService } from './services/question-import-service.js';
import { questionExportCsvHeader, questionExportCsvRow } from './services/question-export.js';
import { parseQuestionsCsv } from './services/question-csv.js';
import { DirectChallengeService } from './services/direct-challenge-service.js';
import { SocialPushService } from './services/social-push-service.js';
import { inspectQuestionImageWebp, inspectWebp, QUESTION_IMAGE_MAX_BYTES, THEME_ARTWORK_MAX_BYTES } from './storage/webp.js';
import { CUSTOM_AVATAR_BYTES, CUSTOM_AVATAR_DIMENSION } from './storage/custom-avatar.js';
import { isQuestionImageKey, R2ImageStorage } from './storage/image-storage.js';

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
    // Autocura: uma tentativa anterior pode ter deixado a presença travada em
    // 'matchmaking' sem partida nenhuma por trás (queda de rede, fila que não
    // respondeu, aba fechada antes do socket confirmar). Diferente de uma
    // partida em andamento, esse estado nunca tem `matches` para preservar, e
    // sem essa liberação o jogador nunca mais conseguiria clicar em "Puxar
    // partida" de novo.
    const staleState = await presence.fetch('https://presence.internal/state');
    if (staleState.ok) {
      const state = await staleState.json<ActivityState>();
      if (state.activity === 'matchmaking') {
        await presence.fetch('https://presence.internal/transition', {
          body: JSON.stringify({ from: 'matchmaking', fromResource: state.resource, resource: null, to: 'idle' }),
          method: 'POST',
        });
      }
    }
    const reserved = await presence.fetch('https://presence.internal/transition', {
      body: JSON.stringify({ from: 'idle', resource, to: 'matchmaking' }),
      method: 'POST',
    });
    if (!reserved.ok) throw new ApiError(409, 'PLAYER_BUSY', 'Você já está em outra atividade.');
    const queue = env.MATCHMAKING_QUEUE.get(env.MATCHMAKING_QUEUE.idFromName(resource));
    let response: Response;
    try {
      response = await queue.fetch(new Request('https://queue.internal/socket', {
        headers: {
          Upgrade: 'websocket',
          'X-QG-Authenticated-Uid': uid,
          'X-QG-Match-Resource': resource,
          'X-QG-Theme-Knowledge': String(ranking?.knowledge ?? 0),
        },
      }));
    } catch (queueError) {
      // Sem isso, uma falha ao contatar a fila (DO indisponível, erro de
      // rede interno) deixaria a presença travada em 'matchmaking' para
      // sempre: nenhum outro caminho do sistema libera esse estado.
      await presence.fetch('https://presence.internal/transition', {
        body: JSON.stringify({ from: 'matchmaking', resource: null, to: 'idle' }),
        method: 'POST',
      });
      throw queueError;
    }
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

async function profileSummaryRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
  const identity = await requireUser(request, env);
  const repository = new UserRepository(env.CORE_DB);
  const profile = await repository.findByFirebaseUid(identity.uid);
  if (profile === null) throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Perfil ainda não criado.');
  const dayKey = utcDayKey(Date.now());
  return json({
    activeStreak: await new StreakRepository(env.CORE_DB).activeStreakWithTheme(profile.userId),
    bestTheme: await repository.bestTheme(profile.userId),
    categoryAverages: await repository.categoryAverages(profile.userId),
    matchSummary: await repository.matchSummary(profile.userId),
    missions: await new MissionRepository(env.CORE_DB).listForDay(profile.userId, dayKey),
  });
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

/**
 * Bucket privado: a URL pública passa pelo Worker e só abre objetos já
 * referenciados por uma pergunta. Nunca há `r2.dev`, listagem de chave ou
 * credencial exposta ao cliente.
 */
async function questionImageRoute(request: Request, env: Env, key: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
  }
  if (!isQuestionImageKey(key)) throw new ApiError(404, 'NOT_FOUND', 'Imagem não encontrada.');
  const referenced = await env.QUESTIONS_DB.prepare('SELECT 1 FROM questions WHERE image_key = ?1 LIMIT 1')
    .bind(key).first();
  if (referenced === null) throw new ApiError(404, 'NOT_FOUND', 'Imagem não encontrada.');
  const object = await new R2ImageStorage(env.QUESTION_IMAGES).object(key);
  if (object === null || object.httpMetadata?.contentType !== 'image/webp') {
    throw new ApiError(404, 'NOT_FOUND', 'Imagem não encontrada.');
  }
  const headers = new Headers({
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Length': String(object.size),
    'Content-Type': 'image/webp',
    ETag: object.httpEtag,
    'X-Content-Type-Options': 'nosniff',
  });
  if (request.headers.get('If-None-Match') === object.httpEtag) return new Response(null, { headers, status: 304 });
  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}

const CSV_IMPORT_MAX_BYTES = 256 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function applyDefaultThemeToImport(payload: unknown, defaultThemeId: string | undefined): unknown {
  if (defaultThemeId === undefined || !isRecord(payload)) return payload;
  const candidate = payload;
  if (!Array.isArray(candidate.questions)) return payload;
  const questions: unknown[] = candidate.questions;
  return {
    ...candidate,
    questions: questions.map((question) => (
      isRecord(question)
        ? { ...question, themeId: defaultThemeId }
        : question
    )),
  };
}

async function adminImportRoute(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
  const identity = await requireUser(request, env);
  await requireAdmin(identity, env);
  const profile = await new UserRepository(env.CORE_DB).findByFirebaseUid(identity.uid);
  if (profile === null) throw new ApiError(409, 'PROFILE_REQUIRED', 'Conclua seu perfil.');
  const contentType = request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const isCsv = contentType === 'text/csv';
  const requestedThemeId = url.searchParams.get('themeId')?.trim();
  const defaultThemeId = requestedThemeId === '' || requestedThemeId === undefined ? undefined : requestedThemeId;

  let importedQuestions;
  if (isCsv) {
    const text = await readText(request, CSV_IMPORT_MAX_BYTES);
    const { diagnostics, questions: parsedQuestions } = parseQuestionsCsv(text, defaultThemeId);
    if (diagnostics.length > 0) {
      // `details` precisa ser o array em si: `apiErrorResponse` o repassa tal
      // como está, e o cliente só reconhece diagnóstico por linha quando
      // `Array.isArray(error.details)` é verdadeiro.
      throw new ApiError(400, 'CSV_VALIDATION_ERROR', 'Revise as linhas indicadas do CSV.', diagnostics);
    }
    importedQuestions = parsedQuestions;
  } else {
    const parsed = importBatchSchema.safeParse(applyDefaultThemeToImport(await readJson(request), defaultThemeId));
    if (!parsed.success) throw validationError(parsed.error);
    importedQuestions = parsed.data.questions;
  }

  const idempotencyKey = request.headers.get('Idempotency-Key') ?? '';
  const result = await new QuestionImportService(env.CORE_DB, env.QUESTIONS_DB)
    .import(profile.userId, idempotencyKey, importedQuestions);
  await auditLog(env, profile.userId, 'IMPORT_QUESTIONS_BATCH', 'theme', defaultThemeId ?? 'multiple', {
    imported: result.imported, questionCount: importedQuestions.length, status: result.status,
  });
  return json(result, { status: result.status === 'APPLIED' ? 201 : 200 });
}

function exportFilename(themeId: string, format: 'csv' | 'json'): string {
  return `quiz-gomes-${themeId}-perguntas.${format}`;
}

/**
 * Exportação integral sem OFFSET e sem materializar o catálogo todo. O arquivo
 * contém também itens em revisão/rejeitados/desativados: é um relatório
 * editorial, não um payload de partida nem um atalho de importação pública.
 */
async function adminThemeQuestionsExportRoute(
  request: Request,
  env: Env,
  themeId: string,
  format: 'csv' | 'json',
): Promise<Response> {
  if (request.method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
  const identity = await requireUser(request, env);
  await requireAdmin(identity, env);
  const profile = await new UserRepository(env.CORE_DB).findByFirebaseUid(identity.uid);
  if (profile === null) throw new ApiError(409, 'PROFILE_REQUIRED', 'Conclua seu perfil.');
  if (await new ThemeRepository(env.CORE_DB).themeEditAccess(themeId, profile.userId) === null) {
    throw new ApiError(404, 'THEME_NOT_FOUND', 'Tema não encontrado.');
  }

  const questions = new QuestionEditorialRepository(env.QUESTIONS_DB);
  const encoder = new TextEncoder();
  const exportedAt = new Date().toISOString();
  let cursor: string | null = null;
  let started = false;
  let firstJsonRecord = true;
  let complete = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!started) {
          started = true;
          controller.enqueue(encoder.encode(format === 'csv'
            ? questionExportCsvHeader()
            : `{"schemaVersion":1,"themeId":${JSON.stringify(themeId)},"exportedAt":${JSON.stringify(exportedAt)},"questions":[`));
        }
        if (complete) {
          controller.close();
          return;
        }
        const page = await questions.listForExport({ cursor, themeId });
        for (const question of page.questions) {
          const chunk = format === 'csv'
            ? questionExportCsvRow(question)
            : `${firstJsonRecord ? '' : ','}${JSON.stringify(question)}`;
          firstJsonRecord = false;
          controller.enqueue(encoder.encode(chunk));
        }
        cursor = page.nextCursor;
        if (cursor === null) {
          if (format === 'json') controller.enqueue(encoder.encode(']}'));
          complete = true;
        }
      } catch (error) {
        controller.error(error);
      }
    },
  });
  await auditLog(env, profile.userId, 'EXPORT_THEME_QUESTIONS', 'theme', themeId, { format });
  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${exportFilename(themeId, format)}"`,
      'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
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

async function auditLog(
  env: Env,
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await env.CORE_DB.prepare(
    `INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, metadata_json)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  ).bind(crypto.randomUUID(), actorUserId, action, entityType, entityId, JSON.stringify(metadata)).run();
}

async function adminCategoriesRoute(request: Request, env: Env): Promise<Response> {
  const identity = await requireUser(request, env);
  await requireAdmin(identity, env);
  const profile = await new UserRepository(env.CORE_DB).findByFirebaseUid(identity.uid);
  if (profile === null) throw new ApiError(409, 'PROFILE_REQUIRED', 'Conclua seu perfil.');
  const themes = new ThemeRepository(env.CORE_DB);
  if (request.method === 'GET') return json({ categories: await themes.listCategoriesForAdmin() });
  if (request.method === 'POST') {
    const parsed = categoryCreationSchema.safeParse(await readJson(request));
    if (!parsed.success) throw validationError(parsed.error);
    const category = await themes.createCategory(parsed.data);
    await auditLog(env, profile.userId, 'CREATE_CATEGORY', 'category', category.id, { name: category.name });
    return json({ category }, { status: 201 });
  }
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
}

async function adminCategoryUpdateRoute(request: Request, env: Env, categoryId: string): Promise<Response> {
  if (request.method !== 'PATCH') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
  const identity = await requireUser(request, env);
  await requireAdmin(identity, env);
  const profile = await new UserRepository(env.CORE_DB).findByFirebaseUid(identity.uid);
  if (profile === null) throw new ApiError(409, 'PROFILE_REQUIRED', 'Conclua seu perfil.');
  const parsed = categoryUpdateSchema.safeParse(await readJson(request));
  if (!parsed.success) throw validationError(parsed.error);
  const category = await new ThemeRepository(env.CORE_DB).updateCategory({ id: categoryId, ...parsed.data });
  await auditLog(env, profile.userId, 'UPDATE_CATEGORY', 'category', categoryId, { status: category.status });
  return json({ category });
}

async function adminUsersRoute(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
  const identity = await requireUser(request, env);
  await requireAdmin(identity, env);
  const search = (url.searchParams.get('search') ?? '').trim().slice(0, 80);
  const cursor = url.searchParams.get('cursor');
  return json(await new UserRepository(env.CORE_DB).listForAdmin({ cursor, search }));
}

/**
 * Concede ou revoga ADMIN, já com o ator autenticado/autorizado resolvido.
 * Separado de `adminUserRoleRoute` (que só cuida de auth/roteamento) para ser
 * testável diretamente, no mesmo padrão de `acceptChallenge`.
 */
export async function setAdminRoleForUser(
  env: Env, actorUserId: string, targetUserId: string, granted: boolean,
): Promise<Response> {
  const users = new UserRepository(env.CORE_DB);
  if (!granted) {
    // Ninguém revoga o próprio acesso: evita travar o painel para si mesmo por engano.
    if (targetUserId === actorUserId) {
      throw new ApiError(409, 'CANNOT_REVOKE_SELF', 'Você não pode revogar o próprio acesso de ADMIN.');
    }
    // UID de bootstrap (`ADMIN_FIREBASE_UIDS`) continua ADMIN mesmo sem a
    // role no banco — revogar aqui só apagaria a linha sem tirar acesso
    // nenhum, deixando a trilha de auditoria dizer algo que não aconteceu.
    const targetUid = (await users.firebaseUidsFor([targetUserId])).get(targetUserId);
    if (targetUid !== undefined && bootstrapAdminUids(env).has(targetUid)) {
      throw new ApiError(
        409, 'CANNOT_REVOKE_BOOTSTRAP_ADMIN',
        'Este usuário é ADMIN por configuração do ambiente e não pode ser revogado por aqui.',
      );
    }
  }
  const outcome = await users.setAdminRole(targetUserId, granted, actorUserId);
  if (outcome === 'LAST_ADMIN') {
    throw new ApiError(409, 'LAST_ADMIN_ROLE', 'Pelo menos um ADMIN precisa continuar com acesso.');
  }
  await auditLog(env, actorUserId, granted ? 'GRANT_ADMIN_ROLE' : 'REVOKE_ADMIN_ROLE', 'user', targetUserId, {});
  return json({ ok: true });
}

async function adminUserRoleRoute(request: Request, env: Env, targetUserId: string): Promise<Response> {
  if (request.method !== 'POST' && request.method !== 'DELETE') {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
  }
  const identity = await requireUser(request, env);
  await requireAdmin(identity, env);
  const profile = await new UserRepository(env.CORE_DB).findByFirebaseUid(identity.uid);
  if (profile === null) throw new ApiError(409, 'PROFILE_REQUIRED', 'Conclua seu perfil.');
  return setAdminRoleForUser(env, profile.userId, targetUserId, request.method === 'POST');
}

async function adminAuditLogRoute(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
  const identity = await requireUser(request, env);
  await requireAdmin(identity, env);
  const cursor = url.searchParams.get('cursor');
  return json(await new AuditLogRepository(env.CORE_DB).list({ cursor }));
}

/**
 * Moderação de tema: aprovar concede OWNER a quem propôs, rejeitar/editar/
 * desativar seguem CAS por `revision`. Edição aceita ADMIN em qualquer tema
 * ou o OWNER do próprio tema USER; nunca o dono de um tema OFFICIAL.
 */
async function adminThemeModerationRoute(
  request: Request,
  env: Env,
  themeId: string,
  action: 'approve' | 'deactivate' | 'edit' | 'reject',
): Promise<Response> {
  if (request.method !== 'POST' && !(action === 'edit' && request.method === 'PATCH')) {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
  }
  const identity = await requireUser(request, env);
  const profile = await new UserRepository(env.CORE_DB).findByFirebaseUid(identity.uid);
  if (profile === null) throw new ApiError(409, 'PROFILE_REQUIRED', 'Conclua seu perfil.');
  const themes = new ThemeRepository(env.CORE_DB);
  const isAdmin = await hasAdminAccess(identity, env);

  if (action === 'edit') {
    if (!isAdmin) {
      const access = await themes.themeEditAccess(themeId, profile.userId);
      if (access === null) throw new ApiError(404, 'THEME_NOT_FOUND', 'Tema não encontrado.');
      if (access.origin !== 'USER' || !access.owned) {
        throw new ApiError(403, 'THEME_EDIT_FORBIDDEN', 'Você não pode editar este tema.');
      }
    }
    const parsed = themeEditSchema.safeParse(await readJson(request));
    if (!parsed.success) throw validationError(parsed.error);
    const theme = await themes.editTheme({ themeId, ...parsed.data });
    await auditLog(env, profile.userId, 'EDIT_THEME', 'theme', themeId, { name: theme.name });
    return json({ theme });
  }

  await requireAdmin(identity, env);
  if (action === 'approve') {
    const parsed = themeModerationCasSchema.safeParse(await readJson(request));
    if (!parsed.success) throw validationError(parsed.error);
    const theme = await themes.approveTheme({ expectedRevision: parsed.data.expectedRevision, themeId });
    await auditLog(env, profile.userId, 'APPROVE_THEME', 'theme', themeId, {});
    return json({ theme });
  }
  if (action === 'reject') {
    const parsed = themeRejectionSchema.safeParse(await readJson(request));
    if (!parsed.success) throw validationError(parsed.error);
    const theme = await themes.rejectTheme({
      expectedRevision: parsed.data.expectedRevision, note: parsed.data.note ?? null, themeId,
    });
    await auditLog(env, profile.userId, 'REJECT_THEME', 'theme', themeId, { note: parsed.data.note ?? null });
    return json({ theme });
  }
  const parsed = themeModerationCasSchema.safeParse(await readJson(request));
  if (!parsed.success) throw validationError(parsed.error);
  const theme = await themes.deactivateTheme({ expectedRevision: parsed.data.expectedRevision, themeId });
  await auditLog(env, profile.userId, 'DEACTIVATE_THEME', 'theme', themeId, {});
  return json({ theme });
}

/** ADMIN em qualquer tema; OWNER só no próprio tema USER; nunca em tema OFFICIAL. */
async function requireQuestionEditAccess(
  env: Env,
  profileUserId: string,
  isAdmin: boolean,
  themeId: string,
): Promise<void> {
  if (isAdmin) return;
  const access = await new ThemeRepository(env.CORE_DB).themeEditAccess(themeId, profileUserId);
  if (access === null) throw new ApiError(404, 'THEME_NOT_FOUND', 'Tema não encontrado.');
  if (access.origin !== 'USER' || !access.owned) {
    throw new ApiError(403, 'THEME_EDIT_FORBIDDEN', 'Você não pode editar perguntas deste tema.');
  }
}

/** `themes.active_question_count` é só um contador de exibição; a fonte real do sorteio é `question_pools.active_count`. */
async function syncThemeQuestionCount(env: Env, themeId: string): Promise<void> {
  try {
    const totals = await env.QUESTIONS_DB.prepare(
      'SELECT COALESCE(SUM(active_count), 0) AS total FROM question_pools WHERE theme_id = ?1',
    ).bind(themeId).first<{ total: number }>();
    await env.CORE_DB.prepare('UPDATE themes SET active_question_count = ?1 WHERE id = ?2')
      .bind(totals?.total ?? 0, themeId).run();
  } catch {
    console.error(JSON.stringify({ code: 'THEME_QUESTION_COUNT_SYNC_FAILED', themeId }));
  }
}

async function editorialQuestionsRoute(request: Request, env: Env, url: URL, themeId: string): Promise<Response> {
  const identity = await requireUser(request, env);
  const profile = await new UserRepository(env.CORE_DB).findByFirebaseUid(identity.uid);
  if (profile === null) throw new ApiError(409, 'PROFILE_REQUIRED', 'Conclua seu perfil.');
  const isAdmin = await hasAdminAccess(identity, env);
  await requireQuestionEditAccess(env, profile.userId, isAdmin, themeId);
  const questions = new QuestionEditorialRepository(env.QUESTIONS_DB);
  if (request.method === 'GET') {
    const cursor = url.searchParams.get('cursor');
    const requestedStatus = url.searchParams.get('statuses');
    const statuses = requestedStatus === null
      ? undefined
      : ['ACTIVE', 'DISABLED', 'IN_REVIEW', 'PENDING', 'REJECTED'].includes(requestedStatus)
        ? [requestedStatus as 'ACTIVE' | 'DISABLED' | 'IN_REVIEW' | 'PENDING' | 'REJECTED']
        : null;
    if (statuses === null) throw new ApiError(400, 'QUESTION_STATUS_INVALID', 'Status de pergunta inválido.');
    return json(await questions.listForTheme(statuses === undefined
      ? { cursor, themeId }
      : { cursor, statuses, themeId }));
  }
  if (request.method === 'POST') {
    const parsed = questionEditorialSchema.safeParse(await readJson(request));
    if (!parsed.success) throw validationError(parsed.error);
    const created = await questions.create({ actorUserId: profile.userId, themeId, ...parsed.data });
    await auditLog(env, profile.userId, 'CREATE_QUESTION', 'question', created.questionId, { themeId });
    return json(created, { status: 201 });
  }
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
}

async function editorialQuestionActionRoute(
  request: Request,
  env: Env,
  questionId: string,
  action: 'approve' | 'deactivate' | 'edit' | 'reject',
): Promise<Response> {
  const identity = await requireUser(request, env);
  const profile = await new UserRepository(env.CORE_DB).findByFirebaseUid(identity.uid);
  if (profile === null) throw new ApiError(409, 'PROFILE_REQUIRED', 'Conclua seu perfil.');
  const isAdmin = await hasAdminAccess(identity, env);
  const questions = new QuestionEditorialRepository(env.QUESTIONS_DB);

  if (action === 'edit') {
    if (request.method !== 'PATCH') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
    const current = await questions.findForModeration(questionId);
    if (current === null) throw new ApiError(404, 'QUESTION_NOT_FOUND', 'Pergunta não encontrada.');
    await requireQuestionEditAccess(env, profile.userId, isAdmin, current.themeId);
    const parsed = questionEditSchema.safeParse(await readJson(request));
    if (!parsed.success) throw validationError(parsed.error);
    if (current.status === 'IN_REVIEW') {
      await questions.reviseDraft({ questionId, ...parsed.data });
      const question = await questions.findForModeration(questionId);
      await auditLog(env, profile.userId, 'REVISE_QUESTION_DRAFT', 'question', questionId, {});
      return json({ question });
    }
    const draft = await questions.proposeEdit({ actorUserId: profile.userId, questionId, ...parsed.data });
    await auditLog(env, profile.userId, 'PROPOSE_QUESTION_EDIT', 'question', draft.draftId, { replaces: questionId });
    return json(draft, { status: 201 });
  }

  if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
  // Aprovar/rejeitar/desativar exigem ADMIN mesmo quando o OWNER criou a pergunta:
  // ninguém aprova a própria submissão.
  await requireAdmin(identity, env);
  if (action === 'approve') {
    const { themeId } = await questions.approve(questionId, profile.userId);
    await syncThemeQuestionCount(env, themeId);
    await auditLog(env, profile.userId, 'APPROVE_QUESTION', 'question', questionId, { themeId });
    return json({ ok: true });
  }
  if (action === 'reject') {
    const parsed = questionRejectionSchema.safeParse(await readJson(request));
    if (!parsed.success) throw validationError(parsed.error);
    const { themeId } = await questions.reject(questionId, profile.userId, parsed.data.note ?? null);
    await auditLog(env, profile.userId, 'REJECT_QUESTION', 'question', questionId, { note: parsed.data.note ?? null, themeId });
    return json({ ok: true });
  }
  const { themeId } = await questions.deactivate(questionId, profile.userId);
  await syncThemeQuestionCount(env, themeId);
  await auditLog(env, profile.userId, 'DEACTIVATE_QUESTION', 'question', questionId, { themeId });
  return json({ ok: true });
}

async function editorialQuestionBatchApprovalRoute(request: Request, env: Env, themeId: string): Promise<Response> {
  if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
  const identity = await requireUser(request, env);
  const profile = await new UserRepository(env.CORE_DB).findByFirebaseUid(identity.uid);
  if (profile === null) throw new ApiError(409, 'PROFILE_REQUIRED', 'Conclua seu perfil.');
  await requireAdmin(identity, env);
  const parsed = questionBatchApprovalSchema.safeParse(await readJson(request));
  if (!parsed.success) throw validationError(parsed.error);

  const result = await new QuestionEditorialRepository(env.QUESTIONS_DB).approveMany({
    actorUserId: profile.userId, questionIds: parsed.data.questionIds, themeId,
  });
  if (result.approvedQuestionIds.length > 0) {
    await syncThemeQuestionCount(env, themeId);
    await auditLog(env, profile.userId, 'APPROVE_QUESTIONS_BATCH', 'theme', themeId, {
      approvedQuestionIds: result.approvedQuestionIds,
      failedQuestionIds: result.failed.map((failure) => failure.questionId),
    });
  }
  return json(result);
}

/**
 * Foto de pergunta (somente ADMIN). O cliente já reencoda em WebP; o Worker
 * revalida o contêiner, grava no R2 com chave nova e versionada e só então
 * aponta a pergunta para ela (CAS pela chave anterior). Se o D1 recusar, o
 * objeto recém-gravado é apagado. O objeto antigo só sai do bucket quando
 * nenhuma pergunta (inclusive rascunho de edição) ainda o referencia.
 */
async function adminQuestionImageRoute(request: Request, env: Env, questionId: string): Promise<Response> {
  if (request.method !== 'PUT' && request.method !== 'DELETE') {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
  }
  const identity = await requireUser(request, env);
  await requireAdmin(identity, env);
  const profile = await new UserRepository(env.CORE_DB).findByFirebaseUid(identity.uid);
  if (profile === null) throw new ApiError(409, 'PROFILE_REQUIRED', 'Conclua seu perfil.');
  const questions = new QuestionEditorialRepository(env.QUESTIONS_DB);
  const current = await env.QUESTIONS_DB.prepare('SELECT status, image_key FROM questions WHERE id = ?1')
    .bind(questionId).first<{ image_key: string | null; status: string }>();
  if (current === null) throw new ApiError(404, 'QUESTION_NOT_FOUND', 'Pergunta não encontrada.');
  if (current.status !== 'ACTIVE' && current.status !== 'IN_REVIEW') {
    throw new ApiError(409, 'QUESTION_IMAGE_STATUS', 'Só perguntas publicadas ou em revisão aceitam foto.');
  }
  const storage = new R2ImageStorage(env.QUESTION_IMAGES);

  let next: { bytes: number; key: string } | null = null;
  if (request.method === 'PUT') {
    if (request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'image/webp') {
      throw new ApiError(415, 'QUESTION_IMAGE_TYPE_INVALID', 'Envie a foto reencodada em WebP.');
    }
    const data = await readBytes(request, QUESTION_IMAGE_MAX_BYTES, new ApiError(
      413, 'QUESTION_IMAGE_TOO_LARGE', 'A foto deve ter menos de 100 KB depois de comprimida.',
    ));
    const dimensions = inspectQuestionImageWebp(data);
    if (dimensions === null) {
      throw new ApiError(400, 'QUESTION_IMAGE_INVALID', 'A foto precisa ser WebP válida, sem EXIF/XMP, entre 64 e 1280 px e proporção até 3:1.');
    }
    // Versão = instante do envio: chave nova a cada troca, então caches
    // imutáveis nunca servem a foto antiga com o nome novo.
    next = { bytes: data.byteLength, key: `questions/${questionId.toLowerCase()}/v${Date.now()}.webp` };
    await storage.put({ ...next, contentType: 'image/webp', license: '', sourceUrl: null }, data);
  } else if (current.image_key === null) {
    return json({ question: await questions.findForModeration(questionId) });
  }

  try {
    await questions.setImage({ expectedKey: current.image_key, image: next, questionId });
  } catch (error) {
    if (next !== null) await env.QUESTION_IMAGES.delete(next.key).catch(() => undefined);
    throw error;
  }
  if (current.image_key !== null && !await questions.isImageReferenced(current.image_key)) {
    // Limpeza de órfão é melhor-esforço: falhar aqui não desfaz a troca.
    await env.QUESTION_IMAGES.delete(current.image_key).catch(() => {
      console.error(JSON.stringify({ code: 'QUESTION_IMAGE_ORPHAN_DELETE_FAILED', key: current.image_key }));
    });
  }
  await auditLog(env, profile.userId, next === null ? 'REMOVE_QUESTION_IMAGE' : 'UPLOAD_QUESTION_IMAGE', 'question', questionId, {
    bytes: next?.bytes ?? null,
  });
  return json({ question: await questions.findForModeration(questionId) });
}

async function adminThemeArtworkRoute(request: Request, env: Env, themeId: string): Promise<Response> {
  const identity = await requireUser(request, env);
  await requireAdmin(identity, env);
  const profile = await new UserRepository(env.CORE_DB).findByFirebaseUid(identity.uid);
  if (profile === null) throw new ApiError(409, 'PROFILE_REQUIRED', 'Conclua seu perfil.');
  const themes = new ThemeRepository(env.CORE_DB);
  try {
    if (request.method === 'PATCH') {
      const parsed = themeArtworkChoiceSchema.safeParse(await readJson(request));
      if (!parsed.success) throw validationError(parsed.error);
      const theme = await themes.setArtworkChoice({ ...parsed.data, themeId });
      await auditLog(env, profile.userId, 'SET_THEME_ARTWORK_CHOICE', 'theme', themeId, { kind: parsed.data.kind });
      return json({ theme });
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
        throw new ApiError(400, 'ARTWORK_INVALID', 'A imagem precisa ser WebP quadrada e válida, sem EXIF/XMP, entre 256 e 512 px.');
      }
      const theme = await themes.setCustomArtwork({
        data,
        expectedVersion: expectedArtworkVersion(request),
        height: dimensions.height,
        themeId,
        width: dimensions.width,
      });
      await auditLog(env, profile.userId, 'UPLOAD_THEME_ARTWORK', 'theme', themeId, {
        bytes: data.byteLength, height: dimensions.height, width: dimensions.width,
      });
      return json({ theme });
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
  } catch (error) {
    artworkMutationError(error);
  }
}

function reportRuleErrorToApiError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  if (error instanceof Error && error.name === 'ReportRuleError') {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : 'REPORT_INVALID';
    throw new ApiError(400, code, error.message);
  }
  throw error;
}

async function reportsRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
  const identity = await requireUser(request, env);
  const profile = await new UserRepository(env.CORE_DB).findByFirebaseUid(identity.uid);
  if (profile === null) throw new ApiError(409, 'PROFILE_REQUIRED', 'Conclua seu perfil.');
  const parsed = reportCreationSchema.safeParse(await readJson(request));
  if (!parsed.success) throw validationError(parsed.error);
  try {
    const result = await new ReportRepository(env.CORE_DB).create({
      contextId: parsed.data.contextId,
      contextKind: parsed.data.contextKind,
      note: parsed.data.note ?? null,
      questionId: parsed.data.questionId,
      reason: parsed.data.reason,
      reporterUserId: profile.userId,
      roundNumber: parsed.data.roundNumber,
    });
    return json({ report: result.report }, { status: result.created ? 201 : 200 });
  } catch (error) {
    reportRuleErrorToApiError(error);
  }
}

interface ReportQuestionMetadata {
  sources: Array<{ sourceKind: string; title: string | null; url: string }>;
  statistics: {
    answerCount: number;
    correctCount: number;
    optionACount: number;
    optionBCount: number;
    optionCCount: number;
    optionDCount: number;
    totalResponseMs: number;
    useCount: number;
    wrongCount: number;
  } | null;
  themeName: string;
}

function safeQuestionSourceUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Metadados editoriais por leitura indexada; nunca alteram a pergunta ou o resultado competitivo. */
async function reportQuestionMetadata(env: Env, report: ReportRecord): Promise<ReportQuestionMetadata | null> {
  const context = report.contextKind === 'MATCH'
    ? await env.CORE_DB.prepare(
      `SELECT t.name AS theme_name
         FROM matches m JOIN themes t ON t.id = m.theme_id
        WHERE m.id = ?1 LIMIT 1`,
    ).bind(report.contextId).first<{ theme_name: string }>()
    : await env.CORE_DB.prepare(
      `SELECT t.name AS theme_name
         FROM challenges c JOIN themes t ON t.id = c.theme_id
        WHERE c.id = ?1 LIMIT 1`,
    ).bind(report.contextId).first<{ theme_name: string }>();
  if (context === null) return null;
  const [sources, statistics] = await Promise.all([
    env.QUESTIONS_DB.prepare(
      `SELECT source_kind, title, url FROM question_sources
        WHERE question_id = ?1 ORDER BY created_at ASC LIMIT 5`,
    ).bind(report.questionId).all<{ source_kind: string; title: string | null; url: string }>(),
    env.QUESTIONS_DB.prepare(
      `SELECT answer_count, correct_count, wrong_count, option_a_count, option_b_count,
              option_c_count, option_d_count, total_response_ms, use_count
         FROM question_statistics WHERE question_id = ?1 LIMIT 1`,
    ).bind(report.questionId).first<{
      answer_count: number; correct_count: number; option_a_count: number; option_b_count: number;
      option_c_count: number; option_d_count: number; total_response_ms: number; use_count: number; wrong_count: number;
    }>(),
  ]);
  return {
    sources: sources.results.flatMap((source) => {
      const url = safeQuestionSourceUrl(source.url);
      return url === null ? [] : [{ sourceKind: source.source_kind, title: source.title, url }];
    }),
    statistics: statistics === null ? null : {
      answerCount: statistics.answer_count,
      correctCount: statistics.correct_count,
      optionACount: statistics.option_a_count,
      optionBCount: statistics.option_b_count,
      optionCCount: statistics.option_c_count,
      optionDCount: statistics.option_d_count,
      totalResponseMs: statistics.total_response_ms,
      useCount: statistics.use_count,
      wrongCount: statistics.wrong_count,
    },
    themeName: context.theme_name,
  };
}

/** Enriquece a fila com snapshot e contexto editorial, sem imagens completas. */
async function withSnapshots(env: Env, reports: ReportRepository, records: ReportRecord[]) {
  return Promise.all(records.map(async (report) => ({
    questionMetadata: await reportQuestionMetadata(env, report),
    questionSnapshot: await reports.questionSnapshot(report),
    report,
  })));
}

async function adminReportsRoute(request: Request, env: Env, url: URL): Promise<Response> {
  const identity = await requireUser(request, env);
  await requireAdmin(identity, env);
  if (request.method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
  const statusParam = url.searchParams.get('status') ?? 'OPEN';
  const parsedStatus = z.enum(['OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED']).safeParse(statusParam);
  if (!parsedStatus.success) throw new ApiError(400, 'INVALID_REPORT_STATUS', 'Status de denúncia inválido.');
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 20) || 20));
  const cursor = url.searchParams.get('cursor');
  const repository = new ReportRepository(env.CORE_DB);
  const page = await repository.listForAdmin(parsedStatus.data, limit, cursor);
  return json({ nextCursor: page.nextCursor, reports: await withSnapshots(env, repository, page.reports) });
}

async function adminReportResolveRoute(request: Request, env: Env, reportId: string): Promise<Response> {
  const identity = await requireUser(request, env);
  await requireAdmin(identity, env);
  if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
  const profile = await new UserRepository(env.CORE_DB).findByFirebaseUid(identity.uid);
  if (profile === null) throw new ApiError(409, 'PROFILE_REQUIRED', 'Conclua seu perfil.');
  const parsed = reportResolutionSchema.safeParse(await readJson(request));
  if (!parsed.success) throw validationError(parsed.error);
  const repository = new ReportRepository(env.CORE_DB);
  const current = await repository.byId(reportId);
  if (current === null) throw new ApiError(404, 'REPORT_NOT_FOUND', 'Denúncia não encontrada.');
  let changed: boolean;
  try {
    changed = await repository.resolve({
      fromStatus: current.status,
      id: reportId,
      resolutionNote: parsed.data.resolutionNote ?? null,
      resolvedByUserId: profile.userId,
      toStatus: parsed.data.status,
    });
  } catch (error) {
    reportRuleErrorToApiError(error);
  }
  if (!changed) throw new ApiError(409, 'REPORT_NOT_OPEN', 'Esta denúncia já foi resolvida por outra sessão.');
  await env.CORE_DB.prepare(
    `INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, metadata_json)
     VALUES (?1, ?2, 'RESOLVE_REPORT', 'question_report', ?3, ?4)`,
  ).bind(
    crypto.randomUUID(), profile.userId, reportId,
    JSON.stringify({ from: current.status, to: parsed.data.status }),
  ).run();
  const updated = await repository.byId(reportId);
  return json({ report: updated });
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
export async function reconcileChallengeLifecycle(
  env: Env,
  context: ExecutionContext,
  challenges: ChallengeRepository,
  userId: string,
): Promise<void> {
  const nowMs = Date.now();
  const matches = new LiveMatchRepository(env.CORE_DB, env.QUESTIONS_DB);
  const expired = await challenges.expireStaleDirect(userId);
  for (const entry of expired) {
    notifySocial(env, context, entry.participants, {
      challengeId: entry.id,
      type: 'CHALLENGE_UPDATED',
    });
  }

  // Cada desafio é independente: convergir em paralelo, bounded pelo próprio
  // LIMIT 50, evita até 50 idas e vindas sequenciais ao DO numa única chamada.
  await Promise.all((await challenges.liveLifecycleForUser(userId)).map(async (challenge) => {
    let changed = false;
    if (challenge.kind === 'DIRECT') {
      // matchId === null é sempre PENDING_DIRECT — o convite ainda não foi
      // aceito. A graça de 7 s é só para reconexão de sala já iniciada; um
      // convite pendente só expira pelos 30 s de `expireStaleDirect` acima,
      // nunca aqui. Sem chamada ao DO nesse caso.
      if (challenge.matchId !== null) {
        let phase: string | null = null;
        try {
          const response = await env.MATCH_ROOM
            .get(env.MATCH_ROOM.idFromName(challenge.matchId))
            .fetch('https://match.internal/reconcile', { method: 'POST' });
          if (response.ok) phase = (await response.json<{ phase?: string }>()).phase ?? null;
        } catch {
          // Indisponibilidade transitória não autoriza apagar uma sala viva.
        }

        if (phase === 'MISSING' && nowMs - challenge.updatedAtMs >= CHALLENGE_INITIAL_GRACE_MS) {
          const orphan = await matches.voidOrphanedPreparingMatch(
            challenge.matchId,
            nowMs - CHALLENGE_INITIAL_GRACE_MS,
          );
          if (orphan.voided) {
            await Promise.all(orphan.firebaseUids.map((uid) => releaseTerminalPresence(env, matches, uid)));
          } else if (await env.CORE_DB.prepare('SELECT 1 FROM matches WHERE id = ?1')
            .bind(challenge.matchId).first() === null) {
            // A sala nunca chegou a nascer: o processo que reservou o roomId
            // morreu antes de sequer chamar o MatchRoom, então não existe
            // linha em `matches` para converter — a própria reserva do
            // desafio é a única prova viva, e é ela quem se anula.
            changed = await challenges.voidOrphanedLive(challenge, nowMs - CHALLENGE_INITIAL_GRACE_MS);
          }
        }
        // O MatchRoom terminal (ou a limpeza de reserva órfã acima) é quem
        // grava FINISHED/VOID. Só então D1 converte o desafio e limpa payload.
        if (!changed) changed = await challenges.reconcileDirectMatch(challenge);
      }
    } else if (challenge.status === 'FIRST_PLAYER_ACTIVE' || challenge.status === 'SECOND_PLAYER_ACTIVE') {
      // ASYNC nunca expira. `MISSING` só significa que este jogador ainda não
      // abriu a própria metade — normal e pode durar indefinidamente; nunca é
      // um sinal de abandono. A graça de 7 s é exclusiva de reconexão de uma
      // metade JÁ aberta (o próprio ChallengeRoom aplica isso via seu deadline
      // interno quando o socket cai); ela nunca serve de TTL de criação/aceite.
      // Chamar o DO aqui só recupera uma metade travada em FINALIZING/VOID —
      // uma reserva sem sala nunca é anulada por isto.
      const seat = challenge.status === 'FIRST_PLAYER_ACTIVE' ? 'FIRST' : 'SECOND';
      try {
        await env.CHALLENGE_ROOM
          .get(env.CHALLENGE_ROOM.idFromName(`${challenge.id}:${seat}`))
          .fetch('https://challenge.internal/reconcile', { method: 'POST' });
      } catch {
        // A próxima operação real tenta de novo.
      }
    }
    if (changed) {
      notifySocial(env, context, [challenge.firstPlayerUserId, challenge.secondPlayerUserId], {
        challengeId: challenge.id,
        type: 'CHALLENGE_UPDATED',
      });
    }
  }));
}

async function challengeRoute(request: Request, env: Env, url: URL, context: ExecutionContext): Promise<Response> {
  const identity = await requireUser(request, env);
  const users = new UserRepository(env.CORE_DB);
  const profile = await users.findByFirebaseUid(identity.uid);
  if (profile === null) throw new ApiError(409, 'PROFILE_REQUIRED', 'Conclua seu perfil antes de desafiar.');
  const challenges = new ChallengeRepository(env.CORE_DB);

  if (url.pathname === '/api/challenges' && request.method === 'GET') {
    await reconcileChallengeLifecycle(env, context, challenges, profile.userId);
    const cursor = url.searchParams.get('cursor');
    const page = await challenges.forUser(profile.userId, Date.now(), cursor);
    return json({ challenges: page.challenges, nextCursor: page.nextCursor });
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
        await challenges.sealQuestionSet(created.challengeId, theme.id, env.QUESTIONS_DB);
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
const TERMINAL_DIRECT_STATUSES = new Set<string>(['CANCELLED', 'COMPLETED', 'DECLINED', 'EXPIRED', 'VOID']);

/**
 * Entrega a sala DIRECT já reservada (`roomId`) ao aceitante e, quando esta
 * chamada é quem abriu a tentativa (`isOriginatingAttempt`), decide o desfecho
 * dela: some CAS por revisão exata garante que só quem tirou o desafio de
 * PENDING_DIRECT pode voltar a VOID em caso de falha — uma chamada de
 * recuperação (double tap, outra aba, reconexão) nunca encerra uma tentativa
 * que não é dela, e nunca cria uma segunda sala ou reserva de presença: o
 * `DirectChallengeService.start` é idempotente para o mesmo `roomId`.
 */
async function deliverDirectRoom(
  env: Env,
  context: ExecutionContext,
  challenges: ChallengeRepository,
  users: UserRepository,
  challenge: ChallengeRecord,
  roomId: string,
  revisionBeforeStart: number,
  isOriginatingAttempt: boolean,
): Promise<Response> {
  const uids = await users.firebaseUidsFor([challenge.firstPlayerUserId, challenge.secondPlayerUserId]);
  const challengerUid = uids.get(challenge.firstPlayerUserId);
  const challengedUid = uids.get(challenge.secondPlayerUserId);
  if (challengerUid === undefined || challengedUid === undefined) {
    throw new ApiError(409, 'PROFILE_REQUIRED', 'Um dos jogadores precisa concluir o perfil.');
  }

  let started;
  try {
    started = await new DirectChallengeService(env).start(challenge, [challengerUid, challengedUid], roomId);
  } catch (error) {
    if (isOriginatingAttempt) {
      const voided = await env.CORE_DB.prepare(
        `UPDATE challenges SET status = 'VOID', updated_at = ?1, revision = revision + 1
          WHERE id = ?2 AND revision = ?3 AND status = 'PREPARING'`,
      ).bind(new Date().toISOString(), challenge.id, revisionBeforeStart).run();
      if ((voided.meta.changes ?? 0) === 1) {
        await challenges.cleanupPayload(challenge.id);
        notifySocial(env, context, [challenge.firstPlayerUserId, challenge.secondPlayerUserId], {
          challengeId: challenge.id,
          type: 'CHALLENGE_UPDATED',
        });
      }
    }
    throw error;
  }

  // Qualquer chamada que confirmou a sala pode fechar PREPARING -> ACTIVE: o CAS
  // pela revisão lida garante que só a primeira a chegar aqui de fato aplica e
  // dispara o aviso ao desafiante — um retry ou recuperação vira no-op seguro.
  const activated = await env.CORE_DB.prepare(
    `UPDATE challenges SET status = 'ACTIVE', updated_at = ?1, revision = revision + 1
      WHERE id = ?2 AND revision = ?3 AND status = 'PREPARING'`,
  ).bind(new Date().toISOString(), challenge.id, revisionBeforeStart).run();
  if ((activated.meta.changes ?? 0) === 1) {
    notifySocial(env, context, [challenge.firstPlayerUserId], {
      challengeId: challenge.id,
      opponent: started.presentations.get(challengerUid)?.opponent,
      preload: started.presentations.get(challengerUid)?.preload,
      roomId,
      type: 'CHALLENGE_STARTED',
    });
  }

  return json({
    challengeId: challenge.id,
    opponent: started.presentations.get(challengedUid)?.opponent,
    preload: started.presentations.get(challengedUid)?.preload,
    roomId,
  });
}

export async function acceptChallenge(
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

  // Aceite idempotente: a sala já está reservada (este mesmo aceite repetido,
  // outra aba, ou uma reconexão que tenta de novo) — devolve a mesma sala em
  // vez do erro genérico "não aguarda aceite", e não cria nada a mais.
  if ((challenge.status === 'PREPARING' || challenge.status === 'ACTIVE') && challenge.matchId !== null) {
    return await deliverDirectRoom(env, context, challenges, users, challenge, challenge.matchId, challenge.revision, false);
  }
  if (TERMINAL_DIRECT_STATUSES.has(challenge.status)) {
    throw new ApiError(409, 'CHALLENGE_ALREADY_SETTLED', 'Este desafio já foi encerrado.');
  }
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

  // roomId nasce ANTES do CAS e é persistido na MESMA escrita que sai de
  // PENDING_DIRECT: nunca existe uma janela com PREPARING e match_id nulo, que
  // era o que fazia a reconciliação anular uma sala que já estava viva.
  const roomId = crypto.randomUUID();
  const claimed = await env.CORE_DB.prepare(
    `UPDATE challenges SET status = 'PREPARING', match_id = ?1, updated_at = ?2, revision = revision + 1
      WHERE id = ?3 AND revision = ?4 AND status = 'PENDING_DIRECT'`,
  ).bind(roomId, new Date().toISOString(), challenge.id, challenge.revision).run();
  if ((claimed.meta.changes ?? 0) !== 1) {
    // Corrida perdida — outra chamada (double tap, outra aba) já avançou. Se foi
    // este mesmo aceitante, a recuperação abaixo devolve a mesma sala dele.
    const fresh = await challenges.byId(challenge.id);
    if (fresh !== null && fresh.secondPlayerUserId === actorUserId &&
      (fresh.status === 'PREPARING' || fresh.status === 'ACTIVE') && fresh.matchId !== null) {
      return await deliverDirectRoom(env, context, challenges, users, fresh, fresh.matchId, fresh.revision, false);
    }
    throw new ApiError(409, 'CHALLENGE_CONFLICT', 'Este desafio mudou de estado. Atualize a tela.');
  }

  return await deliverDirectRoom(env, context, challenges, users, challenge, roomId, challenge.revision + 1, true);
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
      friends: Array<{ presence: string; queueThemeId?: string; revision: number; userId: string }>;
      revision: number;
    }>();
    const identities = new Map(friends.map((friend) => [friend.userId, friend.publicId]));
    return json({
      friends: snapshot.friends.flatMap((friend) => {
        const publicId = identities.get(friend.userId);
        return publicId === undefined ? [] : [{
          presence: friend.presence,
          publicId,
          ...(friend.queueThemeId === undefined ? {} : { queueThemeId: friend.queueThemeId }),
          revision: friend.revision,
        }];
      }),
      revision: snapshot.revision,
    });
  }
  if (url.pathname === '/api/social/search' && request.method === 'GET') {
    return json({ users: await social.search(profile.userId, url.searchParams.get('q') ?? '') });
  }
  const matchOpponent = /^\/api\/social\/match-opponent\/([a-f0-9-]{36})$/i.exec(url.pathname);
  if (matchOpponent?.[1] !== undefined && (request.method === 'GET' || request.method === 'POST')) {
    // O adversário vem da própria partida; o cliente nunca informa quem é.
    const opponent = await env.CORE_DB.prepare(
      `SELECT them.user_id, p.public_id
         FROM match_players me
         JOIN match_players them ON them.match_id = me.match_id AND them.user_id <> me.user_id
         JOIN matches m ON m.id = me.match_id
         JOIN user_profiles p ON p.user_id = them.user_id
        WHERE me.match_id = ?1 AND me.user_id = ?2 AND m.status IN ('FINISHED', 'VOID')`,
    ).bind(matchOpponent[1], profile.userId).first<{ public_id: string; user_id: string }>();
    if (opponent === null) throw new ApiError(404, 'MATCH_NOT_FOUND', 'Partida não encontrada.');
    const [low, high] = profile.userId < opponent.user_id
      ? [profile.userId, opponent.user_id]
      : [opponent.user_id, profile.userId];
    const friends = await env.CORE_DB.prepare(
      'SELECT 1 AS linked FROM friendships WHERE user_low_id = ?1 AND user_high_id = ?2',
    ).bind(low, high).first();
    if (friends !== null) return json({ status: 'FRIEND' });
    if (request.method === 'GET') return json({ status: 'NONE' });
    const result = await social.sendRequest(profile.userId, opponent.public_id);
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
    return json({ status: 'SENT' }, { status: result.created ? 201 : 200 });
  }
  if (url.pathname === '/api/social/requests' && request.method === 'GET') {
    const direction = url.searchParams.get('direction') === 'outgoing' ? 'outgoing' : 'incoming';
    return json(await social.requests(profile.userId, direction, url.searchParams.get('cursor')));
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
    if (request.method === 'GET') return json(await social.blockedUsers(profile.userId, url.searchParams.get('cursor')));
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
  if (url.pathname === '/api/profile/summary') return profileSummaryRoute(request, env);
  if (url.pathname === '/api/profile/avatar') return profileAvatarRoute(request, env);
  if (url.pathname === '/api/social' || url.pathname.startsWith('/api/social/')) {
    return socialRoute(request, env, url, context);
  }
  if (url.pathname === '/api/challenges' || url.pathname.startsWith('/api/challenges/')) {
    return challengeRoute(request, env, url, context);
  }
  if (url.pathname === '/api/realtime/tickets' && request.method === 'POST') return createRealtimeTicket(request, env);
  if (url.pathname.startsWith('/api/realtime/') && request.headers.get('Upgrade') !== null) return realtimeRoute(request, env, url);
  if (url.pathname === '/api/reports') return reportsRoute(request, env);
  if (url.pathname === '/api/admin/questions/import') return adminImportRoute(request, env, url);
  if (url.pathname === '/api/admin/themes') return adminThemesRoute(request, env, url);
  if (url.pathname === '/api/admin/reports') return adminReportsRoute(request, env, url);
  if (url.pathname === '/api/admin/categories') return adminCategoriesRoute(request, env);
  if (url.pathname === '/api/admin/users') return adminUsersRoute(request, env, url);
  if (url.pathname === '/api/admin/audit-logs') return adminAuditLogRoute(request, env, url);

  const adminUserRoleMatch = /^\/api\/admin\/users\/([a-f0-9-]{36})\/roles\/admin$/i.exec(url.pathname);
  if (adminUserRoleMatch?.[1] !== undefined) return adminUserRoleRoute(request, env, adminUserRoleMatch[1]);

  const adminReportResolveMatch = /^\/api\/admin\/reports\/([a-f0-9-]{36})\/resolve$/i.exec(url.pathname);
  if (adminReportResolveMatch?.[1] !== undefined) {
    return adminReportResolveRoute(request, env, adminReportResolveMatch[1]);
  }

  const adminCategoryMatch = /^\/api\/admin\/categories\/([a-z0-9_-]{1,128})$/i.exec(url.pathname);
  if (adminCategoryMatch?.[1] !== undefined) {
    return adminCategoryUpdateRoute(request, env, decodeURIComponent(adminCategoryMatch[1]));
  }

  const adminQuestionImageMatch = /^\/api\/admin\/questions\/([a-f0-9-]{36})\/image$/i.exec(url.pathname);
  if (adminQuestionImageMatch?.[1] !== undefined) return adminQuestionImageRoute(request, env, adminQuestionImageMatch[1]);

  const adminArtworkMatch = /^\/api\/admin\/themes\/([a-z0-9_-]{1,128})\/artwork$/i.exec(url.pathname);
  if (adminArtworkMatch?.[1] !== undefined) {
    return adminThemeArtworkRoute(request, env, decodeURIComponent(adminArtworkMatch[1]));
  }

  const adminThemeActionMatch = /^\/api\/admin\/themes\/([a-z0-9_-]{1,128})\/(approve|reject|deactivate)$/i.exec(url.pathname);
  if (adminThemeActionMatch?.[1] !== undefined && adminThemeActionMatch[2] !== undefined) {
    return adminThemeModerationRoute(
      request, env, decodeURIComponent(adminThemeActionMatch[1]),
      adminThemeActionMatch[2] as 'approve' | 'deactivate' | 'reject',
    );
  }

  const adminThemeExportMatch = /^\/api\/admin\/themes\/([a-z0-9_-]{1,128})\/questions\/(csv|json)$/i.exec(url.pathname);
  if (adminThemeExportMatch?.[1] !== undefined && adminThemeExportMatch[2] !== undefined) {
    return adminThemeQuestionsExportRoute(
      request, env, decodeURIComponent(adminThemeExportMatch[1]), adminThemeExportMatch[2].toLowerCase() as 'csv' | 'json',
    );
  }

  const adminThemeEditMatch = /^\/api\/admin\/themes\/([a-z0-9_-]{1,128})$/i.exec(url.pathname);
  if (adminThemeEditMatch?.[1] !== undefined && request.method === 'PATCH') {
    return adminThemeModerationRoute(request, env, decodeURIComponent(adminThemeEditMatch[1]), 'edit');
  }

  const editorialQuestionsMatch = /^\/api\/editorial\/themes\/([a-z0-9_-]{1,128})\/questions$/i.exec(url.pathname);
  if (editorialQuestionsMatch?.[1] !== undefined) {
    return editorialQuestionsRoute(request, env, url, decodeURIComponent(editorialQuestionsMatch[1]));
  }

  const editorialQuestionBatchApprovalMatch = /^\/api\/editorial\/themes\/([a-z0-9_-]{1,128})\/questions\/approve$/i.exec(url.pathname);
  if (editorialQuestionBatchApprovalMatch?.[1] !== undefined) {
    return editorialQuestionBatchApprovalRoute(request, env, decodeURIComponent(editorialQuestionBatchApprovalMatch[1]));
  }

  const editorialQuestionActionMatch = /^\/api\/editorial\/questions\/([a-f0-9-]{36})\/(approve|reject|deactivate)$/i
    .exec(url.pathname);
  if (editorialQuestionActionMatch?.[1] !== undefined && editorialQuestionActionMatch[2] !== undefined) {
    return editorialQuestionActionRoute(
      request, env, editorialQuestionActionMatch[1],
      editorialQuestionActionMatch[2] as 'approve' | 'deactivate' | 'reject',
    );
  }

  const editorialQuestionEditMatch = /^\/api\/editorial\/questions\/([a-f0-9-]{36})$/i.exec(url.pathname);
  if (editorialQuestionEditMatch?.[1] !== undefined && request.method === 'PATCH') {
    return editorialQuestionActionRoute(request, env, editorialQuestionEditMatch[1], 'edit');
  }

  const themes = new ThemeRepository(env.CORE_DB);
  const questionImageMatch = /^\/api\/question-images\/(questions\/[0-9a-f-]{36}\/v[1-9]\d*\.webp)$/i.exec(url.pathname);
  if (questionImageMatch?.[1] !== undefined) {
    return questionImageRoute(request, env, decodeURIComponent(questionImageMatch[1]));
  }
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
    // Criação pública fica desativada na V1 (AGENTS.md): a UI já esconde o
    // formulário para quem não é ADMIN, mas a rota precisa recusar por conta
    // própria — nunca depender só de esconder a interface.
    await requireAdmin(identity, env);
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
    const topFive = await themes.topFive(theme.id);
    let personal: null | {
      discoveredPercentage: number;
      knowledge: number;
      position: number | null;
      rankedMatches: number;
      records: { CASUAL: number | null; RANKED: number | null };
    } = null;
    if (request.headers.get('Authorization') !== null) {
      const identity = await requireUser(request, env);
      const profile = await new UserRepository(env.CORE_DB).findByFirebaseUid(identity.uid);
      if (profile !== null) {
        const pool = await questionRepository.pool(theme.id);
        let discoveredPercentage = 0;
        if (pool !== null && pool.activeCount > 0) {
          const state = await new PoolStateRepository(env.CORE_DB).read(profile.userId, pool.id, pool.version);
          discoveredPercentage = (discoveredCount(state.state, pool.activeCount) / pool.activeCount) * 100;
        }
        const ranking = await themes.personalRanking(theme.id, profile.userId);
        const recordRows = await env.CORE_DB.prepare(
          'SELECT mode, best_score FROM theme_personal_records WHERE user_id = ?1 AND theme_id = ?2',
        ).bind(profile.userId, theme.id).all<{ best_score: number; mode: 'CASUAL' | 'RANKED' }>();
        const records = { CASUAL: null as number | null, RANKED: null as number | null };
        for (const row of recordRows.results) records[row.mode] = row.best_score;
        personal = { discoveredPercentage, ...ranking, records };
      }
    }
    return json({ personal, theme, topFive });
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
