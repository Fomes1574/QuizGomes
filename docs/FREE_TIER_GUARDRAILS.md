# Guardrails do free tier

Revisado em 11 de agosto de 2026. Limites mudam; confirmar no painel e nas fontes oficiais antes de produção.

## Serviços usados

| Serviço | Uso | Limite gratuito relevante | Proteção arquitetural |
|---|---|---:|---|
| Workers Builds | CI/CD do GitHub | 3.000 min/mês, 1 build simultâneo, timeout de 20 min | uma pipeline de produção na `main`, previews desativados, `npm ci` e cache opcional |
| Workers | API + assets | 100.000 requests/dia | assets estáticos não invocam Worker quando possível; endpoints enxutos |
| D1 | core + shard inicial | 5 milhões rows lidas/dia, 100.000 escritas/dia, 5 GB | índices, paginação, ausência de scans aleatórios, agregação compacta |
| Durable Objects SQLite | filas, presença e salas | 100.000 requests/dia, 13.000 GB-s/dia; storage com limites equivalentes ao D1 | WebSocket Hibernation, sem polling/heartbeat agressivo, objetos encerram estado ocioso |
| Firebase Authentication | login Google | cota Spark aplicável | somente Auth; sem banco/storage/functions/hosting |

Fontes Cloudflare atuais:

- <https://developers.cloudflare.com/workers/platform/pricing/>
- <https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/>
- <https://developers.cloudflare.com/d1/platform/pricing/>
- <https://developers.cloudflare.com/durable-objects/platform/pricing/>

## Componentes deliberadamente não usados

- Firebase Hosting, App Hosting, Firestore, Realtime Database, Storage e Functions;
- plano Blaze;
- R2 até autorização explícita;
- Workers Analytics Engine, Logpush ou analytics pagos;
- KV para presença;
- `ORDER BY RANDOM()` ou scans integrais de perguntas;
- polling de presença/matchmaking;
- OpenAI API ou outro gerador pago.

As únicas permissões de escrita do token do Workers Builds são Workers Scripts e D1 na conta do projeto. O token não recebe R2, KV ou Billing; migrations remotas exigem explicitamente `D1 Edit`.

## Orçamento por operação

- catálogo: query indexada e paginada, limite fixo;
- tema: uma leitura de metadata + Top 5 indexado + ranking pessoal;
- matchmaking: mensagens/eventos no DO, sem writes periódicos D1;
- rodada: estado principal no DO; D1 recebe finalização/agregados em batch, não ticks do timer;
- histórico: uma row compacta usuário+pool em vez de uma row por pergunta;
- estatísticas: incremento agregado ao final/resolução, não evento analítico duplicado.

## Alertas operacionais

O administrador deve acompanhar semanalmente no começo e diariamente após crescimento:

- requests Workers/DO e erros por cota;
- duração DO e taxa de hibernação;
- rows lidas/escritas e storage D1;
- queries com `rows_read / rows_returned` alto;
- crescimento médio de `user_pool_state.state_blob`;
- número de matches incompletos e retries;
- tamanho/quantidade de imagens quando R2 for aprovado.

Alertas iniciais recomendados: 50%, 75% e 90% do limite diário. Em 75%, investigar antes de ampliar produto. Em 90%, degradar recursos não essenciais (presença detalhada/admin analytics), nunca integridade de partida.

## Crescimento perigoso

Sinais:

- full table scan em busca/admin;
- escrita D1 a cada heartbeat/segundo;
- Durable Object incapaz de hibernar;
- envio de catálogo completo ao browser;
- uma row por usuário×pergunta;
- duplicação de snapshots grandes;
- imagem maior que 100 KB;
- shards com pools não densos causando rerolls excessivos.

Nenhuma franquia é considerada infinita. Se um requisito futuro exigir plano pago, a operação deve parar sem ativar billing; registrar custo, alternativa e decisão do proprietário.
