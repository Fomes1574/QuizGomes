# Deployment

Atualizado em 25 de setembro de 2026. O destino é um único Cloudflare Worker que serve API, PWA e Durable Objects em `workers.dev`, usando somente **Workers Free**. Firebase Cloud Messaging opcional permanece no plano gratuito.

Se o painel solicitar cartão, billing, Workers Paid, upgrade ou qualquer produto pago, cancele e pare. Não use deploy temporário nem habilite recursos ausentes deste documento. O R2 privado abaixo é a única exceção autorizada para imagens de perguntas.

## 1. Firebase

No console do projeto `quizgomes-cbc48`:

1. habilite Authentication → Sign-in method → Google;
2. mantenha `localhost` em Authorized Domains para desenvolvimento;
3. após o primeiro deploy, adicione o hostname `quiz-gomes.<seu-subdominio>.workers.dev`, sem `https://` e sem caminho, em Authentication → Settings → Authorized Domains;
4. faça o primeiro login e copie o Firebase UID do proprietário em Authentication → Users → selecione a conta → User UID;
5. grave esse UID como o secret de runtime `ADMIN_FIREBASE_UIDS` no Worker.

A configuração Web existente é pública e está no bundle, como previsto pelo Firebase. A API key deve permanecer restrita no Google Cloud às APIs Firebase necessárias e aos domínios autorizados. Nunca adicione JSON de Service Account, chave privada ou credencial do Firebase Admin SDK ao Git, ao browser ou às variáveis `VITE_`; a credencial FCM opcional pertence exclusivamente ao runtime Secret do Worker.

## 2. Recursos D1 existentes

Os dois bancos foram criados manualmente no Dashboard e permanecem no Workers Free. Seus UUIDs não são secrets e estão versionados no `wrangler.jsonc`:

| Binding | Banco | ID |
|---|---|---|
| `CORE_DB` | `quiz-gomes-core` | `3260deba-54ab-4e47-8c7f-a4d088dad728` |
| `QUESTIONS_DB` | `quiz-gomes-questions-01` | `40ea8ac4-9dd6-40a8-b032-89cb3cede229` |

Não execute `wrangler d1 create`, não altere esses nomes e não crie outros bancos. Os comandos remotos usam `--experimental-provision=false` para impedir provisionamento inferido; o deploy aplica as classes Durable Objects SQLite `v1`, `v2` e `v3`. A `v2` acrescenta `SocialRealtimeHub` e a `v3`, `ChallengeRoom`, sem novo D1, billing ou SQL manual.

## 3. Workers Builds conectado ao GitHub

### 3.1. Token de build com menor privilégio

O token automático padrão do Workers Builds não serve para este pipeline: segundo a documentação atual, ele não inclui `D1 Edit` e inclui permissões de KV/R2 desnecessárias. Crie um token de usuário personalizado, limitado somente à conta do QUIZ GOMES, com:

| Escopo | Permissão |
|---|---|
| Account | Account Settings: Read |
| Account | Workers Scripts: Edit |
| Account | D1: Edit |
| User | User Details: Read |
| User | Memberships: Read |

Não conceda R2, KV, Billing, zone routes ou acesso a outras contas. As permissões de leitura acima servem apenas para identificar usuário, associação e conta; as únicas permissões de escrita são Workers Scripts e D1.

Selecione esse token no campo **API token** da configuração do Workers Builds. Não copie seu valor para o GitHub, para Build variables, para `wrangler.jsonc` ou para qualquer arquivo do repositório.

### 3.2. Valores exatos da conexão

Em Workers & Pages, conecte o repositório `Fomes1574/QuizGomes` com estes valores:

| Campo | Valor |
|---|---|
| Worker name | `quiz-gomes` |
| Production branch | `main` |
| Root directory | `/` |
| Build command | `npm run build:cloudflare` |
| Deploy command | `npm run deploy:cloudflare` |
| Non-production branch builds | **Desativado** |
| Non-production branch deploy command | Não se aplica; deixe o padrão sem uso |

Em **Build variables and secrets**, adicione somente variáveis públicas:

