# Deployment

Atualizado em 12 de agosto de 2026. O destino é um único Cloudflare Worker que serve API, PWA e Durable Objects em `workers.dev`, usando somente **Workers Free**.

Se o painel solicitar cartão, billing, Workers Paid, upgrade ou qualquer produto pago, cancele e pare. Não use deploy temporário, não crie R2 e não habilite recursos ausentes deste documento.

## 1. Firebase

No console do projeto `quizgomes-cbc48`:

1. habilite Authentication → Sign-in method → Google;
2. mantenha `localhost` em Authorized Domains para desenvolvimento;
3. após o primeiro deploy, adicione o hostname `quiz-gomes.<seu-subdominio>.workers.dev`, sem `https://` e sem caminho, em Authentication → Settings → Authorized Domains;
4. faça o primeiro login e copie o Firebase UID do proprietário em Authentication → Users → selecione a conta → User UID;
5. grave esse UID como o secret de runtime `ADMIN_FIREBASE_UIDS` no Worker.

A configuração Web existente é pública e está no bundle, como previsto pelo Firebase. A API key deve permanecer restrita no Google Cloud às APIs Firebase necessárias e aos domínios autorizados. Nunca adicione JSON de Service Account, chave privada ou credencial do Firebase Admin SDK.

## 2. Recursos D1 existentes

Os dois bancos foram criados manualmente no Dashboard e permanecem no Workers Free. Seus UUIDs não são secrets e estão versionados no `wrangler.jsonc`:

| Binding | Banco | ID |
|---|---|---|
| `CORE_DB` | `quiz-gomes-core` | `3260deba-54ab-4e47-8c7f-a4d088dad728` |
| `QUESTIONS_DB` | `quiz-gomes-questions-01` | `40ea8ac4-9dd6-40a8-b032-89cb3cede229` |

Não execute `wrangler d1 create`, não altere esses nomes e não crie outros bancos. Os comandos remotos usam `--experimental-provision=false` para impedir provisionamento inferido; o deploy ainda aplica normalmente as classes Durable Objects SQLite declaradas explicitamente na migration `v1`.

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

### 3.4. Diagnóstico seguro da autenticação

Rejeições de Firebase ID Token geram um evento estruturado `firebase_id_token_rejected` com apenas:

- `stage`: `configuration`, `header`, `keys`, `signature` ou `claims`;
- `reason`: categoria segura como `KEY_UNKNOWN`, `SIGNATURE_INVALID`, `AUDIENCE_INVALID`, `ISSUER_INVALID` ou `EXPIRATION_INVALID`.

O evento nunca contém ID Token, refresh token, cookie, UID, email, payload ou credencial. A resposta pública permanece genérica. No frontend, o primeiro 401 força `getIdToken(true)` e repete a mesma requisição uma única vez; um segundo 401 mostra que a sessão não pôde ser renovada e não entra em loop.

## 4. Migrations

O pipeline executa, nessa ordem e antes do deploy:

```bash
npm run test:migrations
npm run db:migrate:remote
npm run deploy:cloudflare -w @quiz-gomes/worker
```

O primeiro comando aplica somente migrations pendentes:

- `QUESTIONS_DB`: `0001_questions.sql` e `0002_synthetic_smoke_test.sql`;
- `CORE_DB`: `0001_core.sql`, `0002_live_matches.sql`, `0003_synthetic_smoke_test.sql` e `0004_theme_artwork.sql`.

Questions é aplicado primeiro para que o tema temporário só fique visível depois que seu pool estiver pronto. Wrangler registra o histórico em `d1_migrations`; retries não reaplicam versões concluídas. Se uma migration falhar, o D1 reverte integralmente aquela migration, preserva as anteriores e o deploy não começa. Arquivos já aplicados são imutáveis e qualquer correção posterior é forward-only. Uma migration que falhou e não foi registrada, como a primeira tentativa remota da `0004_theme_artwork.sql`, continua pendente e deve ser corrigida no próprio arquivo antes do retry — não recebe uma compensação vazia ou manual.

