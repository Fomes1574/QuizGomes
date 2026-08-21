PRAGMA foreign_keys = ON;

ALTER TABLE friend_requests ADD COLUMN resolution_key TEXT;

CREATE UNIQUE INDEX idx_friend_requests_pending_unordered_pair
  ON friend_requests(
    CASE WHEN sender_user_id < recipient_user_id THEN sender_user_id ELSE recipient_user_id END,
    CASE WHEN sender_user_id < recipient_user_id THEN recipient_user_id ELSE sender_user_id END
  )
  WHERE status = 'PENDING';

CREATE INDEX idx_friend_requests_sender_status_created
  ON friend_requests(sender_user_id, status, created_at);

CREATE TABLE friend_request_pair_state (
  requester_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rejection_count INTEGER NOT NULL DEFAULT 0 CHECK (rejection_count BETWEEN 0 AND 3),
  cooldown_until TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (requester_user_id <> target_user_id),
  CHECK (
    (rejection_count < 3 AND cooldown_until IS NULL)
    OR (rejection_count = 3 AND cooldown_until IS NOT NULL)
  ),
  PRIMARY KEY (requester_user_id, target_user_id)
);

CREATE TABLE user_blocks (
  blocker_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (blocker_user_id <> blocked_user_id),
  PRIMARY KEY (blocker_user_id, blocked_user_id)
);

CREATE INDEX idx_user_blocks_blocked_blocker
  ON user_blocks(blocked_user_id, blocker_user_id);

CREATE TABLE push_installations (
  installation_id TEXT PRIMARY KEY CHECK (length(installation_id) BETWEEN 10 AND 200),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_success_at TEXT
);

CREATE INDEX idx_push_installations_user_enabled
  ON push_installations(user_id, enabled);
