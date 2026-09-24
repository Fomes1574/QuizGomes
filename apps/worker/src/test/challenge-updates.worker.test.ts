import { env, runInDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AsyncHalfState } from '@quiz-gomes/domain';
import { ChallengeRepository } from '../repositories/challenge-repository.js';
import { notifyChallengeReadyForSecond, notifyChallengeUpdated } from '../services/challenge-notifier.js';
import { SocialRepository } from '../repositories/social-repository.js';
import { resetSocialPushCacheForTests, SocialPushService } from '../services/social-push-service.js';
import { befriend, fixture, themeIdOf, userAt, type FixtureUser } from './challenge-fixture.worker.js';

/** Chave RSA sintética só para assinar o JWT do OAuth do FCM em teste. */
async function syntheticPrivateKeyPem(): Promise<string> {
  const generated = await crypto.subtle.generateKey({
    hash: 'SHA-256',
    modulusLength: 2048,
    name: 'RSASSA-PKCS1-v1_5',
    publicExponent: new Uint8Array([1, 0, 1]),
  }, true, ['sign', 'verify']);
  const exported = new Uint8Array(await crypto.subtle.exportKey('pkcs8', generated.privateKey));
  let binary = '';
  for (const byte of exported) binary += String.fromCharCode(byte);
  const body = btoa(binary).match(/.{1,64}/g)?.join('\n') ?? '';
  return [`-----BEGIN ${'PRIVATE KEY'}-----`, body, `-----END ${'PRIVATE KEY'}-----`].join('\n');
}

function withFcmConfigured(fixtureKey: string): typeof env {
  return {
    ...env,
    FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: 'synthetic-service@example.test',
      private_key: fixtureKey,
      project_id: env.FIREBASE_PROJECT_ID,
    }),
  };
}

interface RealtimeEvent {
  challengeId?: string;
  type?: string;
}

interface SocialCapture {
  messages: RealtimeEvent[];
  waitFor: (type: string) => Promise<RealtimeEvent>;
}

/**
 * Escuta o canal social GLOBAL — o mesmo `idFromName('global')` que o notificador
 * usa. Se a lista de desafios voltasse a depender de polling, nenhum evento
 * chegaria aqui e estes testes ficariam vermelhos.
 */
async function listenSocial(userId: string): Promise<SocialCapture> {
  const stub = env.SOCIAL_REALTIME_HUB.get(env.SOCIAL_REALTIME_HUB.idFromName('global'));
  const response = await stub.fetch(new Request('https://social.internal/socket', {
    headers: { Upgrade: 'websocket', 'X-QG-Authenticated-User-Id': userId },
  }));
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null) throw new Error('Socket social ausente.');
  const messages: RealtimeEvent[] = [];
  const listeners: Array<{ resolve: (event: RealtimeEvent) => void; type: string }> = [];
  socket.addEventListener('message', (event) => {
    const raw = String(event.data);
    if (raw === 'PONG') return;
    const parsed = JSON.parse(raw) as RealtimeEvent;
    const index = listeners.findIndex((entry) => entry.type === parsed.type);
    const waiter = listeners[index];
    if (waiter === undefined) messages.push(parsed);
    else {
      listeners.splice(index, 1);
      waiter.resolve(parsed);
    }
  });
  socket.accept();
  return {
    messages,
    waitFor: (type) => {
      const index = messages.findIndex((message) => message.type === type);
      const existing = messages[index];
      if (existing !== undefined) {
        messages.splice(index, 1);
        return Promise.resolve(existing);
      }
      return new Promise((resolve, reject) => {
        const waiter = { resolve, type };
        listeners.push(waiter);
        setTimeout(() => {
          const waiterIndex = listeners.indexOf(waiter);
          if (waiterIndex >= 0) {
            listeners.splice(waiterIndex, 1);
            reject(new Error(`Evento social ${type} não chegou.`));
          }
        }, 3_000);
      });
    },
  };
}

