# Performance — Milestone 9A Social Foundation

Referência M8/8.5 congelada: bundle inicial `217,60 KB / 68,34 KB gzip`, sala lazy `19,15 KB / 6,32 KB gzip`, CSS `54,87 KB / 11,19 KB gzip`, precache `11 entradas / 441,18 KiB` e Worker `706,8 KB`.

Build Social Foundation local com `VITE_ENABLE_REALTIME_MATCHES=true`:

| Artefato | Bruto | Gzip | Observação |
|---|---:|---:|---|
| JavaScript inicial | 214,16 KB | 67,51 KB | abaixo da referência congelada; Social virou chunk lazy |
| Página Social | 7,49 KB | 2,31 KB | carregada somente ao abrir a aba e excluída do precache |
| Sala de partida | 19,18 KB | 6,34 KB | motor, UI de conexão e protocolo preservados |
| CSS global | 57,40 KB | 11,58 KB | cards, badge e confirmação acessível sem biblioteca nova |
| Service worker único | 69,43 KB | 21,60 KB | Workbox + Firebase Messaging background no mesmo root scope |
| Precache | 477,75 KiB | — | 15 entradas; shell, atualização e API `NetworkOnly` preservados |
| Worker | 736,5 KB | — | APIs/repository sociais, compatibilidade por bloqueio e FCM HTTP v1 |

Regras operacionais:

- nenhuma dependência npm foi adicionada; o Firebase SDK `12.17.1` já existia;
- busca nominal usa prefixo case-insensitive indexado, debounce de 220 ms e limite de 20 resultados; ID público usa lookup exato e retorna no máximo um;
- startup autenticado faz somente `GET /api/social/summary` para o badge; não consulta lista de bloqueados, instalações ou catálogos sociais inteiros;
- Social abre seu chunk e usa `GET /api/social`; cada busca realiza uma consulta específica, sem polling;
- bloqueados são buscados somente após abrir `Perfil → Privacidade e Segurança → Usuários bloqueados`;
- Firebase Messaging roda em chunk separado e só inicia após permissão previamente concedida ou gesto explícito;
- `MatchmakingQueue` consulta bloqueio por par somente ao avaliar um candidato; jogadores incompatíveis continuam na mesma fila sem erro, polling ou alteração do MatchRoom;
- push consulta no máximo 20 instalações daquele destinatário, envia assincronamente depois da persistência e nunca faz rollback do pedido;
- APIs autenticadas mantêm `Cache-Control: no-store`; requests do Worker e WebSocket nunca são cacheados pelo service worker.

## Milestone 9A.1 — realtime social global

`SocialRealtimeHub` é um único Durable Object SQLite global usando `acceptWebSocket`,
anexos serializados e tags por ID interno. O total online é a quantidade de IDs
distintos com pelo menos um socket aceito. Não existe query D1, escrita de
`last_seen`, timer/alarm server-side ou polling HTTP para manter esse número.

Build 9A.1 medido: JavaScript inicial `214,83 KB / 67,69 KB gzip` (acréscimo
de `0,67 KB / 0,18 KB gzip` sobre o 9A), sala lazy `19,59 KB / 6,52 KB gzip`,
Social lazy inalterado `7,49 KB / 2,31 KB gzip`, CSS `57,80 KB / 11,67 KB gzip`,
service worker único inalterado `69,43 KB / 21,60 KB gzip`, precache com
15 entradas / `480,69 KiB` e Worker `742,1 KB`.

O navegador envia `PING` a cada **45 segundos**. A configuração
`setWebSocketAutoResponse(new WebSocketRequestResponsePair('PING', 'PONG'))`
responde na infraestrutura sem acordar o objeto e sem cobrar duração ociosa.
Ausência de `PONG` por 15 segundos fecha a conexão e inicia reconexão com backoff
de 1 até 30 segundos; o heartbeat competitivo de 1.500 ms permanece intocado.

Estimativa conservadora para **30 usuários únicos, uma aba por usuário, 24 horas
continuamente conectados**, sem contar ações sociais reais:

| Operação | Quantidade diária | Impacto |
|---|---:|---|
| WebSockets estabelecidos inicialmente | 30 | 30 conexões para o hub; abas extras criam sockets, não usuários online |
| Tickets autenticados | 30 | 30 HTTP Workers; até 60 operações no `TicketBroker` entre emissão e consumo |
| Heartbeats recebidos | 57.600 | `30 × 86.400 ÷ 45`; resposta automática sem acordar o Durable Object |
| Equivalência conservadora de requests DO | 2.880 | razão oficial de 20 mensagens recebidas para 1 request; 2,88% de 100.000/dia |
| PONGs e broadcasts server → client | 57.600 + mudanças reais | mensagens de saída não são tarifadas como requests |
| D1 para heartbeat/presença | 0 reads / 0 writes | D1 é consultado somente na autenticação inicial e nas mutações/snapshots reais |
| Storage/alarms periódicos do SocialRealtimeHub | 0 | sockets/anexos são gerenciados pela Hibernation API; nenhum `setInterval` no DO |
| Snapshot Social sem evento | 0 polls | `GET /api/social` e summary adicionais acontecem somente em evento/foco/reconexão |

O valor de 2.880 requests é deliberadamente conservador: a documentação garante
que auto-responses não incorrem duração; métricas do painel devem confirmar a
contabilização efetiva do projeto após deploy. Mesmo adicionando conexões,
tickets, ações reais e reconexões, esse cenário mantém ampla margem abaixo da
franquia gratuita de **100.000 requests DO/dia** e **13.000 GB-s/dia**. Nenhum
Firebase, FCM, D1, billing ou recurso pago é necessário para realtime foreground.