| Variável | Valor | Motivo |
|---|---|---|
| `SKIP_DEPENDENCY_INSTALL` | `1` | impede a instalação automática duplicada; o script executa `npm ci` |
| `VITE_ENABLE_REALTIME_MATCHES` | `true` | libera a interface do Milestone 8 no bundle de teste |
| `VITE_FIREBASE_VAPID_PUBLIC_KEY` | chave **pública** Web Push do Firebase; opcional | habilita a inscrição FCM no PWA sem expor a chave privada |

Não adicione `CLOUDFLARE_API_TOKEN` manualmente: o token selecionado no campo próprio do Workers Builds é a credencial do pipeline. O arquivo `.node-version` fixa Node 22, suportado pela imagem oficial.

O root `/` é intencional. É nele que ficam `package-lock.json`, o `package.json` com os workspaces e os scripts que coordenam:

- `packages/domain`;
- `apps/web`;
- `apps/worker`.

O build executa `npm ci` e depois `npm run check`, que inclui lint, typecheck, todos os testes, a validação isolada das migrations D1 e os três builds. O deploy só é liberado quando `WORKERS_CI=1` e `WORKERS_CI_BRANCH=main`; imediatamente antes de tocar o D1 remoto, repete o gate de migrations, aplica somente versões pendentes e executa `wrangler deploy`. Nenhum script de produção referencia a pasta `seeds`.

Desative builds de branches não produtivas. Uma versão de preview usaria os mesmos bindings D1 reais e não existe um ambiente D1 separado autorizado para isso.

### 3.3. Variáveis de runtime

`FIREBASE_PROJECT_ID=quizgomes-cbc48` permanece em `vars` no `wrangler.jsonc`.

`ALLOWED_ORIGINS` não é definido em produção. O Worker reconhece dinamicamente a origem do próprio `request.url`, cobrindo o hostname `workers.dev` ainda desconhecido e futuros domínios próprios sem CORS aberto. Origens externas só entram por lista explícita; `*` é rejeitado. `http://localhost:5173` permanece somente em `apps/worker/.dev.vars` durante desenvolvimento.

Depois do primeiro login, configure o ADMIN sem terminal:

1. Firebase Console → Authentication → Users → abra sua conta → copie `User UID`;
2. Cloudflare → Workers & Pages → `quiz-gomes` → Settings → Variables & Secrets;
3. adicione uma variável do tipo **Secret**, nome `ADMIN_FIREBASE_UIDS`, valor igual ao UID;
4. salve e aguarde a nova versão/configuração ficar ativa;
5. saia e entre novamente no QUIZ GOMES ou atualize a sessão.

Para vários administradores, use UIDs separados por vírgula. Nunca use email, nome ou role enviada pelo cliente.

`ADMIN_FIREBASE_UIDS` não participa da verificação do ID Token. O Worker primeiro exige assinatura RS256 válida e confere `kid`, `aud`, `iss`, `exp`, `iat`, `auth_time` e `sub`; somente depois disso consulta o UID autenticado para autorização administrativa.

### 3.4. Firebase Cloud Messaging opcional e gratuito

Busca, pedidos, amizades, recusas, bloqueios e matchmaking funcionam integralmente sem configurar push. Nesse estado, Perfil mostra `Notificações ainda não configuradas` e nenhuma operação social falha. Para ativar o envio real:

