import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { REPORT_RATE_LIMIT, REPORT_RATE_WINDOW_MS, ReportRepository } from '../repositories/report-repository.js';
import { befriend, fixture, themeIdOf, userAt, type FixtureUser } from './challenge-fixture.worker.js';

/**
 * Fixture de denúncia: um contexto MATCH (tabelas do M0/M8) e um contexto
 * CHALLENGE (tabelas do M9C+M10), cada um com um snapshot selado real, para
 * que a validação "realmente viu" tenha algo concreto para provar ou recusar.
 */
async function matchContext(themeId: string, first: FixtureUser, second: FixtureUser): Promise<string> {
  const matchId = crypto.randomUUID();
  await env.CORE_DB.batch([
    env.CORE_DB.prepare(
      `INSERT INTO matches (id, theme_id, difficulty, mode, kind, status, question_shard_id)
       VALUES (?1, ?2, 'EASY', 'CASUAL', 'MATCHMAKING', 'FINISHED', 'questions-01')`,
    ).bind(matchId, themeId),
    env.CORE_DB.prepare('INSERT INTO match_players (match_id, user_id, seat) VALUES (?1, ?2, 1)').bind(matchId, first.id),
    env.CORE_DB.prepare('INSERT INTO match_players (match_id, user_id, seat) VALUES (?1, ?2, 2)').bind(matchId, second.id),
    ...[1, 2].map((roundNumber) => env.CORE_DB.prepare(
      `INSERT INTO match_questions
        (match_id, round_number, question_id, pool_slot, public_snapshot_json, correct_option_sealed)
       VALUES (?1, ?2, ?3, ?2, ?4, '0')`,
    ).bind(
      matchId, roundNumber, `match-question-${matchId}-${roundNumber}`,
      JSON.stringify({ id: `match-question-${matchId}-${roundNumber}`, imageUrl: null, options: ['A', 'B', 'C', 'D'], prompt: `Pergunta ${roundNumber}?` }),
    )),
  ]);
  return matchId;
}

async function challengeContext(themeId: string, first: FixtureUser, second: FixtureUser): Promise<string> {
  const challengeId = crypto.randomUUID();
  const [low, high] = [first.id, second.id].sort();
  await env.CORE_DB.batch([
    env.CORE_DB.prepare(
      `INSERT INTO challenges
        (id, pair_low_id, pair_high_id, first_player_user_id, second_player_user_id,
         theme_id, difficulty, kind, status, revision)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'EASY', 'ASYNC', 'COMPLETED', 1)`,
    ).bind(challengeId, low, high, first.id, second.id, themeId),
    env.CORE_DB.prepare(
      `INSERT INTO challenge_questions
        (challenge_id, round_number, question_id, pool_slot, public_snapshot_json, correct_option)
       VALUES (?1, 1, ?2, 1, ?3, 0)`,
    ).bind(
      challengeId, `challenge-question-${challengeId}-1`,
      JSON.stringify({ id: `challenge-question-${challengeId}-1`, imageUrl: null, options: ['W', 'X', 'Y', 'Z'], prompt: 'Pergunta do desafio?' }),
    ),
  ]);
  return challengeId;
}

