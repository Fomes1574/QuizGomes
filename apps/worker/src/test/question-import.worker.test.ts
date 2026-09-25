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
});
