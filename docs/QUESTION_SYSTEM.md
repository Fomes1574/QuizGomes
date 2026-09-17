# Sistema de perguntas

## Objetivos

- sorteio uniforme entre todas as perguntas elegíveis;
- nenhuma consulta aleatória sobre milhões de rows;
- sem bloqueio por histórico entre partidas; sem repetição apenas dentro da própria partida;
- descoberta histórica exata e compacta;
- sharding sem alterar UI ou regras de domínio;
- nenhuma resposta correta futura no cliente.

## Pool denso

Um pool é `(theme_id, difficulty)` e guarda `active_count`. Toda pergunta ativa ocupa um `slot` único entre 1 e N.

Seleção:

1. montar conjunto bloqueado somente dos slots já usados na própria partida;
2. sortear inteiro uniforme em `[1,N]` com rejeição sem viés;
3. rerrolar se bloqueado;
4. buscar a row pela chave indexada `(pool_id, slot)`;
5. repetir até a quantidade da dificuldade.

Se `N - blockedEligible < needed`, retornar erro de pool insuficiente; nunca repetir pergunta dentro da própria partida.

O dataset interno `SYNTHETIC_SMOKE_TEST` possui 250 perguntas EASY mínimas e inequivocamente artificiais para suportar repetição de smoke sem mudar essa regra. A ampliação é uma migration restrita aos IDs e à flag reservados; temas editoriais continuam usando seus próprios pools e descoberta histórica normal.

Ao desativar slot S:

1. ler pergunta em S e no último slot N;
2. se S != N, mover N para S;
3. remover a pergunta desativada do mapa ativo;
4. decrementar N;
5. registrar remapeamento para migrar bitmaps de descoberta de forma assíncrona/administrativa antes de reutilização em produção.

Na primeira V1, mudanças de slot que afetem descoberta exigem job de manutenção e versionamento do pool. O admin não publica enquanto a migração estiver pendente.

## Estado compacto usuário+pool

Uma row guarda `state_blob`, `pool_version` e `revision`.

Formato binário vigente:

| Campo | Tamanho | Descrição |
|---|---:|---|
| versão | 1 byte | versão do formato |
| bitmap histórico | variável | bit `(slot-1)` indica descoberta |

Com 1.000.000 de perguntas num único pool, o bitmap máximo é aproximadamente 125 KB por usuário daquele pool; normalmente perguntas estarão distribuídas entre muitos pools e o estado cresce sob demanda. Não existe uma row por usuário×pergunta. Leitores legados podem aceitar o formato que continha fila recente, mas a fila não participa mais da seleção nem deve voltar a ser gravada.

Ao responder:

- marcar bit histórico;
- atualizar com `WHERE revision = ?`; conflito recarrega e tenta novamente.

Descoberta é `popcount(bitmap intersect activeSlots) / active_count`. Como slots ativos são densos, na versão sem migração pendente basta contar bits de 1..N. Descoberta nunca altera elegibilidade de sorteio.

## Shards

`themes.question_shard_id` seleciona um `QuestionRepository`. Inicialmente `default` usa `QUESTIONS_DB`. Um router futuro adiciona bindings/shards sem mudar contratos HTTP, UI ou engine.

Rows de match guardam snapshot público e referências necessárias para auditoria. Correta fica server-side. No assíncrono, respostas do primeiro permanecem seladas e são reveladas rodada a rodada.

## Importação

Importadores aceitam JSON/CSV normalizado, validam:

- tema/dificuldade/status;
- exatamente quatro alternativas;
- índice correto 0..3;
- fontes não vazias para publicação;
- duplicatas normalizadas;
- tamanho textual e medição editorial;
- metadata/licença de imagem;
- imagem menor que 100 KB.

`image_key` é uma referência opaca. Só pode ser aceita/publicada quando o
`ImageStorage` ativo consegue servi-la; sem backend de imagens autorizado, a
pergunta permanece sem imagem e o admin informa essa indisponibilidade. R2 fica
preparado apenas como adapter futuro, sem bucket, binding ou upload fantasma na V1.

Falhas retornam linhas/campos sem importação parcial. Fixtures usam namespace e seed separados.

## Uniformidade

O inteiro aleatório usa rejection sampling sobre `crypto.getRandomValues`, evitando viés de módulo. O conjunto de bloqueio só rejeita; portanto cada slot elegível conserva a mesma probabilidade condicional. Testes estruturais cobrem limites, exclusões, duplicatas e pool insuficiente.
