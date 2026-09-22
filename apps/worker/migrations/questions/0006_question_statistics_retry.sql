PRAGMA foreign_keys = ON;

-- O recibo só é definitivo depois do incremento agregado. Registros antigos
-- já foram tratados pela versão anterior e permanecem aplicados; novos eventos
-- entram explicitamente como pendentes e são concluídos no mesmo batch D1.
ALTER TABLE question_statistics_ledger
  ADD COLUMN applied INTEGER NOT NULL DEFAULT 1 CHECK (applied IN (0, 1));
