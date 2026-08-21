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
