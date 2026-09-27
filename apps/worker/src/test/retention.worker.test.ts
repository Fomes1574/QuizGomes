import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { ReportRepository } from '../repositories/report-repository.js';
import { RETENTION_CRON, runScheduled } from '../scheduled.js';
import {
  auditCutoffDay,
  RetentionService,
  retentionCutoffDay,
} from '../services/retention-service.js';
import { fixture, themeIdOf, userAt, type FixtureUser } from './challenge-fixture.worker.js';

const DAY_MS = 86_400_000;
const NOW = Date.now();

/** Carimbo no formato de `CURRENT_TIMESTAMP`, N dias atrás. */
function daysAgo(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString().replace('T', ' ').slice(0, 19);
}

async function seedMatch(
  themeId: string,
  players: [FixtureUser, FixtureUser],
  options: { ageDays: number; status: 'FINISHED' | 'PLAYING' | 'VOID' },
): Promise<string> {
  const matchId = `retention-match-${crypto.randomUUID()}`;
  const createdAt = daysAgo(options.ageDays);
  await env.CORE_DB.batch([
    env.CORE_DB.prepare(
      `INSERT INTO matches (id, theme_id, difficulty, mode, kind, status, question_shard_id, created_at)
       VALUES (?1, ?2, 'MEDIUM', 'CASUAL', 'MATCHMAKING', ?3, 'questions-01', ?4)`,
    ).bind(matchId, themeId, options.status, createdAt),
    ...players.map((player, index) => env.CORE_DB.prepare(
      'INSERT INTO match_players (match_id, user_id, seat, score) VALUES (?1, ?2, ?3, 42)',
    ).bind(matchId, player.id, index + 1)),
    ...[1, 2].map((round) => env.CORE_DB.prepare(
      `INSERT INTO match_questions (match_id, round_number, question_id, pool_slot, public_snapshot_json, correct_option_sealed)
       VALUES (?1, ?2, ?3, ?2, '{}', '0')`,
    ).bind(matchId, round, `${matchId}-q${round}`)),
    ...[1, 2].map((round) => env.CORE_DB.prepare(
      `INSERT INTO match_answers (match_id, round_number, user_id, selected_option, remaining_ms, is_correct, score)
       VALUES (?1, ?2, ?3, 0, 5000, 1, 15)`,
    ).bind(matchId, round, players[0].id)),
    env.CORE_DB.prepare(
      `INSERT INTO question_report_views (context_kind, context_id, user_id, round_number, question_id, delivered_at)
       VALUES ('MATCH', ?1, ?2, 1, ?3, ?4)`,
    ).bind(matchId, players[0].id, `${matchId}-q1`, createdAt),
  ]);
  return matchId;
}

async function seedChallenge(
  themeId: string,
  players: [FixtureUser, FixtureUser],
  options: { ageDays: number; status: 'COMPLETED' | 'WAITING_FOR_SECOND' },
): Promise<string> {
  const challengeId = `retention-challenge-${crypto.randomUUID()}`;
  const [low, high] = [players[0].id, players[1].id].sort();
  await env.CORE_DB.batch([
    env.CORE_DB.prepare(
      `INSERT INTO challenges
        (id, pair_low_id, pair_high_id, first_player_user_id, second_player_user_id,
         theme_id, difficulty, kind, status, revision, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'MEDIUM', 'ASYNC', ?7, 1, ?8, ?8)`,
    ).bind(challengeId, low, high, players[0].id, players[1].id, themeId, options.status, daysAgo(options.ageDays)),
    env.CORE_DB.prepare(
      `INSERT INTO challenge_questions (challenge_id, round_number, question_id, pool_slot, public_snapshot_json, correct_option)
       VALUES (?1, 1, ?2, 1, '{}', 0)`,
    ).bind(challengeId, `${challengeId}-q1`),
    env.CORE_DB.prepare(
      `INSERT INTO challenge_answers (challenge_id, round_number, user_id, selected_option, remaining_ms, is_correct, score)
       VALUES (?1, 1, ?2, 0, 5000, 1, 15)`,
    ).bind(challengeId, players[0].id),
  ]);
  return challengeId;
}

