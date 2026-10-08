PRAGMA foreign_keys = ON;

-- Missões semanais da Rankeada (decisão do proprietário, 2026-10-08). A
-- semana do jogo começa na segunda à 0h de Brasília; `week_key` é essa
-- segunda (YYYY-MM-DD). As linhas nascem sob demanda, uma vez por pessoa e
-- semana, e a limpeza automática apaga semanas antigas como faz com o dia.
CREATE TABLE user_weekly_missions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_key TEXT NOT NULL CHECK (length(week_key) = 10),
  mission_type TEXT NOT NULL CHECK (mission_type IN ('PLAY_RANKED', 'WIN_RANKED', 'CORRECT_RANKED')),
  target INTEGER NOT NULL CHECK (target > 0),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= target),
  completed_at TEXT,
  PRIMARY KEY (user_id, week_key, mission_type)
);

CREATE INDEX idx_user_weekly_missions_week ON user_weekly_missions(week_key);

-- Objetivo escolhido na vitrine: o título que a pessoa decidiu perseguir.
-- Só um identificador de título, validado pelo Worker.
ALTER TABLE user_profiles ADD COLUMN goal_title_id TEXT CHECK (goal_title_id IS NULL OR length(goal_title_id) <= 200);
