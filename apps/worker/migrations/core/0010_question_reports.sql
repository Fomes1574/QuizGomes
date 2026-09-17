PRAGMA foreign_keys = ON;

-- Denúncia de pergunta. O contexto (MATCH ou CHALLENGE) e a rodada amarram a
-- denúncia ao snapshot selado que o Worker valida contra match_questions ou
-- challenge_questions: o denunciante precisa mesmo ter recebido aquela pergunta
-- naquele contexto. question_id não tem FK porque perguntas vivem no shard
-- QUESTIONS_DB, um banco D1 separado.
CREATE TABLE question_reports (
  id TEXT PRIMARY KEY,
  reporter_user_id TEXT NOT NULL REFERENCES users(id),
  question_id TEXT NOT NULL,
  context_kind TEXT NOT NULL CHECK (context_kind IN ('MATCH', 'CHALLENGE')),
  context_id TEXT NOT NULL,
  round_number INTEGER NOT NULL CHECK (round_number BETWEEN 1 AND 12),
  reason TEXT NOT NULL CHECK (reason IN (
    'INCORRECT', 'AMBIGUOUS', 'OUTDATED', 'TEXT', 'SOURCE', 'IMAGE', 'OTHER'
  )),
  note TEXT CHECK (note IS NULL OR length(note) <= 280),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED')),
  resolution_note TEXT CHECK (resolution_note IS NULL OR length(resolution_note) <= 280),
  resolved_by_user_id TEXT REFERENCES users(id),
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Idempotência: uma denúncia OPEN/IN_REVIEW equivalente por usuário e por
-- contexto+rodada. Depois de RESOLVED/DISMISSED, a mesma pessoa pode denunciar
-- de novo — não é um bloqueio permanente.
CREATE UNIQUE INDEX idx_question_reports_open_per_user_context
  ON question_reports(reporter_user_id, context_kind, context_id, round_number)
  WHERE status IN ('OPEN', 'IN_REVIEW');

-- Fila de moderação: filtro por status, mais recentes primeiro, paginação por cursor.
CREATE INDEX idx_question_reports_status_created
  ON question_reports(status, created_at DESC, id);

-- Histórico de denúncias por pergunta, para o admin ver o quadro completo.
CREATE INDEX idx_question_reports_question
  ON question_reports(question_id, status);

-- Teto técnico de criação por usuário numa janela curta.
CREATE INDEX idx_question_reports_reporter_created
  ON question_reports(reporter_user_id, created_at);
