PRAGMA foreign_keys = ON;

-- Companheira de `questions/0007_unify_question_pools.sql`: todo pool passa a
-- ter id `${themeId}:pool`; os antigos `${themeId}:easy|medium|hard` (e o pool
-- sintético de smoke) deixam de existir. `user_pool_states` não tem FK para
-- QUESTIONS_DB (bancos D1 separados, sem FK entre si) e guarda só a descoberta
-- histórica (bitmap de slots já respondidos) — nunca resultado de partida,
-- XP ou Conhecimento. Uma linha presa a um pool_id antigo nunca mais seria
-- lida (toda leitura passa a pedir o novo id e simplesmente não encontra
-- nada, recomeçando do zero), então isto só libera o espaço órfão; documentado
-- aqui porque a descoberta não pôde ser remapeada com precisão para os novos
-- slots consolidados (a decisão explícita é reinicializar, não preservar).
DELETE FROM user_pool_states WHERE pool_id NOT LIKE '%:pool';
