PRAGMA foreign_keys = ON;

-- O conjunto de perguntas de uma partida/desafio é selado antes de cada rodada.
-- Participar do contexto, portanto, não prova que a pergunta já foi projetada
-- para aquele usuário. Esta tabela é o recibo autoritativo da entrega da rodada.
CREATE TABLE question_report_views (
  context_kind TEXT NOT NULL CHECK (context_kind IN ('MATCH', 'CHALLENGE')),
  context_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  round_number INTEGER NOT NULL CHECK (round_number BETWEEN 1 AND 12),
  question_id TEXT NOT NULL,
  delivered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (context_kind, context_id, user_id, round_number)
);

CREATE INDEX idx_question_report_views_proof
  ON question_report_views(context_kind, context_id, user_id, round_number, question_id);
