PRAGMA foreign_keys = ON;

-- A 0013 criou o recibo de progressão antes de aplicar missões/streak. O
-- marcador pendente permite retomar uma queda sem duplicar o evento. Linhas
-- antigas receberam o efeito pela versão anterior, por isso entram como já
-- aplicadas; as novas são criadas explicitamente com applied = 0.
ALTER TABLE challenge_progression_ledger
  ADD COLUMN applied INTEGER NOT NULL DEFAULT 1 CHECK (applied IN (0, 1));
