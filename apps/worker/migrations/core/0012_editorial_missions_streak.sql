PRAGMA foreign_keys = ON;

-- Pipeline editorial M11: aprovação/edição/desativação de categoria e tema
-- usam CAS por revisão, como o resto do produto (challenges, matches). Um
-- ADMIN que lê o estado antigo nunca sobrescreve silenciosamente a decisão
-- de outra sessão; a escrita perdedora recebe zero linhas afetadas.
ALTER TABLE categories ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE themes ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

-- Motivo visível ao proponente quando o tema USER é rejeitado; nunca aparece
-- para tema OFFICIAL, que não passa por este fluxo de proposta.
ALTER TABLE themes ADD COLUMN rejection_note TEXT;

-- Missões diárias: exatamente três por usuário/dia, geradas sob demanda na
-- primeira leitura do dia (INSERT OR IGNORE por chave primária) e nunca por
-- um job periódico. Progresso só avança por evento autoritativo já persistido
-- (partida válida concluída, resposta registrada, acerto registrado); uma
-- partida VOID/cancelada nunca chega a gerar esse evento.
CREATE TABLE user_daily_missions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_key TEXT NOT NULL,
  mission_type TEXT NOT NULL CHECK (mission_type IN ('PLAY_MATCH', 'ANSWER_QUESTIONS', 'CORRECT_ANSWERS')),
  target INTEGER NOT NULL CHECK (target > 0),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0),
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, day_key, mission_type)
);

CREATE INDEX idx_user_daily_missions_user_day ON user_daily_missions(user_id, day_key);

-- Streak por usuário+tema. Um dia sem atividade zera o atual, nunca o
-- recorde; `last_active_day` é a chave de dia UTC (`YYYY-MM-DD`) do último
-- evento que avançou o streak, decidida inteiramente pelo servidor.
CREATE TABLE user_theme_streaks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  current_streak INTEGER NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
  best_streak INTEGER NOT NULL DEFAULT 0 CHECK (best_streak >= current_streak),
  last_active_day TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, theme_id)
);

-- Fallback determinístico do "tema ativo" a exibir (maior streak atual,
-- desempate por theme_id): uma leitura indexada, nunca ORDER BY RANDOM() nem
-- varredura completa dos temas do usuário.
CREATE INDEX idx_user_theme_streaks_active
  ON user_theme_streaks(user_id, current_streak DESC, theme_id);
