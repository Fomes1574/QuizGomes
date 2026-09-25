-- A rota pública de fotos só serve chaves referenciadas por uma pergunta, e a
-- limpeza de objetos órfãos pergunta se ainda há referência. Sem índice, cada
-- consulta varreria o catálogo inteiro (até ~1.000.000 de linhas). O índice é
-- parcial: perguntas sem foto não ocupam espaço nele.
CREATE INDEX IF NOT EXISTS idx_questions_image_key ON questions(image_key) WHERE image_key IS NOT NULL;
