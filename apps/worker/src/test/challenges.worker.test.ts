import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  CHALLENGE_RATE_LIMIT,
  CHALLENGE_RATE_WINDOW_MS,
  ChallengeRepository,
} from '../repositories/challenge-repository.js';
import { acceptChallenge, reconcileChallengeLifecycle } from '../index.js';
import { SocialRepository } from '../repositories/social-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import { DirectChallengeService } from '../services/direct-challenge-service.js';
import { befriend, fixture, themeIdOf, userAt } from './challenge-fixture.worker.js';

function fakeContext(): ExecutionContext {
  return { waitUntil(promise: Promise<unknown>) { void promise; } } as unknown as ExecutionContext;
}

/**
 * Mesma coisa que `fakeContext()`, mas coleta os `waitUntil` em vez de
 * dispará-los sem esperar — necessário quando o próprio teste dispara duas
 * chamadas de verdade em corrida: sem isso, o trabalho de fundo (aviso Social)
 * do perdedor continuaria em voo depois do teste terminar e podia colidir com
 * o próximo teste, que roda no mesmo ambiente Miniflare (`--no-isolate`).
 */
function collectingContext(): { context: ExecutionContext; settle: () => Promise<void> } {
  const pending: Array<Promise<unknown>> = [];
  const context = {
    waitUntil(promise: Promise<unknown>) { pending.push(promise); },
  } as unknown as ExecutionContext;
  return { context, settle: async () => { await Promise.allSettled(pending); } };
}

async function presenceOf(uid: string): Promise<{ activity: string; resource: string | null }> {
  const response = await env.PRESENCE_HUB.get(env.PRESENCE_HUB.idFromName(uid))
    .fetch('https://presence.internal/state');
  return response.json();
}