1. Firebase Console → projeto `quizgomes-cbc48` → Project settings → **Cloud Messaging**. Confirme que **Firebase Cloud Messaging API (V1)** está habilitada; não habilite Firestore, Storage, Functions, Blaze ou billing.
2. Ainda em **Cloud Messaging** → **Web configuration** → **Web Push certificates**, gere um par Web Push/VAPID ou importe um par já administrado com segurança. Copie somente a **chave pública** exibida.
3. Cloudflare → Workers & Pages → `quiz-gomes` → **Settings → Builds → Build variables and secrets**: adicione `VITE_FIREBASE_VAPID_PUBLIC_KEY` com a chave **pública**. Por ser configuração do bundle, é necessária uma nova build/deploy após a alteração.
4. Firebase Console → Project settings → **Service accounts** → **Generate new private key**, ou Google Cloud IAM → Service Accounts → conta autorizada para Firebase Cloud Messaging → Keys. Crie a credencial somente se a política do projeto permitir; ela deve pertencer ao projeto `quizgomes-cbc48` e ter permissão para envio FCM HTTP v1.
5. Cloudflare → Workers & Pages → `quiz-gomes` → **Settings → Variables & Secrets**: crie uma variável do tipo **Secret** com nome exato `FCM_SERVICE_ACCOUNT_JSON` e cole o JSON completo diretamente no Dashboard seguro. Não envie o JSON/chave privada por chat, GitHub, commit, `VITE_`, variável pública de build ou screenshot. Salve e descarte a cópia local conforme sua política de segurança.
6. Aguarde a build/publicação e abra o PWA instalado em HTTPS. Em **Perfil → Notificações**, clique explicitamente em **Ativar notificações** e conceda a permissão. Repita nos outros navegadores/dispositivos desejados; cada FID permanece isolado e associado ao usuário autenticado.
7. Com B no PWA instalado/background, faça A buscar `#QG...` de B e enviar um pedido. O aparelho de B deve mostrar `Novo pedido de amizade`; tocar abre **Social → Pedidos**. Com B na aba aberta, o badge e a lista devem atualizar sem notificação do sistema duplicada.

O SDK instalado utiliza a API Web atual `register()` + `onRegistered()`; o backend envia FCM HTTP v1 com o campo `fid`, não registration token depreciado. `FCM_SERVICE_ACCOUNT_JSON` ausente ou inválido desativa push com segurança. O mesmo service worker Workbox trata shell offline e mensagens background; não registre outro service worker no root scope.

### 3.5. Diagnóstico seguro da autenticação

Rejeições de Firebase ID Token geram um evento estruturado `firebase_id_token_rejected` com apenas:

- `stage`: `configuration`, `header`, `keys`, `signature` ou `claims`;
- `reason`: categoria segura como `KEY_UNKNOWN`, `SIGNATURE_INVALID`, `AUDIENCE_INVALID`, `ISSUER_INVALID` ou `EXPIRATION_INVALID`.

O evento nunca contém ID Token, refresh token, cookie, UID, email, payload ou credencial. A resposta pública permanece genérica. No frontend, o primeiro 401 força `getIdToken(true)` e repete a mesma requisição uma única vez; um segundo 401 mostra que a sessão não pôde ser renovada e não entra em loop.

## 4. Migrations

`npm run test:migrations` já roda uma vez dentro do **Build command** (`build:cloudflare` → `check`), sobre o mesmo commit que o **Deploy command** vai publicar. Repeti-lo dentro de `deploy:cloudflare` era puro desperdício (a mesma validação local de ~6 minutos, sem cobrir nada novo) e consumia uma fração relevante do timeout de 20 min do Workers Builds Free (`docs/FREE_TIER_GUARDRAILS.md`) — corrigido: `deploy:cloudflare` não roda mais `test:migrations`. O gate `assert-cloudflare-production.mjs` já impede que este comando rode fora de `WORKERS_CI=1`/`WORKERS_CI_BRANCH=main`, e nesse ambiente o Deploy command só executa depois que o Build command (que inclui `test:migrations`) já passou no mesmo pipeline; não existe caminho de produção em que `deploy:cloudflare` rode sem essa validação ter acabado de passar sobre o mesmo commit.

O pipeline executa, nessa ordem e antes do deploy:

```bash
npm run build:cloudflare   # inclui test:migrations, entre outros checks
npm run db:migrate:remote
npm run deploy:cloudflare -w @quiz-gomes/worker
```

`test:migrations` aplica somente migrations pendentes:

- `QUESTIONS_DB`: `0001_questions.sql` até `0008_question_export_index.sql`;
- `CORE_DB`: `0001_core.sql` até `0016_reset_stale_pool_discovery.sql`.

