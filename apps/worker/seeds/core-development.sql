-- FIXTURES SINTÉTICAS. NUNCA executar em produção.
INSERT OR IGNORE INTO categories (id, slug, name, sort_order) VALUES
  ('cat-games', 'games', 'Games', 10),
  ('cat-filmes', 'filmes', 'Filmes', 20),
  ('cat-ciencia', 'ciencia', 'Ciência', 30),
  ('cat-historia', 'historia', 'História', 40);

INSERT OR IGNORE INTO themes (
  id, category_id, slug, name, description, status, origin, question_shard_id, active_question_count
) VALUES
  ('theme-games-general', 'cat-games', 'games-em-geral', 'Games em Geral', 'Fixture sintética para validar a experiência de desenvolvimento.', 'ACTIVE', 'OFFICIAL', 'questions-01', 8),
  ('theme-elden-ring', 'cat-games', 'elden-ring', 'Elden Ring', 'Slot editorial de desenvolvimento; ainda sem perguntas reais publicadas.', 'ACTIVE', 'OFFICIAL', 'questions-01', 0),
  ('theme-filmes-general', 'cat-filmes', 'filmes-em-geral', 'Filmes em Geral', 'Slot editorial de desenvolvimento; ainda sem perguntas reais publicadas.', 'ACTIVE', 'OFFICIAL', 'questions-01', 0),
  ('theme-ciencia-general', 'cat-ciencia', 'ciencia-em-geral', 'Ciência em Geral', 'Slot editorial de desenvolvimento; ainda sem perguntas reais publicadas.', 'ACTIVE', 'OFFICIAL', 'questions-01', 0);
