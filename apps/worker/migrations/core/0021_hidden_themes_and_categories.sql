PRAGMA foreign_keys = ON;

-- Ocultar é diferente de desativar: um tema ou categoria oculto some de
-- todas as listas e opções (jogador e ADMIN) e só aparece na aba "Ocultos"
-- do admin, onde pode voltar. Nada é apagado: partidas, placares, recordes e
-- Conhecimento continuam intactos. Categoria oculta esconde junto todos os
-- temas dela. Colunas novas e opcionais: o código anterior segue funcionando.
ALTER TABLE themes ADD COLUMN hidden_at TEXT;
ALTER TABLE categories ADD COLUMN hidden_at TEXT;
