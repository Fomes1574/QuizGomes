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

O service worker precacheia somente shell/assets versionados. `/api/**`, Firebase auth endpoints e WebSockets usam rede e nunca cache competitivo. O app permanece navegável offline apenas no shell, com estado explícito de indisponibilidade para funções online. A rota Criar e o editor de arte ADMIN são chunks lazy excluídos do precache; contas que não abrem essa área não transferem esse código.

## Armazenamento de imagens

Há duas camadas intencionalmente distintas:

- imagens de pergunta continuam atrás de `ImageStorage`; `LocalImageStorage` serve fixtures e nenhum R2 foi provisionado;
- arte personalizada de tema é pequena e dinâmica, fica no `CORE_DB.theme_artwork_blobs` e possui exatamente uma linha ativa por tema.

`themes` mantém somente `artwork_kind`, `artwork_icon_key`, `artwork_version` e a ponte compatível `cover_image_key`. Catálogo, detalhe e matchmaking consultam apenas esses metadados. O BLOB só é lido por `GET /api/theme-artwork/:themeId/v:version.webp`, cuja URL imutável muda em toda substituição. Versões anteriores deixam imediatamente de ser servidas e a row anterior é substituída; não existe galeria ou histórico no produto. O Time Travel interno do D1 continua sendo uma capacidade operacional do provedor, não uma restauração exposta ao usuário.

O upload administrativo usa `PUT /api/admin/themes/:themeId/artwork` com WebP binário e versão esperada. O Worker revalida autenticação/role e `Content-Type`, interrompe a leitura em streaming no hard cap de 60 KB e valida RIFF/WEBP, chunks permitidos, ausência de EXIF/XMP/ICC/animação, dimensão quadrada e faixa 256–512 px. Cada tentativa usa também um token de escrita único: uma sessão atrasada não consegue substituir o BLOB de outra gravação que venceu a disputa de versão. SVG ou conteúdo executável não entra nessa rota.

A migration `core/0004_theme_artwork.sql` não depende de triggers. `CHECK`s mantêm a união exclusiva `NONE`/`ICON`/`CUSTOM`, a lista fechada de ícones, dimensões, tipo e limite de bytes; a PK limita a uma row por tema. Uma FK composta de `(theme_id, version, artwork_kind)` para a versão ativa em `themes`, com `ON UPDATE CASCADE`, impede que um BLOB pertença a metadata não `CUSTOM` ou a outra versão. Trocar para ícone/fallback executa `DELETE` condicional antes do `UPDATE` no mesmo `D1Database.batch()`; substituir uma imagem executa `UPDATE` versionado e `UPSERT` com token único no mesmo batch. Falha, versão concorrente ou constraint inválida reverte o batch inteiro.

Ícones padrões são 16 símbolos próprios em um único sprite SVG estático. A resolução visual central é `CUSTOM → ICON → NONE/iniciais`; `ThemeArtwork` reserva proporção quadrada, faz fade após decode, usa `object-fit: cover` e retém o fallback se a imagem falhar. Catálogo usa lazy loading; detalhe e matchmaking reutilizam a mesma URL já conhecida pelo cache HTTP/memória, sem request de descoberta adicional.