describe('Denúncias de pergunta — validação de contexto e idempotência', () => {
  it('aceita a denúncia quando o denunciante realmente participou da rodada', async () => {
    const { themeSlug, users } = await fixture(2);
    const themeId = await themeIdOf(themeSlug);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    const matchId = await matchContext(themeId, first, second);
    const repository = new ReportRepository(env.CORE_DB);

    const result = await repository.create({
      contextId: matchId, contextKind: 'MATCH', note: 'Parece desatualizada.',
      questionId: `match-question-${matchId}-1`, reason: 'OUTDATED', reporterUserId: first.id, roundNumber: 1,
    });
    expect(result.created).toBe(true);
    expect(result.report.status).toBe('OPEN');
    expect(result.report.note).toBe('Parece desatualizada.');
  });

  it('recusa quando o usuário não participou da partida', async () => {
    const { themeSlug, users } = await fixture(3);
    const themeId = await themeIdOf(themeSlug);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    const outsider = userAt(users, 2);
    const matchId = await matchContext(themeId, first, second);
    const repository = new ReportRepository(env.CORE_DB);

    await expect(repository.create({
      contextId: matchId, contextKind: 'MATCH', note: null,
      questionId: `match-question-${matchId}-1`, reason: 'INCORRECT', reporterUserId: outsider.id, roundNumber: 1,
    })).rejects.toMatchObject({ code: 'REPORT_CONTEXT_MISMATCH', status: 403 });
  });

  it('recusa quando a rodada e a pergunta não combinam — cliente não pode fabricar o par', async () => {
    const { themeSlug, users } = await fixture(2);
    const themeId = await themeIdOf(themeSlug);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    const matchId = await matchContext(themeId, first, second);
    const repository = new ReportRepository(env.CORE_DB);

    // Pergunta real da rodada 1, mas alegando ser da rodada 2.
    await expect(repository.create({
      contextId: matchId, contextKind: 'MATCH', note: null,
      questionId: `match-question-${matchId}-1`, reason: 'INCORRECT', reporterUserId: first.id, roundNumber: 2,
    })).rejects.toMatchObject({ code: 'REPORT_CONTEXT_MISMATCH' });
  });

  it('funciona igual no contexto CHALLENGE, restrito aos dois participantes', async () => {
    const { themeSlug, users } = await fixture(3);
    const themeId = await themeIdOf(themeSlug);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    const outsider = userAt(users, 2);
    const challengeId = await challengeContext(themeId, first, second);
    const repository = new ReportRepository(env.CORE_DB);

    await expect(repository.create({
      contextId: challengeId, contextKind: 'CHALLENGE', note: null,
      questionId: `challenge-question-${challengeId}-1`, reason: 'AMBIGUOUS', reporterUserId: second.id, roundNumber: 1,
    })).resolves.toMatchObject({ created: true });
    await expect(repository.create({
      contextId: challengeId, contextKind: 'CHALLENGE', note: null,
      questionId: `challenge-question-${challengeId}-1`, reason: 'AMBIGUOUS', reporterUserId: outsider.id, roundNumber: 1,
    })).rejects.toMatchObject({ code: 'REPORT_CONTEXT_MISMATCH' });
  });

  it('é idempotente: a mesma denúncia OPEN/IN_REVIEW é reconhecida, não duplicada', async () => {
    const { themeSlug, users } = await fixture(2);
    const themeId = await themeIdOf(themeSlug);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    const matchId = await matchContext(themeId, first, second);
    const repository = new ReportRepository(env.CORE_DB);
    const input = {
      contextId: matchId, contextKind: 'MATCH' as const, note: null,
      questionId: `match-question-${matchId}-1`, reason: 'INCORRECT' as const, reporterUserId: first.id, roundNumber: 1,
    };

    const first_ = await repository.create(input);
    expect(first_.created).toBe(true);
    // Motivo diferente na segunda tentativa não importa: o par usuário+contexto+rodada já está aberto.
    const second_ = await repository.create({ ...input, reason: 'OUTDATED' });
    expect(second_.created).toBe(false);
    expect(second_.report.id).toBe(first_.report.id);
    expect(second_.report.reason).toBe('INCORRECT');

    const count = await env.CORE_DB.prepare(
      'SELECT COUNT(*) AS total FROM question_reports WHERE reporter_user_id = ?1',
    ).bind(first.id).first<{ total: number }>();
    expect(count?.total).toBe(1);
  });

  it('depois de resolvida, a mesma pessoa pode denunciar de novo o mesmo contexto', async () => {
    const { themeSlug, users } = await fixture(2);
    const themeId = await themeIdOf(themeSlug);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    const matchId = await matchContext(themeId, first, second);
    const repository = new ReportRepository(env.CORE_DB);
    const input = {
      contextId: matchId, contextKind: 'MATCH' as const, note: null,
      questionId: `match-question-${matchId}-1`, reason: 'INCORRECT' as const, reporterUserId: first.id, roundNumber: 1,
    };
    const created = await repository.create(input);
    expect(await repository.resolve({
      fromStatus: 'OPEN', id: created.report.id, resolutionNote: 'Confirmada.', resolvedByUserId: second.id, toStatus: 'RESOLVED',
    })).toBe(true);

    const reopened = await repository.create(input);
    expect(reopened.created).toBe(true);
    expect(reopened.report.id).not.toBe(created.report.id);
  });

  it('recusa nota acima de 280 caracteres antes de tocar o banco', async () => {
    const { themeSlug, users } = await fixture(2);
    const themeId = await themeIdOf(themeSlug);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    const matchId = await matchContext(themeId, first, second);
    const repository = new ReportRepository(env.CORE_DB);

    await expect(repository.create({
      contextId: matchId, contextKind: 'MATCH', note: 'x'.repeat(281),
      questionId: `match-question-${matchId}-1`, reason: 'OTHER', reporterUserId: first.id, roundNumber: 1,
    })).rejects.toMatchObject({ code: 'REPORT_NOTE_TOO_LONG' });
    expect(await env.CORE_DB.prepare('SELECT COUNT(*) AS total FROM question_reports WHERE reporter_user_id = ?1')
      .bind(first.id).first()).toEqual({ total: 0 });
  });

  it('aplica teto técnico de criação sem impedir denúncias legítimas fora da janela', async () => {
    const { themeSlug, users } = await fixture(2);
    const themeId = await themeIdOf(themeSlug);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    let now = Date.parse('2026-09-17T12:00:00.000Z');
    const repository = new ReportRepository(env.CORE_DB, () => new Date(now));

    // Cada denúncia usa um contexto MATCH próprio para não esbarrar na idempotência.
    for (let index = 0; index < REPORT_RATE_LIMIT; index += 1) {
      const otherMatchId = await matchContext(themeId, first, second);
      await expect(repository.create({
        contextId: otherMatchId, contextKind: 'MATCH', note: null,
        questionId: `match-question-${otherMatchId}-1`, reason: 'INCORRECT', reporterUserId: first.id, roundNumber: 1,
      })).resolves.toMatchObject({ created: true });
    }
    const blockedMatchId = await matchContext(themeId, first, second);
    await expect(repository.create({
      contextId: blockedMatchId, contextKind: 'MATCH', note: null,
      questionId: `match-question-${blockedMatchId}-1`, reason: 'INCORRECT', reporterUserId: first.id, roundNumber: 1,
    })).rejects.toMatchObject({ code: 'REPORT_RATE_LIMITED', status: 429 });

    now += REPORT_RATE_WINDOW_MS + 1_000;
    await expect(repository.create({
      contextId: blockedMatchId, contextKind: 'MATCH', note: null,
      questionId: `match-question-${blockedMatchId}-1`, reason: 'INCORRECT', reporterUserId: first.id, roundNumber: 1,
    })).resolves.toMatchObject({ created: true });
  });

  it('lista a fila de moderação paginada, mais recentes primeiro, sem sobreposição entre páginas', async () => {
    const { themeSlug, users } = await fixture(2);
    const themeId = await themeIdOf(themeSlug);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    // Um relógio crescente e no futuro garante created_at distinto e mais recente que
    // qualquer denúncia real de outro teste: o Workers runtime pode devolver o mesmo
    // Date.now() para chamadas seguidas sem I/O real entre elas.
    let now = Date.parse('2099-01-01T00:00:00.000Z');
    const repository = new ReportRepository(env.CORE_DB, () => new Date(now));
    const createdIds: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      now += 1_000;
      const matchId = await matchContext(themeId, first, second);
      const result = await repository.create({
        contextId: matchId, contextKind: 'MATCH', note: null,
        questionId: `match-question-${matchId}-1`, reason: 'INCORRECT', reporterUserId: first.id, roundNumber: 1,
      });
      createdIds.push(result.report.id);
    }

    // A fila é global (outros testes deste arquivo também deixam denúncias OPEN), então a
    // asserção não assume um total exato: caminha as páginas de 2 em 2 e confere que as 5
    // criadas aqui aparecem, sem duplicata, na ordem certa — mais recente primeiro.
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await repository.listForAdmin('OPEN', 2, cursor);
      expect(page.reports.length, `página ${pages}`).toBeGreaterThan(0);
      expect(page.reports.length, `página ${pages}`).toBeLessThanOrEqual(2);
      seen.push(...page.reports.map((report) => report.id));
      cursor = page.nextCursor;
      pages += 1;
      expect(pages, 'paginação não terminou').toBeLessThan(50);
    } while (cursor !== null && seen.length < createdIds.length + 1);

    expect(new Set(seen).size).toBe(seen.length);
    // As 5 mais recentes são exatamente as que este teste criou, na ordem inversa de criação.
    expect(seen.slice(0, createdIds.length)).toEqual([...createdIds].reverse());
  });

  it('resolve com CAS otimista: uma segunda tentativa com status desatualizado não reaplica', async () => {
    const { themeSlug, users } = await fixture(2);
    const themeId = await themeIdOf(themeSlug);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    const matchId = await matchContext(themeId, first, second);
    const repository = new ReportRepository(env.CORE_DB);
    const created = await repository.create({
      contextId: matchId, contextKind: 'MATCH', note: null,
      questionId: `match-question-${matchId}-1`, reason: 'INCORRECT', reporterUserId: first.id, roundNumber: 1,
    });

    expect(await repository.resolve({
      fromStatus: 'OPEN', id: created.report.id, resolutionNote: 'Ok.', resolvedByUserId: second.id, toStatus: 'DISMISSED',
    })).toBe(true);
    // A mesma leitura antiga (OPEN) tentando resolver de novo não encontra a linha nesse status.
    expect(await repository.resolve({
      fromStatus: 'OPEN', id: created.report.id, resolutionNote: 'Repetido.', resolvedByUserId: second.id, toStatus: 'RESOLVED',
    })).toBe(false);

    const settled = await repository.byId(created.report.id);
    expect(settled).toMatchObject({ resolutionNote: 'Ok.', status: 'DISMISSED' });
    expect(settled?.resolvedByUserId).toBe(second.id);
    expect(settled?.resolvedAt).not.toBeNull();
  });

  it('recupera o snapshot selado para o admin revisar — MATCH e CHALLENGE', async () => {
    const { themeSlug, users } = await fixture(2);
    const themeId = await themeIdOf(themeSlug);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    const repository = new ReportRepository(env.CORE_DB);

    const matchId = await matchContext(themeId, first, second);
    const matchReport = await repository.create({
      contextId: matchId, contextKind: 'MATCH', note: null,
      questionId: `match-question-${matchId}-1`, reason: 'INCORRECT', reporterUserId: first.id, roundNumber: 1,
    });
    const matchSnapshot = await repository.questionSnapshot(matchReport.report);
    expect(matchSnapshot).toMatchObject({ correctOption: 0, options: ['A', 'B', 'C', 'D'], prompt: 'Pergunta 1?' });

    await befriend(first, second);
    const challengeId = await challengeContext(themeId, first, second);
    const challengeReport = await repository.create({
      contextId: challengeId, contextKind: 'CHALLENGE', note: null,
      questionId: `challenge-question-${challengeId}-1`, reason: 'IMAGE', reporterUserId: second.id, roundNumber: 1,
    });
    const challengeSnapshot = await repository.questionSnapshot(challengeReport.report);
    expect(challengeSnapshot).toMatchObject({ correctOption: 0, options: ['W', 'X', 'Y', 'Z'], prompt: 'Pergunta do desafio?' });
  });

  it('exige autenticação em toda rota de denúncia', async () => {
    const requests: Array<[string, RequestInit]> = [
      ['/api/reports', {
        body: JSON.stringify({ contextId: 'x', contextKind: 'MATCH', questionId: 'x', reason: 'OTHER', roundNumber: 1 }),
        headers: { 'Content-Type': 'application/json', 'X-User-Id': 'arbitrary' },
        method: 'POST',
      }],
      ['/api/admin/reports', { headers: { 'X-User-Id': 'arbitrary' } }],
      [`/api/admin/reports/${crypto.randomUUID()}/resolve`, {
        body: JSON.stringify({ status: 'RESOLVED' }),
        headers: { 'Content-Type': 'application/json', 'X-User-Id': 'arbitrary' },
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
