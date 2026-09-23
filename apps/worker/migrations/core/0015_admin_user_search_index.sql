PRAGMA foreign_keys = ON;

-- `UserRepository.listForAdmin` pagina por (created_at DESC, id DESC) filtrando
-- `disabled_at IS NULL`; sem índice, cada página varre a tabela inteira mesmo
-- devolvendo só 50 linhas. O `LIKE '%termo%'` da busca continua não sargable
-- (wildcard nas duas pontas) — cobrir isso exigiria busca por prefixo ou FTS5,
-- uma mudança de comportamento de busca maior, fora do escopo desta corretiva.
CREATE INDEX idx_users_admin_listing ON users(disabled_at, created_at DESC, id DESC);