`npm run test:migrations` usa a versão fixada do Wrangler e não acessa Cloudflare. O gate:

- lê e passa todas as migrations pelo splitter SQL exportado pelo Wrangler, incluindo o statement de tracking;
- exige LF e bloqueia `CREATE TRIGGER`, pois compound statements continuam sujeitos a diferenças entre o splitter local e o parser multi-statement do endpoint D1 `/query` usado por migrations remotas;
- aplica Core `0001–0004` em banco vazio;
- aplica `0001–0003`, verifica o estado exato e só então aplica `0004`;
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

O primeiro push/build bem-sucedido cria o Worker `quiz-gomes`, aplica a migration Durable Objects SQLite `v1` e publica uma URL semelhante a:

```text
https://quiz-gomes.<seu-subdominio>.workers.dev
```

Depois:

1. adicione `quiz-gomes.<seu-subdominio>.workers.dev` aos Authorized Domains do Firebase;
2. abra `https://quiz-gomes.<seu-subdominio>.workers.dev/api/health` e confirme `{"name":"QUIZ GOMES","status":"ok","version":"0.1.0"}`;
3. faça login Google e configure `ADMIN_FIREBASE_UIDS` pelo Dashboard;
4. confirme que “Criar meu perfil” conclui o onboarding e que “Sair / trocar conta” volta à autenticação sem criar perfil;
5. confirme acesso ADMIN depois da autenticação; o secret de UID não deve alterar a aceitação do token;
6. selecione a categoria **INTERNO · TESTE SINTÉTICO TEMPORÁRIO**, abra o tema **Teste Multiplayer** e mantenha **Fácil + Casual** nas duas contas;
7. em dois perfis/navegadores, conclua uma partida e confira pergunta X/Y, timer após os dois READY, bolinha amarela sem segredo e score adversário somente após resolução;
8. inicie uma nova partida para confirmar a liberação dos locks;
9. repita com reconexão abaixo de 7 segundos, queda individual acima de 7 segundos e dupla queda, sempre confirmando que uma partida terminada/anulada libera ambos os usuários;
10. confirme que o Conhecimento do tema continua em 0 nas duas contas e que os frames WebSocket nunca expõem `correctOption`, perguntas futuras ou a alternativa do adversário antes da resolução;
11. confira métricas D1/DO e confirme que eventos `firebase_id_token_rejected` não contêm tokens ou PII.

Esses itens só contam como **testes reais Cloudflare** quando executados no hostname implantado. Até lá, permanecem pendentes no ExecPlan.

As respostas corretas do dataset seguem o ciclo A/B/C/D pelo número da pergunta: 01=A, 02=B, 03=C, 04=D e então reinicia. Todas as 30 perguntas têm quatro opções, nenhuma imagem ou trivia real e a flag editorial exata `SYNTHETIC_SMOKE_TEST`.

A limpeza já está preparada em `apps/worker/maintenance/synthetic-smoke-test`, mas não faz parte do pipeline e não deve ser executada antes da autorização posterior do proprietário. Quando promovida a migrations novas, ela remove apenas o conteúdo marcado e preserva todo histórico de usuário/partida por meio de tombstones desativados quando houver referências.

## Rollback

- código: implantar um commit anterior validado;
- schema já aplicado: criar migration corretiva forward-only, nunca editar uma aplicada;
- migration que falhou e não consta em `d1_migrations`: corrigir o mesmo arquivo pendente e deixar a pipeline tentar novamente;
- conteúdo: desativar pergunta/tema por status, sem exclusão destrutiva;
- resultados: preservar o ledger idempotente durante retries.

## R2

Não há binding, bucket, script ou permissão de R2 neste deployment. A camada de imagens continua abstrata e R2 só poderá ser considerado com autorização explícita futura.

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
- <https://github.com/panva/jose/blob/main/docs/key/import/functions/importX509.md>
