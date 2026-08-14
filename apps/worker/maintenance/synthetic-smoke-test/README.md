# Limpeza do dataset `SYNTHETIC_SMOKE_TEST`

Estes arquivos estão versionados para a remoção futura do dataset temporário do smoke test real do Milestone 8. Eles **não** pertencem aos diretórios configurados em `wrangler.jsonc`, não são chamados por nenhum script e não serão executados pelo Workers Builds atual.

## Identificadores reservados

- categoria: `category-synthetic-smoke-test-20260811`;
- tema: `theme-synthetic-smoke-test-multiplayer-20260811`;
- pool: `pool-synthetic-smoke-test-multiplayer-easy-20260811`;
- perguntas: 250 slots; IDs legados `q01`–`q30` e IDs ampliados `q031`–`q250`;
- flag editorial exata: `["SYNTHETIC_SMOKE_TEST"]`.

## Promoção futura

Somente depois de o proprietário confirmar o fim dos smoke tests:

1. copiar `cleanup-questions.sql`, sem editar migrations já aplicadas, para a próxima versão numérica de `migrations/questions`;
2. copiar `cleanup-core.sql` para a próxima versão numérica de `migrations/core`;
3. validar em D1 local vazio e também com uma partida histórica sintética;
4. publicar o commit autorizador na `main` para o Workers Builds aplicar primeiro Questions e depois Core.

A limpeza do shard apaga apenas perguntas com o pool, o prefixo e a flag exatos. Fontes e estatísticas dessas perguntas seguem o `ON DELETE CASCADE`. O pool só é apagado se ficar vazio.

No core, o tema e a categoria são primeiro desativados. Eles só são apagados fisicamente quando não houver partidas, desafios, rankings ou ownership que dependam do tema. Se já houver histórico do smoke test, ficam como tombstones desativados para preservar integridade referencial. Nenhuma instrução toca em usuários, perfis, partidas, respostas, resultados, Conhecimento, XP, estados de pool ou locks.
