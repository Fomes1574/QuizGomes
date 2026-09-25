PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

-- Avatares novos passam a morar no R2 (bucket privado já existente, prefixo
-- "avatars/"), e não mais como BLOB no D1, antes que ~10 mil avatares de
-- 50 KB encham os 500 MB do banco. Avatares antigos em BLOB continuam válidos
-- e migram sozinhos quando o jogador troca a foto.
--
-- O SQLite não altera CHECK: a tabela é reconstruída preservando todas as
-- linhas, versões e a FK para users. Nenhuma outra tabela referencia esta.
CREATE TABLE user_custom_avatars_next (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  content_type TEXT,
  width INTEGER,
  height INTEGER,
  byte_length INTEGER,
  image_data BLOB,
  object_key TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (
      active = 0
      AND content_type IS NULL
      AND width IS NULL
      AND height IS NULL
      AND byte_length IS NULL
      AND image_data IS NULL
      AND object_key IS NULL
    )
    OR (
      active = 1
      AND content_type = 'image/webp'
      AND width = 256
      AND height = 256
      AND byte_length BETWEEN 1 AND 51200
      AND (
        (image_data IS NOT NULL AND length(image_data) = byte_length AND object_key IS NULL)
        OR (
          image_data IS NULL
          AND object_key IS NOT NULL
          AND object_key = 'avatars/' || user_id || '/v' || version || '.webp'
        )
      )
    )
  )
);

INSERT INTO user_custom_avatars_next (
  user_id, version, active, content_type, width, height, byte_length, image_data, object_key, updated_at
)
SELECT user_id, version, active, content_type, width, height, byte_length, image_data, NULL, updated_at
  FROM user_custom_avatars;

DROP TABLE user_custom_avatars;
ALTER TABLE user_custom_avatars_next RENAME TO user_custom_avatars;
