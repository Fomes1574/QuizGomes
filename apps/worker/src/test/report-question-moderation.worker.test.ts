import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { ReportRepository } from '../repositories/report-repository.js';
import { QuestionEditorialRepository } from '../repositories/question-editorial-repository.js';
import { fixture, userAt } from './challenge-fixture.worker.js';

/**
 * Tema mínimo só em CORE_DB (para satisfazer a FK de `matches.theme_id`),
 * SEM passar pela fixture combinada de desafios — que semeia pools no
 * QUESTIONS_DB sob um id diferente do que `QuestionEditorialRepository`
 * calcula, e colidiria na constraint UNIQUE(theme_id, difficulty).
 */
async function minimalCoreTheme(themeId: string): Promise<void> {
  const categoryId = `category-${themeId}`;
  await env.CORE_DB.batch([
    env.CORE_DB.prepare(
      "INSERT INTO categories (id, slug, name) VALUES (?1, ?1, ?2)",
    ).bind(categoryId, `Categoria ${themeId}`),
    env.CORE_DB.prepare(
      `INSERT INTO themes (id, category_id, slug, name, description, status, origin, question_shard_id)
       VALUES (?1, ?2, ?1, ?3, 'Fixture sintética.', 'ACTIVE', 'OFFICIAL', 'questions-01')`,
    ).bind(themeId, categoryId, `Tema ${themeId}`),
  ]);
}

/**
 * Integração ADMIN entre denúncia e moderação de pergunta: "enviar revisão"
 * é a própria transição de status (OPEN -> IN_REVIEW, sem carimbar
 * resolvido) e "desativar" é a mesma ação de `QuestionEditorialRepository`
 * já usada pelo pipeline editorial — os dois fluxos permanecem
 * independentes e cada um mantém seu próprio CAS e trilha de auditoria.
 */
describe('M11 — denúncia integrada à moderação de pergunta', () => {
  it('enviar para revisão não carimba resolvedBy/resolvedAt; resolver depois carimba', async () => {
    const { users } = await fixture(2);
    // themeId independente: cada pergunta do pipeline editorial mora só no
    // QUESTIONS_DB (sem FK cruzando bancos), então não precisa do tema real
    // que a fixture de desafios já semeou com pools próprios.
    const themeId = `theme-report-moderation-${crypto.randomUUID()}`;
    await minimalCoreTheme(themeId);
    const reporter = userAt(users, 0);
    const admin = userAt(users, 1);

    const questions = new QuestionEditorialRepository(env.QUESTIONS_DB);
    const created = await questions.create({
      actorUserId: admin.id, correctOption: 0,
      options: ['A', 'B', 'C', 'D'], prompt: 'Pergunta real do relatório?',
      sources: [{ kind: 'WEB', url: 'https://fonte.test/relatorio' }], themeId,
    });
    await questions.approve(created.questionId, admin.id);

    const matchId = crypto.randomUUID();
    await env.CORE_DB.batch([
      env.CORE_DB.prepare(
        `INSERT INTO matches (id, theme_id, difficulty, mode, kind, status, question_shard_id)
         VALUES (?1, ?2, 'EASY', 'CASUAL', 'MATCHMAKING', 'FINISHED', 'questions-01')`,
      ).bind(matchId, themeId),
      env.CORE_DB.prepare(
        `INSERT INTO match_questions
          (match_id, round_number, question_id, pool_slot, public_snapshot_json, correct_option_sealed)
         VALUES (?1, 1, ?2, 1, ?3, '0')`,
      ).bind(matchId, created.questionId, JSON.stringify({
        id: created.questionId, imageUrl: null, options: ['A', 'B', 'C', 'D'], prompt: 'Pergunta real do relatório?',
      })),
      env.CORE_DB.prepare(
        `INSERT INTO question_report_views (context_kind, context_id, user_id, round_number, question_id)
         VALUES ('MATCH', ?1, ?2, 1, ?3)`,
      ).bind(matchId, reporter.id, created.questionId),
    ]);

    const reports = new ReportRepository(env.CORE_DB);
    const report = await reports.create({
      contextId: matchId, contextKind: 'MATCH', note: null,
      questionId: created.questionId, reason: 'INCORRECT', reporterUserId: reporter.id, roundNumber: 1,
    });

    // "Enviar para revisão": só muda o status, não é uma resolução terminal.
    expect(await reports.resolve({
      fromStatus: 'OPEN', id: report.report.id, resolutionNote: null, resolvedByUserId: admin.id, toStatus: 'IN_REVIEW',
    })).toBe(true);
    const underReview = await reports.byId(report.report.id);
    expect(underReview).toMatchObject({ resolvedAt: null, resolvedByUserId: null, status: 'IN_REVIEW' });

    // O ADMIN confirma o problema e desativa a pergunta real por trás da denúncia.
    await questions.deactivate(created.questionId, admin.id);
    const deactivated = await questions.findForModeration(created.questionId);
    expect(deactivated).toMatchObject({ activeSlot: null, status: 'DISABLED' });

    // Só agora a denúncia é resolvida de fato — e carimba quem/quando.
    expect(await reports.resolve({
      fromStatus: 'IN_REVIEW', id: report.report.id, resolutionNote: 'Pergunta desativada por conteúdo incorreto.',
      resolvedByUserId: admin.id, toStatus: 'RESOLVED',
    })).toBe(true);
    const resolved = await reports.byId(report.report.id);
    expect(resolved).toMatchObject({
      resolutionNote: 'Pergunta desativada por conteúdo incorreto.', resolvedByUserId: admin.id, status: 'RESOLVED',
    });
    expect(resolved?.resolvedAt).not.toBeNull();
  });

  it('editar a pergunta reportada (rascunho vinculado) não altera o estado da denúncia', async () => {
    const { users } = await fixture(1);
    const themeId = `theme-report-edit-${crypto.randomUUID()}`;
    const admin = userAt(users, 0);
    const questions = new QuestionEditorialRepository(env.QUESTIONS_DB);
    const created = await questions.create({
      actorUserId: admin.id, correctOption: 0,
      options: ['A', 'B', 'C', 'D'], prompt: 'Pergunta com erro de digitação?',
      sources: [{ kind: 'WEB', url: 'https://fonte.test/edicao' }], themeId,
    });
    await questions.approve(created.questionId, admin.id);

    await env.CORE_DB.prepare(
      `INSERT INTO question_report_views (context_kind, context_id, user_id, round_number, question_id)
       VALUES ('MATCH', 'contexto-independente', ?1, 1, ?2)`,
    ).bind(admin.id, created.questionId).run();
    const reports = new ReportRepository(env.CORE_DB);
    const report = await reports.create({
      contextId: 'contexto-independente', contextKind: 'MATCH', note: null,
      questionId: created.questionId, reason: 'TEXT', reporterUserId: admin.id, roundNumber: 1,
    });

    const draft = await questions.proposeEdit({
      actorUserId: admin.id, correctOption: 0, options: ['A', 'B', 'C', 'D corrigido'],
      prompt: 'Pergunta com erro de digitação corrigida?', questionId: created.questionId,
      sources: [{ kind: 'WEB', url: 'https://fonte.test/edicao' }],
    });
    await questions.approve(draft.draftId, admin.id);

    const beforeResolve = await reports.byId(report.report.id);
    expect(beforeResolve).toMatchObject({ status: 'OPEN' });
    const original = await questions.findForModeration(created.questionId);
    expect(original).toMatchObject({ status: 'DISABLED' });
  });
});