Questions é aplicado primeiro para que o tema temporário só fique visível depois que seu pool estiver pronto. Wrangler registra o histórico em `d1_migrations`; retries não reaplicam versões concluídas. Se uma migration falhar, o D1 reverte integralmente aquela migration, preserva as anteriores e o deploy não começa. Arquivos já aplicados são imutáveis e qualquer correção posterior é forward-only. Uma migration que falhou e não foi registrada, como a primeira tentativa remota da `0004_theme_artwork.sql`, continua pendente e deve ser corrigida no próprio arquivo antes do retry — não recebe uma compensação vazia ou manual.

`npm run test:migrations` usa a versão fixada do Wrangler e não acessa Cloudflare. O gate:

- lê e passa todas as migrations pelo splitter SQL exportado pelo Wrangler, incluindo o statement de tracking;
- exige LF e bloqueia `CREATE TRIGGER`, pois compound statements continuam sujeitos a diferenças entre o splitter local e o parser multi-statement do endpoint D1 `/query` usado por migrations remotas;
- aplica Core `0001–0016` e Questions `0001–0008` em bancos vazios e isolados;
- prova os upgrades Core `0003→0004→0005→0006→0007→0008→0009→0010→0011→0012→0013→0014→0015→0016` e Questions `0002→0003→0004→0005→0006→0007→0008`, incluindo a passagem exata do pool sintético de 30 para 250 slots;
- valida pedidos cruzados, constraints direcionais de recusas/bloqueios e instalações FCM no schema social;
- inspeciona colunas, índice e FK composta, e tenta estados inválidos de metadata/BLOB;
- injeta uma migration temporária que falha depois de criar/escrever e comprova rollback de schema e de `d1_migrations`.

Esse gate remove a classe conhecida de SQL remoto frágil e testa o runtime D1 local real, sem mock. Ele não reproduz o parser hospedado do endpoint `/query` e, portanto, não substitui o smoke remoto automático do Workers Build. Não cole SQL no Dashboard para contornar uma falha: o retry da pipeline GitHub → Workers Builds → migrations → deploy permanece a única fonte de verdade.

Os únicos comandos de seed contêm `:local` no nome e não fazem parte de `build:cloudflare` nem de `deploy:cloudflare`. O conteúdo temporário de produção usa migrations próprias, IDs reservados e a flag `SYNTHETIC_SMOKE_TEST`; ele não reutiliza os seeds de desenvolvimento. Não cole SQL de fixture no Dashboard D1.

## 5. Validação local

Antes de publicar mudanças de deployment:

```bash
npm run check
npm run test:migrations
npm run db:migrate:local
```

O build do Worker usa `apps/web/dist` como static assets e `not_found_handling: single-page-application`. `/api/**` executa o Worker primeiro; o restante serve a PWA.

## 6. Primeiro deploy e smoke tests reais

O primeiro push/build bem-sucedido cria o Worker `quiz-gomes`, aplica as migrations Durable Objects SQLite declaradas (`v1`, `v2` para o hub social e `v3` para ChallengeRoom quando pendentes) e publica uma URL semelhante a:

```text
https://quiz-gomes.<seu-subdominio>.workers.dev
```

Depois:

1. adicione `quiz-gomes.<seu-subdominio>.workers.dev` aos Authorized Domains do Firebase;
2. abra `https://quiz-gomes.<seu-subdominio>.workers.dev/api/health` e confirme `{"name":"QUIZ GOMES","status":"ok","version":"0.1.0"}`;
3. faça login Google e configure `ADMIN_FIREBASE_UIDS` pelo Dashboard;
4. confirme que “Criar meu perfil” conclui o onboarding e que “Sair / trocar conta” volta à autenticação sem criar perfil;
5. confirme acesso ADMIN depois da autenticação; o secret de UID não deve alterar a aceitação do token;
6. selecione a categoria **INTERNO · TESTE SINTÉTICO TEMPORÁRIO**, abra o tema **Teste Multiplayer** e mantenha **Partida normal** nas duas contas;
7. em dois perfis/navegadores, conclua uma partida e confira pergunta X/Y, timer após os dois READY, bolinha amarela sem segredo e score adversário somente após resolução;
8. na primeira partida, desconecte o jogador 1 durante uma pergunta, aguarde mais de 7 segundos, confirme `Partida anulada` no jogador 2 e só então reabra o jogador 1; ele deve ir diretamente a `Partida anulada`, sem restaurar a pergunta;
9. com as mesmas duas contas, inicie imediatamente uma segunda partida e confirme que ela forma normalmente; depois repita com reconexão abaixo de 7 segundos e dupla queda;
10. confirme que o Conhecimento do tema continua em 0 nas duas contas e que os frames WebSocket nunca expõem `correctOption`, perguntas futuras ou a alternativa do adversário antes da resolução;
11. confira métricas D1/DO e confirme que eventos `firebase_id_token_rejected` não contêm tokens ou PII.

