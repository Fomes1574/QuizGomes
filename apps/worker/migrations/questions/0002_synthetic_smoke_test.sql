PRAGMA foreign_keys = ON;

-- Dataset temporário e exclusivamente sintético para o smoke test real do Milestone 8.
-- Não contém trivia, fonte editorial ou imagem. Slots 1..30 permanecem densos.
INSERT INTO question_pools (
  id,
  theme_id,
  difficulty,
  active_count,
  version,
  migration_status
)
VALUES (
  'pool-synthetic-smoke-test-multiplayer-easy-20260811',
  'theme-synthetic-smoke-test-multiplayer-20260811',
  'EASY',
  30,
  1,
  'READY'
)
ON CONFLICT(id) DO UPDATE SET
  theme_id = excluded.theme_id,
  difficulty = excluded.difficulty,
  active_count = excluded.active_count,
  version = excluded.version,
  migration_status = excluded.migration_status,
  updated_at = CURRENT_TIMESTAMP;

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
VALUES
  ('synthetic-smoke-test-20260811-q01', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 1, '[SYNTHETIC_SMOKE_TEST 01/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 0, 'synthetic-smoke-test-20260811-content-01', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q02', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 2, '[SYNTHETIC_SMOKE_TEST 02/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 1, 'synthetic-smoke-test-20260811-content-02', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q03', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 3, '[SYNTHETIC_SMOKE_TEST 03/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 2, 'synthetic-smoke-test-20260811-content-03', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q04', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 4, '[SYNTHETIC_SMOKE_TEST 04/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 3, 'synthetic-smoke-test-20260811-content-04', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q05', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 5, '[SYNTHETIC_SMOKE_TEST 05/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 0, 'synthetic-smoke-test-20260811-content-05', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q06', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 6, '[SYNTHETIC_SMOKE_TEST 06/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 1, 'synthetic-smoke-test-20260811-content-06', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q07', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 7, '[SYNTHETIC_SMOKE_TEST 07/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 2, 'synthetic-smoke-test-20260811-content-07', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q08', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 8, '[SYNTHETIC_SMOKE_TEST 08/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 3, 'synthetic-smoke-test-20260811-content-08', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q09', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 9, '[SYNTHETIC_SMOKE_TEST 09/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 0, 'synthetic-smoke-test-20260811-content-09', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q10', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 10, '[SYNTHETIC_SMOKE_TEST 10/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 1, 'synthetic-smoke-test-20260811-content-10', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q11', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 11, '[SYNTHETIC_SMOKE_TEST 11/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 2, 'synthetic-smoke-test-20260811-content-11', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q12', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 12, '[SYNTHETIC_SMOKE_TEST 12/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 3, 'synthetic-smoke-test-20260811-content-12', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q13', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 13, '[SYNTHETIC_SMOKE_TEST 13/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 0, 'synthetic-smoke-test-20260811-content-13', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q14', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 14, '[SYNTHETIC_SMOKE_TEST 14/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 1, 'synthetic-smoke-test-20260811-content-14', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q15', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 15, '[SYNTHETIC_SMOKE_TEST 15/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 2, 'synthetic-smoke-test-20260811-content-15', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q16', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 16, '[SYNTHETIC_SMOKE_TEST 16/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 3, 'synthetic-smoke-test-20260811-content-16', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q17', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 17, '[SYNTHETIC_SMOKE_TEST 17/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 0, 'synthetic-smoke-test-20260811-content-17', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q18', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 18, '[SYNTHETIC_SMOKE_TEST 18/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 1, 'synthetic-smoke-test-20260811-content-18', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q19', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 19, '[SYNTHETIC_SMOKE_TEST 19/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 2, 'synthetic-smoke-test-20260811-content-19', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q20', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 20, '[SYNTHETIC_SMOKE_TEST 20/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 3, 'synthetic-smoke-test-20260811-content-20', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q21', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 21, '[SYNTHETIC_SMOKE_TEST 21/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 0, 'synthetic-smoke-test-20260811-content-21', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q22', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 22, '[SYNTHETIC_SMOKE_TEST 22/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 1, 'synthetic-smoke-test-20260811-content-22', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q23', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 23, '[SYNTHETIC_SMOKE_TEST 23/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 2, 'synthetic-smoke-test-20260811-content-23', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q24', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 24, '[SYNTHETIC_SMOKE_TEST 24/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 3, 'synthetic-smoke-test-20260811-content-24', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q25', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 25, '[SYNTHETIC_SMOKE_TEST 25/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 0, 'synthetic-smoke-test-20260811-content-25', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q26', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 26, '[SYNTHETIC_SMOKE_TEST 26/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 1, 'synthetic-smoke-test-20260811-content-26', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q27', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 27, '[SYNTHETIC_SMOKE_TEST 27/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 2, 'synthetic-smoke-test-20260811-content-27', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q28', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 28, '[SYNTHETIC_SMOKE_TEST 28/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 3, 'synthetic-smoke-test-20260811-content-28', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q29', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 29, '[SYNTHETIC_SMOKE_TEST 29/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 0, 'synthetic-smoke-test-20260811-content-29', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]'),
  ('synthetic-smoke-test-20260811-q30', 'pool-synthetic-smoke-test-multiplayer-easy-20260811', 30, '[SYNTHETIC_SMOKE_TEST 30/30] Pergunta artificial exclusiva do teste multiplayer.', 'Opção sintética A', 'Opção sintética B', 'Opção sintética C', 'Opção sintética D', 1, 'synthetic-smoke-test-20260811-content-30', 'ACTIVE', NULL, NULL, NULL, '["SYNTHETIC_SMOKE_TEST"]')
ON CONFLICT(id) DO UPDATE SET
  pool_id = excluded.pool_id,
  active_slot = excluded.active_slot,
  prompt = excluded.prompt,
  option_a = excluded.option_a,
  option_b = excluded.option_b,
  option_c = excluded.option_c,
  option_d = excluded.option_d,
  correct_option = excluded.correct_option,
  content_hash = excluded.content_hash,
  status = excluded.status,
  image_key = NULL,
  image_bytes = NULL,
  image_license = NULL,
  editorial_flags_json = excluded.editorial_flags_json,
  created_by_user_id = NULL,
  verified_by_user_id = NULL,
  updated_at = CURRENT_TIMESTAMP;

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
