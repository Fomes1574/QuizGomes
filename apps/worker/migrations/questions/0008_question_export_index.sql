-- A exportação administrativa percorre um tema pelo UUID da pergunta, sem
-- OFFSET e sem carregar o catálogo inteiro. Este índice mantém a paginação
-- estável mesmo para temas muito grandes.
CREATE INDEX IF NOT EXISTS idx_questions_pool_id ON questions(pool_id, id);
