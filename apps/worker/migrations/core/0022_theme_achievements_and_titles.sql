PRAGMA foreign_keys = ON;

-- Conquistas por tema (decisão do proprietário, 2026-10-08). Um catálogo
-- pequeno de regras no código vale para todos os temas; aqui só ficam os
-- contadores de cada pessoa em cada tema que ela joga e as conquistas ganhas.
-- Nada é criado para temas que a pessoa nunca jogou.

-- Contadores da Rankeada por pessoa e tema. `completed_ranked` conta só
-- partidas concluídas (o `ranked_matches` do ranking também soma abandono
-- penalizado). As sequências recomeçam do zero: o histórico antigo não diz
-- a ordem das partidas com segurança. `last_match_id` impede que uma
-- finalização repetida conte a mesma partida duas vezes.
CREATE TABLE user_theme_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  theme_id TEXT NOT NULL REFERENCES themes(id),
  completed_ranked INTEGER NOT NULL DEFAULT 0 CHECK (completed_ranked >= 0),
  win_streak INTEGER NOT NULL DEFAULT 0 CHECK (win_streak >= 0),
  unbeaten_matches INTEGER NOT NULL DEFAULT 0 CHECK (unbeaten_matches >= 0),
  unbeaten_wins INTEGER NOT NULL DEFAULT 0 CHECK (unbeaten_wins >= 0 AND unbeaten_wins <= unbeaten_matches),
  best_division INTEGER NOT NULL DEFAULT 0 CHECK (best_division BETWEEN 0 AND 39),
  last_match_id TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, theme_id)
);

-- Conquistas de tema: uma por pessoa, tema e regra. Nunca são apagadas
-- (só junto com a conta, na exclusão pedida pela própria pessoa).
CREATE TABLE user_theme_achievements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  theme_id TEXT NOT NULL REFERENCES themes(id),
  achievement_id TEXT NOT NULL CHECK (length(achievement_id) BETWEEN 3 AND 40),
  unlocked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, theme_id, achievement_id)
);

CREATE INDEX idx_user_theme_achievements_recent ON user_theme_achievements(user_id, unlocked_at);

-- Vitrine do perfil:
-- * equipped_title_id (já existia) guarda o título permanente escolhido;
-- * equipped_top_theme_id fixa o Top de um tema (vale enquanto a pessoa
--   estiver no Top 10 dele; senão aparece o título permanente);
-- * top_title_auto mostra sozinho o Top do tema da partida, quando houver;
-- * pinned_achievements guarda até três destaques (JSON validado no Worker).
ALTER TABLE user_profiles ADD COLUMN equipped_top_theme_id TEXT REFERENCES themes(id);
ALTER TABLE user_profiles ADD COLUMN top_title_auto INTEGER NOT NULL DEFAULT 1 CHECK (top_title_auto IN (0, 1));
ALTER TABLE user_profiles ADD COLUMN pinned_achievements TEXT CHECK (pinned_achievements IS NULL OR length(pinned_achievements) <= 600);

-- Histórico que dá para recuperar com segurança: Rankeadas concluídas de
-- cada pessoa em cada tema e a divisão atual (piso da maior já alcançada).
-- Os limites abaixo são os mesmos de DIVISION_THRESHOLDS no domínio (um teste
-- do Worker compara os dois). As conquistas que isso garante são gravadas
-- pelo Worker, que usa as mesmas regras das partidas novas.
INSERT OR IGNORE INTO user_theme_progress (user_id, theme_id, completed_ranked, best_division)
SELECT r.user_id, r.theme_id,
       (SELECT COUNT(*) FROM match_players mp JOIN matches m ON m.id = mp.match_id
         WHERE mp.user_id = r.user_id AND m.theme_id = r.theme_id
           AND m.mode = 'RANKED' AND m.status = 'FINISHED' AND mp.completed_at IS NOT NULL),
       (SELECT COUNT(*) - 1 FROM (VALUES
          (0), (300), (700), (1200), (1800), (2500), (3300), (4200), (5200), (6300),
          (7500), (8800), (10200), (11700), (13300), (15000), (16800), (18700), (20700), (22800),
          (25000), (27300), (29700), (32200), (34800), (37500), (40500), (43700), (47100), (50700),
          (54500), (58700), (63200), (68000), (73100), (78500), (84500), (91000), (98000), (105500)
        ) AS thresholds WHERE thresholds.column1 <= r.knowledge)
  FROM theme_rankings r;
