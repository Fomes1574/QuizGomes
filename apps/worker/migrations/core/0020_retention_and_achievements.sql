PRAGMA foreign_keys = ON;

-- Limpeza automática (Cron Trigger). Detalhes de partida e desafio vencem em
-- 15 dias; sem estes índices cada rodada da limpeza varreria a tabela inteira.
CREATE INDEX IF NOT EXISTS idx_question_report_views_delivered ON question_report_views(delivered_at);
CREATE INDEX IF NOT EXISTS idx_user_daily_missions_day ON user_daily_missions(day_key);
CREATE INDEX IF NOT EXISTS idx_friend_queue_alerts_sent ON friend_queue_alerts(sent_at_ms);

-- Aviso "sua ofensiva acaba hoje": busca quem jogou ontem e ainda não hoje.
CREATE INDEX IF NOT EXISTS idx_user_theme_streaks_day ON user_theme_streaks(last_active_day, current_streak);

-- Aviso de ofensiva em risco: opcional (desligado por padrão), no máximo um
-- por dia. `last_sent_day` é o dia de São Paulo do último envio.
CREATE TABLE streak_reminder_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  last_sent_day TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Conquistas permanentes (nunca entram na limpeza). `seen_at` nulo significa
-- que o cartão de parabéns ainda não foi mostrado ao jogador.
CREATE TABLE user_achievements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL CHECK (length(achievement_id) BETWEEN 3 AND 40),
  theme_id TEXT REFERENCES themes(id),
  value INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0),
  unlocked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  seen_at TEXT,
  PRIMARY KEY (user_id, achievement_id)
);

CREATE INDEX idx_user_achievements_unseen ON user_achievements(user_id, unlocked_at) WHERE seen_at IS NULL;

-- Molduras de recompensa. Só são ganhas por conquista; nunca vendidas.
INSERT OR IGNORE INTO cosmetics (id, kind, name, status, metadata_json) VALUES
  ('frame-missions', 'FRAME', 'Dever cumprido', 'AVAILABLE', '{"achievement":"MISSIONS_DAY"}'),
  ('frame-streak-7', 'FRAME', 'Chama acesa', 'AVAILABLE', '{"achievement":"STREAK_7"}'),
  ('frame-record', 'FRAME', 'Recordista', 'AVAILABLE', '{"achievement":"PERSONAL_RECORD"}'),
  ('frame-streak-100', 'FRAME', 'Centenário', 'AVAILABLE', '{"achievement":"STREAK_100"}'),
  ('frame-streak-365', 'FRAME', 'Um ano em chamas', 'AVAILABLE', '{"achievement":"STREAK_365"}'),
  ('frame-streak-730', 'FRAME', 'Lenda de dois anos', 'AVAILABLE', '{"achievement":"STREAK_730"}');
