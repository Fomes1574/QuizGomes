import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { AsyncHalfState } from '@quiz-gomes/domain';
import { ChallengeRepository } from '../repositories/challenge-repository.js';
import { notifyChallengeUpdated } from '../services/challenge-notifier.js';
import { befriend, fixture, themeIdOf, userAt, type FixtureUser } from './challenge-fixture.worker.js';

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
    difficulty: 'EASY',
    kind: 'ASYNC',
    targetPresence: 'OFFLINE',
    targetUserId: second.id,
    themeId,
  });
  await repository.sealQuestionSet(created.challengeId, themeId, 'EASY', env.QUESTIONS_DB);
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

    await finalizeHalf(await openRoom(challengeId, 'FIRST'), [20, 18, 0, 15, 11]);

    expect(await firstSide.waitFor('CHALLENGE_UPDATED')).toMatchObject({ challengeId });
    expect(await secondSide.waitFor('CHALLENGE_UPDATED')).toMatchObject({ challengeId });
    expect(await repository.byId(challengeId)).toMatchObject({ status: 'WAITING_FOR_SECOND' });
    expect(await repository.sealedHalf(challengeId, first.id)).toHaveLength(5);
    expect(await repository.sealedHalf(challengeId, second.id)).toEqual([]);
  });

  it('a conclusão da segunda metade avisa os dois lados e fecha o desafio', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const { challengeId, repository } = await asyncChallenge(first, second, themeSlug);
    await finalizeHalf(await openRoom(challengeId, 'FIRST'), [20, 18, 0, 15, 11]);
    await env.CORE_DB.prepare("UPDATE challenges SET status = 'SECOND_PLAYER_ACTIVE' WHERE id = ?1")
      .bind(challengeId).run();

    const firstSide = await listenSocial(first.id);
    const secondSide = await listenSocial(second.id);
    await finalizeHalf(await openRoom(challengeId, 'SECOND'), [20, 20, 20, 20, 20]);

    expect(await firstSide.waitFor('CHALLENGE_UPDATED')).toMatchObject({ challengeId });
    expect(await secondSide.waitFor('CHALLENGE_UPDATED')).toMatchObject({ challengeId });
    expect(await repository.byId(challengeId)).toMatchObject({ status: 'COMPLETED' });
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
      actorUserId: first.id, difficulty: 'EASY', kind: 'ASYNC',
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
    await finalizeHalf(await openRoom(challengeId, 'FIRST'), [20, 18, 0, 15, 11]);
    expect(await repository.byId(challengeId)).toMatchObject({ status: 'WAITING_FOR_SECOND' });

    // Cenário obrigatório do smoke: A já jogou a metade dele e pode chamar B para agora.
    const direct = await repository.create({
      actorUserId: first.id, difficulty: 'EASY', kind: 'DIRECT',
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
      actorUserId: first.id, difficulty: 'EASY', kind: 'ASYNC',
      targetPresence: 'ONLINE', targetUserId: second.id, themeId,
    })).resolves.toMatchObject({ created: true });
    await expect(repository.create({
      actorUserId: first.id, difficulty: 'HARD', kind: 'ASYNC',
      targetPresence: 'ONLINE', targetUserId: second.id, themeId,
    })).rejects.toMatchObject({ code: 'CHALLENGE_ALREADY_ACTIVE', status: 409 });

    await expect(repository.create({
      actorUserId: first.id, difficulty: 'EASY', kind: 'DIRECT',
      targetPresence: 'ONLINE', targetUserId: second.id, themeId,
    })).resolves.toMatchObject({ created: true });
    await expect(repository.create({
      actorUserId: first.id, difficulty: 'EASY', kind: 'DIRECT',
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
      actorUserId: first.id, difficulty: 'EASY', kind: 'ASYNC',
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
