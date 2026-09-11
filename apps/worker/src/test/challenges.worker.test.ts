import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  CHALLENGE_RATE_LIMIT,
  CHALLENGE_RATE_WINDOW_MS,
  ChallengeRepository,
} from '../repositories/challenge-repository.js';
import { reconcileChallengeLifecycle } from '../index.js';
import { SocialRepository } from '../repositories/social-repository.js';
import { DirectChallengeService } from '../services/direct-challenge-service.js';
import { befriend, fixture, themeIdOf, userAt } from './challenge-fixture.worker.js';

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
        difficulty: 'EASY',
        kind: 'DIRECT',
        targetPresence: presence,
        targetUserId: friend.id,
        themeId,
      })).rejects.toMatchObject({ code: 'FRIEND_UNAVAILABLE', status: 409 });
    }

    const async = await repository.create({
      actorUserId: challenger.id,
      difficulty: 'HARD',
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
    const base = { difficulty: 'EASY', kind: 'ASYNC', targetPresence: 'ONLINE', themeId } as const;

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
      difficulty: 'EASY',
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
      difficulty: 'EASY',
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
      difficulty: 'EASY',
      kind: 'DIRECT',
      targetPresence: 'ONLINE',
      targetUserId: friend.id,
      themeId,
    });

    expect(await repository.forUser(friend.id, now)).toHaveLength(1);
    now += 29_999;
    expect(await repository.expireStaleDirect()).toEqual([]);
    expect(await repository.forUser(friend.id, now)).toHaveLength(1);

    now += 1;
    // Vencido some da lista mesmo antes da varredura.
    expect(await repository.forUser(friend.id, now)).toEqual([]);
    // A varredura por participante encerra e devolve os dois lados para notificação.
    expect(await repository.expireStaleDirect(friend.id)).toEqual([
      { id: created.challengeId, participants: [challenger.id, friend.id] },
    ]);
    expect(await repository.byId(created.challengeId)).toMatchObject({ status: 'EXPIRED' });
    // Idempotente: uma segunda varredura não encontra mais nada.
    expect(await repository.expireStaleDirect(friend.id)).toEqual([]);

    const again = await repository.create({
      actorUserId: challenger.id,
      difficulty: 'EASY',
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
        actorUserId: first.id, difficulty: 'EASY', kind: 'DIRECT',
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
      expect(await repository.forUser(first.id)).toEqual([]);
      await expect(repository.create({
        actorUserId: first.id, difficulty: 'EASY', kind: 'DIRECT',
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
      actorUserId: first.id, difficulty: 'EASY', kind: 'DIRECT',
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
      actorUserId: first.id, difficulty: 'EASY', kind: 'DIRECT',
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
      actorUserId: first.id, difficulty: 'EASY', kind: 'DIRECT',
      targetPresence: 'ONLINE', targetUserId: second.id, themeId,
    });
    const pending = await challenges.byId(created.challengeId);
    if (pending === null) throw new Error('Convite DIRECT ausente.');
    const started = await new DirectChallengeService(env).start(pending, [first.uid, second.uid]);
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
      actorUserId: first.id, difficulty: 'EASY', kind: 'DIRECT',
      targetPresence: 'ONLINE', targetUserId: second.id, themeId,
    });
    const async = await repository.create({
      actorUserId: first.id, difficulty: 'EASY', kind: 'ASYNC',
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
        difficulty: 'MEDIUM',
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
      difficulty: 'MEDIUM',
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
    const base = { actorUserId: challenger.id, difficulty: 'EASY', kind: 'ASYNC', targetPresence: 'ONLINE', themeId } as const;

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
      actorUserId: first.id, difficulty: 'MEDIUM', kind: 'ASYNC',
      targetPresence: 'OFFLINE', targetUserId: second.id, themeId,
    });

    await repository.sealQuestionSet(created.challengeId, themeId, 'MEDIUM', env.QUESTIONS_DB);
    const sealedOnce = await repository.questionSet(created.challengeId);
    expect(sealedOnce).toHaveLength(8);
    expect(new Set(sealedOnce.map((question) => question.id)).size).toBe(8);

    // Selar de novo é no-op: o conjunto já selado vence.
    await repository.sealQuestionSet(created.challengeId, themeId, 'MEDIUM', env.QUESTIONS_DB);
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
      actorUserId: first.id, difficulty: 'EASY', kind: 'ASYNC',
      targetPresence: 'OFFLINE', targetUserId: second.id, themeId,
    });
    await repository.sealQuestionSet(created.challengeId, themeId, 'EASY', env.QUESTIONS_DB);

    const firstHalf = [20, 0, 15, 11, 18].map((score, index) => ({
      correct: score > 0, remainingMs: score > 0 ? (score - 10) * 1_000 : 0, score, selectedOption: index % 4,
    }));
    await repository.sealHalf({
      answers: firstHalf, challengeId: created.challengeId, difficulty: 'EASY',
      isSecondPlayer: false, opponentScore: 0, userId: first.id,
    });
    expect(await repository.byId(created.challengeId)).toMatchObject({ status: 'WAITING_FOR_SECOND' });
    expect(await repository.sealedHalf(created.challengeId, first.id)).toEqual(firstHalf);
    // O segundo jogador ainda não selou nada.
    expect(await repository.sealedHalf(created.challengeId, second.id)).toEqual([]);

    await env.CORE_DB.prepare("UPDATE challenges SET status = 'SECOND_PLAYER_ACTIVE' WHERE id = ?1")
      .bind(created.challengeId).run();
    const secondHalf = [20, 20, 20, 0, 0].map((score, index) => ({
      correct: score > 0, remainingMs: score > 0 ? (score - 10) * 1_000 : 0, score, selectedOption: index % 4,
    }));
    await repository.sealHalf({
      answers: secondHalf, challengeId: created.challengeId, difficulty: 'EASY',
      isSecondPlayer: true, opponentScore: 64, userId: second.id,
    });

    expect(await repository.byId(created.challengeId)).toMatchObject({ status: 'COMPLETED' });
    // 64 do primeiro contra 60 do segundo: vitória do primeiro, +10 XP de Fácil.
    const xp = await env.CORE_DB.prepare(
      'SELECT user_id, total_xp FROM user_profiles WHERE user_id IN (?1, ?2) ORDER BY user_id',
    ).bind(first.id, second.id).all<{ total_xp: number; user_id: string }>();
    const byUser = new Map(xp.results.map((row) => [row.user_id, row.total_xp]));
    expect(byUser.get(first.id)).toBe(10);
    expect(byUser.get(second.id)).toBe(0);

    // Reexecutar não duplica resposta nem paga XP duas vezes.
    await repository.sealHalf({
      answers: secondHalf, challengeId: created.challengeId, difficulty: 'EASY',
      isSecondPlayer: true, opponentScore: 64, userId: second.id,
    });
    expect(await env.CORE_DB.prepare(
      'SELECT COUNT(*) AS total FROM challenge_answers WHERE challenge_id = ?1',
    ).bind(created.challengeId).first()).toEqual({ total: 10 });
    expect(await env.CORE_DB.prepare('SELECT total_xp FROM user_profiles WHERE user_id = ?1')
      .bind(first.id).first()).toEqual({ total_xp: 10 });
  });

  it('empate no assíncrono não paga XP a ninguém e Conhecimento nunca muda', async () => {
    const { themeSlug, users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    await befriend(first, second);
    const repository = new ChallengeRepository(env.CORE_DB);
    const themeId = await themeIdOf(themeSlug);
    const created = await repository.create({
      actorUserId: first.id, difficulty: 'EASY', kind: 'ASYNC',
      targetPresence: 'OFFLINE', targetUserId: second.id, themeId,
    });
    await repository.sealQuestionSet(created.challengeId, themeId, 'EASY', env.QUESTIONS_DB);
    const half = [20, 0, 0, 0, 0].map((score, index) => ({
      correct: score > 0, remainingMs: score > 0 ? (score - 10) * 1_000 : 0, score, selectedOption: index % 4,
    }));
    await repository.sealHalf({
      answers: half, challengeId: created.challengeId, difficulty: 'EASY',
      isSecondPlayer: false, opponentScore: 0, userId: first.id,
    });
    await env.CORE_DB.prepare("UPDATE challenges SET status = 'SECOND_PLAYER_ACTIVE' WHERE id = ?1")
      .bind(created.challengeId).run();
    await repository.sealHalf({
      answers: half, challengeId: created.challengeId, difficulty: 'EASY',
      isSecondPlayer: true, opponentScore: 20, userId: second.id,
    });

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
      actorUserId: first.id, difficulty: 'EASY', kind: 'ASYNC',
      targetPresence: 'OFFLINE', targetUserId: second.id, themeId,
    });
    await repository.sealQuestionSet(created.challengeId, themeId, 'EASY', env.QUESTIONS_DB);

    await repository.voidChallenge(created.challengeId);
    expect(await repository.byId(created.challengeId)).toMatchObject({ status: 'VOID' });
    expect(await env.CORE_DB.prepare(
      'SELECT COUNT(*) AS total FROM challenge_questions WHERE challenge_id = ?1',
    ).bind(created.challengeId).first()).toEqual({ total: 0 });
    expect(await env.CORE_DB.prepare(
      'SELECT SUM(total_xp) AS total FROM user_profiles WHERE user_id IN (?1, ?2)',
    ).bind(first.id, second.id).first<{ total: number }>()).toEqual({ total: 0 });
  });

  it('todas as rotas de desafio exigem autenticação e não aceitam identidade arbitrária', async () => {
    const requests: Array<[string, RequestInit]> = [
      ['/api/challenges', {}],
      ['/api/challenges', {
        body: JSON.stringify({ difficulty: 'EASY', kind: 'DIRECT', publicId: '#QGFAKE123', themeSlug: 'x' }),
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
