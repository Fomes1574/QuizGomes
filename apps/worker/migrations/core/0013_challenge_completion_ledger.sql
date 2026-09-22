PRAGMA foreign_keys = ON;

-- Corretiva DIRECT/ASYNC: hoje `challenges.status = 'COMPLETED'` é gravado
-- numa escrita e o XP dos dois jogadores em outra, separada — uma falha entre
-- as duas perde XP para sempre, sem nenhum jeito de tentar de novo (o CAS de
-- `sealHalf` só aplica a transição uma vez; uma segunda chamada devolve
-- ALREADY_APPLIED e, antes desta migration, nunca tentava o XP de novo).
--
-- `challenge_xp_ledger` segue o mesmo desenho de `result_ledger` do MatchRoom:
-- uma linha por jogador, `xp_delta` já calculado e `applied` como o gatilho
-- que condiciona a escrita em `user_profiles` via `WHERE EXISTS`. Diferente do
-- MatchRoom, aqui o XP pode ser recalculado a qualquer momento a partir de
-- `challenge_answers` (nunca apagado para um desafio COMPLETED), então a
-- aplicação é feita por um método de repositório dedicado, chamado de novo a
-- cada `trySeal` (inclusive em retry após COMPLETED já persistido) em vez de
-- depender de uma única escrita transacional.
CREATE TABLE challenge_xp_ledger (
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  xp_delta INTEGER NOT NULL CHECK (xp_delta >= 0),
  applied INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0, 1)),
  applied_at TEXT,
  PRIMARY KEY (challenge_id, user_id)
);

-- Estatística de pergunta já tem seu próprio ledger (`question_statistics_ledger`,
-- em QUESTIONS_DB) e é sempre chamada de novo com segurança. Missão/streak
-- (`recordValidPlay`) não é idempotente por si — chamá-la duas vezes para o
-- mesmo evento soma progresso duas vezes — então esta tabela é o gatilho que
-- garante que ela só roda uma vez por metade selada, mesmo com retry.
CREATE TABLE challenge_progression_ledger (
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (challenge_id, user_id)
);