async function asyncChallenge(
  first: FixtureUser,
  second: FixtureUser,
  themeSlug: string,
): Promise<{ challengeId: string; repository: ChallengeRepository; themeId: string }> {
  const repository = new ChallengeRepository(env.CORE_DB);
  const themeId = await themeIdOf(themeSlug);
  const created = await repository.create({
    actorUserId: first.id,
    kind: 'ASYNC',
    targetPresence: 'OFFLINE',
    targetUserId: second.id,
    themeId,
  });
  await repository.sealQuestionSet(created.challengeId, themeId, env.QUESTIONS_DB);
  return { challengeId: created.challengeId, repository, themeId };
}

function roomStub(challengeId: string, seat: 'FIRST' | 'SECOND'): DurableObjectStub {
  return env.CHALLENGE_ROOM.get(env.CHALLENGE_ROOM.idFromName(`${challengeId}:${seat}`));
}

async function openRoom(challengeId: string, seat: 'FIRST' | 'SECOND'): Promise<DurableObjectStub> {
  const stub = roomStub(challengeId, seat);
  const response = await stub.fetch('https://challenge.internal/initialize', {
    body: JSON.stringify({ challengeId, createdAtMs: Date.now(), seat, userId: 'irrelevante' }),
    method: 'POST',
  });
  expect(await response.json()).toEqual({ status: 'ready' });
  return stub;
}

/**
 * Leva a metade direto ao ponto de selagem, sem esperar 5 × 10 s de relógio real.
 * O que se testa aqui é a selagem e a notificação — o motor de rodadas já tem
 * cobertura própria no domínio.
 */
async function finalizeHalf(stub: DurableObjectStub, scores: number[]): Promise<void> {
  await runInDurableObject(stub, async (_instance, state) => {
    const stored = await state.storage.get<AsyncHalfState>('half');
    if (stored === undefined) throw new Error('Metade não inicializada.');
    stored.answers = stored.answers.map((_answer, index) => {
      const score = scores[index] ?? 0;
      return {
        answeredAtMs: Date.now(),
        correct: score > 0,
        remainingMs: score > 0 ? (score - 10) * 1_000 : 0,
        score,
        selectedOption: 0,
        submitted: true,
      };
    });
    stored.score = stored.answers.reduce((total, answer) => total + (answer?.score ?? 0), 0);
    stored.roundIndex = stored.questions.length - 1;
    stored.phase = 'FINALIZING';
    stored.phaseDeadlineMs = null;
    stored.connected = true;
    await state.storage.put('half', stored);
  });
  // O alarme em fase FINALIZING é exatamente o caminho de selagem em produção.
  await runInDurableObject(stub, async (instance) => {
    await (instance as unknown as { alarm: () => Promise<void> }).alarm();
  });
}