describe('M9C+M10 — desafios entre amigos no runtime Workers/D1', () => {
  it('exige amizade e recusa alvo bloqueado ou desconhecido', async () => {
    const { users } = await fixture(3);
    const challenger = userAt(users, 0);
    const stranger = userAt(users, 1);
    const blockedFriend = userAt(users, 2);
    const repository = new ChallengeRepository(env.CORE_DB);

    await expect(repository.friendTarget(challenger.id, stranger.publicId)).rejects.toMatchObject({
      code: 'USER_UNAVAILABLE', status: 404,
    });

    await befriend(challenger, blockedFriend);
    await expect(repository.friendTarget(challenger.id, blockedFriend.publicId)).resolves.toBe(blockedFriend.id);
    await new SocialRepository(env.CORE_DB).block(challenger.id, blockedFriend.publicId);
    await expect(repository.friendTarget(challenger.id, blockedFriend.publicId)).rejects.toMatchObject({
      code: 'USER_UNAVAILABLE', status: 404,
    });
  });

  it('"Desafiar agora" só vale para amigo Online; "Desafiar depois" aceita qualquer presença', async () => {
    const { themeSlug, users } = await fixture(2);
    const challenger = userAt(users, 0);
    const friend = userAt(users, 1);
    await befriend(challenger, friend);
    const repository = new ChallengeRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);

    for (const presence of ['OFFLINE', 'MATCHMAKING', 'IN_MATCH', 'RECONNECTING'] as const) {
      await expect(repository.create({
        actorUserId: challenger.id,
        kind: 'DIRECT',
        targetPresence: presence,
        targetUserId: friend.id,
        themeId,
      })).rejects.toMatchObject({ code: 'FRIEND_UNAVAILABLE', status: 409 });
    }

    const async = await repository.create({
      actorUserId: challenger.id,
      kind: 'ASYNC',
      targetPresence: 'OFFLINE',
      targetUserId: friend.id,
      themeId,
    });
    expect(async.created).toBe(true);
    const stored = await repository.byId(async.challengeId);
    expect(stored?.status).toBe('FIRST_PLAYER_ACTIVE');
    expect(stored?.expiresAtMs).toBeNull();
  });

  it('mantém no máximo um desafio por dupla e libera terceiros', async () => {
    const { themeSlug, users } = await fixture(3);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    const third = userAt(users, 2);
    await befriend(first, second);
    await befriend(first, third);
    await befriend(second, third);
    const repository = new ChallengeRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);
    const base = { kind: 'ASYNC', targetPresence: 'ONLINE', themeId } as const;

    const created = await repository.create({ ...base, actorUserId: first.id, targetUserId: second.id });
    expect(created.created).toBe(true);

    // O mesmo desafiante não abre um segundo desafio para a mesma pessoa.
    await expect(repository.create({ ...base, actorUserId: first.id, targetUserId: second.id }))
      .rejects.toMatchObject({ code: 'CHALLENGE_ALREADY_ACTIVE', status: 409 });

    // O cruzado vira concordância, sem criar registro novo e sem trocar o primeiro jogador.
    const crossed = await repository.create({ ...base, actorUserId: second.id, targetUserId: first.id });
    expect(crossed.created).toBe(false);
    expect(crossed.challengeId).toBe(created.challengeId);
    const agreed = await repository.byId(created.challengeId);
    expect(agreed?.secondPlayerAgreed).toBe(true);
    expect(agreed?.firstPlayerUserId).toBe(first.id);

    // Outras duplas continuam livres.
    await expect(repository.create({ ...base, actorUserId: first.id, targetUserId: third.id }))
      .resolves.toMatchObject({ created: true });
    await expect(repository.create({ ...base, actorUserId: second.id, targetUserId: third.id }))
      .resolves.toMatchObject({ created: true });
  });

  it('cancelamento e recusa são idempotentes por CAS e limpam o payload competitivo', async () => {
    const { themeSlug, users } = await fixture(2);
    const challenger = userAt(users, 0);
    const friend = userAt(users, 1);
    await befriend(challenger, friend);
    const repository = new ChallengeRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);
    const created = await repository.create({
      actorUserId: challenger.id,
      kind: 'ASYNC',
      targetPresence: 'ONLINE',
      targetUserId: friend.id,
      themeId,
    });
    await env.CORE_DB.batch([
      env.CORE_DB.prepare(
        `INSERT INTO challenge_questions
          (challenge_id, round_number, question_id, pool_slot, public_snapshot_json, correct_option)
         VALUES (?1, 1, 'q-1', 1, '{}', 0)`,
      ).bind(created.challengeId),
      env.CORE_DB.prepare(
        `INSERT INTO challenge_answers
          (challenge_id, round_number, user_id, selected_option, remaining_ms, is_correct, score)
         VALUES (?1, 1, ?2, 0, 8000, 1, 18)`,
      ).bind(created.challengeId, challenger.id),
    ]);

    const record = await repository.byId(created.challengeId);
    if (record === null) throw new Error('Desafio ausente.');
    expect(await repository.applyAction(record, { actorUserId: challenger.id, type: 'CANCEL' })).toBe(true);
    // Retry, double tap ou outra aba com a mesma revisão não reaplica nada: o CAS recusa.
    expect(await repository.applyAction(record, { actorUserId: challenger.id, type: 'CANCEL' })).toBe(false);
    // Relendo o estado já encerrado, a regra recusa antes mesmo de tocar o banco.
    const settled = await repository.byId(created.challengeId);
    if (settled === null) throw new Error('Desafio ausente.');
    await expect(repository.applyAction(settled, { actorUserId: challenger.id, type: 'CANCEL' }))
      .rejects.toMatchObject({ code: 'CHALLENGE_NOT_ACTIVE' });

    expect(await repository.byId(created.challengeId)).toMatchObject({ status: 'CANCELLED' });
    expect(await env.CORE_DB.prepare(
      'SELECT COUNT(*) AS total FROM challenge_questions WHERE challenge_id = ?1',
    ).bind(created.challengeId).first()).toEqual({ total: 0 });
    expect(await env.CORE_DB.prepare(
      'SELECT COUNT(*) AS total FROM challenge_answers WHERE challenge_id = ?1',
    ).bind(created.challengeId).first()).toEqual({ total: 0 });
    // A dupla volta a aceitar desafio depois do encerramento.
    await expect(repository.create({
      actorUserId: challenger.id,
      kind: 'ASYNC',
      targetPresence: 'ONLINE',
      targetUserId: friend.id,
      themeId,
    })).resolves.toMatchObject({ created: true });
  });

  it('expira o convite direto em 30 s sem tratar como recusa e libera novo desafio', async () => {
    const { themeSlug, users } = await fixture(2);
    const challenger = userAt(users, 0);
    const friend = userAt(users, 1);
    await befriend(challenger, friend);
    const themeId = await themeIdOf(themeSlug);
    let now = Date.parse('2026-09-10T12:00:00.000Z');
    const repository = new ChallengeRepository(env.CORE_DB, () => new Date(now));
    const created = await repository.create({
      actorUserId: challenger.id,
      kind: 'DIRECT',
      targetPresence: 'ONLINE',
      targetUserId: friend.id,
      themeId,
    });

    expect((await repository.forUser(friend.id, now)).challenges).toHaveLength(1);
    now += 29_999;
    expect(await repository.expireStaleDirect()).toEqual([]);
    expect((await repository.forUser(friend.id, now)).challenges).toHaveLength(1);

    now += 1;
    // Vencido some da lista mesmo antes da varredura.
    expect((await repository.forUser(friend.id, now)).challenges).toEqual([]);
    // A varredura por participante encerra e devolve os dois lados para notificação.
    expect(await repository.expireStaleDirect(friend.id)).toEqual([
      { id: created.challengeId, participants: [challenger.id, friend.id] },
    ]);
    expect(await repository.byId(created.challengeId)).toMatchObject({ status: 'EXPIRED' });
    // Idempotente: uma segunda varredura não encontra mais nada.
    expect(await repository.expireStaleDirect(friend.id)).toEqual([]);

    const again = await repository.create({
      actorUserId: challenger.id,
      kind: 'DIRECT',
      targetPresence: 'ONLINE',
      targetUserId: friend.id,
      themeId,
    });
    expect(again.created).toBe(true);
  });

  it('converge DIRECT terminal do MatchRoom para COMPLETED/VOID e libera outro DIRECT', async () => {
    for (const matchStatus of ['FINISHED', 'VOID'] as const) {
      const { themeSlug, users } = await fixture(2);
      const first = userAt(users, 0);
      const second = userAt(users, 1);
      await befriend(first, second);
      const repository = new ChallengeRepository(env.CORE_DB);
      const themeId = await themeIdOf(themeSlug);
      const created = await repository.create({
        actorUserId: first.id, kind: 'DIRECT',
        targetPresence: 'ONLINE', targetUserId: second.id, themeId,
      });
      const matchId = crypto.randomUUID();
      await env.CORE_DB.batch([
        env.CORE_DB.prepare(
          `INSERT INTO matches (id, theme_id, difficulty, mode, kind, status, question_shard_id)
           VALUES (?1, ?2, 'EASY', 'CASUAL', 'DIRECT_LIVE', ?3, 'questions-01')`,
        ).bind(matchId, themeId, matchStatus),
        env.CORE_DB.prepare(
          "UPDATE challenges SET status = 'ACTIVE', match_id = ?1 WHERE id = ?2",
        ).bind(matchId, created.challengeId),
      ]);
      const live = (await repository.liveLifecycleForUser(first.id))
        .find((entry) => entry.id === created.challengeId);
      if (live === undefined) throw new Error('Desafio DIRECT ausente.');
      expect(await repository.reconcileDirectMatch(live)).toBe(true);
      expect(await repository.byId(created.challengeId)).toMatchObject({
        status: matchStatus === 'FINISHED' ? 'COMPLETED' : 'VOID',
      });
      expect((await repository.forUser(first.id)).challenges).toEqual([]);
      await expect(repository.create({
        actorUserId: first.id, kind: 'DIRECT',
        targetPresence: 'ONLINE', targetUserId: second.id, themeId,
      })).resolves.toMatchObject({ created: true });
    }
  });

  it('anula reserva DIRECT PREPARING sem MatchRoom, limpa locks e libera novo convite', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const challenges = new ChallengeRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);
    const created = await challenges.create({
      actorUserId: first.id, kind: 'DIRECT',
      targetPresence: 'ONLINE', targetUserId: second.id, themeId,
    });
    const matchId = crypto.randomUUID();
    await env.CORE_DB.batch([
      env.CORE_DB.prepare(
        `INSERT INTO matches
          (id, theme_id, difficulty, mode, kind, status, question_shard_id, created_at)
         VALUES (?1, ?2, 'EASY', 'CASUAL', 'DIRECT_LIVE', 'PREPARING', 'questions-01', '2000-01-01T00:00:00.000Z')`,
      ).bind(matchId, themeId),
      env.CORE_DB.prepare(
        'INSERT INTO match_players (match_id, user_id, seat) VALUES (?1, ?2, 1), (?1, ?3, 2)',
      ).bind(matchId, first.id, second.id),
      env.CORE_DB.prepare(
        'INSERT INTO active_match_players (user_id, match_id) VALUES (?1, ?3), (?2, ?3)',
      ).bind(first.id, second.id, matchId),
      env.CORE_DB.prepare(
        "UPDATE challenges SET status = 'ACTIVE', match_id = ?1, updated_at = '2000-01-01T00:00:00.000Z' WHERE id = ?2",
      ).bind(matchId, created.challengeId),
    ]);

    // O MatchRoom deste id nunca foi inicializado: GET /api/challenges consulta
    // essa prova autoritativa e executa a limpeza bounded abaixo.
    const missing = await env.MATCH_ROOM.get(env.MATCH_ROOM.idFromName(matchId))
      .fetch('https://match.internal/reconcile', { method: 'POST' });
    expect(await missing.json()).toEqual({ phase: 'MISSING' });
    await reconcileChallengeLifecycle(env, {
      waitUntil(promise: Promise<unknown>) { void promise; },
    } as unknown as ExecutionContext, challenges, first.id);
    expect(await env.CORE_DB.prepare('SELECT status FROM matches WHERE id = ?1').bind(matchId).first())
      .toEqual({ status: 'VOID' });
    expect(await env.CORE_DB.prepare('SELECT COUNT(*) AS total FROM active_match_players WHERE match_id = ?1')
      .bind(matchId).first()).toEqual({ total: 0 });
    expect(await challenges.byId(created.challengeId)).toMatchObject({ status: 'VOID' });
    await expect(challenges.create({
      actorUserId: first.id, kind: 'DIRECT',
      targetPresence: 'ONLINE', targetUserId: second.id, themeId,
    })).resolves.toMatchObject({ created: true });
  });

  it('MatchRoom terminal converge o desafio DIRECT e remove seus locks', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const challenges = new ChallengeRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);
    const created = await challenges.create({
      actorUserId: first.id, kind: 'DIRECT',
      targetPresence: 'ONLINE', targetUserId: second.id, themeId,
    });
    const pending = await challenges.byId(created.challengeId);
    if (pending === null) throw new Error('Convite DIRECT ausente.');
    const started = await new DirectChallengeService(env).start(pending, [first.uid, second.uid], crypto.randomUUID());
    await env.CORE_DB.prepare(
      "UPDATE challenges SET status = 'ACTIVE', match_id = ?1 WHERE id = ?2",
    ).bind(started.roomId, created.challengeId).run();

    const room = env.MATCH_ROOM.get(env.MATCH_ROOM.idFromName(started.roomId));
    expect((await room.fetch('https://match.internal/system-failure', { method: 'POST' })).ok).toBe(true);
    expect(await room.fetch('https://match.internal/reconcile', { method: 'POST' })
      .then((response) => response.json())).toEqual({ phase: 'VOID' });
    expect(await challenges.byId(created.challengeId)).toMatchObject({ status: 'VOID' });
    expect(await env.CORE_DB.prepare(
      'SELECT COUNT(*) AS total FROM active_match_players WHERE match_id = ?1',
    ).bind(started.roomId).first()).toEqual({ total: 0 });
  });

  it('remove reserva DIRECT sem MatchRoom após a graça e preserva um ASYNC paralelo', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    let now = Date.parse('2026-09-10T12:00:00.000Z');
    const repository = new ChallengeRepository(env.CORE_DB, () => new Date(now));
    const themeId = await themeIdOf(themeSlug);
    const direct = await repository.create({
      actorUserId: first.id, kind: 'DIRECT',
      targetPresence: 'ONLINE', targetUserId: second.id, themeId,
    });
    const async = await repository.create({
      actorUserId: first.id, kind: 'ASYNC',
      targetPresence: 'OFFLINE', targetUserId: second.id, themeId,
    });
    await env.CORE_DB.prepare(
      "UPDATE challenges SET status = 'PREPARING', updated_at = ?1 WHERE id = ?2",
    ).bind(new Date(now - 7_001).toISOString(), direct.challengeId).run();
    const stale = (await repository.liveLifecycleForUser(first.id)).find((entry) => entry.id === direct.challengeId);
    if (stale === undefined) throw new Error('Reserva DIRECT ausente.');
    now += 7_001;
    expect(await repository.voidOrphanedLive(stale, now - 7_000)).toBe(true);
    expect(await repository.byId(direct.challengeId)).toMatchObject({ status: 'VOID' });
    expect(await repository.byId(async.challengeId)).toMatchObject({ status: 'FIRST_PLAYER_ACTIVE' });
  });

  it('desfazer amizade e bloquear encerram o desafio pendente sem gerar resultado', async () => {
    for (const mode of ['unfriend', 'block'] as const) {
      const { themeSlug, users } = await fixture(2);
      const challenger = userAt(users, 0);
      const friend = userAt(users, 1);
      await befriend(challenger, friend);
      const repository = new ChallengeRepository(env.CORE_DB);
      const social = new SocialRepository(env.CORE_DB);
      const created = await repository.create({
        actorUserId: challenger.id,
        kind: 'ASYNC',
        targetPresence: 'ONLINE',
        targetUserId: friend.id,
        themeId: await themeIdOf(themeSlug),
      });

      if (mode === 'unfriend') await social.removeFriend(challenger.id, friend.publicId);
      else await social.block(challenger.id, friend.publicId);
      await repository.endForRelationship(challenger.id, friend.id);

      expect(await repository.byId(created.challengeId), mode).toMatchObject({ status: 'CANCELLED' });
      expect(await env.CORE_DB.prepare(
        'SELECT COUNT(*) AS total FROM result_ledger WHERE match_id = ?1',
      ).bind(created.challengeId).first(), mode).toEqual({ total: 0 });
    }
  });

  it('partida já iniciada sobrevive a desfazer amizade e a bloqueio', async () => {
    const { themeSlug, users } = await fixture(2);
    const challenger = userAt(users, 0);
    const friend = userAt(users, 1);
    await befriend(challenger, friend);
    const repository = new ChallengeRepository(env.CORE_DB);
    const created = await repository.create({
      actorUserId: challenger.id,
      kind: 'ASYNC',
      targetPresence: 'ONLINE',
      targetUserId: friend.id,
      themeId: await themeIdOf(themeSlug),
    });
    await env.CORE_DB.prepare(
      "UPDATE challenges SET status = 'SECOND_PLAYER_ACTIVE' WHERE id = ?1",
    ).bind(created.challengeId).run();

    await repository.endForRelationship(challenger.id, friend.id);
    expect(await repository.byId(created.challengeId)).toMatchObject({ status: 'SECOND_PLAYER_ACTIVE' });
  });

  it('aplica teto técnico de criação sem virar cooldown social visível', async () => {
    const { themeSlug, users } = await fixture(CHALLENGE_RATE_LIMIT + 2);
    const challenger = userAt(users, 0);
    const targets = users.slice(1);
    for (const target of targets) await befriend(challenger, target);
    const repository = new ChallengeRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);
    const base = { actorUserId: challenger.id, kind: 'ASYNC', targetPresence: 'ONLINE', themeId } as const;

    for (let index = 0; index < CHALLENGE_RATE_LIMIT; index += 1) {
      const target = targets[index];
      if (target === undefined) throw new Error('Fixture insuficiente.');
      await expect(repository.create({ ...base, targetUserId: target.id })).resolves.toMatchObject({ created: true });
    }

    const blocked = targets[CHALLENGE_RATE_LIMIT];
    if (blocked === undefined) throw new Error('Fixture insuficiente.');
    await expect(repository.create({ ...base, targetUserId: blocked.id })).rejects.toMatchObject({
      code: 'CHALLENGE_RATE_LIMITED', status: 429,
    });

    // Fora da janela o mesmo usuário volta a criar: é limite técnico, não punição.
    const later = new ChallengeRepository(
      env.CORE_DB,
      () => new Date(Date.now() + CHALLENGE_RATE_WINDOW_MS + 1_000),
    );
    await expect(later.create({ ...base, targetUserId: blocked.id })).resolves.toMatchObject({ created: true });
  });

  it('sela um único conjunto e serve exatamente as mesmas perguntas às duas metades', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const repository = new ChallengeRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);
    const created = await repository.create({
      actorUserId: first.id, kind: 'ASYNC',
      targetPresence: 'OFFLINE', targetUserId: second.id, themeId,
    });

    await repository.sealQuestionSet(created.challengeId, themeId, env.QUESTIONS_DB);
    const sealedOnce = await repository.questionSet(created.challengeId);
    expect(sealedOnce).toHaveLength(7);
    expect(new Set(sealedOnce.map((question) => question.id)).size).toBe(7);

    // Selar de novo é no-op: o conjunto já selado vence.
    await repository.sealQuestionSet(created.challengeId, themeId, env.QUESTIONS_DB);
    const sealedTwice = await repository.questionSet(created.challengeId);
    expect(sealedTwice.map((question) => question.id)).toEqual(sealedOnce.map((question) => question.id));
    expect(sealedTwice.map((question) => question.options)).toEqual(sealedOnce.map((question) => question.options));
    expect(sealedTwice.map((question) => question.correctOption))
      .toEqual(sealedOnce.map((question) => question.correctOption));
  });

  it('sela a metade do primeiro jogador, espera o segundo e conclui pagando XP uma única vez', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const repository = new ChallengeRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);
    const created = await repository.create({
      actorUserId: first.id, kind: 'ASYNC',
      targetPresence: 'OFFLINE', targetUserId: second.id, themeId,
    });
    await repository.sealQuestionSet(created.challengeId, themeId, env.QUESTIONS_DB);

    const firstHalf = [20, 0, 15, 11, 18].map((score, index) => ({
      correct: score > 0, remainingMs: score > 0 ? (score - 10) * 1_000 : 0, score, selectedOption: index % 4,
    }));
    await repository.sealHalf({
      answers: firstHalf, challengeId: created.challengeId,
      isSecondPlayer: false, userId: first.id,
    });
    expect(await repository.byId(created.challengeId)).toMatchObject({ status: 'WAITING_FOR_SECOND' });
    expect(await repository.sealedHalf(created.challengeId, first.id)).toEqual(firstHalf);
    // O segundo jogador ainda não selou nada.
    expect(await repository.sealedHalf(created.challengeId, second.id)).toEqual([]);
    // Efeitos da primeira metade (estatística/progressão) são chamados como o DO faria,
    // antes da conclusão — não pagam XP ainda, pois o desafio não está COMPLETED.
    await repository.recordHalfEffects(created.challengeId, first.id, env.QUESTIONS_DB);
    await repository.applyCompletionXp(created.challengeId);
    expect(await env.CORE_DB.prepare('SELECT total_xp FROM user_profiles WHERE user_id = ?1')
      .bind(first.id).first()).toEqual({ total_xp: 0 });

    await env.CORE_DB.prepare("UPDATE challenges SET status = 'SECOND_PLAYER_ACTIVE' WHERE id = ?1")
      .bind(created.challengeId).run();
    const secondHalf = [20, 20, 20, 0, 0].map((score, index) => ({
      correct: score > 0, remainingMs: score > 0 ? (score - 10) * 1_000 : 0, score, selectedOption: index % 4,
    }));
    await repository.sealHalf({
      answers: secondHalf, challengeId: created.challengeId,
      isSecondPlayer: true, userId: second.id,
    });
    await repository.recordHalfEffects(created.challengeId, second.id, env.QUESTIONS_DB);
    await repository.applyCompletionXp(created.challengeId);

    expect(await repository.byId(created.challengeId)).toMatchObject({ status: 'COMPLETED' });
    // 64 do primeiro contra 60 do segundo: vitória do primeiro, +20 XP (desafio é sempre Casual).
    const xp = await env.CORE_DB.prepare(
      'SELECT user_id, total_xp FROM user_profiles WHERE user_id IN (?1, ?2) ORDER BY user_id',
    ).bind(first.id, second.id).all<{ total_xp: number; user_id: string }>();
    const byUser = new Map(xp.results.map((row) => [row.user_id, row.total_xp]));
    expect(byUser.get(first.id)).toBe(20);
    expect(byUser.get(second.id)).toBe(0);

    // Reexecutar sealHalf, recordHalfEffects e applyCompletionXp (simulando um retry
    // após falha) não duplica resposta, progressão nem paga XP duas vezes.
    await repository.sealHalf({
      answers: secondHalf, challengeId: created.challengeId,
      isSecondPlayer: true, userId: second.id,
    });
    await repository.recordHalfEffects(created.challengeId, second.id, env.QUESTIONS_DB);
    await repository.recordHalfEffects(created.challengeId, first.id, env.QUESTIONS_DB);
    await repository.applyCompletionXp(created.challengeId);
    await repository.applyCompletionXp(created.challengeId);
    expect(await env.CORE_DB.prepare(
      'SELECT COUNT(*) AS total FROM challenge_answers WHERE challenge_id = ?1',
    ).bind(created.challengeId).first()).toEqual({ total: 10 });
    expect(await env.CORE_DB.prepare('SELECT total_xp FROM user_profiles WHERE user_id = ?1')
      .bind(first.id).first()).toEqual({ total_xp: 20 });
    expect(await env.CORE_DB.prepare('SELECT total_xp FROM user_profiles WHERE user_id = ?1')
      .bind(second.id).first()).toEqual({ total_xp: 0 });
  });

  it('empate no assíncrono não paga XP a ninguém e Conhecimento nunca muda', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const repository = new ChallengeRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);
    const created = await repository.create({
      actorUserId: first.id, kind: 'ASYNC',
      targetPresence: 'OFFLINE', targetUserId: second.id, themeId,
    });
    await repository.sealQuestionSet(created.challengeId, themeId, env.QUESTIONS_DB);
    const half = [20, 0, 0, 0, 0].map((score, index) => ({
      correct: score > 0, remainingMs: score > 0 ? (score - 10) * 1_000 : 0, score, selectedOption: index % 4,
    }));
    await repository.sealHalf({
      answers: half, challengeId: created.challengeId,
      isSecondPlayer: false, userId: first.id,
    });
    await env.CORE_DB.prepare("UPDATE challenges SET status = 'SECOND_PLAYER_ACTIVE' WHERE id = ?1")
      .bind(created.challengeId).run();
    await repository.sealHalf({
      answers: half, challengeId: created.challengeId,
      isSecondPlayer: true, userId: second.id,
    });
    await repository.recordHalfEffects(created.challengeId, first.id, env.QUESTIONS_DB);
    await repository.recordHalfEffects(created.challengeId, second.id, env.QUESTIONS_DB);
    await repository.applyCompletionXp(created.challengeId);

    expect(await repository.byId(created.challengeId)).toMatchObject({ status: 'COMPLETED' });
    const xp = await env.CORE_DB.prepare(
      'SELECT SUM(total_xp) AS total FROM user_profiles WHERE user_id IN (?1, ?2)',
    ).bind(first.id, second.id).first<{ total: number }>();
    expect(xp?.total).toBe(0);
    expect(await env.CORE_DB.prepare(
      'SELECT COUNT(*) AS total FROM theme_rankings WHERE user_id IN (?1, ?2)',
    ).bind(first.id, second.id).first()).toEqual({ total: 0 });
  });

  it('anular a metade do segundo jogador não gera vencedor, XP nem payload sobrevivente', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const repository = new ChallengeRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);
    const created = await repository.create({
      actorUserId: first.id, kind: 'ASYNC',
      targetPresence: 'OFFLINE', targetUserId: second.id, themeId,
    });
    await repository.sealQuestionSet(created.challengeId, themeId, env.QUESTIONS_DB);

    await repository.voidChallenge(created.challengeId);
    expect(await repository.byId(created.challengeId)).toMatchObject({ status: 'VOID' });
    expect(await env.CORE_DB.prepare(
      'SELECT COUNT(*) AS total FROM challenge_questions WHERE challenge_id = ?1',
    ).bind(created.challengeId).first()).toEqual({ total: 0 });
    expect(await env.CORE_DB.prepare(
      'SELECT SUM(total_xp) AS total FROM user_profiles WHERE user_id IN (?1, ?2)',
    ).bind(first.id, second.id).first<{ total: number }>()).toEqual({ total: 0 });
  });

  it('retomar efeitos pós-conclusão depois de uma falha simulada nunca duplica estatística, missão, streak ou XP', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const repository = new ChallengeRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);
    const created = await repository.create({
      actorUserId: first.id, kind: 'ASYNC',
      targetPresence: 'OFFLINE', targetUserId: second.id, themeId,
    });
    await repository.sealQuestionSet(created.challengeId, themeId, env.QUESTIONS_DB);
    const winningHalf = [20, 18, 0, 15, 11].map((score, index) => ({
      correct: score > 0, remainingMs: score > 0 ? (score - 10) * 1_000 : 0, score, selectedOption: index % 4,
    }));
    const losingHalf = [0, 0, 0, 0, 0].map((score, index) => ({
      correct: score > 0, remainingMs: 0, score, selectedOption: index % 4,
    }));
    await repository.sealHalf({
      answers: winningHalf, challengeId: created.challengeId, isSecondPlayer: false, userId: first.id,
    });
    await env.CORE_DB.prepare("UPDATE challenges SET status = 'SECOND_PLAYER_ACTIVE' WHERE id = ?1")
      .bind(created.challengeId).run();
    await repository.sealHalf({
      answers: losingHalf, challengeId: created.challengeId, isSecondPlayer: true, userId: second.id,
    });

    // `COMPLETED` já foi persistido por `sealHalf`, mas simula-se aqui uma falha
    // logo em seguida: efeitos pós-conclusão (estatística, missão, streak, XP)
    // nunca chegaram a rodar — exatamente a janela que a corretiva cobre.
    expect(await repository.byId(created.challengeId)).toMatchObject({ status: 'COMPLETED' });
    expect(await env.CORE_DB.prepare(
      'SELECT SUM(total_xp) AS total FROM user_profiles WHERE user_id IN (?1, ?2)',
    ).bind(first.id, second.id).first<{ total: number }>()).toEqual({ total: 0 });

    // Simula queda depois de criar o recibo de XP do vencedor e antes de o
    // batch que atualiza user_profiles/`applied` concluir.
    await env.CORE_DB.prepare(
      `INSERT INTO challenge_xp_ledger (challenge_id, user_id, xp_delta, applied)
       VALUES (?1, ?2, 10, 0)`,
    ).bind(created.challengeId, first.id).run();

    // Retry (o alarme do DO tentando de novo): os efeitos agora rodam.
    await repository.recordHalfEffects(created.challengeId, first.id, env.QUESTIONS_DB);
    await repository.recordHalfEffects(created.challengeId, second.id, env.QUESTIONS_DB);
    await repository.applyCompletionXp(created.challengeId);

    const dayKey = new Date().toISOString().slice(0, 10);
    const missionsBefore = await env.CORE_DB.prepare(
      'SELECT progress FROM user_daily_missions WHERE user_id = ?1 AND day_key = ?2 AND mission_type = ?3',
    ).bind(first.id, dayKey, 'ANSWER_QUESTIONS').first<{ progress: number }>();
    expect(missionsBefore?.progress).toBe(5);
    const streakBefore = await env.CORE_DB.prepare(
      'SELECT current_streak FROM user_theme_streaks WHERE user_id = ?1 AND theme_id = ?2',
    ).bind(first.id, themeId).first<{ current_streak: number }>();
    expect(streakBefore?.current_streak).toBe(1);
    const statsBefore = await env.QUESTIONS_DB.prepare(
      "SELECT COUNT(*) AS total FROM question_statistics_ledger WHERE context_kind = 'CHALLENGE' AND context_id = ?1",
    ).bind(created.challengeId).first<{ total: number }>();
    expect(statsBefore?.total).toBe(10);
    const xpBefore = await env.CORE_DB.prepare('SELECT total_xp FROM user_profiles WHERE user_id = ?1')
      .bind(first.id).first<{ total_xp: number }>();
    expect(xpBefore?.total_xp).toBeGreaterThan(0);

    // Repetir a mesma retomada (segunda tentativa do alarme, ou uma corrida entre
    // duas retomadas) nunca soma progresso, streak, estatística ou XP de novo.
    await repository.recordHalfEffects(created.challengeId, first.id, env.QUESTIONS_DB);
    await repository.recordHalfEffects(created.challengeId, second.id, env.QUESTIONS_DB);
    await repository.applyCompletionXp(created.challengeId);
    await repository.applyCompletionXp(created.challengeId);

    expect(await env.CORE_DB.prepare(
      'SELECT progress FROM user_daily_missions WHERE user_id = ?1 AND day_key = ?2 AND mission_type = ?3',
    ).bind(first.id, dayKey, 'ANSWER_QUESTIONS').first()).toEqual(missionsBefore);
    expect(await env.CORE_DB.prepare(
      'SELECT current_streak FROM user_theme_streaks WHERE user_id = ?1 AND theme_id = ?2',
    ).bind(first.id, themeId).first()).toEqual(streakBefore);
    expect(await env.QUESTIONS_DB.prepare(
      "SELECT COUNT(*) AS total FROM question_statistics_ledger WHERE context_kind = 'CHALLENGE' AND context_id = ?1",
    ).bind(created.challengeId).first()).toEqual(statsBefore);
    expect(await env.CORE_DB.prepare('SELECT total_xp FROM user_profiles WHERE user_id = ?1')
      .bind(first.id).first()).toEqual(xpBefore);
  });

  it('aceite em duplicidade (double tap / outra aba) converge para a mesma sala DIRECT', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const challenges = new ChallengeRepository(env.CORE_DB);
    const userRepository = new UserRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);
    const created = await challenges.create({
      actorUserId: first.id, kind: 'DIRECT',
      targetPresence: 'ONLINE', targetUserId: second.id, themeId,
    });
    const context = fakeContext();

    const [firstResponse, secondResponse] = await Promise.all([
      acceptChallenge(env, context, challenges, userRepository, second.id, created.challengeId),
      acceptChallenge(env, context, challenges, userRepository, second.id, created.challengeId),
    ]);
    const firstBody = await firstResponse.json<{ roomId: string }>();
    const secondBody = await secondResponse.json<{ roomId: string }>();
    // Os dois lados (double tap, outra aba) recebem exatamente a mesma sala.
    expect(secondBody.roomId).toBe(firstBody.roomId);

    expect(await env.CORE_DB.prepare('SELECT COUNT(*) AS total FROM matches WHERE id = ?1')
      .bind(firstBody.roomId).first()).toEqual({ total: 1 });
    expect(await challenges.byId(created.challengeId)).toMatchObject({ matchId: firstBody.roomId, status: 'ACTIVE' });
    // Nenhuma reserva de presença extra: cada jogador está preparado numa única sala.
    await expect(presenceOf(first.uid)).resolves.toMatchObject({ resource: firstBody.roomId });
    await expect(presenceOf(second.uid)).resolves.toMatchObject({ resource: firstBody.roomId });
  });

  it('falha de PresenceHub durante o start() desfaz a reserva, sem deixar modal preso', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const challenges = new ChallengeRepository(env.CORE_DB);
    const userRepository = new UserRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);
    const created = await challenges.create({
      actorUserId: first.id, kind: 'DIRECT',
      targetPresence: 'ONLINE', targetUserId: second.id, themeId,
    });

    // O desafiante já está ocupado em outra sala quando o aceite chega —
    // reproduz a corrida entre uma reserva concorrente e este aceite direto.
    await env.PRESENCE_HUB.get(env.PRESENCE_HUB.idFromName(first.uid)).fetch(
      'https://presence.internal/transition',
      { body: JSON.stringify({ from: ['idle'], resource: 'outra-sala', to: 'playing' }), method: 'POST' },
    );

    await expect(acceptChallenge(env, fakeContext(), challenges, userRepository, second.id, created.challengeId))
      .rejects.toMatchObject({ code: 'PLAYER_BUSY', status: 409 });

    // Nenhum modal preso: a tentativa que abriu o CAS desfaz a própria reserva.
    expect(await challenges.byId(created.challengeId)).toMatchObject({ status: 'VOID' });
    // O convidado, que não estava ocupado, não fica preso em "preparing".
    await expect(presenceOf(second.uid)).resolves.toMatchObject({ activity: 'idle' });
    // A ocupação alheia do desafiante não é tocada pela falha.
    await expect(presenceOf(first.uid)).resolves.toMatchObject({ activity: 'playing', resource: 'outra-sala' });

    // Depois do VOID a dupla pode abrir um novo convite normalmente.
    await expect(challenges.create({
      actorUserId: first.id, kind: 'DIRECT',
      targetPresence: 'ONLINE', targetUserId: second.id, themeId,
    })).resolves.toMatchObject({ created: true });
  });

  it('reconciliação não anula uma sala DIRECT recém-reservada ainda dentro da graça de 7 s', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const challenges = new ChallengeRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);
    const created = await challenges.create({
      actorUserId: first.id, kind: 'DIRECT',
      targetPresence: 'ONLINE', targetUserId: second.id, themeId,
    });
    // roomId reservado agora mesmo (updated_at "agora"), mas o MatchRoom ainda
    // não terminou de inicializar — a mesma janela de um `start()` lento.
    const roomId = crypto.randomUUID();
    await env.CORE_DB.prepare(
      `UPDATE challenges SET status = 'PREPARING', match_id = ?1 WHERE id = ?2`,
    ).bind(roomId, created.challengeId).run();

    await reconcileChallengeLifecycle(env, fakeContext(), challenges, first.id);

    // Dentro dos 7 s, mesmo com o MatchRoom "MISSING", a reserva sobrevive.
    expect(await challenges.byId(created.challengeId)).toMatchObject({ matchId: roomId, status: 'PREPARING' });
    expect(await env.CORE_DB.prepare('SELECT COUNT(*) AS total FROM matches WHERE id = ?1')
      .bind(roomId).first()).toEqual({ total: 0 });
  });

  it('depois da graça, reconciliação anula a reserva DIRECT cujo MatchRoom nunca terminou de nascer', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const challenges = new ChallengeRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);
    const created = await challenges.create({
      actorUserId: first.id, kind: 'DIRECT',
      targetPresence: 'ONLINE', targetUserId: second.id, themeId,
    });
    const roomId = crypto.randomUUID();
    // Mesma reserva, agora "parada" há mais de 7 s: a inicialização do MatchRoom
    // nunca chegou a completar (falha pós-criação da tentativa).
    await env.CORE_DB.prepare(
      `UPDATE challenges SET status = 'PREPARING', match_id = ?1, updated_at = '2000-01-01T00:00:00.000Z' WHERE id = ?2`,
    ).bind(roomId, created.challengeId).run();

    await reconcileChallengeLifecycle(env, fakeContext(), challenges, first.id);

    expect(await challenges.byId(created.challengeId)).toMatchObject({ status: 'VOID' });
    // A dupla volta a poder abrir um novo convite DIRECT.
    await expect(challenges.create({
      actorUserId: first.id, kind: 'DIRECT',
      targetPresence: 'ONLINE', targetUserId: second.id, themeId,
    })).resolves.toMatchObject({ created: true });
  });

  it('expõe roomId de DIRECT em preparo/ativo para os dois participantes recuperarem sem depender do push', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const challenges = new ChallengeRepository(env.CORE_DB);
    const userRepository = new UserRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);
    const created = await challenges.create({
      actorUserId: first.id, kind: 'DIRECT',
      targetPresence: 'ONLINE', targetUserId: second.id, themeId,
    });

    // O desafiante (criador) nunca vê roomId antes do aceite.
    const beforeAccept = (await challenges.forUser(first.id)).challenges.find((entry) => entry.id === created.challengeId);
    expect(beforeAccept?.roomId).toBeNull();

    // Aceite do convidado ativa a sala — simula o criador perdendo o push
    // CHALLENGE_STARTED (rede instável, aba em segundo plano).
    const response = await acceptChallenge(env, fakeContext(), challenges, userRepository, second.id, created.challengeId);
    const { roomId } = await response.json<{ roomId: string }>();

    // O criador recupera a MESMA sala relendo a lista autoritativa, sem realtime.
    const afterAccept = (await challenges.forUser(first.id)).challenges.find((entry) => entry.id === created.challengeId);
    expect(afterAccept).toMatchObject({ roomId, status: 'ACTIVE' });
    // O convidado também a vê, pela mesma via.
    const forSecond = (await challenges.forUser(second.id)).challenges.find((entry) => entry.id === created.challengeId);
    expect(forSecond).toMatchObject({ roomId, status: 'ACTIVE' });
  });

  it('aceite DIRECT persiste matches.kind = DIRECT_LIVE, nunca escolhido pelo cliente', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const challenges = new ChallengeRepository(env.CORE_DB);
    const userRepository = new UserRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);
    const created = await challenges.create({
      actorUserId: first.id, kind: 'DIRECT',
      targetPresence: 'ONLINE', targetUserId: second.id, themeId,
    });

    const response = await acceptChallenge(env, fakeContext(), challenges, userRepository, second.id, created.challengeId);
    const { roomId } = await response.json<{ roomId: string }>();

    expect(await env.CORE_DB.prepare('SELECT kind FROM matches WHERE id = ?1').bind(roomId).first())
      .toEqual({ kind: 'DIRECT_LIVE' });
  });

  it('convite DIRECT pendente nunca é anulado pela reconciliação antes dos 30 s, em nenhum instante', async () => {
    // matchId ainda é null (PENDING_DIRECT): a graça de 7 s nunca se aplica aqui,
    // só a expiração de 30 s de `expireStaleDirect`. Cobre 7 s, logo após 7 s e o
    // limiar de 29.999 s, sempre sobrevivendo e aceitando normalmente.
    for (const elapsedMs of [7_000, 7_001, 29_999]) {
      const { themeSlug, users } = await fixture(2);
      const first = userAt(users, 0);
      const second = userAt(users, 1);
      await befriend(first, second);
      const challenges = new ChallengeRepository(env.CORE_DB);
      const userRepository = new UserRepository(env.CORE_DB);
      const themeId = await themeIdOf(themeSlug);
      const created = await challenges.create({
        actorUserId: first.id, kind: 'DIRECT',
        targetPresence: 'ONLINE', targetUserId: second.id, themeId,
      });
      await env.CORE_DB.prepare('UPDATE challenges SET updated_at = ?1 WHERE id = ?2')
        .bind(new Date(Date.now() - elapsedMs).toISOString(), created.challengeId).run();

      await reconcileChallengeLifecycle(env, fakeContext(), challenges, second.id);
      // matchId continua null (nenhuma sala nasceu à toa): a reconciliação nunca
      // chama o MatchRoom para um convite ainda pendente.
      expect(await challenges.byId(created.challengeId), `elapsed=${elapsedMs}`)
        .toMatchObject({ matchId: null, status: 'PENDING_DIRECT' });

      const response = await acceptChallenge(env, fakeContext(), challenges, userRepository, second.id, created.challengeId);
      expect(response.status, `elapsed=${elapsedMs}`).toBe(200);
      expect(await challenges.byId(created.challengeId), `elapsed=${elapsedMs}`).toMatchObject({ status: 'ACTIVE' });
    }
  });

  it('convite cruzado DIRECT aceito depois dos 7 s continua abrindo a sala normalmente', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const challenges = new ChallengeRepository(env.CORE_DB);
    const userRepository = new UserRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);
    const created = await challenges.create({
      actorUserId: first.id, kind: 'DIRECT',
      targetPresence: 'ONLINE', targetUserId: second.id, themeId,
    });
    // Convite parado há mais de 7 s, ainda bem dentro dos 30 s.
    await env.CORE_DB.prepare('UPDATE challenges SET updated_at = ?1 WHERE id = ?2')
      .bind(new Date(Date.now() - 10_000).toISOString(), created.challengeId).run();

    // O convidado consulta a lista (roda a reconciliação) antes de desafiar de volta.
    await reconcileChallengeLifecycle(env, fakeContext(), challenges, second.id);
    expect(await challenges.byId(created.challengeId)).toMatchObject({ status: 'PENDING_DIRECT' });

    // O convite cruzado (B desafia A de volta) reconhece o existente como aceite.
    const crossed = await challenges.create({
      actorUserId: second.id, kind: 'DIRECT',
      targetPresence: 'ONLINE', targetUserId: first.id, themeId,
    });
    expect(crossed.crossAccepted).toBe(true);
    expect(crossed.challengeId).toBe(created.challengeId);

    const response = await acceptChallenge(env, fakeContext(), challenges, userRepository, second.id, created.challengeId);
    expect(response.status).toBe(200);
    const { roomId } = await response.json<{ roomId: string }>();
    expect(await challenges.byId(created.challengeId)).toMatchObject({ matchId: roomId, status: 'ACTIVE' });
    expect(await env.CORE_DB.prepare('SELECT COUNT(*) AS total FROM matches WHERE id = ?1')
      .bind(roomId).first()).toEqual({ total: 1 });
  });

  it('ASYNC nunca vira VOID por estar MISSING, em nenhum dos dois lados, por mais que passe dos 7 s', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const challenges = new ChallengeRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);
    const created = await challenges.create({
      actorUserId: first.id, kind: 'ASYNC',
      targetPresence: 'OFFLINE', targetUserId: second.id, themeId,
    });
    await challenges.sealQuestionSet(created.challengeId, themeId, env.QUESTIONS_DB);

    // Metade do primeiro jamais aberta, muito além de 7 s — continua jogável.
    await env.CORE_DB.prepare("UPDATE challenges SET updated_at = '2000-01-01T00:00:00.000Z' WHERE id = ?1")
      .bind(created.challengeId).run();
    await reconcileChallengeLifecycle(env, fakeContext(), challenges, first.id);
    expect(await challenges.byId(created.challengeId)).toMatchObject({ status: 'FIRST_PLAYER_ACTIVE' });

    // Segundo jogador aceita e também nunca abre a própria metade — mesma garantia.
    await env.CORE_DB.prepare(
      "UPDATE challenges SET status = 'SECOND_PLAYER_ACTIVE', updated_at = '2000-01-01T00:00:00.000Z' WHERE id = ?1",
    ).bind(created.challengeId).run();
    await reconcileChallengeLifecycle(env, fakeContext(), challenges, second.id);
    expect(await challenges.byId(created.challengeId)).toMatchObject({ status: 'SECOND_PLAYER_ACTIVE' });
  });

  it('reconciliação nunca toca WAITING_FOR_SECOND: nem DO, nem chamada desnecessária, nem VOID', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const challenges = new ChallengeRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);
    const created = await challenges.create({
      actorUserId: first.id, kind: 'ASYNC',
      targetPresence: 'OFFLINE', targetUserId: second.id, themeId,
    });
    // Simula a primeira metade já selada (estado real de WAITING_FOR_SECOND),
    // parada há muito tempo — nem DIRECT (matchId nulo) nem FIRST/SECOND_PLAYER_ACTIVE:
    // a reconciliação não tem ramo nenhum para este status, então é sempre no-op.
    await env.CORE_DB.prepare(
      "UPDATE challenges SET status = 'WAITING_FOR_SECOND', updated_at = '2000-01-01T00:00:00.000Z' WHERE id = ?1",
    ).bind(created.challengeId).run();

    await reconcileChallengeLifecycle(env, fakeContext(), challenges, second.id);
    expect(await challenges.byId(created.challengeId)).toMatchObject({ status: 'WAITING_FOR_SECOND' });
  });

  it('cancelamento que vence a corrida antes do CAS de aceite bloqueia o aceite e não cria sala', async () => {
    for (const action of ['CANCEL', 'DECLINE'] as const) {
      const { themeSlug, users } = await fixture(2);
      const first = userAt(users, 0);
      const second = userAt(users, 1);
      await befriend(first, second);
      const challenges = new ChallengeRepository(env.CORE_DB);
      const userRepository = new UserRepository(env.CORE_DB);
      const themeId = await themeIdOf(themeSlug);
      const created = await challenges.create({
        actorUserId: first.id, kind: 'DIRECT',
        targetPresence: 'ONLINE', targetUserId: second.id, themeId,
      });
      const record = await challenges.byId(created.challengeId);
      if (record === null) throw new Error('Convite ausente.');
      const actorUserId = action === 'CANCEL' ? first.id : second.id;
      expect(await challenges.applyAction(record, { actorUserId, type: action }), action).toBe(true);

      await expect(
        acceptChallenge(env, fakeContext(), challenges, userRepository, second.id, created.challengeId),
        action,
      ).rejects.toMatchObject({ code: 'CHALLENGE_ALREADY_SETTLED', status: 409 });
      // matchId continua null: o aceite bloqueado nunca chega a reservar sala.
      expect(await challenges.byId(created.challengeId), action)
        .toMatchObject({ matchId: null, status: action === 'CANCEL' ? 'CANCELLED' : 'DECLINED' });
    }
  });

  it('depois do CAS de aceite (PREPARING com sala viva), cancelar ou recusar concorrente nunca encerra a tentativa', async () => {
    for (const action of ['CANCEL', 'DECLINE'] as const) {
      const { themeSlug, users } = await fixture(2);
      const first = userAt(users, 0);
      const second = userAt(users, 1);
      await befriend(first, second);
      const challenges = new ChallengeRepository(env.CORE_DB);
      const themeId = await themeIdOf(themeSlug);
      const created = await challenges.create({
        actorUserId: first.id, kind: 'DIRECT',
        targetPresence: 'ONLINE', targetUserId: second.id, themeId,
      });
      const pending = await challenges.byId(created.challengeId);
      if (pending === null) throw new Error('Convite ausente.');
      // Reproduz exatamente o instante em que o CAS de aceite já venceu (PENDING_DIRECT
      // -> PREPARING com roomId persistido), antes da segunda escrita que leva a ACTIVE —
      // a mesma janela em que uma ação concorrente só pode ler o estado já comprometido.
      const started = await new DirectChallengeService(env).start(pending, [first.uid, second.uid], crypto.randomUUID());
      await env.CORE_DB.prepare(
        `UPDATE challenges SET status = 'PREPARING', match_id = ?1, updated_at = ?2, revision = revision + 1
          WHERE id = ?3 AND revision = ?4`,
      ).bind(started.roomId, new Date().toISOString(), created.challengeId, pending.revision).run();

      const committed = await challenges.byId(created.challengeId);
      if (committed === null) throw new Error('Convite ausente.');
      const actorUserId = action === 'CANCEL' ? first.id : second.id;
      await expect(
        challenges.applyAction(committed, { actorUserId, type: action }),
        action,
      ).rejects.toMatchObject({ code: 'CHALLENGE_ALREADY_STARTED' });

      // A tentativa segue viva: nem status nem a sala já reservada foram tocados.
      expect(await challenges.byId(created.challengeId), action)
        .toMatchObject({ matchId: started.roomId, status: 'PREPARING' });
      expect(await env.CORE_DB.prepare('SELECT COUNT(*) AS total FROM matches WHERE id = ?1')
        .bind(started.roomId).first(), action).toEqual({ total: 1 });
    }
  });

  it('corrida real entre aceitar e cancelar converge para exatamente um resultado, nunca os dois', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const challenges = new ChallengeRepository(env.CORE_DB);
    const userRepository = new UserRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);
    const created = await challenges.create({
      actorUserId: first.id, kind: 'DIRECT',
      targetPresence: 'ONLINE', targetUserId: second.id, themeId,
    });
    const record = await challenges.byId(created.challengeId);
    if (record === null) throw new Error('Convite ausente.');

    const { context, settle } = collectingContext();
    const [acceptOutcome, cancelOutcome] = await Promise.allSettled([
      acceptChallenge(env, context, challenges, userRepository, second.id, created.challengeId),
      challenges.applyAction(record, { actorUserId: first.id, type: 'CANCEL' }),
    ]);
    // O aviso Social do lado vencedor não pode ficar em voo depois deste teste:
    // o mesmo ambiente Miniflare (`--no-isolate`) é reaproveitado pelo próximo.
    await settle();

    const finalState = await challenges.byId(created.challengeId);
    if (finalState === null) throw new Error('Convite ausente.');
    if (finalState.status === 'CANCELLED') {
      // O cancelamento venceu: o aceite nunca chega a reservar nenhuma sala.
      expect(cancelOutcome).toMatchObject({ status: 'fulfilled', value: true });
      expect(finalState.matchId).toBeNull();
    } else {
      // O aceite venceu: nunca sobra CANCELLED convivendo com uma sala viva.
      expect(['ACTIVE', 'PREPARING']).toContain(finalState.status);
      expect(acceptOutcome.status).toBe('fulfilled');
      if (cancelOutcome.status === 'fulfilled') expect(cancelOutcome.value).toBe(false);
    }
  });

  it('pagina desafios vivos além de 50 por cursor, sem esconder nenhum silenciosamente', async () => {
    const total = 55;
    const { themeSlug, users } = await fixture(total + 1);
    const owner = userAt(users, 0);
    const friends = users.slice(1);
    for (const friend of friends) await befriend(owner, friend);
    const themeId = await themeIdOf(themeSlug);
    const repository = new ChallengeRepository(env.CORE_DB);

    const base = Date.parse('2026-01-01T00:00:00.000Z');
    const ids = friends.map(() => crypto.randomUUID());
    await env.CORE_DB.batch(friends.map((friend, index) => {
      const createdAt = new Date(base + index * 1_000).toISOString();
      const [low, high] = [owner.id, friend.id].sort();
      return env.CORE_DB.prepare(
        `INSERT INTO challenges
          (id, pair_low_id, pair_high_id, first_player_user_id, second_player_user_id,
           theme_id, difficulty, kind, status, revision, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'EASY', 'ASYNC', 'FIRST_PLAYER_ACTIVE', 1, ?7, ?7)`,
      ).bind(ids[index], low, high, owner.id, friend.id, themeId, createdAt);
    }));

    const firstPage = await repository.forUser(owner.id);
    expect(firstPage.challenges).toHaveLength(50);
    expect(firstPage.nextCursor).not.toBeNull();
    expect(new Set(firstPage.challenges.map((entry) => entry.id)).size).toBe(50);

    const secondPage = await repository.forUser(owner.id, Date.now(), firstPage.nextCursor);
    expect(secondPage.challenges).toHaveLength(total - 50);
    expect(secondPage.nextCursor).toBeNull();

    // As duas páginas juntas cobrem exatamente os 55 desafios, sem repetir nem sumir com nenhum.
    const seen = new Set([...firstPage.challenges, ...secondPage.challenges].map((entry) => entry.id));
    expect(seen.size).toBe(total);
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  it('todas as rotas de desafio exigem autenticação e não aceitam identidade arbitrária', async () => {
    const requests: Array<[string, RequestInit]> = [
      ['/api/challenges', {}],
      ['/api/challenges', {
        body: JSON.stringify({ kind: 'DIRECT', publicId: '#QGFAKE123', themeSlug: 'x' }),
        headers: { 'Content-Type': 'application/json', 'X-User-Id': 'arbitrary' },
        method: 'POST',
      }],
      [`/api/challenges/${crypto.randomUUID()}/accept`, {
        headers: { 'X-User-Id': 'arbitrary' },
        method: 'POST',
      }],
    ];
    for (const [path, options] of requests) {
      const response = await SELF.fetch(`https://quiz.test${path}`, options);
      expect(response.status, path).toBe(401);
      expect(response.headers.get('Cache-Control'), path).toBe('no-store');
    }
  });
});
