import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { QuestionEditorialRepository } from '../repositories/question-editorial-repository.js';

const SOURCE = { kind: 'WEB', title: 'Fonte', url: 'https://example.test/fonte' } as const;

function questionInput(themeId: string, prompt: string, actorUserId: string) {
  return {
    actorUserId,
    correctOption: 0,
    difficulty: 'EASY' as const,
    options: ['A', 'B', 'C', 'D'] as [string, string, string, string],
    prompt,
    sources: [SOURCE],
    themeId,
  };
}

describe('M11 — CRUD e versionamento de pergunta', () => {
  it('cria pergunta IN_REVIEW sem slot ativo e nunca aparece no sorteio', async () => {
    const themeId = `theme-editorial-create-${crypto.randomUUID()}`;
    const questions = new QuestionEditorialRepository(env.QUESTIONS_DB);
    const created = await questions.create(questionInput(themeId, 'Pergunta nova?', 'actor-1'));

    const record = await questions.findForModeration(created.questionId);
    expect(record).toMatchObject({ activeSlot: null, status: 'IN_REVIEW', themeId });
    expect(record?.sources).toHaveLength(1);
    expect(record?.sources[0]).toMatchObject({ kind: 'WEB', title: 'Fonte', url: 'https://example.test/fonte' });
    expect(typeof record?.sources[0]?.id).toBe('string');

    const activeCount = await env.QUESTIONS_DB.prepare(
      "SELECT COUNT(*) AS total FROM questions WHERE pool_id = ?1 AND status = 'ACTIVE'",
    ).bind(record?.poolId).first<{ total: number }>();
    expect(activeCount?.total).toBe(0);
  });

  it('recusa conteúdo duplicado (mesmo tema+dificuldade+enunciado+alternativas)', async () => {
    const themeId = `theme-editorial-dup-${crypto.randomUUID()}`;
    const questions = new QuestionEditorialRepository(env.QUESTIONS_DB);
    await questions.create(questionInput(themeId, 'Pergunta única?', 'actor-1'));
    await expect(questions.create(questionInput(themeId, 'Pergunta única?', 'actor-2')))
      .rejects.toMatchObject({ code: 'DUPLICATE_QUESTION' });
  });

  it('aprovar pergunta nova ocupa o próximo slot denso e atualiza active_count/version', async () => {
    const themeId = `theme-editorial-approve-${crypto.randomUUID()}`;
    const questions = new QuestionEditorialRepository(env.QUESTIONS_DB);
    const first = await questions.create(questionInput(themeId, 'Primeira?', 'actor-1'));
    const second = await questions.create(questionInput(themeId, 'Segunda?', 'actor-1'));

    await questions.approve(first.questionId, 'admin-1');
    const afterFirst = await questions.findForModeration(first.questionId);
    expect(afterFirst).toMatchObject({ activeSlot: 1, resolvedByUserId: 'admin-1', status: 'ACTIVE' });

    await questions.approve(second.questionId, 'admin-1');
    const afterSecond = await questions.findForModeration(second.questionId);
    expect(afterSecond).toMatchObject({ activeSlot: 2, status: 'ACTIVE' });

    const pool = await env.QUESTIONS_DB.prepare('SELECT active_count, version FROM question_pools WHERE id = ?1')
      .bind(afterFirst?.poolId).first<{ active_count: number; version: number }>();
    expect(pool).toEqual({ active_count: 2, version: 3 });
  });

  it('aprovar de novo (ou aprovar rejeitada) falha com QUESTION_NOT_PENDING', async () => {
    const themeId = `theme-editorial-repeat-${crypto.randomUUID()}`;
    const questions = new QuestionEditorialRepository(env.QUESTIONS_DB);
    const created = await questions.create(questionInput(themeId, 'Repetível?', 'actor-1'));
    await questions.approve(created.questionId, 'admin-1');
    await expect(questions.approve(created.questionId, 'admin-1')).rejects.toMatchObject({ code: 'QUESTION_NOT_PENDING' });

    const rejected = await questions.create(questionInput(themeId, 'Será rejeitada?', 'actor-1'));
    await questions.reject(rejected.questionId, 'admin-1', 'Fonte insuficiente.');
    await expect(questions.approve(rejected.questionId, 'admin-1')).rejects.toMatchObject({ code: 'QUESTION_NOT_PENDING' });
    const rejectedRecord = await questions.findForModeration(rejected.questionId);
    expect(rejectedRecord).toMatchObject({ resolutionNote: 'Fonte insuficiente.', status: 'REJECTED' });
  });

  it('editar pergunta ACTIVE nasce vinculada e nunca some do sorteio antes da aprovação', async () => {
    const themeId = `theme-editorial-edit-${crypto.randomUUID()}`;
    const questions = new QuestionEditorialRepository(env.QUESTIONS_DB);
    const created = await questions.create(questionInput(themeId, 'Pergunta original?', 'actor-1'));
    await questions.approve(created.questionId, 'admin-1');
    const active = await questions.findForModeration(created.questionId);

    const draft = await questions.proposeEdit({
      actorUserId: 'actor-1', correctOption: 1, options: ['A2', 'B2', 'C2', 'D2'],
      prompt: 'Pergunta revisada?', questionId: created.questionId, sources: [SOURCE],
    });
    const draftRecord = await questions.findForModeration(draft.draftId);
    expect(draftRecord).toMatchObject({ activeSlot: null, replacesQuestionId: created.questionId, status: 'IN_REVIEW' });
    // A publicada continua servindo normalmente enquanto o rascunho aguarda.
    const stillActive = await questions.findForModeration(created.questionId);
    expect(stillActive).toMatchObject({ activeSlot: active?.activeSlot, status: 'ACTIVE' });

    await questions.approve(draft.draftId, 'admin-1');
    const publishedDraft = await questions.findForModeration(draft.draftId);
    const disabledOriginal = await questions.findForModeration(created.questionId);
    expect(publishedDraft).toMatchObject({ activeSlot: active?.activeSlot, status: 'ACTIVE' });
    expect(disabledOriginal).toMatchObject({ activeSlot: null, status: 'DISABLED' });

    // A contagem do pool não muda: é uma troca, não uma adição.
    const pool = await env.QUESTIONS_DB.prepare('SELECT active_count FROM question_pools WHERE id = ?1')
      .bind(active?.poolId).first<{ active_count: number }>();
    expect(pool?.active_count).toBe(1);
  });

  it('editar pergunta que não está ACTIVE falha com QUESTION_NOT_ACTIVE', async () => {
    const themeId = `theme-editorial-edit-inactive-${crypto.randomUUID()}`;
    const questions = new QuestionEditorialRepository(env.QUESTIONS_DB);
    const created = await questions.create(questionInput(themeId, 'Ainda em revisão?', 'actor-1'));
    await expect(questions.proposeEdit({
      actorUserId: 'actor-1', correctOption: 1, options: ['A2', 'B2', 'C2', 'D2'],
      prompt: 'x', questionId: created.questionId, sources: [SOURCE],
    })).rejects.toMatchObject({ code: 'QUESTION_NOT_ACTIVE' });
  });

  it('duas aprovações concorrentes no mesmo pool: uma vence, a outra recebe conflito limpo', async () => {
    const themeId = `theme-editorial-race-${crypto.randomUUID()}`;
    const questions = new QuestionEditorialRepository(env.QUESTIONS_DB);
    const first = await questions.create(questionInput(themeId, 'Corrida A?', 'actor-1'));
    const second = await questions.create(questionInput(themeId, 'Corrida B?', 'actor-1'));

    const results = await Promise.allSettled([
      questions.approve(first.questionId, 'admin-1'),
      questions.approve(second.questionId, 'admin-1'),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'QUESTION_CONFLICT' });

    const pool = await env.QUESTIONS_DB.prepare('SELECT active_count FROM question_pools WHERE id = ?1')
      .bind((await questions.findForModeration(first.questionId))?.poolId).first<{ active_count: number }>();
    // Só a vencedora avançou a contagem — sem slot duplicado nem contagem adiantada.
    expect(pool?.active_count).toBe(1);
  });

  it('desativar preserva densidade: o último slot assume o slot vago, sem buracos', async () => {
    const themeId = `theme-editorial-deactivate-${crypto.randomUUID()}`;
    const questions = new QuestionEditorialRepository(env.QUESTIONS_DB);
    const ids: string[] = [];
    for (let index = 1; index <= 3; index += 1) {
      const created = await questions.create(questionInput(themeId, `Pergunta ${index}?`, 'actor-1'));
      await questions.approve(created.questionId, 'admin-1');
      ids.push(created.questionId);
    }
    const [firstId, secondId, thirdId] = ids;
    if (firstId === undefined || secondId === undefined || thirdId === undefined) throw new Error('Fixture incompleta.');

    // Desativa o do meio (slot 2): o de slot 3 deve assumir o slot 2.
    await questions.deactivate(secondId, 'admin-1');

    const disabled = await questions.findForModeration(secondId);
    const moved = await questions.findForModeration(thirdId);
    const untouched = await questions.findForModeration(firstId);
    expect(disabled).toMatchObject({ activeSlot: null, status: 'DISABLED' });
    expect(moved).toMatchObject({ activeSlot: 2, status: 'ACTIVE' });
    expect(untouched).toMatchObject({ activeSlot: 1, status: 'ACTIVE' });

    const pool = await env.QUESTIONS_DB.prepare('SELECT active_count FROM question_pools WHERE id = ?1')
      .bind(disabled?.poolId).first<{ active_count: number }>();
    expect(pool?.active_count).toBe(2);

    // Slots continuam densos e sem duplicata.
    const slots = await env.QUESTIONS_DB.prepare(
      "SELECT active_slot FROM questions WHERE pool_id = ?1 AND status = 'ACTIVE' ORDER BY active_slot",
    ).bind(disabled?.poolId).all<{ active_slot: number }>();
    expect(slots.results.map((row) => row.active_slot)).toEqual([1, 2]);
  });

  it('desativar a última pergunta do pool não precisa de swap e zera a contagem', async () => {
    const themeId = `theme-editorial-deactivate-last-${crypto.randomUUID()}`;
    const questions = new QuestionEditorialRepository(env.QUESTIONS_DB);
    const created = await questions.create(questionInput(themeId, 'Única?', 'actor-1'));
    await questions.approve(created.questionId, 'admin-1');
    await questions.deactivate(created.questionId, 'admin-1');
    const record = await questions.findForModeration(created.questionId);
    expect(record).toMatchObject({ activeSlot: null, status: 'DISABLED' });
    const pool = await env.QUESTIONS_DB.prepare('SELECT active_count FROM question_pools WHERE id = ?1')
      .bind(record?.poolId).first<{ active_count: number }>();
    expect(pool?.active_count).toBe(0);
  });

  it('desativar pergunta que não está ACTIVE falha com QUESTION_NOT_ACTIVE', async () => {
    const themeId = `theme-editorial-deactivate-inactive-${crypto.randomUUID()}`;
    const questions = new QuestionEditorialRepository(env.QUESTIONS_DB);
    const created = await questions.create(questionInput(themeId, 'Nunca aprovada?', 'actor-1'));
    await expect(questions.deactivate(created.questionId, 'admin-1')).rejects.toMatchObject({ code: 'QUESTION_NOT_ACTIVE' });
  });

  it('pagina perguntas do tema por cursor sem esconder nenhuma', async () => {
    const themeId = `theme-editorial-page-${crypto.randomUUID()}`;
    const questions = new QuestionEditorialRepository(env.QUESTIONS_DB);
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const created = await questions.create(questionInput(themeId, `Página ${index}?`, 'actor-1'));
      ids.push(created.questionId);
    }
    const firstPage = await questions.listForTheme({ themeId });
    expect(firstPage.questions).toHaveLength(5);
    expect(firstPage.nextCursor).toBeNull();
    expect(new Set(firstPage.questions.map((question) => question.id))).toEqual(new Set(ids));
  });
});
