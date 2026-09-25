PRAGMA foreign_keys = ON;

-- "Seu amigo está na fila de X agora": aviso opcional (desligado por padrão).
CREATE TABLE friend_queue_alert_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Último aviso por dupla. Serve de limite de frequência para quem recebe
-- (um aviso por hora, de qualquer amigo) e para quem entra na fila (uma
-- rodada de avisos a cada 30 min), sem guardar histórico além disso.
CREATE TABLE friend_queue_alerts (
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_at_ms INTEGER NOT NULL CHECK (sent_at_ms > 0),
  PRIMARY KEY (recipient_user_id, sender_user_id)
);

CREATE INDEX idx_friend_queue_alerts_recipient ON friend_queue_alerts(recipient_user_id, sent_at_ms);
CREATE INDEX idx_friend_queue_alerts_sender ON friend_queue_alerts(sender_user_id, sent_at_ms);
