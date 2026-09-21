PRAGMA foreign_keys = ON;

-- Edição de uma pergunta ACTIVE nasce como rascunho IN_REVIEW vinculado pelo
-- id da pergunta que ela pretende substituir; a publicada segue servindo
-- normalmente até a aprovação trocar os dois no mesmo slot. Uma pergunta
-- nova (não é edição de nenhuma outra) mantém esta coluna NULL. Sem FK: id
-- de pergunta é validado pela camada de serviço, seguindo o mesmo padrão já
-- usado por `question_pools.theme_id`, que também não referencia outro banco.
ALTER TABLE questions ADD COLUMN replaces_question_id TEXT;

-- Decisão de moderação (aprovar/rejeitar/desativar), espelhando o padrão já
-- usado em `question_reports`: quem decidiu, quando e uma nota opcional.
ALTER TABLE questions ADD COLUMN resolved_by_user_id TEXT;
ALTER TABLE questions ADD COLUMN resolved_at TEXT;
ALTER TABLE questions ADD COLUMN resolution_note TEXT;

CREATE INDEX idx_questions_replaces ON questions(replaces_question_id)
  WHERE replaces_question_id IS NOT NULL;
CREATE INDEX idx_questions_status_created ON questions(status, created_at);