Fontes oficiais revisadas em 21/08/2026:

- https://developers.cloudflare.com/durable-objects/api/state/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/durable-objects/best-practices/websockets/

## Milestone 9B — presença privada entre amigos

Não existe segundo WebSocket, Durable Object, migration, serviço, dependência de
animação ou produto Firebase. O canal global hibernável do 9A.1 transporta
também `FRIEND_PRESENCE_CHANGED` somente para amigos autorizados; `PresenceHub`
continua sendo a autoridade da atividade competitiva existente.

| Artefato | 9A.1 aprovado | 9B | Impacto |
|---|---:|---:|---:|
| JavaScript inicial | 214,83 KB / 67,69 KB gzip | 215,00 KB / 67,76 KB gzip | +0,17 KB / +0,07 KB gzip |
| Página Social lazy | 7,49 KB / 2,31 KB gzip | 10,87 KB / 3,49 KB gzip | +3,38 KB / +1,18 KB gzip; somente ao abrir Social |
| CSS global | 57,80 KB / 11,67 KB gzip | 62,20 KB / 12,50 KB gzip | +4,40 KB / +0,83 KB gzip |
| Sala de partida lazy | 19,59 KB / 6,52 KB gzip | 19,59 KB / 6,52 KB gzip | zero alteração no motor/UI congelados |
| Service worker único | 69,43 KB / 21,60 KB gzip | 69,43 KB / 21,60 KB gzip | zero alteração em PWA/FCM |
| Precache | 15 entradas / 480,69 KiB | 15 entradas / 486,12 KiB | +5,43 KiB; Social continua lazy e fora do precache |
| Worker | 742,1 KB | 748,7 KB | +6,6 KB sem binding ou classe adicional |

### Requests e acesso a dados

- startup autenticado mantém o ticket/socket social aprovado e
  `GET /api/social/summary`; adiciona **um**
  `GET /api/social/presence` autenticado para o snapshot inicial de amizades;
- abrir Social continua realizando somente `GET /api/social`; não existe
  download de todos os usuários, lista de bloqueados ou consulta pública por ID;
- mudança de presença usa apenas o WebSocket existente: **zero requests HTTP**
  do navegador e zero refresh global/header por amigo alterado;
- aceitar/remover/bloquear continua emitindo invalidação somente após a mutação
  persistida; uma atualização real recarrega summary, presença e, quando a aba
  Social está aberta, o snapshot social;
- cada mudança real de atividade encaminha **um** request interno DO para o hub
  social e executa **uma** query indexada das amizades válidas; não há query por
  heartbeat. Se o usuário não possui socket, a atividade não executa query D1;
- snapshot usa uma consulta de amizades e somente lê `PresenceHub` de amigos
  efetivamente online; offline nunca consulta activity residual;
- presença cria **zero D1 writes**, nenhum last-seen, nenhum alarm, nenhum
  `setInterval` server-side e nenhum push FCM;
- o heartbeat permanece em 45 s, watchdog 15 s e `PING/PONG` por
  `setWebSocketAutoResponse`, preservando hibernação e o orçamento do 9A.1.

### Cenário conservador: 30 usuários únicos por 24 horas

Assumindo uma sessão por usuário, 30 snapshots iniciais, até 29 amizades por
pessoa e **10 mudanças reais de activity por usuário/dia**:

| Operação | Base 9A.1 | Incremento 9B |
|---|---:|---:|
| Heartbeats sociais | 57.600/dia | 0; mesma cadência de 45 s |
| Requests DO equivalentes de heartbeat | até 2.880/dia | 0 |
| Eventos reais de activity | — | 300 requests internos SocialRealtimeHub |
| Snapshots iniciais | — | até 30 requests ao hub + até 870 reads DO de amigos online no pior caso completo |
| Activity inicial dos primeiros sockets | — | até 30 reads DO |
| D1 statements para fanout/snapshot/conexão | — | cerca de 360 reads, somente por evento/snapshot real |
| D1 rows de amizades, pior caso de 29 por consulta | — | até aproximadamente 10.440 rows/dia, antes dos índices seletivos |
| D1 writes/last-seen/heartbeat | 0 | 0 |
| Segundo WebSocket, alarm ou produto pago | 0 | 0 |

Mesmo no cenário deliberadamente superestimado, heartbeat + fanout + snapshots
permanecem em torno de **4.110 requests DO/dia**, antes dos poucos tickets e
conexões já existentes: aproximadamente **4,1%** da franquia oficial de
100.000 requests/dia. Reads D1 ficam muito abaixo de 5 milhões de rows/dia;
mensagens server → client não são cobradas como requests, e auto-responses não
acordam o objeto nem geram duração ociosa. Não houve ativação de billing.

Validação visual neste ambiente: DOM responsivo em `390 px` e `1.440 px`, dark
mode, avatar customizado/moldura, estados acessíveis e fallback
`prefers-reduced-motion`/FLIP. Chromium e dispositivos físicos não estão
instalados/disponíveis; a confirmação visual em navegador/aparelho real pertence
ao smoke físico pós-deploy do proprietário.

Documentação oficial Cloudflare revisada novamente em 21/08/2026:

- https://developers.cloudflare.com/durable-objects/api/state/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/durable-objects/best-practices/websockets/
