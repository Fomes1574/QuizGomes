PRAGMA foreign_keys = ON;

-- Silenciamento por amizade: suprime apenas notificações. Não desfaz amizade,
-- não bloqueia, não esconde presença e não impede desafio.
CREATE TABLE friendship_mutes (
  muter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muted_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (muter_user_id <> muted_user_id),
  PRIMARY KEY (muter_user_id, muted_user_id)
);

-- Índice de contagem de amizades por usuário, para o limite de 200 sem full scan.
CREATE INDEX idx_friendships_high ON friendships(user_high_id);

-- A tabela de desafios do M3 nunca recebeu escrita: nenhuma rota, repositório ou
-- Durable Object a referencia. É substituída aqui pelo modelo unificado M9C+M10,
-- forward-only, sem perda de dado existente.
DROP INDEX IF EXISTS idx_async_pending_pair;
DROP TABLE IF EXISTS challenges;

CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  pair_low_id TEXT NOT NULL REFERENCES users(id),
  pair_high_id TEXT NOT NULL REFERENCES users(id),
  first_player_user_id TEXT NOT NULL REFERENCES users(id),
  second_player_user_id TEXT NOT NULL REFERENCES users(id),
  theme_id TEXT NOT NULL REFERENCES themes(id),
  difficulty TEXT NOT NULL CHECK (difficulty IN ('EASY', 'MEDIUM', 'HARD')),
  kind TEXT NOT NULL CHECK (kind IN ('ASYNC', 'DIRECT')),
  status TEXT NOT NULL CHECK (status IN (
    'PENDING_DIRECT',
    'PREPARING',
    'ACTIVE',
    'FIRST_PLAYER_ACTIVE',
    'WAITING_FOR_SECOND',
    'SECOND_PLAYER_ACTIVE',
    'CANCELLED',
    'DECLINED',
    'EXPIRED',
    'VOID',
    'COMPLETED'
  )),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  match_id TEXT,
  pool_id TEXT,
  pool_version INTEGER,
  expires_at TEXT,
  second_player_agreed INTEGER NOT NULL DEFAULT 0 CHECK (second_player_agreed IN (0, 1)),
  first_half_sealed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (pair_low_id < pair_high_id),
  CHECK (first_player_user_id <> second_player_user_id),
  CHECK (kind <> 'DIRECT' OR second_player_agreed = 0)
);

-- Barreira final da regra "no máximo um desafio ativo por dupla não ordenada".
CREATE UNIQUE INDEX idx_challenges_live_pair
  ON challenges(pair_low_id, pair_high_id)
  WHERE status IN (
    'PENDING_DIRECT',
    'PREPARING',
    'ACTIVE',
    'FIRST_PLAYER_ACTIVE',
    'WAITING_FOR_SECOND',
    'SECOND_PLAYER_ACTIVE'
  );

CREATE INDEX idx_challenges_second_player
  ON challenges(second_player_user_id, status, created_at);

CREATE INDEX idx_challenges_first_player
  ON challenges(first_player_user_id, status, created_at);

CREATE INDEX idx_challenges_direct_expiry
  ON challenges(expires_at)
  WHERE status = 'PENDING_DIRECT';

-- Conjunto selado do desafio assíncrono: mesma ordem e mesmas alternativas para os dois.
CREATE TABLE challenge_questions (
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL CHECK (round_number BETWEEN 1 AND 12),
  question_id TEXT NOT NULL,
  pool_slot INTEGER NOT NULL CHECK (pool_slot > 0),
  public_snapshot_json TEXT NOT NULL,
  correct_option INTEGER NOT NULL CHECK (correct_option BETWEEN 0 AND 3),
  PRIMARY KEY (challenge_id, round_number),
  UNIQUE (challenge_id, question_id)
);

-- Metade selada de cada jogador. A metade do primeiro jogador nunca é lida pelo
-- segundo antes da resolução da rodada correspondente.
CREATE TABLE challenge_answers (
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  selected_option INTEGER CHECK (selected_option BETWEEN 0 AND 3),
  remaining_ms INTEGER NOT NULL CHECK (remaining_ms BETWEEN 0 AND 10000),
  is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 20),
  answered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (challenge_id, round_number, user_id),
  FOREIGN KEY (challenge_id, round_number)
    REFERENCES challenge_questions(challenge_id, round_number) ON DELETE CASCADE
);

CREATE INDEX idx_challenge_answers_user
  ON challenge_answers(challenge_id, user_id, round_number);
