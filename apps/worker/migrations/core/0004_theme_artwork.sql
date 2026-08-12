PRAGMA foreign_keys = ON;

-- Keep this migration free of compound trigger statements. Wrangler sends
-- remote migrations through D1's /query endpoint as one multi-statement string,
-- whose server-side splitter can truncate trigger bodies containing CASE ... END.
ALTER TABLE themes ADD COLUMN artwork_icon_key TEXT
  CHECK (
    artwork_icon_key IS NULL OR artwork_icon_key IN (
      'games', 'movies', 'series', 'music', 'science', 'history', 'geography', 'football',
      'sports', 'books', 'art', 'nature', 'fantasy', 'technology', 'food', 'general'
    )
  );
ALTER TABLE themes ADD COLUMN artwork_version INTEGER NOT NULL DEFAULT 0
  CHECK (artwork_version >= 0);
ALTER TABLE themes ADD COLUMN artwork_kind TEXT NOT NULL DEFAULT 'NONE'
  CHECK (
    (artwork_kind = 'NONE' AND artwork_icon_key IS NULL)
    OR (
      artwork_kind = 'ICON' AND artwork_icon_key IS NOT NULL AND artwork_icon_key IN (
        'games', 'movies', 'series', 'music', 'science', 'history', 'geography', 'football',
        'sports', 'books', 'art', 'nature', 'fantasy', 'technology', 'food', 'general'
      )
    )
    OR (
      artwork_kind = 'CUSTOM' AND artwork_icon_key IS NULL AND artwork_version > 0
    )
  );

-- SQLite requires a UNIQUE parent key for the composite foreign key below.
-- It binds a custom BLOB to the active metadata version without a trigger.
CREATE UNIQUE INDEX themes_artwork_parent_key
  ON themes(id, artwork_version, artwork_kind);

CREATE TABLE theme_artwork_blobs (
  theme_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version > 0),
  artwork_kind TEXT NOT NULL DEFAULT 'CUSTOM' CHECK (artwork_kind = 'CUSTOM'),
  content_type TEXT NOT NULL CHECK (content_type = 'image/webp'),
  width INTEGER NOT NULL CHECK (width BETWEEN 256 AND 512),
  height INTEGER NOT NULL CHECK (height = width),
  byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 61440),
  image_data BLOB NOT NULL CHECK (length(image_data) = byte_length),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (theme_id, version, artwork_kind)
    REFERENCES themes(id, artwork_version, artwork_kind)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);