describe('M9C+M10 — Social converge por evento, sem polling', () => {
  it('registra a entrega da rodada inicial da metade assíncrona para denúncia', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const { challengeId, repository } = await asyncChallenge(first, second, themeSlug);
    const stub = await openRoom(challengeId, 'FIRST');

    const response = await stub.fetch(new Request('https://challenge.internal/socket', {
      headers: { Upgrade: 'websocket', 'X-QG-Authenticated-User-Id': first.id },
    }));
    expect(response.status).toBe(101);
    response.webSocket?.accept();

    const firstQuestion = await repository.questionSet(challengeId).then((questions) => questions[0]);
    if (firstQuestion === undefined) throw new Error('Pergunta inicial ausente.');
    expect(await env.CORE_DB.prepare(
      `SELECT question_id, round_number, user_id FROM question_report_views
        WHERE context_kind = 'CHALLENGE' AND context_id = ?1`,
    ).bind(challengeId).all()).toMatchObject({
      results: [{ question_id: firstQuestion.id, round_number: 1, user_id: first.id }],
    });
  });

  it('entrega CHALLENGE_UPDATED só a quem participa do desafio', async () => {
    const { users } = await fixture(2);
    const participant = userAt(users, 0);
    const outsider = userAt(users, 1);
    const listener = await listenSocial(participant.id);
    const stranger = await listenSocial(outsider.id);

    await notifyChallengeUpdated(env, 'challenge-abc', [participant.id]);

    expect(await listener.waitFor('CHALLENGE_UPDATED')).toMatchObject({ challengeId: 'challenge-abc' });
    expect(stranger.messages.some((message) => message.type === 'CHALLENGE_UPDATED')).toBe(false);
  });

  it('selar a primeira metade avisa os dois lados e libera o Jogar do desafiado', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const { challengeId, repository } = await asyncChallenge(first, second, themeSlug);
    const firstSide = await listenSocial(first.id);
    const secondSide = await listenSocial(second.id);

    // Antes de selar, o desafiado não pode jogar: a metade do desafiante ainda corre.
    expect(await repository.byId(challengeId)).toMatchObject({ status: 'FIRST_PLAYER_ACTIVE' });

    await finalizeHalf(await openRoom(challengeId, 'FIRST'), [20, 18, 0, 15, 11, 14, 0]);

    expect(await firstSide.waitFor('CHALLENGE_UPDATED')).toMatchObject({ challengeId });
    expect(await secondSide.waitFor('CHALLENGE_UPDATED')).toMatchObject({ challengeId });
    expect(await repository.byId(challengeId)).toMatchObject({ status: 'WAITING_FOR_SECOND' });
    expect(await repository.sealedHalf(challengeId, first.id)).toHaveLength(7);
    expect(await repository.sealedHalf(challengeId, second.id)).toEqual([]);
  });

  it('a conclusão da segunda metade avisa os dois lados e fecha o desafio', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const { challengeId, repository } = await asyncChallenge(first, second, themeSlug);
    await finalizeHalf(await openRoom(challengeId, 'FIRST'), [20, 18, 0, 15, 11, 14, 0]);
    await env.CORE_DB.prepare("UPDATE challenges SET status = 'SECOND_PLAYER_ACTIVE' WHERE id = ?1")
      .bind(challengeId).run();

    const firstSide = await listenSocial(first.id);
    const secondSide = await listenSocial(second.id);
    await finalizeHalf(await openRoom(challengeId, 'SECOND'), [20, 20, 20, 20, 20, 20, 20]);

    expect(await firstSide.waitFor('CHALLENGE_UPDATED')).toMatchObject({ challengeId });
    expect(await secondSide.waitFor('CHALLENGE_UPDATED')).toMatchObject({ challengeId });
    expect(await repository.byId(challengeId)).toMatchObject({ status: 'COMPLETED' });
  });

  it('selar as duas metades registra estatísticas por pergunta, uma vez por jogador', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const { challengeId, repository } = await asyncChallenge(first, second, themeSlug);
    const questions = await repository.questionSet(challengeId);
    expect(questions).toHaveLength(7);

    await finalizeHalf(await openRoom(challengeId, 'FIRST'), [20, 18, 0, 15, 11, 0, 0]);
    await env.CORE_DB.prepare("UPDATE challenges SET status = 'SECOND_PLAYER_ACTIVE' WHERE id = ?1")
      .bind(challengeId).run();
    await finalizeHalf(await openRoom(challengeId, 'SECOND'), [20, 20, 20, 20, 20, 20, 20]);

    for (const question of questions) {
      const stats = await env.QUESTIONS_DB.prepare(
        'SELECT answer_count, use_count FROM question_statistics WHERE question_id = ?1',
      ).bind(question.id).first<{ answer_count: number; use_count: number }>();
      // Os dois jogadores responderam cada uma das 7 perguntas: 2 usos por pergunta.
      expect(stats, question.id).toEqual({ answer_count: 2, use_count: 2 });
    }
    const ledgerTotal = await env.QUESTIONS_DB.prepare(
      "SELECT COUNT(*) AS total FROM question_statistics_ledger WHERE context_kind = 'CHALLENGE' AND context_id = ?1",
    ).bind(challengeId).first<{ total: number }>();
    expect(ledgerTotal?.total).toBe(14);

    // M11 — cada selagem ASYNC registra missão/streak só do jogador que selou:
    // primeiro acertou 4/7 (não satura a missão de acertos), segundo acertou 7/7 (satura).
    const themeId = await themeIdOf(themeSlug);
    const dayKey = new Date().toISOString().slice(0, 10);
    for (const [userId, correct] of [[first.id, 4], [second.id, 7]] as const) {
      const missions = await env.CORE_DB.prepare(
        `SELECT mission_type, progress, target, completed_at IS NOT NULL AS completed
           FROM user_daily_missions WHERE user_id = ?1 AND day_key = ?2 ORDER BY mission_type`,
      ).bind(userId, dayKey).all<{ completed: number; mission_type: string; progress: number; target: number }>();
      expect(missions.results).toEqual([
        { completed: 0, mission_type: 'ANSWER_QUESTIONS', progress: 7, target: 8 },
        { completed: correct >= 5 ? 1 : 0, mission_type: 'CORRECT_ANSWERS', progress: Math.min(correct, 5), target: 5 },
        { completed: 1, mission_type: 'PLAY_MATCH', progress: 1, target: 1 },
      ]);
      expect(await env.CORE_DB.prepare(
        'SELECT current_streak, best_streak, last_active_day FROM user_theme_streaks WHERE user_id = ?1 AND theme_id = ?2',
      ).bind(userId, themeId).first()).toEqual({
        best_streak: 1, current_streak: 1, last_active_day: dayKey,
      });
    }
  });

  it('"Cancelar e voltar" na metade assíncrona encerra o desafio e avisa os dois lados', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const { challengeId, repository, themeId } = await asyncChallenge(first, second, themeSlug);
    const stub = await openRoom(challengeId, 'FIRST');
    const firstSide = await listenSocial(first.id);
    const secondSide = await listenSocial(second.id);

    const response = await stub.fetch('https://challenge.internal/abort', { method: 'POST' });
    expect(await response.json()).toEqual({ status: 'cancelled' });

    // A sala terminal também converge o D1: não sobra FIRST_PLAYER_ACTIVE caso
    // a operação Social tenha sido interrompida depois de abortar a metade.
    expect(await firstSide.waitFor('CHALLENGE_UPDATED')).toMatchObject({ challengeId });
    expect(await secondSide.waitFor('CHALLENGE_UPDATED')).toMatchObject({ challengeId });
    expect(await repository.byId(challengeId)).toMatchObject({ status: 'CANCELLED' });
    // Uma sala já cancelada confirma sem repetir efeito.
    expect(await (await stub.fetch('https://challenge.internal/abort', { method: 'POST' })).json())
      .toEqual({ status: 'already' });
    // E a dupla volta a poder se desafiar.
    await expect(repository.create({
      actorUserId: first.id, kind: 'ASYNC',
      targetPresence: 'ONLINE', targetUserId: second.id, themeId,
    })).resolves.toMatchObject({ created: true });
  });

  it('anular a metade avisa os dois lados sem produzir vencedor', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const { challengeId, repository } = await asyncChallenge(first, second, themeSlug);
    const stub = await openRoom(challengeId, 'FIRST');
    const firstSide = await listenSocial(first.id);
    const secondSide = await listenSocial(second.id);

    await runInDurableObject(stub, async (_instance, state) => {
      const stored = await state.storage.get<AsyncHalfState>('half');
      if (stored === undefined) throw new Error('Metade não inicializada.');
      stored.phase = 'VOID';
      stored.phaseDeadlineMs = null;
      await state.storage.put('half', stored);
      await state.storage.put('sealed-pending', true);
    });
    await runInDurableObject(stub, async (instance) => {
      await (instance as unknown as { alarm: () => Promise<void> }).alarm();
    });

    expect(await firstSide.waitFor('CHALLENGE_UPDATED')).toMatchObject({ challengeId });
    expect(await secondSide.waitFor('CHALLENGE_UPDATED')).toMatchObject({ challengeId });
    expect(await repository.byId(challengeId)).toMatchObject({ status: 'VOID' });
    expect(await env.CORE_DB.prepare(
      'SELECT SUM(total_xp) AS total FROM user_profiles WHERE user_id IN (?1, ?2)',
    ).bind(first.id, second.id).first<{ total: number }>()).toEqual({ total: 0 });
  });

  it('corrida entre selar a metade e um cancelamento concorrente não duplica resposta, XP ou evento', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const { challengeId, repository } = await asyncChallenge(first, second, themeSlug);
    const stub = await openRoom(challengeId, 'FIRST');

    // Leva a sala até FINALIZING (pronta para selar no próximo alarme), sem
    // disparar o alarme ainda — reproduz a janela em que ele já está agendado.
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = await state.storage.get<AsyncHalfState>('half');
      if (stored === undefined) throw new Error('Metade não inicializada.');
      stored.answers = stored.answers.map((_answer, index) => {
        const score = [20, 18, 0, 15, 11, 14, 0][index] ?? 0;
        return {
          answeredAtMs: Date.now(), correct: score > 0,
          remainingMs: score > 0 ? (score - 10) * 1_000 : 0, score, selectedOption: 0, submitted: true,
        };
      });
      stored.score = stored.answers.reduce((total, answer) => total + (answer?.score ?? 0), 0);
      stored.roundIndex = stored.questions.length - 1;
      stored.phase = 'FINALIZING';
      stored.phaseDeadlineMs = null;
      stored.connected = true;
      await state.storage.put('half', stored);
    });

    // Corrida: o desafio é cancelado por fora exatamente nessa janela, sem
    // passar pelo endpoint /abort — a sala não sabe do cancelamento concorrente.
    const record = await repository.byId(challengeId);
    if (record === null) throw new Error('Desafio ausente.');
    expect(await repository.applyAction(record, { actorUserId: first.id, type: 'CANCEL' })).toBe(true);

    const firstSide = await listenSocial(first.id);
    const secondSide = await listenSocial(second.id);
    // O alarme roda mesmo assim: a selagem perde a corrida contra o cancelamento.
    await runInDurableObject(stub, async (instance) => {
      await (instance as unknown as { alarm: () => Promise<void> }).alarm();
    });

    expect(await repository.byId(challengeId)).toMatchObject({ status: 'CANCELLED' });
    // Nenhuma resposta residual: a tentativa perdedora é explicitamente desfeita.
    expect(await env.CORE_DB.prepare(
      'SELECT COUNT(*) AS total FROM challenge_answers WHERE challenge_id = ?1',
    ).bind(challengeId).first()).toEqual({ total: 0 });
    expect(await env.CORE_DB.prepare(
      'SELECT SUM(total_xp) AS total FROM user_profiles WHERE user_id IN (?1, ?2)',
    ).bind(first.id, second.id).first<{ total: number }>()).toEqual({ total: 0 });
    // A selagem perdedora é silenciosa: não gera um segundo CHALLENGE_UPDATED.
    expect(firstSide.messages.some((message) => message.type === 'CHALLENGE_UPDATED')).toBe(false);
    expect(secondSide.messages.some((message) => message.type === 'CHALLENGE_UPDATED')).toBe(false);
    // Nem estatística: a corrida perdida nunca chega a registrar use/answer_count.
    expect(await env.QUESTIONS_DB.prepare(
      "SELECT COUNT(*) AS total FROM question_statistics_ledger WHERE context_kind = 'CHALLENGE' AND context_id = ?1",
    ).bind(challengeId).first()).toEqual({ total: 0 });
    // Nem missão/streak: a selagem perdedora nunca chega a outcome === 'APPLIED'.
    const dayKey = new Date().toISOString().slice(0, 10);
    expect(await env.CORE_DB.prepare(
      'SELECT COUNT(*) AS total FROM user_daily_missions WHERE user_id = ?1 AND day_key = ?2 AND progress > 0',
    ).bind(first.id, dayKey).first()).toEqual({ total: 0 });
    expect(await env.CORE_DB.prepare(
      'SELECT COUNT(*) AS total FROM user_theme_streaks WHERE user_id = ?1',
    ).bind(first.id).first()).toEqual({ total: 0 });

    // Selar de novo (retry do alarme) continua sem efeito colateral.
    await runInDurableObject(stub, async (instance) => {
      await (instance as unknown as { alarm: () => Promise<void> }).alarm();
    });
    expect(await env.CORE_DB.prepare(
      'SELECT COUNT(*) AS total FROM challenge_answers WHERE challenge_id = ?1',
    ).bind(challengeId).first()).toEqual({ total: 0 });
  });

  it('metade inicializada sem socket expira pela graça e não deixa FIRST_PLAYER_ACTIVE órfão', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const { challengeId, repository } = await asyncChallenge(first, second, themeSlug);
    const stub = await openRoom(challengeId, 'FIRST');
    const firstSide = await listenSocial(first.id);
    const secondSide = await listenSocial(second.id);

    await runInDurableObject(stub, async (_instance, state) => {
      const stored = await state.storage.get<AsyncHalfState>('half');
      if (stored === undefined) throw new Error('Metade não inicializada.');
      stored.connected = false;
      stored.phaseDeadlineMs = Date.now() - 1;
      await state.storage.put('half', stored);
    });
    const response = await stub.fetch('https://challenge.internal/reconcile', { method: 'POST' });
    expect(await response.json()).toEqual({ phase: 'VOID' });
    expect(await firstSide.waitFor('CHALLENGE_UPDATED')).toMatchObject({ challengeId });
    expect(await secondSide.waitFor('CHALLENGE_UPDATED')).toMatchObject({ challengeId });
    expect(await repository.byId(challengeId)).toMatchObject({ status: 'VOID' });
    expect(await env.CORE_DB.prepare(
      'SELECT COUNT(*) AS total FROM challenge_questions WHERE challenge_id = ?1',
    ).bind(challengeId).first()).toEqual({ total: 0 });
  });
});

