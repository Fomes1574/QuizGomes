import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { QuestionImportService } from '../services/question-import-service.js';

const CATEGORY_ID = 'category-question-import-test';
const THEME_ID = 'theme-question-import-test';

beforeAll(async () => {
  await env.CORE_DB.batch([
    env.CORE_DB.prepare(
      "INSERT INTO categories (id, slug, name, sort_order, status) VALUES (?1, 'categoria-question-import-test', 'Categoria Importação', 2147481000, 'ACTIVE')",
    ).bind(CATEGORY_ID),
    env.CORE_DB.prepare(
      `INSERT INTO themes (id, category_id, slug, name, description, status, origin, question_shard_id)
       VALUES (?1, ?2, 'tema-question-import-test', 'Tema Importação', 'Fixture para importação grande.', 'ACTIVE', 'OFFICIAL', 'questions-01')`,
    ).bind(THEME_ID, CATEGORY_ID),
  ]);
});

describe('importação CSV grande', () => {
  it('aceita 100 perguntas mesmo com os quatro hashes de compatibilidade por pergunta', async () => {
    const questions = Array.from({ length: 100 }, (_, index) => ({
      correctOption: index % 4,
      options: [`A ${index}`, `B ${index}`, `C ${index}`, `D ${index}`] as [string, string, string, string],
      prompt: `Pergunta importada ${index}?`,
      sources: [],
      themeId: THEME_ID,
    }));
    const result = await new QuestionImportService(env.CORE_DB, env.QUESTIONS_DB)
      .import('import-actor', crypto.randomUUID(), questions);
    expect(result).toMatchObject({ imported: 100, status: 'APPLIED' });
    expect(await env.QUESTIONS_DB.prepare(
      "SELECT COUNT(*) AS total FROM questions WHERE pool_id = ?1 AND status = 'IN_REVIEW'",
    ).bind(`${THEME_ID}:pool`).first<{ total: number }>()).toEqual({ total: 100 });
  });

  it('sem o modo de pular, uma pergunta já existente recusa o lote inteiro', async () => {
    const service = new QuestionImportService(env.CORE_DB, env.QUESTIONS_DB);
    const base = { options: ['Um', 'Dois', 'Três', 'Quatro'] as [string, string, string, string], sources: [], themeId: THEME_ID };
    const prompt = `Existente ${crypto.randomUUID()}?`;
    await service.import('import-actor', crypto.randomUUID(), [{ ...base, correctOption: 0, prompt }]);
    await expect(service.import('import-actor', crypto.randomUUID(), [
      { ...base, correctOption: 0, prompt },
      { ...base, correctOption: 1, prompt: `Nova ${crypto.randomUUID()}?` },
    ])).rejects.toMatchObject({ code: 'DUPLICATE_QUESTION' });
  });

  it('no modo de pular, importa as novas e conta as repetidas (no catálogo e no próprio lote)', async () => {
    const service = new QuestionImportService(env.CORE_DB, env.QUESTIONS_DB);
    const base = { options: ['Um', 'Dois', 'Três', 'Quatro'] as [string, string, string, string], sources: [], themeId: THEME_ID };
    const existing = `Já no catálogo ${crypto.randomUUID()}?`;
    const repeated = `Repetida no lote ${crypto.randomUUID()}?`;
    const fresh = `Inédita ${crypto.randomUUID()}?`;
    await service.import('import-actor', crypto.randomUUID(), [{ ...base, correctOption: 0, prompt: existing }]);
    const key = crypto.randomUUID();
    const batch = [
      { ...base, correctOption: 0, prompt: existing },
      { ...base, correctOption: 2, prompt: repeated },
      { ...base, correctOption: 2, prompt: repeated },
      { ...base, correctOption: 3, prompt: fresh },
    ];
    await expect(service.import('import-actor', key, batch, { skipDuplicates: true }))
      .resolves.toMatchObject({ imported: 2, skipped: 2, status: 'APPLIED' });
    // Reenviar a mesma parte (mesma chave) não duplica nada.
    await expect(service.import('import-actor', key, batch, { skipDuplicates: true }))
      .resolves.toMatchObject({ imported: 2, status: 'ALREADY_APPLIED' });
    // Uma parte inteira já importada (chave nova) vira só "puladas".
    await expect(service.import('import-actor', crypto.randomUUID(), batch, { skipDuplicates: true }))
      .resolves.toMatchObject({ imported: 0, skipped: 4, status: 'APPLIED' });
    const total = await env.QUESTIONS_DB.prepare(
      'SELECT COUNT(*) AS total FROM questions WHERE prompt IN (?1, ?2, ?3)',
    ).bind(existing, repeated, fresh).first<{ total: number }>();
    expect(total?.total).toBe(3);
  });
});
