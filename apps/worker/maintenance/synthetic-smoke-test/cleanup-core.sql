PRAGMA foreign_keys = ON;

-- NÃO ESTÁ ATIVO COMO MIGRATION. Promover somente após autorização explícita.
UPDATE themes
   SET status = 'DISABLED',
       active_question_count = 0,
       updated_at = CURRENT_TIMESTAMP
 WHERE id = 'theme-synthetic-smoke-test-multiplayer-20260811'
   AND category_id = 'category-synthetic-smoke-test-20260811'
   AND slug = 'teste-multiplayer-synthetic-smoke-test-20260811'
   AND name = 'Teste Multiplayer'
   AND description = 'INTERNO E TEMPORÁRIO · SYNTHETIC_SMOKE_TEST · Não contém trivia real.';

UPDATE categories
   SET status = 'DISABLED',
       updated_at = CURRENT_TIMESTAMP
 WHERE id = 'category-synthetic-smoke-test-20260811'
   AND slug = 'interno-synthetic-smoke-test-20260811'
   AND name = 'INTERNO · TESTE SINTÉTICO TEMPORÁRIO';

-- Apaga o catálogo somente quando nenhuma referência histórica precisa do tema.
DELETE FROM themes
 WHERE id = 'theme-synthetic-smoke-test-multiplayer-20260811'
   AND category_id = 'category-synthetic-smoke-test-20260811'
   AND slug = 'teste-multiplayer-synthetic-smoke-test-20260811'
   AND status = 'DISABLED'
   AND NOT EXISTS (
         SELECT 1 FROM matches
          WHERE theme_id = 'theme-synthetic-smoke-test-multiplayer-20260811'
       )
   AND NOT EXISTS (
         SELECT 1 FROM challenges
          WHERE theme_id = 'theme-synthetic-smoke-test-multiplayer-20260811'
       )
   AND NOT EXISTS (
         SELECT 1 FROM theme_rankings
          WHERE theme_id = 'theme-synthetic-smoke-test-multiplayer-20260811'
       )
   AND NOT EXISTS (
         SELECT 1 FROM theme_ownership
          WHERE theme_id = 'theme-synthetic-smoke-test-multiplayer-20260811'
       );

DELETE FROM categories
 WHERE id = 'category-synthetic-smoke-test-20260811'
   AND slug = 'interno-synthetic-smoke-test-20260811'
   AND status = 'DISABLED'
   AND NOT EXISTS (
         SELECT 1 FROM themes
          WHERE category_id = 'category-synthetic-smoke-test-20260811'
       );
