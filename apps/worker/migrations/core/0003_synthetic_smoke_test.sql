PRAGMA foreign_keys = ON;

-- Dataset temporário e exclusivamente sintético para o smoke test real do Milestone 8.
-- Os identificadores reservados e o texto visível impedem confusão com catálogo editorial.
INSERT INTO categories (id, slug, name, sort_order, status)
VALUES (
  'category-synthetic-smoke-test-20260811',
  'interno-synthetic-smoke-test-20260811',
  'INTERNO · TESTE SINTÉTICO TEMPORÁRIO',
  2147483000,
  'ACTIVE'
)
ON CONFLICT(id) DO UPDATE SET
  slug = excluded.slug,
  name = excluded.name,
  sort_order = excluded.sort_order,
  status = excluded.status,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO themes (
  id,
  category_id,
  slug,
  name,
  description,
  cover_image_key,
  status,
  origin,
  created_by_user_id,
  question_shard_id,
  active_question_count
)
VALUES (
  'theme-synthetic-smoke-test-multiplayer-20260811',
  'category-synthetic-smoke-test-20260811',
  'teste-multiplayer-synthetic-smoke-test-20260811',
  'Teste Multiplayer',
  'INTERNO E TEMPORÁRIO · SYNTHETIC_SMOKE_TEST · Não contém trivia real.',
  NULL,
  'ACTIVE',
  'OFFICIAL',
  NULL,
  'questions-01',
  30
)
ON CONFLICT(id) DO UPDATE SET
  category_id = excluded.category_id,
  slug = excluded.slug,
  name = excluded.name,
  description = excluded.description,
  cover_image_key = NULL,
  status = excluded.status,
  origin = excluded.origin,
  created_by_user_id = NULL,
  question_shard_id = excluded.question_shard_id,
  active_question_count = excluded.active_question_count,
  updated_at = CURRENT_TIMESTAMP;