async function count(db: D1Database, sql: string, ...params: unknown[]): Promise<number> {
  return (await db.prepare(sql).bind(...params).first<{ total: number }>())?.total ?? -1;
}

async function players(): Promise<{ pair: [FixtureUser, FixtureUser]; themeId: string }> {
  const { themeSlug, users } = await fixture(2);
  return { pair: [userAt(users, 0), userAt(users, 1)], themeId: await themeIdOf(themeSlug) };
}

describe('Limpeza automática', () => {
  it('corta por dia: 15 dias para jogo, 6 meses para administração', () => {
    const now = Date.parse('2026-09-27T15:00:00.000Z');
    expect(retentionCutoffDay(now)).toBe('2026-09-12');
    expect(auditCutoffDay(now)).toBe('2026-03-27');
    // O prefixo do dia é menor que os dois formatos gravados naquele dia.
    expect('2026-09-12 00:00:00' < retentionCutoffDay(now)).toBe(false);
    expect('2026-09-12T00:00:00.000Z' < retentionCutoffDay(now)).toBe(false);
    expect('2026-09-11 23:59:59' < retentionCutoffDay(now)).toBe(true);
  });

  it('apaga o detalhe de partidas encerradas há mais de 15 dias e mantém a partida', async () => {
    const { pair, themeId } = await players();
    const old = await seedMatch(themeId, pair, { ageDays: 16, status: 'FINISHED' });
    const oldVoid = await seedMatch(themeId, pair, { ageDays: 40, status: 'VOID' });
    const recent = await seedMatch(themeId, pair, { ageDays: 14, status: 'FINISHED' });
    const stuck = await seedMatch(themeId, pair, { ageDays: 30, status: 'PLAYING' });

    await new RetentionService(env.CORE_DB, env.QUESTIONS_DB).run(NOW);

    for (const matchId of [old, oldVoid]) {
      expect(await count(env.CORE_DB, 'SELECT COUNT(*) AS total FROM match_questions WHERE match_id = ?1', matchId)).toBe(0);
      expect(await count(env.CORE_DB, 'SELECT COUNT(*) AS total FROM match_answers WHERE match_id = ?1', matchId)).toBe(0);
      expect(await count(env.CORE_DB, 'SELECT COUNT(*) AS total FROM question_report_views WHERE context_id = ?1', matchId)).toBe(0);
      // Placar e histórico continuam: perfil e "últimas partidas" não mudam.
      expect(await count(env.CORE_DB, 'SELECT COUNT(*) AS total FROM matches WHERE id = ?1', matchId)).toBe(1);
      expect(await count(env.CORE_DB, 'SELECT COUNT(*) AS total FROM match_players WHERE match_id = ?1 AND score = 42', matchId)).toBe(2);
    }
    for (const matchId of [recent, stuck]) {
      expect(await count(env.CORE_DB, 'SELECT COUNT(*) AS total FROM match_questions WHERE match_id = ?1', matchId)).toBe(2);
      expect(await count(env.CORE_DB, 'SELECT COUNT(*) AS total FROM match_answers WHERE match_id = ?1', matchId)).toBe(2);
    }
    expect(await count(env.CORE_DB, 'SELECT COUNT(*) AS total FROM question_report_views WHERE context_id = ?1', recent)).toBe(1);
  });

  it('apaga o detalhe de desafios encerrados e preserva os que ainda estão vivos', async () => {
    const { pair, themeId } = await players();
    const done = await seedChallenge(themeId, pair, { ageDays: 20, status: 'COMPLETED' });
    await new RetentionService(env.CORE_DB, env.QUESTIONS_DB).run(NOW);
    expect(await count(env.CORE_DB, 'SELECT COUNT(*) AS total FROM challenge_questions WHERE challenge_id = ?1', done)).toBe(0);
    expect(await count(env.CORE_DB, 'SELECT COUNT(*) AS total FROM challenge_answers WHERE challenge_id = ?1', done)).toBe(0);
    expect(await count(env.CORE_DB, 'SELECT COUNT(*) AS total FROM challenges WHERE id = ?1', done)).toBe(1);

    // Assíncrono não expira: esperar o segundo jogador por semanas é válido.
    const other = await players();
    const waiting = await seedChallenge(other.themeId, other.pair, { ageDays: 60, status: 'WAITING_FOR_SECOND' });
    await new RetentionService(env.CORE_DB, env.QUESTIONS_DB).run(NOW);
    expect(await count(env.CORE_DB, 'SELECT COUNT(*) AS total FROM challenge_questions WHERE challenge_id = ?1', waiting)).toBe(1);
    expect(await count(env.CORE_DB, 'SELECT COUNT(*) AS total FROM challenge_answers WHERE challenge_id = ?1', waiting)).toBe(1);
  });

  it('guarda administração por 6 meses e concessões de ADMIN para sempre', async () => {
    const { pair } = await players();
    const ids = { grant: crypto.randomUUID(), old: crypto.randomUUID(), recent: crypto.randomUUID(), revoke: crypto.randomUUID() };
    const insert = (id: string, action: string, ageDays: number) => env.CORE_DB.prepare(
      `INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, created_at)
       VALUES (?1, ?2, ?3, 'retention-test', NULL, ?4)`,
    ).bind(id, pair[0].id, action, daysAgo(ageDays));
    await env.CORE_DB.batch([
      insert(ids.old, 'APPROVE_THEME', 200),
      insert(ids.recent, 'APPROVE_THEME', 150),
      insert(ids.grant, 'GRANT_ADMIN_ROLE', 900),
      insert(ids.revoke, 'REVOKE_ADMIN_ROLE', 900),
    ]);
    await new RetentionService(env.CORE_DB, env.QUESTIONS_DB).run(NOW);
    const kept = await env.CORE_DB.prepare(
      "SELECT id FROM audit_logs WHERE entity_type = 'retention-test' AND actor_user_id = ?1",
    ).bind(pair[0].id).all<{ id: string }>();
    expect(kept.results.map((row) => row.id).sort()).toEqual([ids.grant, ids.recent, ids.revoke].sort());
  });

  it('limpa recibos de estatística aplicados, missões, avisos e lotes antigos, sem tocar pendências', async () => {
    const { pair } = await players();
    const context = `retention-stats-${crypto.randomUUID()}`;
    const ledger = (round: number, applied: number, ageDays: number) => env.QUESTIONS_DB.prepare(
      `INSERT INTO question_statistics_ledger (context_kind, context_id, round_number, user_id, question_id, applied, recorded_at)
       VALUES ('MATCH', ?1, ?2, 'u', 'q', ?3, ?4)`,
    ).bind(context, round, applied, daysAgo(ageDays));
    await env.QUESTIONS_DB.batch([ledger(1, 1, 20), ledger(2, 0, 20), ledger(3, 1, 2)]);
    const batchKey = `retention-${crypto.randomUUID()}`;
    await env.QUESTIONS_DB.prepare(
      `INSERT INTO question_import_batches (id, actor_user_id, idempotency_key, status, item_count, created_at)
       VALUES (?1, 'admin', ?2, 'APPLIED', 1, ?3)`,
    ).bind(crypto.randomUUID(), batchKey, daysAgo(30)).run();
    await env.CORE_DB.batch([
      env.CORE_DB.prepare(
        `INSERT INTO user_daily_missions (user_id, day_key, mission_type, target) VALUES (?1, ?2, 'PLAY_MATCH', 1)`,
      ).bind(pair[0].id, daysAgo(20).slice(0, 10)),
      env.CORE_DB.prepare(
        `INSERT INTO user_daily_missions (user_id, day_key, mission_type, target) VALUES (?1, ?2, 'PLAY_MATCH', 1)`,
      ).bind(pair[0].id, daysAgo(1).slice(0, 10)),
      env.CORE_DB.prepare(
        'INSERT INTO friend_queue_alerts (recipient_user_id, sender_user_id, sent_at_ms) VALUES (?1, ?2, ?3)',
      ).bind(pair[0].id, pair[1].id, NOW - 2 * DAY_MS),
      env.CORE_DB.prepare(
        'INSERT INTO friend_queue_alerts (recipient_user_id, sender_user_id, sent_at_ms) VALUES (?1, ?2, ?3)',
      ).bind(pair[1].id, pair[0].id, NOW - 60_000),
    ]);

    await new RetentionService(env.CORE_DB, env.QUESTIONS_DB).run(NOW);

    const rounds = await env.QUESTIONS_DB.prepare(
      'SELECT round_number FROM question_statistics_ledger WHERE context_id = ?1 ORDER BY round_number',
    ).bind(context).all<{ round_number: number }>();
    expect(rounds.results.map((row) => row.round_number)).toEqual([2, 3]);
    expect(await count(env.QUESTIONS_DB, 'SELECT COUNT(*) AS total FROM question_import_batches WHERE idempotency_key = ?1', batchKey)).toBe(0);
    expect(await count(env.CORE_DB, 'SELECT COUNT(*) AS total FROM user_daily_missions WHERE user_id = ?1', pair[0].id)).toBe(1);
    const alerts = await env.CORE_DB.prepare(
      'SELECT recipient_user_id FROM friend_queue_alerts WHERE recipient_user_id IN (?1, ?2)',
    ).bind(pair[0].id, pair[1].id).all<{ recipient_user_id: string }>();
    expect(alerts.results.map((row) => row.recipient_user_id)).toEqual([pair[1].id]);
  });

  it('respeita o orçamento de consultas e avisa quando sobra trabalho', async () => {
    const { pair, themeId } = await players();
    const matchIds = await Promise.all(Array.from({ length: 45 }, () => seedMatch(themeId, pair, { ageDays: 18, status: 'FINISHED' })));
    // Três consultas: só uma rodada de partidas (40), nada das outras etapas.
    const report = await new RetentionService(env.CORE_DB, env.QUESTIONS_DB, 3).run(NOW);
    expect(report.matches).toBe(40);
    expect(report.backlog).toBe(true);
    const placeholders = matchIds.map((_, index) => `?${index + 1}`).join(',');
    const left = await count(env.CORE_DB, `SELECT COUNT(DISTINCT match_id) AS total FROM match_questions WHERE match_id IN (${placeholders})`, ...matchIds);
    expect(left).toBeGreaterThanOrEqual(5);
    await new RetentionService(env.CORE_DB, env.QUESTIONS_DB).run(NOW);
    expect(await count(env.CORE_DB, `SELECT COUNT(*) AS total FROM match_questions WHERE match_id IN (${placeholders})`, ...matchIds)).toBe(0);
  });

  it('denúncia vale por 15 dias a partir da entrega da pergunta', async () => {
    const { pair, themeId } = await players();
    const matchId = await seedMatch(themeId, pair, { ageDays: 16, status: 'FINISHED' });
    const repository = new ReportRepository(env.CORE_DB, () => new Date(NOW));
    await expect(repository.create({
      contextId: matchId, contextKind: 'MATCH', questionId: `${matchId}-q1`,
      note: null, reason: 'INCORRECT', reporterUserId: pair[0].id, roundNumber: 1,
    })).rejects.toMatchObject({ code: 'REPORT_CONTEXT_MISMATCH' });
    const fresh = await seedMatch(themeId, pair, { ageDays: 14, status: 'FINISHED' });
    await expect(repository.create({
      contextId: fresh, contextKind: 'MATCH', questionId: `${fresh}-q1`,
      note: null, reason: 'INCORRECT', reporterUserId: pair[0].id, roundNumber: 1,
    })).resolves.toMatchObject({ created: true });
  });
});

describe('Cron da limpeza', () => {
  it('o gatilho agendado roda a limpeza', async () => {
    const { pair, themeId } = await players();
    const matchId = await seedMatch(themeId, pair, { ageDays: 17, status: 'FINISHED' });
    await runScheduled({ cron: RETENTION_CRON, scheduledTime: NOW }, env);
    expect(await count(env.CORE_DB, 'SELECT COUNT(*) AS total FROM match_questions WHERE match_id = ?1', matchId)).toBe(0);
  });
});
