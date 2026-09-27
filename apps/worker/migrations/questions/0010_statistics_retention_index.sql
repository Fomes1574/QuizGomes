-- A limpeza automática apaga recibos de estatística já aplicados com mais de
-- 15 dias. O índice é parcial: recibos pendentes (applied = 0) nunca entram
-- nele nem na limpeza, porque ainda precisam ser reaplicados.
CREATE INDEX IF NOT EXISTS idx_question_statistics_ledger_applied_recorded
  ON question_statistics_ledger(recorded_at) WHERE applied = 1;
