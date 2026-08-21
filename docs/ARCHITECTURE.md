# Arquitetura

## Visão geral

```mermaid
flowchart TD
  Web["React PWA"] -->|"Firebase ID Token"| Worker["Cloudflare Worker API"]
  Web <-->|"WebSocket"| DO["Durable Objects"]
  Worker --> D1["D1 Core DB"]
  Worker --> Repo["Question Repository"]
  Repo --> Q1["Question shard 1 — D1"]
  DO --> D1
  Worker --> Auth["Firebase public keys"]
  Worker -.->|"Push opcional por FID"| FCM["Firebase Cloud Messaging"]
  Worker -.-> Images["ImageStorage adapter"]
```

O repositório é um npm workspace:

- `apps/web`: SPA/PWA React;
- `apps/worker`: API, D1 e Durable Objects;
- `packages/domain`: regras puras e testáveis, sem dependência de navegador/Cloudflare.

## Fronteiras

### Web

Responsável por apresentação, acessibilidade, animações, sessão Firebase no cliente e projeção local do deadline. Não calcula resultados autoritativos nem recebe respostas futuras.

### Worker API

Termina autenticação, valida schemas, aplica autorização e oferece APIs HTTP. Queries passam por repositories. Respostas autenticadas e competitivas recebem `Cache-Control: no-store`.

### Durable Objects

Um objeto serializa o estado de uma fila ou sala. O backend SQLite é obrigatório para compatibilidade com Workers Free. WebSocket Hibernation evita cobrar duração ociosa. A sala persiste toda transição, usa alarmes para preparação/deadlines/revelação/reconexão e mantém anexos de WebSocket serializados para retomada sem memória global. Presença efêmera não vira escrita constante no D1.

### D1

Core DB guarda conta, social, rankings, matches e metadados. Imagens personalizadas pequenas de perfil/tema podem usar tabelas BLOB dedicadas, nunca colunas incorporadas às queries normais dessas entidades. Question repositories aceitam um `shardId`; inicialmente o binding `QUESTIONS_DB` pode apontar para o mesmo D1, mas nenhuma UI ou regra depende disso.

### Domain

Contém ranking, XP, scoring, anti-repetição, bitmap histórico e seleção uniforme. Funções usam entradas explícitas e fontes de aleatoriedade/tempo injetáveis nos testes.

## Autenticação Firebase em Workers

O cliente chama `getIdToken()` e envia `Authorization: Bearer <token>`. O Worker:

1. exige JWT com `alg=RS256` e `kid`;
2. busca certificados X.509 oficiais de `securetoken@system.gserviceaccount.com`;
3. respeita `Cache-Control: max-age` e mantém cache em memória;
4. verifica assinatura com `jose`/Web Crypto;
5. verifica `aud=quizgomes-cbc48`;
6. verifica `iss=https://securetoken.google.com/quizgomes-cbc48`;
7. verifica `exp`, `iat`, `auth_time` e `sub` não vazio;
8. usa apenas `sub` como Firebase UID.

Fontes oficiais:

- <https://firebase.google.com/docs/auth/admin/verify-id-tokens>
- <https://developers.google.com/identity/gsi/web/guides/verify-google-id-token>

Não é usada Service Account para verificar assinatura. Revogação global de token não é consultada em toda requisição porque exigiria Admin API/credenciais; ações críticas podem futuramente adicionar esse controle conforme ameaça e custo.

## Administração

`ADMIN_FIREBASE_UIDS` é uma lista no ambiente do Worker. O bootstrap cria/garante a role no D1 após login válido. Guards administrativos verificam bootstrap e/ou role persistida. Nenhuma role é derivada de email/nome, e a UI oculta é apenas conveniência visual.

A arte de tema é mutável somente por ADMIN autenticado. A versão esperada integra cada escrita; zero rows alteradas representa edição concorrente e retorna conflito, em vez de sobrescrever silenciosamente outra sessão.

## Social Foundation

O Milestone 9A reutiliza `users`, `user_profiles.public_id`, `friend_requests` e `friendships`. A identidade exposta contém somente nome, ID público, avatar resolvido e moldura; Firebase UID, IDs internos, email e instalações nunca entram nas respostas públicas. A busca nominal usa prefixo case-insensitive indexado/limitado; `#QG...` exige correspondência exata. Um índice único parcial da dupla normalizada impede dois pedidos `PENDING`, inclusive em direções cruzadas.

`friend_request_pair_state` guarda recusas exclusivamente na direção remetente → destinatário. A terceira recusa explícita inicia 30 dias; expiração limpa o ciclo sob demanda e aceite o remove atomicamente. Aceite/recusa usam `resolution_key` e `D1Database.batch()` para impedir efeitos duplicados em retries/corridas. Cancelamento, bloqueio e remoção de amizade não contam como recusa.

