PRAGMA foreign_keys = ON;

CREATE TABLE user_custom_avatars (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  content_type TEXT,
  width INTEGER,
  height INTEGER,
  byte_length INTEGER,
  image_data BLOB,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (
      active = 0
      AND content_type IS NULL
      AND width IS NULL
      AND height IS NULL
      AND byte_length IS NULL
      AND image_data IS NULL
    )
    OR (
      active = 1
      AND content_type = 'image/webp'
      AND width = 256
      AND height = 256
      AND byte_length BETWEEN 1 AND 51200
      AND image_data IS NOT NULL
      AND length(image_data) = byte_length
    )
  )
);
