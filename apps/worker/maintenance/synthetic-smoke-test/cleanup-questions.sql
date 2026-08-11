PRAGMA foreign_keys = ON;

-- NÃO ESTÁ ATIVO COMO MIGRATION. Promover somente após autorização explícita.
DELETE FROM questions
 WHERE pool_id = 'pool-synthetic-smoke-test-multiplayer-easy-20260811'
   AND id GLOB 'synthetic-smoke-test-20260811-q[0-9][0-9]'
   AND content_hash GLOB 'synthetic-smoke-test-20260811-content-[0-9][0-9]'
   AND editorial_flags_json = '["SYNTHETIC_SMOKE_TEST"]';

UPDATE question_pools
   SET active_count = (
         SELECT COUNT(*)
           FROM questions
          WHERE pool_id = 'pool-synthetic-smoke-test-multiplayer-easy-20260811'
            AND status = 'ACTIVE'
       ),
       updated_at = CURRENT_TIMESTAMP
 WHERE id = 'pool-synthetic-smoke-test-multiplayer-easy-20260811'
   AND theme_id = 'theme-synthetic-smoke-test-multiplayer-20260811'
   AND difficulty = 'EASY';

DELETE FROM question_pools
 WHERE id = 'pool-synthetic-smoke-test-multiplayer-easy-20260811'
   AND theme_id = 'theme-synthetic-smoke-test-multiplayer-20260811'
   AND difficulty = 'EASY'
   AND NOT EXISTS (
         SELECT 1
           FROM questions
          WHERE pool_id = 'pool-synthetic-smoke-test-multiplayer-easy-20260811'
       );
