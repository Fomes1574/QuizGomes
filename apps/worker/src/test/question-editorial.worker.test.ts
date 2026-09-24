import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { QuestionEditorialRepository } from '../repositories/question-editorial-repository.js';
import { questionContentHashCandidates, questionPoolId } from '../services/question-content.js';

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

  it('permite criar pergunta sem fonte vinculada', async () => {
    const questions = new QuestionEditorialRepository(env.QUESTIONS_DB);
    const created = await questions.create({
      ...questionInput(`theme-editorial-no-source-${crypto.randomUUID()}`, 'Pergunta sem fonte?', 'actor-1'),
      sources: [],
    });
    expect((await questions.findForModeration(created.questionId))?.sources).toEqual([]);
  });

  it('recusa conteúdo duplicado (mesmo tema+dificuldade+enunciado+alternativas)', async () => {
    const themeId = `theme-editorial-dup-${crypto.randomUUID()}`;
    const questions = new QuestionEditorialRepository(env.QUESTIONS_DB);
    await questions.create(questionInput(themeId, 'Pergunta única?', 'actor-1'));
    await expect(questions.create(questionInput(themeId, 'Pergunta única?', 'actor-2')))
      .rejects.toMatchObject({ code: 'DUPLICATE_QUESTION' });
  });

  it('recusa duplicata cujo hash foi gravado antes da unificação por dificuldade', async () => {
    const themeId = `theme-editorial-legacy-hash-${crypto.randomUUID()}`;
    const input = questionInput(themeId, 'Pergunta já existente?', 'actor-1');
    const [, legacyEasyHash] = await questionContentHashCandidates(input);
    const poolId = questionPoolId(themeId);
    await env.QUESTIONS_DB.batch([
      env.QUESTIONS_DB.prepare(
        "INSERT INTO question_pools (id, theme_id, difficulty) VALUES (?1, ?2, 'MEDIUM')",
      ).bind(poolId, themeId),
      env.QUESTIONS_DB.prepare(
        `INSERT INTO questions
          (id, pool_id, prompt, option_a, option_b, option_c, option_d, correct_option, content_hash, status)
         VALUES (?1, ?2, ?3, 'A', 'B', 'C', 'D', 0, ?4, 'ACTIVE')`,
      ).bind(`${themeId}-legacy`, poolId, input.prompt, legacyEasyHash),
    ]);
    const questions = new QuestionEditorialRepository(env.QUESTIONS_DB);
    await expect(questions.create(input)).rejects.toMatchObject({ code: 'DUPLICATE_QUESTION' });
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

  it('permite revisar somente a resposta correta ou as fontes sem criar uma pergunta duplicada', async () => {
    const themeId = `theme-editorial-answer-only-${crypto.randomUUID()}`;
    const questions = new QuestionEditorialRepository(env.QUESTIONS_DB);
    const created = await questions.create(questionInput(themeId, 'Qual é a resposta?', 'actor-1'));
    await questions.approve(created.questionId, 'admin-1');

    const revision = await questions.proposeEdit({
      actorUserId: 'actor-1', correctOption: 1, options: ['A', 'B', 'C', 'D'],
      prompt: 'Qual é a resposta?', questionId: created.questionId, sources: [],
    });
    const draft = await questions.findForModeration(revision.draftId);
    expect(draft).toMatchObject({ correctOption: 1, replacesQuestionId: created.questionId, status: 'IN_REVIEW' });
    expect(draft?.sources).toEqual([]);
  });

  it('permite corrigir um rascunho em revisão, inclusive alternativas e fontes, sem criar duplicata', async () => {
    const themeId = `theme-editorial-revise-${crypto.randomUUID()}`;
    const questions = new QuestionEditorialRepository(env.QUESTIONS_DB);
    const created = await questions.create(questionInput(themeId, 'Enunciado com detalhe a mais?', 'actor-1'));

    await questions.reviseDraft({
      correctOption: 2,
      options: ['Alternativa A', 'Alternativa B', 'Alternativa C', 'Alternativa D'],
      prompt: 'Enunciado corrigido?',
      questionId: created.questionId,
      sources: [],
    });

    const revised = await questions.findForModeration(created.questionId);
    expect(revised).toMatchObject({
      correctOption: 2,
      options: ['Alternativa A', 'Alternativa B', 'Alternativa C', 'Alternativa D'],
      prompt: 'Enunciado corrigido?', status: 'IN_REVIEW',
    });
    expect(revised?.sources).toEqual([]);
    expect(revised?.activeSlot).toBeNull();
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

  it('aprova um lote do mesmo pool em série, mantendo slots densos', async () => {
    const themeId = `theme-editorial-batch-${crypto.randomUUID()}`;
    const questions = new QuestionEditorialRepository(env.QUESTIONS_DB);
    const ids: string[] = [];
    for (let index = 1; index <= 3; index += 1) {
      ids.push((await questions.create(questionInput(themeId, `Lote ${index}?`, 'actor-1'))).questionId);
    }

    const result = await questions.approveMany({ actorUserId: 'admin-1', questionIds: ids, themeId });
    expect(result).toEqual({ approvedQuestionIds: ids, failed: [] });
    const slots = await env.QUESTIONS_DB.prepare(
      "SELECT active_slot FROM questions WHERE pool_id = ?1 AND status = 'ACTIVE' ORDER BY active_slot",
    ).bind((await questions.findForModeration(ids[0]!))?.poolId).all<{ active_slot: number }>();
    expect(slots.results.map((row) => row.active_slot)).toEqual([1, 2, 3]);
  });

  it('recusa o lote inteiro se uma pergunta não pertencer ao tema selecionado', async () => {
    const questions = new QuestionEditorialRepository(env.QUESTIONS_DB);
    const themeId = `theme-editorial-batch-a-${crypto.randomUUID()}`;
    const first = await questions.create(questionInput(themeId, 'Tema A?', 'actor-1'));
    const second = await questions.create(questionInput(`theme-editorial-batch-b-${crypto.randomUUID()}`, 'Tema B?', 'actor-1'));

    await expect(questions.approveMany({
      actorUserId: 'admin-1', questionIds: [first.questionId, second.questionId], themeId,
    })).rejects.toMatchObject({ code: 'QUESTION_NOT_FOUND' });
    expect((await questions.findForModeration(first.questionId))?.status).toBe('IN_REVIEW');
    expect((await questions.findForModeration(second.questionId))?.status).toBe('IN_REVIEW');
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

  it('filtra a fila editorial pelo status solicitado', async () => {
    const themeId = `theme-editorial-status-${crypto.randomUUID()}`;
    const questions = new QuestionEditorialRepository(env.QUESTIONS_DB);
    const active = await questions.create(questionInput(themeId, 'Publicada?', 'actor-1'));
    const review = await questions.create(questionInput(themeId, 'Ainda em revisão?', 'actor-1'));
    await questions.approve(active.questionId, 'admin-1');

    expect((await questions.listForTheme({ statuses: ['ACTIVE'], themeId })).questions.map((question) => question.id))
      .toEqual([active.questionId]);
    expect((await questions.listForTheme({ statuses: ['IN_REVIEW'], themeId })).questions.map((question) => question.id))
      .toEqual([review.questionId]);
  });
});
