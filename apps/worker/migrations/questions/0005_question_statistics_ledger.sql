PRAGMA foreign_keys = ON;

-- Idempotência do registro de estatísticas: cada (contexto, rodada, usuário)
-- só pode alimentar question_statistics uma única vez, não importa quantas
-- vezes a finalização best-effort seja repetida (retry de alarme, replay de
-- resultado já aplicado). context_id não referencia matches/challenges
-- porque eles vivem em CORE_DB, um banco D1 separado.
CREATE TABLE question_statistics_ledger (
  context_kind TEXT NOT NULL CHECK (context_kind IN ('MATCH', 'CHALLENGE')),
  context_id TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (context_kind, context_id, round_number, user_id)
);
