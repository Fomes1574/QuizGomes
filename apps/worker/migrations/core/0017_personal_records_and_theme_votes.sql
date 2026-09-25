PRAGMA foreign_keys = ON;

-- Recorde pessoal por tema e modo. Normal (7 perguntas) e Rankeada (10) não são
-- comparáveis entre si, por isso cada modo tem o seu. Só partidas ao vivo
-- concluídas contam; a linha guarda a partida que estabeleceu o recorde para
-- o resultado poder anunciar "novo recorde" sem estado extra.
CREATE TABLE theme_personal_records (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('CASUAL', 'RANKED')),
  best_score INTEGER NOT NULL CHECK (best_score > 0),
  match_id TEXT NOT NULL,
  achieved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, theme_id, mode)
);

INSERT INTO theme_personal_records (user_id, theme_id, mode, best_score, match_id, achieved_at)
SELECT user_id, theme_id, mode, best_score, match_id, achieved_at
  FROM (
    SELECT mp.user_id AS user_id,
           m.theme_id AS theme_id,
           m.mode AS mode,
           mp.score AS best_score,
           m.id AS match_id,
           COALESCE(m.finished_at, m.created_at) AS achieved_at,
           ROW_NUMBER() OVER (
             PARTITION BY mp.user_id, m.theme_id, m.mode
             ORDER BY mp.score DESC, COALESCE(m.finished_at, m.created_at) ASC, m.id ASC
           ) AS position
      FROM match_players mp
      JOIN matches m ON m.id = mp.match_id
     WHERE m.status = 'FINISHED'
       AND m.kind IN ('MATCHMAKING', 'DIRECT_LIVE')
       AND mp.score > 0
  )
 WHERE position = 1;

-- Votação de próximos temas: o ADMIN cadastra os candidatos e os jogadores
-- apenas votam. Não é criação pública de tema.
CREATE TABLE theme_suggestions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 60),
  description TEXT CHECK (description IS NULL OR length(description) <= 160),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  vote_count INTEGER NOT NULL DEFAULT 0 CHECK (vote_count >= 0),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_theme_suggestions_open ON theme_suggestions(status, vote_count DESC, created_at);

CREATE TABLE theme_suggestion_votes (
  suggestion_id TEXT NOT NULL REFERENCES theme_suggestions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (suggestion_id, user_id)
);

CREATE INDEX idx_theme_suggestion_votes_user ON theme_suggestion_votes(user_id);
