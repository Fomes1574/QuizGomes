import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const CATEGORY_ID = 'category-synthetic-smoke-test-20260811';
const THEME_ID = 'theme-synthetic-smoke-test-multiplayer-20260811';
const POOL_ID = 'pool-synthetic-smoke-test-multiplayer-easy-20260811';
const FLAG = '["SYNTHETIC_SMOKE_TEST"]';

describe('dataset temporário do smoke test real', () => {
  it('publica um catálogo interno inequívoco sem imagem', async () => {
    const category = await env.CORE_DB.prepare(
      'SELECT slug, name, sort_order, status FROM categories WHERE id = ?1',
    ).bind(CATEGORY_ID).first<{
      name: string;
      slug: string;
      sort_order: number;
      status: string;
    }>();
    expect(category).toEqual({
      name: 'INTERNO · TESTE SINTÉTICO TEMPORÁRIO',
      slug: 'interno-synthetic-smoke-test-20260811',
      sort_order: 2_147_483_000,
      status: 'ACTIVE',
    });

    const theme = await env.CORE_DB.prepare(
      `SELECT category_id, slug, name, description, cover_image_key, status, origin,
              created_by_user_id, question_shard_id, active_question_count
         FROM themes
        WHERE id = ?1`,
    ).bind(THEME_ID).first<{
      active_question_count: number;
      category_id: string;
      cover_image_key: string | null;
      created_by_user_id: string | null;
      description: string;
      name: string;
      origin: string;
      question_shard_id: string;
      slug: string;
      status: string;
    }>();
    expect(theme).toEqual({
      active_question_count: 30,
      category_id: CATEGORY_ID,
      cover_image_key: null,
      created_by_user_id: null,
      description: 'INTERNO E TEMPORÁRIO · SYNTHETIC_SMOKE_TEST · Não contém trivia real.',
      name: 'Teste Multiplayer',
      origin: 'OFFICIAL',
      question_shard_id: 'questions-01',
      slug: 'teste-multiplayer-synthetic-smoke-test-20260811',
      status: 'ACTIVE',
    });
  });

  it('mantém somente EASY com 30 slots densos e respostas distribuídas', async () => {
    const pools = await env.QUESTIONS_DB.prepare(
      `SELECT id, difficulty, active_count, version, migration_status
         FROM question_pools
        WHERE theme_id = ?1
        ORDER BY difficulty`,
    ).bind(THEME_ID).all<{
      active_count: number;
      difficulty: string;
      id: string;
      migration_status: string;
      version: number;
    }>();
    expect(pools.results).toEqual([{
      active_count: 30,
      difficulty: 'EASY',
      id: POOL_ID,
      migration_status: 'READY',
      version: 1,
    }]);

    const questions = await env.QUESTIONS_DB.prepare(
      `SELECT id, active_slot, prompt, option_a, option_b, option_c, option_d,
              correct_option, status, image_key, image_bytes, image_license, editorial_flags_json
         FROM questions
        WHERE pool_id = ?1
        ORDER BY active_slot`,
    ).bind(POOL_ID).all<{
      active_slot: number;
      correct_option: number;
      editorial_flags_json: string;
      id: string;
      image_bytes: number | null;
      image_key: string | null;
      image_license: string | null;
      option_a: string;
      option_b: string;
      option_c: string;
      option_d: string;
      prompt: string;
      status: string;
    }>();
    expect(questions.results).toHaveLength(30);
    expect(questions.results.map((question) => question.active_slot)).toEqual(
      Array.from({ length: 30 }, (_, index) => index + 1),
    );
    expect(questions.results.every((question) => (
      question.id.startsWith('synthetic-smoke-test-20260811-q')
      && question.prompt.includes('SYNTHETIC_SMOKE_TEST')
      && question.option_a === 'Opção sintética A'
      && question.option_b === 'Opção sintética B'
      && question.option_c === 'Opção sintética C'
      && question.option_d === 'Opção sintética D'
      && question.status === 'ACTIVE'
      && question.editorial_flags_json === FLAG
      && question.image_key === null
      && question.image_bytes === null
      && question.image_license === null
    ))).toBe(true);

    const distribution = [0, 1, 2, 3].map((option) => (
      questions.results.filter((question) => question.correct_option === option).length
    ));
    expect(distribution).toEqual([8, 8, 7, 7]);

    const sources = await env.QUESTIONS_DB.prepare(
      `SELECT COUNT(*) AS total
         FROM question_sources s
         JOIN questions q ON q.id = s.question_id
        WHERE q.pool_id = ?1`,
    ).bind(POOL_ID).first<{ total: number }>();
    expect(sources).toEqual({ total: 0 });
  });
});
