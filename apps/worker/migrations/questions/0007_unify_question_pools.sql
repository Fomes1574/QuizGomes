PRAGMA foreign_keys = ON;

-- Decisão de produto de 2026-09-24: Fácil/Médio/Difícil deixam de existir como
-- conceito operacional. Cada tema tinha até três pools (um por dificuldade,
-- `UNIQUE(theme_id, difficulty)`); esta migration consolida todos em um único
-- pool por tema, com slots densos 1..N reindexados. A ordem entre as antigas
-- dificuldades nunca teve significado para o sorteio uniforme, então a nova
-- numeração não precisa (e não tenta) preservar a ordem original entre elas.
--
-- O pool sobrevivente de cada tema é o que já existia com a menor dificuldade
-- (EASY, senão MEDIUM, senão HARD) — nunca um id novo criado do zero — porque
-- `UNIQUE(theme_id, difficulty)` impede inserir uma linha nova enquanto as
-- antigas ainda existem: um tema com as três dificuldades já ocupa os três
-- únicos valores permitidos pelo CHECK, então fundir e apagar as demais tem
-- que vir antes de qualquer id novo. Só no fim ele é renomeado para o id
-- determinístico `${themeId}:pool` (ver `questionPoolId` em
-- `question-content.ts`). `difficulty` continua na tabela apenas como coluna
-- física herdada; nenhum código novo lê esse valor para decidir modo,
-- contagem de perguntas, sorteio, fila ou hash de deduplicação.

-- 1) reindexa os slots das perguntas ATIVAS de cada tema em uma numeração
--    densa única 1..N, somando os antigos pools de dificuldade, e já aponta
--    tudo (ativo ou não) para o pool canônico ANTIGO do próprio tema — nenhum
--    id novo é criado neste passo.
WITH ranked AS (
  SELECT q.id AS question_id,
         (SELECT o.id FROM question_pools o
           WHERE o.theme_id = p.theme_id
           ORDER BY CASE o.difficulty WHEN 'EASY' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END, o.id
           LIMIT 1) AS canonical_id,
         ROW_NUMBER() OVER (
           PARTITION BY p.theme_id
           ORDER BY CASE p.difficulty WHEN 'EASY' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END, q.active_slot, q.id
         ) AS new_slot
    FROM questions q
    JOIN question_pools p ON p.id = q.pool_id
   WHERE q.status = 'ACTIVE'
)
UPDATE questions
   SET active_slot = (SELECT new_slot FROM ranked WHERE ranked.question_id = questions.id),
       pool_id = (SELECT canonical_id FROM ranked WHERE ranked.question_id = questions.id)
 WHERE id IN (SELECT question_id FROM ranked);

-- Rascunhos e demais status não-ativos também migram para o canônico do
-- próprio tema, sem ganhar slot.
UPDATE questions
   SET pool_id = (
     SELECT o.id FROM question_pools o
      WHERE o.theme_id = (SELECT theme_id FROM question_pools WHERE id = questions.pool_id)
      ORDER BY CASE o.difficulty WHEN 'EASY' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END, o.id
      LIMIT 1
   )
 WHERE status <> 'ACTIVE';

-- 2) soma a contagem final no canônico e remove os pools irmãos do mesmo
--    tema, já sem nenhuma pergunta apontando para eles.
UPDATE question_pools
   SET active_count = (
         SELECT COUNT(*) FROM questions WHERE pool_id = question_pools.id AND status = 'ACTIVE'
       ),
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE id = (
   SELECT o.id FROM question_pools o
    WHERE o.theme_id = question_pools.theme_id
    ORDER BY CASE o.difficulty WHEN 'EASY' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END, o.id
    LIMIT 1
 );

DELETE FROM question_pools
 WHERE id <> (
   SELECT o.id FROM question_pools o
    WHERE o.theme_id = question_pools.theme_id
    ORDER BY CASE o.difficulty WHEN 'EASY' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END, o.id
    LIMIT 1
 );

-- 3) exatamente um pool por tema sobrevive agora. Renomeia-o para o id
--    determinístico novo e repontea as perguntas dele no mesmo passo lógico.
--    `defer_foreign_keys` é a técnica padrão do próprio SQLite para renomear
--    uma chave referenciada dentro de uma transação: evita a violação
--    transitória enquanto pai e filho ainda não terminaram de trocar de id
--    (ambos os UPDATEs abaixo se resolvem antes do commit desta migration).
PRAGMA defer_foreign_keys = 1;

UPDATE questions
   SET pool_id = (SELECT theme_id FROM question_pools WHERE id = questions.pool_id) || ':pool'
 WHERE pool_id NOT LIKE '%:pool';

UPDATE question_pools
   SET id = theme_id || ':pool'
 WHERE id NOT LIKE '%:pool';