Esses itens só contam como **testes reais Cloudflare** quando executados no hostname implantado. Até lá, permanecem pendentes no ExecPlan.

As respostas corretas do dataset seguem o ciclo A/B/C/D pelo slot: 1=A, 2=B, 3=C, 4=D e então reinicia. Todas as 250 perguntas têm quatro opções mínimas, nenhuma imagem, fonte ou trivia real e a flag editorial exata `SYNTHETIC_SMOKE_TEST`. A ampliação é exclusiva deste dataset e não altera a regra global de sorteio uniforme sem histórico entre partidas.

A limpeza já está preparada em `apps/worker/maintenance/synthetic-smoke-test`, mas não faz parte do pipeline e não deve ser executada antes da autorização posterior do proprietário. Quando promovida a migrations novas, ela remove apenas o conteúdo marcado e preserva todo histórico de usuário/partida por meio de tombstones desativados quando houver referências.

## 7. Smoke físico pendente — M11 (editorial/missões/streak/perfil/paginação) e M12 (auditoria)

Nenhum destes itens foi executado fisicamente nesta entrega; ficam pendentes de confirmação do proprietário no hostname implantado, além da regressão completa do M8–M10 já registrada acima.

1. logado como ADMIN, abra **Perfil → Administração**: crie uma categoria, edite nome/ordem/status e confirme que ela aparece imediatamente no seletor de novo tema, sem F5; crie/aprove um tema e confirme que ele aparece imediatamente em Arte dos temas e Perguntas por tema, sem perder a seleção atual. Envie uma imagem pela própria tela de arte, confirme o recorte e salve: o WebP quadrado entre 256–512 px, reencodado pelo navegador, deve ser aceito inclusive quando trouxer perfil ICC técnico; EXIF/XMP, animação e formatos inválidos continuam recusados. Depois abra o catálogo e o detalhe do tema: a arte CUSTOM deve aparecer no lugar do ícone/fallback, inclusive após recarregar a página. Em **Perfil**, salve, troque e remova um avatar personalizado; ele deve reaparecer após reload e em outra aba. Aprove/rejeite um tema PENDING (proposto por outra conta) com nota de rejeição, edite um tema USER como o próprio OWNER e confirme que a edição de um tema OFFICIAL só é possível como ADMIN. Confirme também que a barra inferior tem apenas Temas, Social e Perfil, `/criar` retorna a Temas e a rota administrativa não é acessível a PLAYER;
2. no mesmo painel, crie uma pergunta nova para um tema (4 alternativas distintas; fonte opcional) e confirme que ela nasce **Em revisão** e não aparece em partida até ser aprovada; confirme que cada aba mostra apenas o status selecionado. Revise o enunciado, alternativas, correta e fontes antes de salvar; selecione perguntas verificadas e aprove o lote da página. Edite também uma pergunta ativa: ela deve continuar sorteável enquanto a nova revisão aguarda aprovação; aprove a revisão e só então confirme a troca. Por fim, desative uma ativa e confirme que ela some do sorteio sem quebrar a densidade dos slots restantes;
3. em **Perguntas por tema**, selecione o tema e importe um lote pequeno pelo novo formulário CSV/JSON (inclua uma linha inválida de propósito) para confirmar diagnóstico por linha, aplicação idempotente, associação obrigatória ao tema selecionado e ausência de importação parcial;
4. conceda e revogue ADMIN para uma conta de teste em **Usuários e papéis**, e confirme a entrada correspondente em **Trilha de auditoria**;
5. jogue uma partida Casual/Ranqueada válida até o fim e confirme, no Perfil, que a missão "Jogue uma partida válida" completa, "Responda perguntas"/"Acerte perguntas" avançam, e o streak do tema mostra 1/1; jogue de novo no mesmo dia e confirme que nada duplica; force um dia sem jogar e confirme que o streak atual zera sem alterar o recorde;
6. confirme no Perfil que partidas Ranqueadas totais (vitórias/derrotas/empates) e a média por categoria aparecem corretamente após pelo menos uma Ranqueada concluída em dois temas da mesma categoria;
7. bloqueie mais de 50 contas de teste (ou confirme via D1 direto) e no Perfil → Privacidade confirme que "Carregar mais" traz o restante sem duplicar nem perder a primeira página; repita o mesmo para pedidos de amizade pendentes recebidos/enviados na tela Social;
8. tente propor 6 temas em menos de uma hora com a mesma conta e confirme que a sexta tentativa é recusada com uma mensagem amigável, sem quebrar a interface;
9. confirme `npm audit --omit=dev` limpo no ambiente de deploy e que os cabeçalhos de segurança (CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) chegam em uma resposta real do hostname implantado.

