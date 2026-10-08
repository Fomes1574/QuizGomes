PRAGMA foreign_keys = ON;

-- Temas em destaque (decisão do proprietário, 2026-10-08): o ADMIN escolhe
-- poucos temas para abrir a tela de Temas. `featured_at` guarda quando o
-- tema entrou no destaque (o mais recente aparece primeiro); NULL = fora.
-- O limite de destaques simultâneos é aplicado pelo Worker.
ALTER TABLE themes ADD COLUMN featured_at TEXT;

CREATE INDEX idx_themes_featured ON themes(featured_at) WHERE featured_at IS NOT NULL;