`user_blocks` persiste a direção da decisão, mas oculta e torna incompatível a dupla inteira. Bloquear remove a amizade e cancela pedidos no mesmo batch; cooldowns existentes permanecem intactos. O bloqueado recebe apenas indisponibilidade genérica. `MatchmakingQueue` consulta os bloqueios imediatamente antes de formar uma sala e continua buscando outro candidato; salas já criadas, `MatchRoom`, reconexão, score e resultados permanecem inalterados.

Cada `push_installations` associa um Firebase Installation ID (FID) ao usuário autenticado; vários dispositivos são possíveis e FID de outro proprietário não pode ser sobrescrito. Firebase JS SDK 12.17.1 usa `register()`/`onRegistered()` em vez dos registration tokens depreciados. O Worker autentica FCM HTTP v1 com OAuth RS256 via Web Crypto e envia `message.fid` após a persistência usando `waitUntil`. Credencial ausente, FCM indisponível ou instalação inválida nunca revertem o pedido; destinos inválidos são desativados. A chave VAPID pública fica em `VITE_FIREBASE_VAPID_PUBLIC_KEY`; somente o runtime Secret `FCM_SERVICE_ACCOUNT_JSON` contém a Service Account, nunca o repositório/bundle.

O Milestone 9A.1 acrescenta `SocialRealtimeHub`, um Durable Object SQLite global
com WebSocket Hibernation. Um ticket curto autenticado autoriza o socket sem
expor Firebase ID Token na URL; cada anexo contém somente o ID interno validado
pelo Worker. O total online usa um `Set` dos IDs associados aos sockets ativos,
portanto múltiplas abas/dispositivos continuam contando como um único usuário.
Tags direcionam uma invalidação genérica e sem ator para todas as sessões da
dupla após a persistência social; nenhum payload revela bloqueio, UID ou email.
O navegador atualiza summary/lista somente quando recebe essa invalidação ou
reconecta. Heartbeat de 45 segundos usa `setWebSocketAutoResponse`, preserva
hibernação e nunca grava D1/storage; FCM continua opcional para background.
Presença individual de amigos e desafios não fazem parte dessa fundação.

Cancelamento anterior a `startedAtMs` permanece `VOID/CANCELLED`, sem qualquer
efeito competitivo. O domínio retém apenas o assento do autor e a projeção
terminal expõe exclusivamente `{ seat, displayName }`, permitindo exibir
“Partida cancelada por {nome}” sem placar. O retorno usa route state com tema,
dificuldade e modalidade; desconexão, abandono iniciado e demais voids não mudam.

## Consistência e idempotência

- `active_match_players.user_id` exclusivo impede o mesmo usuário em duas partidas.
- `matches.result_version` e chave única no ledger impedem resultado duplicado.
- Finalização usa um batch transacional: trava estado final e grava ledger, ranking, XP, respostas, histórico do pool e liberação dos locks; retries observam o resultado já aplicado.
- Requests mutáveis aceitam `Idempotency-Key` quando repetição de rede é provável.
- Slots do pool são alterados por swap com o último slot na mesma transação.
- Estado usuário+pool usa versão otimista para evitar perda concorrente.

## Estado de partida

Estados de presença competitiva: `idle`, `matchmaking`, `invite`, `preparing`, `playing`, `reconnecting` e `finished`. Transições inválidas são rejeitadas pelo servidor.

Cada rodada separa:

- payload público atual: enunciado, alternativas, imagem, pergunta X/Y e tempo restante derivado do deadline do servidor;
- segredo do servidor: alternativa correta, respostas, tempo capturado e score calculado;
- sinal do adversário: somente cinza/amarelo até a resolução, sem alternativa ou correção;
- revelação: alternativa correta e score adversário somente quando a rodada está resolvida para ambos.

O cliente envia somente READY, número da rodada, ID da pergunta e opção escolhida. Campos extras (score, tempo, resposta correta ou resultado) invalidam a mensagem. A partida pausa integralmente por uma única queda, preserva `phaseRemainingMs` por até 7 s e diferencia abandono individual de dupla queda/falha sistêmica.

## Segurança HTTP

- CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` e HSTS em produção;
- origem própria derivada de `request.url`, CORS externo restrito a origens explícitas e wildcard rejeitado;
- JSON com limite de tamanho;
- Zod para input;
- IDs do recurso sempre combinados com UID autorizado para evitar IDOR;
- respostas de API sem HTML arbitrário; React escapa texto por padrão;
- sem secrets em código, logs ou payloads.

## PWA

Um único service worker Workbox `injectManifest` reúne shell offline, precache/atualização e FCM background. O frontend fornece a registration existente para `register({ serviceWorkerRegistration, vapidKey })`; não existe `firebase-messaging-sw.js` concorrente no root scope. `/api/**`, Firebase auth endpoints e WebSockets usam rede e nunca cache competitivo. Mensagens somente-data geram uma notificação controlada no background; foreground invalida badge/lista sem duplicar alerta do sistema. Clique abre `/social?section=pedidos`. Permissão é solicitada apenas por gesto explícito em Perfil. O app permanece navegável offline apenas no shell. A rota Criar e o editor de arte ADMIN são chunks lazy excluídos do precache; Firebase Messaging também permanece em chunk separado para usuários com push autorizado.

## Armazenamento de imagens

Há duas camadas intencionalmente distintas:

- imagens de pergunta continuam atrás de `ImageStorage`; `LocalImageStorage` serve fixtures e nenhum R2 foi provisionado;
- arte personalizada de tema é pequena e dinâmica, fica no `CORE_DB.theme_artwork_blobs` e possui exatamente uma linha ativa por tema.
- avatar personalizado fica no `CORE_DB.user_custom_avatars`, em uma row separada e versionada por usuário; consultas normais leem somente `active/version`, nunca o BLOB.

O cliente recorta em quadrado, gera 256 × 256 WebP e busca aproximadamente 25–40 KB, com hard cap de 50 KB. O Worker autentica pelo Firebase UID, ignora qualquer identidade fornecida pelo cliente, limita a leitura, reinspeciona o contêiner/dimensões e substitui a única row. Remover limpa o BLOB e incrementa a versão. A resolução visual central é `custom → foto Google segura → iniciais`; a URL pública `/api/avatars/:userId/v<versão>.webp` tem ETag/cache imutável e deixa de servir a versão anterior após troca ou remoção.

`MATCH_FOUND` não transporta estado privado da sala. Depois da inicialização autoritativa, o MatchRoom projeta individualmente nome, URLs de avatar, frame, `knowledgeBefore` do tema e somente a primeira pergunta pública. A tela usa os 2,9 s mínimos para abrir e bufferizar o socket da sala, mas não envia `READY`; portanto o relógio de 10 segundos não começa durante a apresentação. A MatchScreen assume o socket e só então participa do protocolo existente.

`themes` mantém somente `artwork_kind`, `artwork_icon_key`, `artwork_version` e a ponte compatível `cover_image_key`. Catálogo, detalhe e matchmaking consultam apenas esses metadados. O BLOB só é lido por `GET /api/theme-artwork/:themeId/v:version.webp`, cuja URL imutável muda em toda substituição. Versões anteriores deixam imediatamente de ser servidas e a row anterior é substituída; não existe galeria ou histórico no produto. O Time Travel interno do D1 continua sendo uma capacidade operacional do provedor, não uma restauração exposta ao usuário.

O upload administrativo usa `PUT /api/admin/themes/:themeId/artwork` com WebP binário e versão esperada. O Worker revalida autenticação/role e `Content-Type`, interrompe a leitura em streaming no hard cap de 60 KB e valida RIFF/WEBP, chunks permitidos, ausência de EXIF/XMP/ICC/animação, dimensão quadrada e faixa 256–512 px. Cada tentativa usa também um token de escrita único: uma sessão atrasada não consegue substituir o BLOB de outra gravação que venceu a disputa de versão. SVG ou conteúdo executável não entra nessa rota.

A migration `core/0004_theme_artwork.sql` não depende de triggers. `CHECK`s mantêm a união exclusiva `NONE`/`ICON`/`CUSTOM`, a lista fechada de ícones, dimensões, tipo e limite de bytes; a PK limita a uma row por tema. Uma FK composta de `(theme_id, version, artwork_kind)` para a versão ativa em `themes`, com `ON UPDATE CASCADE`, impede que um BLOB pertença a metadata não `CUSTOM` ou a outra versão. Trocar para ícone/fallback executa `DELETE` condicional antes do `UPDATE` no mesmo `D1Database.batch()`; substituir uma imagem executa `UPDATE` versionado e `UPSERT` com token único no mesmo batch. Falha, versão concorrente ou constraint inválida reverte o batch inteiro.

Ícones padrões são 16 símbolos próprios em um único sprite SVG estático. A resolução visual central é `CUSTOM → ICON → NONE/iniciais`; `ThemeArtwork` reserva proporção quadrada, faz fade após decode, usa `object-fit: cover` e retém o fallback se a imagem falhar. Catálogo usa lazy loading; detalhe e matchmaking reutilizam a mesma URL já conhecida pelo cache HTTP/memória, sem request de descoberta adicional.
