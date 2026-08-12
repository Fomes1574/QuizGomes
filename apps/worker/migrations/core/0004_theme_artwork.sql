PRAGMA foreign_keys = ON;

ALTER TABLE themes ADD COLUMN artwork_kind TEXT NOT NULL DEFAULT 'NONE'
  CHECK (artwork_kind IN ('NONE', 'ICON', 'CUSTOM'));
ALTER TABLE themes ADD COLUMN artwork_icon_key TEXT;
ALTER TABLE themes ADD COLUMN artwork_version INTEGER NOT NULL DEFAULT 0
  CHECK (artwork_version >= 0);

CREATE TABLE theme_artwork_blobs (
  theme_id TEXT PRIMARY KEY REFERENCES themes(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  content_type TEXT NOT NULL CHECK (content_type = 'image/webp'),
  width INTEGER NOT NULL CHECK (width BETWEEN 256 AND 512),
  height INTEGER NOT NULL CHECK (height = width),
  byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 61440),
  image_data BLOB NOT NULL CHECK (length(image_data) = byte_length),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER validate_theme_artwork_blob_insert
BEFORE INSERT ON theme_artwork_blobs
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM themes
     WHERE id = NEW.theme_id AND artwork_kind = 'CUSTOM' AND artwork_version = NEW.version
  ) THEN RAISE(ABORT, 'Theme artwork blob is not active') END;
END;

CREATE TRIGGER validate_theme_artwork_blob_update
BEFORE UPDATE ON theme_artwork_blobs
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM themes
     WHERE id = NEW.theme_id AND artwork_kind = 'CUSTOM' AND artwork_version = NEW.version
  ) THEN RAISE(ABORT, 'Theme artwork blob is not active') END;
END;

CREATE TRIGGER delete_inactive_theme_artwork_blob
AFTER UPDATE OF artwork_kind, artwork_version ON themes
WHEN NEW.artwork_kind <> 'CUSTOM'
BEGIN
  DELETE FROM theme_artwork_blobs WHERE theme_id = NEW.id;
END;

CREATE TRIGGER validate_theme_artwork_insert
BEFORE INSERT ON themes
BEGIN
  SELECT CASE
    WHEN NEW.artwork_kind = 'NONE' AND NEW.artwork_icon_key IS NOT NULL
      THEN RAISE(ABORT, 'NONE artwork cannot have an icon key')
    WHEN NEW.artwork_kind = 'ICON' AND (NEW.artwork_icon_key IS NULL OR NEW.artwork_icon_key NOT IN (
      'games', 'movies', 'series', 'music', 'science', 'history', 'geography', 'football',
      'sports', 'books', 'art', 'nature', 'fantasy', 'technology', 'food', 'general'
    )) THEN RAISE(ABORT, 'Invalid standard artwork icon key')
    WHEN NEW.artwork_kind = 'CUSTOM' AND (NEW.artwork_icon_key IS NOT NULL OR NEW.artwork_version < 1)
      THEN RAISE(ABORT, 'Invalid custom artwork state')
  END;
END;

CREATE TRIGGER validate_theme_artwork_update
BEFORE UPDATE OF artwork_kind, artwork_icon_key, artwork_version ON themes
BEGIN
  SELECT CASE
    WHEN NEW.artwork_kind = 'NONE' AND NEW.artwork_icon_key IS NOT NULL
      THEN RAISE(ABORT, 'NONE artwork cannot have an icon key')
    WHEN NEW.artwork_kind = 'ICON' AND (NEW.artwork_icon_key IS NULL OR NEW.artwork_icon_key NOT IN (
      'games', 'movies', 'series', 'music', 'science', 'history', 'geography', 'football',
      'sports', 'books', 'art', 'nature', 'fantasy', 'technology', 'food', 'general'
    )) THEN RAISE(ABORT, 'Invalid standard artwork icon key')
    WHEN NEW.artwork_kind = 'CUSTOM' AND (NEW.artwork_icon_key IS NOT NULL OR NEW.artwork_version < 1)
      THEN RAISE(ABORT, 'Invalid custom artwork state')
  END;
END;
