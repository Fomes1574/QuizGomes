-- FIXTURES SINTÉTICAS. Não representam trivia real e NUNCA devem ir para produção.
INSERT OR IGNORE INTO question_pools (id, theme_id, difficulty, active_count) VALUES
  ('pool-games-general-easy', 'theme-games-general', 'EASY', 8),
  ('pool-games-general-medium', 'theme-games-general', 'MEDIUM', 0),
  ('pool-games-general-hard', 'theme-games-general', 'HARD', 0);

INSERT OR IGNORE INTO questions (
  id, pool_id, active_slot, prompt, option_a, option_b, option_c, option_d, correct_option, content_hash, status, editorial_flags_json
) VALUES
  ('fixture-q-01', 'pool-games-general-easy', 1, '[FIXTURE] Qual alternativa foi marcada como correta no teste 01?', 'Alternativa A', 'Alternativa B', 'Alternativa C', 'Alternativa D', 0, 'fixture-hash-01', 'ACTIVE', '["SYNTHETIC_FIXTURE"]'),
  ('fixture-q-02', 'pool-games-general-easy', 2, '[FIXTURE] Qual alternativa foi marcada como correta no teste 02?', 'Alternativa A', 'Alternativa B', 'Alternativa C', 'Alternativa D', 1, 'fixture-hash-02', 'ACTIVE', '["SYNTHETIC_FIXTURE"]'),
  ('fixture-q-03', 'pool-games-general-easy', 3, '[FIXTURE] Qual alternativa foi marcada como correta no teste 03?', 'Alternativa A', 'Alternativa B', 'Alternativa C', 'Alternativa D', 2, 'fixture-hash-03', 'ACTIVE', '["SYNTHETIC_FIXTURE"]'),
  ('fixture-q-04', 'pool-games-general-easy', 4, '[FIXTURE] Qual alternativa foi marcada como correta no teste 04?', 'Alternativa A', 'Alternativa B', 'Alternativa C', 'Alternativa D', 3, 'fixture-hash-04', 'ACTIVE', '["SYNTHETIC_FIXTURE"]'),
  ('fixture-q-05', 'pool-games-general-easy', 5, '[FIXTURE] Qual alternativa foi marcada como correta no teste 05?', 'Alternativa A', 'Alternativa B', 'Alternativa C', 'Alternativa D', 0, 'fixture-hash-05', 'ACTIVE', '["SYNTHETIC_FIXTURE"]'),
  ('fixture-q-06', 'pool-games-general-easy', 6, '[FIXTURE] Qual alternativa foi marcada como correta no teste 06?', 'Alternativa A', 'Alternativa B', 'Alternativa C', 'Alternativa D', 1, 'fixture-hash-06', 'ACTIVE', '["SYNTHETIC_FIXTURE"]'),
  ('fixture-q-07', 'pool-games-general-easy', 7, '[FIXTURE] Qual alternativa foi marcada como correta no teste 07?', 'Alternativa A', 'Alternativa B', 'Alternativa C', 'Alternativa D', 2, 'fixture-hash-07', 'ACTIVE', '["SYNTHETIC_FIXTURE"]'),
  ('fixture-q-08', 'pool-games-general-easy', 8, '[FIXTURE] Qual alternativa foi marcada como correta no teste 08?', 'Alternativa A', 'Alternativa B', 'Alternativa C', 'Alternativa D', 3, 'fixture-hash-08', 'ACTIVE', '["SYNTHETIC_FIXTURE"]');

INSERT OR IGNORE INTO question_sources (id, question_id, url, title, source_kind, verified_at)
SELECT 'source-' || id, id, 'fixture://synthetic', 'Fixture sintética local', 'OTHER', CURRENT_TIMESTAMP
FROM questions
WHERE id LIKE 'fixture-%';
