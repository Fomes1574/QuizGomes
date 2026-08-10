PRAGMA foreign_keys = ON;

CREATE TABLE question_pools (
  id TEXT PRIMARY KEY,
  theme_id TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('EASY', 'MEDIUM', 'HARD')),
  active_count INTEGER NOT NULL DEFAULT 0 CHECK (active_count >= 0),
  version INTEGER NOT NULL DEFAULT 1,
  migration_status TEXT NOT NULL DEFAULT 'READY' CHECK (migration_status IN ('READY', 'PENDING', 'RUNNING', 'FAILED')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (theme_id, difficulty)
);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL REFERENCES question_pools(id),
  active_slot INTEGER CHECK (active_slot > 0),
  prompt TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  option_d TEXT NOT NULL,
  correct_option INTEGER NOT NULL CHECK (correct_option BETWEEN 0 AND 3),
  content_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACTIVE', 'IN_REVIEW', 'REJECTED', 'DISABLED')),
  image_key TEXT,
  image_bytes INTEGER CHECK (image_bytes IS NULL OR image_bytes < 102400),
  image_license TEXT,
  editorial_flags_json TEXT NOT NULL DEFAULT '[]',
  created_by_user_id TEXT,
  verified_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (pool_id, active_slot)
);

CREATE INDEX idx_questions_pool_status ON questions(pool_id, status);
CREATE INDEX idx_questions_pool_slot ON questions(pool_id, active_slot) WHERE status = 'ACTIVE';

CREATE TABLE question_sources (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT,
  source_kind TEXT NOT NULL DEFAULT 'WEB' CHECK (source_kind IN ('PRIMARY', 'WEB', 'BOOK', 'OTHER')),
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_question_sources_question ON question_sources(question_id);

CREATE TABLE question_statistics (
  question_id TEXT PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  answer_count INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  option_a_count INTEGER NOT NULL DEFAULT 0,
  option_b_count INTEGER NOT NULL DEFAULT 0,
  option_c_count INTEGER NOT NULL DEFAULT 0,
  option_d_count INTEGER NOT NULL DEFAULT 0,
  total_response_ms INTEGER NOT NULL DEFAULT 0,
  use_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE question_import_batches (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('VALIDATING', 'APPLIED', 'REJECTED')),
  item_count INTEGER NOT NULL,
  error_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

CREATE TABLE pool_slot_migrations (
  id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL REFERENCES question_pools(id),
  from_version INTEGER NOT NULL,
  to_version INTEGER NOT NULL,
  slot_map_blob BLOB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'DONE', 'FAILED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);