## Rollback

- código: implantar um commit anterior validado;
- schema já aplicado: criar migration corretiva forward-only, nunca editar uma aplicada;
- migration que falhou e não consta em `d1_migrations`: corrigir o mesmo arquivo pendente e deixar a pipeline tentar novamente;
- conteúdo: desativar pergunta/tema por status, sem exclusão destrutiva;
- resultados: preservar o ledger idempotente durante retries.

## R2

Antes do primeiro deploy desta versão, crie em **Cloudflare → R2 → Create bucket** o bucket privado com o nome exato `quiz-gomes-question-images`. Mantenha o bucket sem domínio público e não habilite `r2.dev`: o binding `QUESTION_IMAGES` de `apps/worker/wrangler.jsonc` permite acesso somente pelo Worker. Não existe token, API key, variável de ambiente ou credencial R2 para colocar no GitHub.

O Worker só serve `GET`/`HEAD` para a chave WebP versionada que também consta em `questions.image_key`; uma chave arbitrária, objeto sem referência no D1 ou tipo incorreto retorna 404. As respostas recebem ETag, cache imutável e `nosniff`. O adapter preserva os metadados de licença/fonte, mas esta entrega não inclui uma tela de upload de imagens: perguntas novas continuam sem imagem até a próxima função administrativa validar e enviar os arquivos. Isso evita referências fantasma e mantém o bucket privado.

## Fontes oficiais consultadas

- <https://developers.cloudflare.com/workers/ci-cd/builds/configuration/>
- <https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/>
- <https://developers.cloudflare.com/workers/ci-cd/builds/build-image/>
- <https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/>
- <https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/>
- <https://developers.cloudflare.com/d1/reference/migrations/>
- <https://developers.cloudflare.com/d1/wrangler-commands/>
- <https://developers.cloudflare.com/d1/worker-api/d1-database/>
- <https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/>
- <https://github.com/cloudflare/workers-sdk/issues/4326>
- <https://github.com/cloudflare/workers-sdk/issues/4727>
- <https://github.com/cloudflare/workers-sdk/issues/14991>
- <https://github.com/cloudflare/workers-sdk/releases/tag/wrangler%404.121.0>
- <https://developers.cloudflare.com/fundamentals/api/reference/permissions/>
- <https://developers.cloudflare.com/workers/platform/pricing/>
- <https://developers.cloudflare.com/workers/runtime-apis/web-crypto/>
- <https://firebase.google.com/docs/auth/admin/verify-id-tokens>
- <https://firebase.google.com/docs/reference/js/auth.user>
- <https://firebase.google.com/docs/cloud-messaging/web/get-started>
- <https://firebase.google.com/docs/cloud-messaging/web/receive-messages>
- <https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages>
- <https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages/send>
- <https://github.com/panva/jose/blob/main/docs/key/import/functions/importX509.md>
