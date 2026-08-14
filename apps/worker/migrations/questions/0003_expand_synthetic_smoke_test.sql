PRAGMA foreign_keys = ON;

-- Ampliação exclusiva do dataset sintético de smoke. Os 220 novos slots não
-- contêm trivia, imagens, fontes ou conteúdo editorial real.
WITH RECURSIVE synthetic_slots(active_slot) AS (
  VALUES (31)
  UNION ALL
  SELECT active_slot + 1
    FROM synthetic_slots
   WHERE active_slot < 250
)
INSERT INTO questions (
  id,
  pool_id,
  active_slot,
  prompt,
  option_a,
  option_b,
  option_c,
  option_d,
  correct_option,
  content_hash,
  status,
  image_key,
  image_bytes,
  image_license,
  editorial_flags_json
)
SELECT
  printf('synthetic-smoke-test-20260811-q%03d', active_slot),
  'pool-synthetic-smoke-test-multiplayer-easy-20260811',
  active_slot,
  printf('[SYNTHETIC_SMOKE_TEST %03d/250] Pergunta artificial exclusiva do teste multiplayer.', active_slot),
  'Opção sintética A',
  'Opção sintética B',
  'Opção sintética C',
  'Opção sintética D',
  (active_slot - 1) % 4,
  printf('synthetic-smoke-test-20260811-content-%03d', active_slot),
  'ACTIVE',
  NULL,
  NULL,
  NULL,
  '["SYNTHETIC_SMOKE_TEST"]'
FROM synthetic_slots;

UPDATE questions
   SET prompt = printf(
         '[SYNTHETIC_SMOKE_TEST %03d/250] Pergunta artificial exclusiva do teste multiplayer.',
         active_slot
       ),
       updated_at = CURRENT_TIMESTAMP
 WHERE pool_id = 'pool-synthetic-smoke-test-multiplayer-easy-20260811'
   AND status = 'ACTIVE'
   AND editorial_flags_json = '["SYNTHETIC_SMOKE_TEST"]';

UPDATE question_pools
   SET active_count = (
         SELECT COUNT(*)
           FROM questions
          WHERE pool_id = 'pool-synthetic-smoke-test-multiplayer-easy-20260811'
            AND status = 'ACTIVE'
            AND editorial_flags_json = '["SYNTHETIC_SMOKE_TEST"]'
       ),
       migration_status = 'READY',
       updated_at = CURRENT_TIMESTAMP
 WHERE id = 'pool-synthetic-smoke-test-multiplayer-easy-20260811';
