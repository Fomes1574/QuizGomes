PRAGMA foreign_keys = ON;

ALTER TABLE matches ADD COLUMN pool_id TEXT;
ALTER TABLE matches ADD COLUMN pool_version INTEGER CHECK (pool_version IS NULL OR pool_version > 0);

CREATE TABLE active_match_players (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (match_id, user_id)
);

CREATE INDEX idx_active_match_players_match ON active_match_players(match_id);