describe('M9C+M10 — limite por dupla é por tipo de desafio', () => {
  it('permite DIRECT enquanto o ASYNC da mesma dupla aguarda o segundo jogador', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const { challengeId, repository, themeId } = await asyncChallenge(first, second, themeSlug);
    await finalizeHalf(await openRoom(challengeId, 'FIRST'), [20, 18, 0, 15, 11, 14, 0]);
    expect(await repository.byId(challengeId)).toMatchObject({ status: 'WAITING_FOR_SECOND' });

    // Cenário obrigatório do smoke: A já jogou a metade dele e pode chamar B para agora.
    const direct = await repository.create({
      actorUserId: first.id, kind: 'DIRECT',
      targetPresence: 'ONLINE', targetUserId: second.id, themeId,
    });
    expect(direct.created).toBe(true);
    expect(direct.challengeId).not.toBe(challengeId);

    // Os dois convivem: o assíncrono continua esperando o segundo jogador.
    const live = await repository.allActiveForPair(first.id, second.id);
    expect(live.map((entry) => entry.kind).sort()).toEqual(['ASYNC', 'DIRECT']);
    expect(await repository.byId(challengeId)).toMatchObject({ status: 'WAITING_FOR_SECOND' });
  });

  it('continua proibindo dois ASYNC e dois DIRECT vivos na mesma dupla', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const repository = new ChallengeRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);

    await expect(repository.create({
      actorUserId: first.id, kind: 'ASYNC',
      targetPresence: 'ONLINE', targetUserId: second.id, themeId,
    })).resolves.toMatchObject({ created: true });
    await expect(repository.create({
      actorUserId: first.id, kind: 'ASYNC',
      targetPresence: 'ONLINE', targetUserId: second.id, themeId,
    })).rejects.toMatchObject({ code: 'CHALLENGE_ALREADY_ACTIVE', status: 409 });

    await expect(repository.create({
      actorUserId: first.id, kind: 'DIRECT',
      targetPresence: 'ONLINE', targetUserId: second.id, themeId,
    })).resolves.toMatchObject({ created: true });
    await expect(repository.create({
      actorUserId: first.id, kind: 'DIRECT',
      targetPresence: 'ONLINE', targetUserId: second.id, themeId,
    })).rejects.toMatchObject({ code: 'CHALLENGE_ALREADY_ACTIVE', status: 409 });
  });

  it('o índice único da migration 0009 é a última barreira, separado por tipo', async () => {
    const indexes = await env.CORE_DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'challenges'",
    ).all<{ name: string }>();
    const names = indexes.results.map((row) => row.name);
    expect(names).toContain('idx_challenges_live_pair_async');
    expect(names).toContain('idx_challenges_live_pair_direct');
    // O índice antigo, que impedia DIRECT e ASYNC juntos, não pode voltar.
    expect(names).not.toContain('idx_challenges_live_pair');

    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const repository = new ChallengeRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);
    const created = await repository.create({
      actorUserId: first.id, kind: 'ASYNC',
      targetPresence: 'ONLINE', targetUserId: second.id, themeId,
    });
    const stored = await env.CORE_DB.prepare(
      'SELECT pair_low_id, pair_high_id FROM challenges WHERE id = ?1',
    ).bind(created.challengeId).first<{ pair_high_id: string; pair_low_id: string }>();
    if (stored === null) throw new Error('Desafio ausente.');

    // Mesmo contornando a regra de aplicação, o banco recusa o segundo ASYNC vivo.
    await expect(env.CORE_DB.prepare(
      `INSERT INTO challenges
        (id, pair_low_id, pair_high_id, first_player_user_id, second_player_user_id,
         theme_id, difficulty, kind, status, revision)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'EASY', 'ASYNC', 'FIRST_PLAYER_ACTIVE', 1)`,
    ).bind(
      crypto.randomUUID(), stored.pair_low_id, stored.pair_high_id, first.id, second.id, themeId,
    ).run()).rejects.toThrow();

    // O DIRECT com a mesma dupla passa: são índices distintos.
    await expect(env.CORE_DB.prepare(
      `INSERT INTO challenges
        (id, pair_low_id, pair_high_id, first_player_user_id, second_player_user_id,
         theme_id, difficulty, kind, status, revision)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'EASY', 'DIRECT', 'PENDING_DIRECT', 1)`,
    ).bind(
      crypto.randomUUID(), stored.pair_low_id, stored.pair_high_id, first.id, second.id, themeId,
    ).run()).resolves.toBeDefined();
  });
});

