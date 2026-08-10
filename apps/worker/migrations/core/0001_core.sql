PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  firebase_uid TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  disabled_at TEXT
);

CREATE TABLE user_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  public_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 2 AND 32),
  photo_url TEXT,
  avatar_key TEXT NOT NULL DEFAULT 'default-red',
  equipped_frame_id TEXT,
  equipped_title_id TEXT,
  total_xp INTEGER NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
  profile_version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_profiles_display_name ON user_profiles(display_name COLLATE NOCASE);

CREATE TABLE user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('ADMIN')),
  granted_by_user_id TEXT REFERENCES users(id),
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, role)
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_categories_status_sort ON categories(status, sort_order, name);

CREATE TABLE themes (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL CHECK (length(description) <= 240),
  cover_image_key TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACTIVE', 'REJECTED', 'DISABLED')),
  origin TEXT NOT NULL CHECK (origin IN ('OFFICIAL', 'USER')),
  created_by_user_id TEXT REFERENCES users(id),
  question_shard_id TEXT NOT NULL DEFAULT 'questions-01',
  active_question_count INTEGER NOT NULL DEFAULT 0 CHECK (active_question_count >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_themes_category_status ON themes(category_id, status, name);
CREATE INDEX idx_themes_status_name ON themes(status, name);

CREATE TABLE theme_ownership (
  theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ownership_role TEXT NOT NULL DEFAULT 'OWNER' CHECK (ownership_role IN ('OWNER')),
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (theme_id, user_id)
);

CREATE TABLE theme_rankings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  knowledge INTEGER NOT NULL DEFAULT 0 CHECK (knowledge BETWEEN 0 AND 999999),
  ranked_matches INTEGER NOT NULL DEFAULT 0 CHECK (ranked_matches >= 0),
  wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses INTEGER NOT NULL DEFAULT 0 CHECK (losses >= 0),
  draws INTEGER NOT NULL DEFAULT 0 CHECK (draws >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, theme_id)
);

CREATE INDEX idx_theme_rankings_leaderboard ON theme_rankings(theme_id, knowledge DESC);

CREATE TABLE friendships (
  user_low_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (user_low_id < user_high_id),
  PRIMARY KEY (user_low_id, user_high_id)
);

CREATE TABLE friend_requests (
  id TEXT PRIMARY KEY,
  sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  CHECK (sender_user_id <> recipient_user_id)
);

CREATE UNIQUE INDEX idx_friend_requests_pending_pair
  ON friend_requests(sender_user_id, recipient_user_id)
  WHERE status = 'PENDING';

CREATE INDEX idx_friend_requests_recipient ON friend_requests(recipient_user_id, status, created_at);

CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  challenger_user_id TEXT NOT NULL REFERENCES users(id),
  challenged_user_id TEXT NOT NULL REFERENCES users(id),
  theme_id TEXT NOT NULL REFERENCES themes(id),
  difficulty TEXT NOT NULL CHECK (difficulty IN ('EASY', 'MEDIUM', 'HARD')),
  mode TEXT NOT NULL CHECK (mode IN ('CASUAL', 'RANKED')),
  kind TEXT NOT NULL CHECK (kind IN ('LIVE', 'ASYNC')),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED', 'STARTED', 'FINISHED')),
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (challenger_user_id <> challenged_user_id)
);

CREATE UNIQUE INDEX idx_async_pending_pair
  ON challenges(
    CASE WHEN challenger_user_id < challenged_user_id THEN challenger_user_id ELSE challenged_user_id END,
    CASE WHEN challenger_user_id < challenged_user_id THEN challenged_user_id ELSE challenger_user_id END
  )
  WHERE kind = 'ASYNC' AND status IN ('PENDING', 'ACCEPTED', 'STARTED');

CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  theme_id TEXT NOT NULL REFERENCES themes(id),
  difficulty TEXT NOT NULL CHECK (difficulty IN ('EASY', 'MEDIUM', 'HARD')),
  mode TEXT NOT NULL CHECK (mode IN ('CASUAL', 'RANKED')),
  kind TEXT NOT NULL CHECK (kind IN ('MATCHMAKING', 'DIRECT_LIVE', 'ASYNC')),
  status TEXT NOT NULL CHECK (status IN ('PREPARING', 'PLAYING', 'WAITING_SECOND', 'FINISHED', 'VOID')),
  question_shard_id TEXT NOT NULL,
  room_key TEXT,
  winner_user_id TEXT REFERENCES users(id),
  result_reason TEXT,
  result_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  finished_at TEXT
);

CREATE INDEX idx_matches_status_created ON matches(status, created_at);

CREATE TABLE match_players (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  seat INTEGER NOT NULL CHECK (seat IN (1, 2)),
  score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0),
  knowledge_before INTEGER CHECK (knowledge_before BETWEEN 0 AND 999999),
  knowledge_delta INTEGER,
  xp_delta INTEGER NOT NULL DEFAULT 0 CHECK (xp_delta >= 0),
  connection_outcome TEXT CHECK (connection_outcome IN ('CONNECTED', 'INDIVIDUAL_DISCONNECT', 'SYSTEM_FAILURE')),
  completed_at TEXT,
  PRIMARY KEY (match_id, user_id),
  UNIQUE (match_id, seat)
);

CREATE TABLE match_questions (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL CHECK (round_number BETWEEN 1 AND 15),
  question_id TEXT NOT NULL,
  pool_slot INTEGER NOT NULL CHECK (pool_slot > 0),
  public_snapshot_json TEXT NOT NULL,
  correct_option_sealed TEXT NOT NULL,
  PRIMARY KEY (match_id, round_number),
  UNIQUE (match_id, question_id)
);

CREATE TABLE match_answers (
  match_id TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  selected_option INTEGER CHECK (selected_option BETWEEN 0 AND 3),
  remaining_ms INTEGER NOT NULL CHECK (remaining_ms BETWEEN 0 AND 10000),
  is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 20),
  answered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (match_id, round_number, user_id),
  FOREIGN KEY (match_id, round_number) REFERENCES match_questions(match_id, round_number) ON DELETE CASCADE
);

CREATE TABLE result_ledger (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  result_version INTEGER NOT NULL,
  knowledge_delta INTEGER NOT NULL,
  xp_delta INTEGER NOT NULL,
  applied INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0, 1)),
  applied_at TEXT,
  PRIMARY KEY (match_id, user_id),
  UNIQUE (match_id, user_id, result_version)
);

CREATE TABLE user_pool_states (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pool_id TEXT NOT NULL,
  pool_version INTEGER NOT NULL DEFAULT 1,
  state_blob BLOB NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, pool_id)
);

CREATE TABLE cosmetics (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('FRAME', 'TITLE', 'AVATAR')),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'LOCKED' CHECK (status IN ('LOCKED', 'AVAILABLE', 'DISABLED')),
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE cosmetic_inventory (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cosmetic_id TEXT NOT NULL REFERENCES cosmetics(id),
  unlocked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source TEXT NOT NULL,
  PRIMARY KEY (user_id, cosmetic_id)
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
