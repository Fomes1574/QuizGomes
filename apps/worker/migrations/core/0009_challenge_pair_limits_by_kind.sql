PRAGMA foreign_keys = ON;

-- A 0008 travava a dupla por qualquer desafio vivo, então um assíncrono aguardando
-- resposta impedia um convite imediato entre as mesmas duas pessoas. A regra correta
-- separa os tipos: no máximo um ASYNC vivo por dupla E no máximo um DIRECT vivo por
-- dupla, podendo coexistir. Forward-only: a 0008 permanece intocada.
DROP INDEX IF EXISTS idx_challenges_live_pair;

CREATE UNIQUE INDEX idx_challenges_live_pair_async
  ON challenges(pair_low_id, pair_high_id)
  WHERE kind = 'ASYNC' AND status IN (
    'PENDING_DIRECT',
    'PREPARING',
    'ACTIVE',
    'FIRST_PLAYER_ACTIVE',
    'WAITING_FOR_SECOND',
    'SECOND_PLAYER_ACTIVE'
  );

-- Continua impedindo vários convites imediatos idênticos para a mesma dupla.
CREATE UNIQUE INDEX idx_challenges_live_pair_direct
  ON challenges(pair_low_id, pair_high_id)
  WHERE kind = 'DIRECT' AND status IN (
    'PENDING_DIRECT',
    'PREPARING',
    'ACTIVE',
    'FIRST_PLAYER_ACTIVE',
    'WAITING_FOR_SECOND',
    'SECOND_PLAYER_ACTIVE'
  );

-- Lookup por dupla e tipo, usado na criação e na limpeza por unfriend/bloqueio.
CREATE INDEX idx_challenges_pair_kind_status
  ON challenges(pair_low_id, pair_high_id, kind, status);