describe('M9C+M10 — FCM ASYNC "sua vez de jogar" é best-effort e nunca altera o desafio', () => {
  beforeEach(() => resetSocialPushCacheForTests());

  it('sem FCM configurado, a selagem da primeira metade não tenta rede nem quebra', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const { challengeId, repository } = await asyncChallenge(first, second, themeSlug);
    await new SocialRepository(env.CORE_DB).registerInstallation(second.id, 'syntheticFID_absent_1');
    // env.FCM_SERVICE_ACCOUNT_JSON não está configurado neste ambiente de teste.
    await finalizeHalf(await openRoom(challengeId, 'FIRST'), [20, 18, 0, 15, 11, 14, 0]);
    expect(await repository.byId(challengeId)).toMatchObject({ status: 'WAITING_FOR_SECOND' });
  });

  it('destinatário que silenciou o desafiante não recebe push nenhum', async () => {
    const { users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const social = new SocialRepository(env.CORE_DB);
    await social.registerInstallation(second.id, 'syntheticFID_muted_1');
    await social.muteFriend(second.id, first.publicId);
    const fetcher = vi.fn<typeof fetch>(() => { throw new Error('silenciado não deveria tentar FCM'); });
    const push = new SocialPushService(withFcmConfigured(await syntheticPrivateKeyPem()), social, fetcher);
    expect(push.configured).toBe(true);
    await push.sendChallengeReady({
      challengeId: 'challenge-muted', challengerDisplayName: 'Quem desafiou',
      challengerUserId: first.id, origin: 'https://quiz.test', targetUserId: second.id,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('com FCM configurado, entrega CHALLENGE_READY por FID sem PII e marca sucesso', async () => {
    const { users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const social = new SocialRepository(env.CORE_DB);
    const fid = 'syntheticFID_ready_1';
    await social.registerInstallation(second.id, fid);
    const deliveries: Array<{ message: { data: Record<string, string>; fid: string } }> = [];
    const fetcher = vi.fn<typeof fetch>((input, initialization) => {
      const address = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (address === 'https://oauth2.googleapis.com/token') {
        return Promise.resolve(Response.json({ access_token: 'synthetic-oauth-access-token', expires_in: 3_600 }));
      }
      if (typeof initialization?.body !== 'string') throw new Error('Payload FCM sintético ausente.');
      deliveries.push(JSON.parse(initialization.body) as (typeof deliveries)[number]);
      return Promise.resolve(Response.json({ name: 'projects/synthetic/messages/1' }));
    });
    const push = new SocialPushService(withFcmConfigured(await syntheticPrivateKeyPem()), social, fetcher);
    await push.sendChallengeReady({
      challengeId: 'challenge-ready', challengerDisplayName: 'Primeiro Jogador',
      challengerUserId: first.id, origin: 'https://quiz.test', targetUserId: second.id,
    });

    expect(deliveries).toHaveLength(1);
    const delivered = deliveries[0];
    if (delivered === undefined) throw new Error('Entrega ausente.');
    expect(delivered.message.fid).toBe(fid);
    expect(delivered.message.data).toMatchObject({
      body: 'Primeiro Jogador está esperando você jogar',
      title: 'Sua vez de jogar',
      type: 'CHALLENGE_READY',
    });
    expect(JSON.stringify(delivered.message.data)).not.toContain(first.uid);
    expect(JSON.stringify(delivered.message.data)).not.toContain('@');
    expect(await env.CORE_DB.prepare(
      'SELECT last_success_at IS NOT NULL AS delivered FROM push_installations WHERE installation_id = ?1',
    ).bind(fid).first()).toEqual({ delivered: 1 });
  });

  it('canal social já aberto (foreground) não duplica em push FCM, mesmo configurado', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const { challengeId } = await asyncChallenge(first, second, themeSlug);
    await new SocialRepository(env.CORE_DB).registerInstallation(second.id, 'syntheticFID_fg_1');
    const secondSide = await listenSocial(second.id);
    // Só a chamada FCM/OAuth passa por `fetch` global; a checagem de presença
    // usa o binding do DO diretamente e não é afetada por este espião.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      await notifyChallengeReadyForSecond(withFcmConfigured(await syntheticPrivateKeyPem()), {
        challengeId, firstPlayerDisplayName: 'Primeiro Jogador',
        firstPlayerUserId: first.id, secondPlayerUserId: second.id,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
    expect(secondSide.messages.some((message) => message.type === 'CHALLENGE_READY')).toBe(false);
  });

  it('falha de entrega do FCM é best-effort: não propaga erro nem altera o desafio', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const { challengeId, repository } = await asyncChallenge(first, second, themeSlug);
    await new SocialRepository(env.CORE_DB).registerInstallation(second.id, 'syntheticFID_fail_1');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('rede fora do ar'));
    try {
      await expect(notifyChallengeReadyForSecond(withFcmConfigured(await syntheticPrivateKeyPem()), {
        challengeId, firstPlayerDisplayName: 'Primeiro Jogador',
        firstPlayerUserId: first.id, secondPlayerUserId: second.id,
      })).resolves.toBeUndefined();
    } finally {
      fetchSpy.mockRestore();
    }
    expect(await repository.byId(challengeId)).toMatchObject({ status: 'FIRST_PLAYER_ACTIVE' });
  });
});
