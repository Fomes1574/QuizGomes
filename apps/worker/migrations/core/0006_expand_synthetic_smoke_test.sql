PRAGMA foreign_keys = ON;

-- Espelha no catálogo Core somente a ampliação do tema interno reservado.
UPDATE themes
   SET active_question_count = 250,
       updated_at = CURRENT_TIMESTAMP
 WHERE id = 'theme-synthetic-smoke-test-multiplayer-20260811'
   AND description = 'INTERNO E TEMPORÁRIO · SYNTHETIC_SMOKE_TEST · Não contém trivia real.'
   AND question_shard_id = 'questions-01';
