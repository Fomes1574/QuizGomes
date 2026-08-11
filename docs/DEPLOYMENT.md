# Deployment

O destino é Cloudflare Workers com static assets, D1 e Durable Objects SQLite, inicialmente em `workers.dev`. Este documento não ativa billing. Em 2026-08-10, o provisionamento real ficou bloqueado porque `wrangler whoami` retornou `You are not authenticated`.

Use somente **Workers Free**. Se painel ou CLI solicitar cartão, upgrade, Workers Paid, billing ou produto pago, cancele e pare. Não use `wrangler deploy --temporary`: uma conta preview não valida o ambiente real do proprietário.

## 1. Firebase

No console do projeto `quizgomes-cbc48`:

1. habilite Authentication → Sign-in method → Google;
2. mantenha `localhost` em Authorized Domains;
3. após obter o domínio `*.workers.dev`, adicione o **hostname sem `https://` e sem caminho** em Authentication → Settings → Authorized Domains;
4. faça o primeiro login e copie o Firebase UID do proprietário em Authentication → Users → selecione a conta → User UID;
5. configure esse UID em `ADMIN_FIREBASE_UIDS` no Worker.

A configuração Web existente é pública e está no bundle, como previsto pelo Firebase. A API key deve permanecer restrita no Google Cloud às APIs Firebase necessárias e aos domínios autorizados. Nunca adicione JSON de Service Account, chave privada ou credencial do Firebase Admin SDK.

## 2. Desbloquear e criar os recursos Cloudflare Free

```bash
npm install
cd apps/worker
npx wrangler login
npx wrangler whoami
npx wrangler d1 create quiz-gomes-core
npx wrangler d1 create quiz-gomes-questions-01
```

O login abre a autorização OAuth da Cloudflare; ele não exige token inventado. Confirme no painel que a conta continua em Workers Free antes de criar qualquer recurso.

Copie apenas os dois IDs retornados para os `database_id` correspondentes em `apps/worker/wrangler.jsonc`:

- ID de `quiz-gomes-core` substitui somente `00000000-0000-0000-0000-000000000001`;
- ID de `quiz-gomes-questions-01` substitui somente `00000000-0000-0000-0000-000000000002`.

Não altere nomes/bindings e não commite `.dev.vars`. UUID de D1 não é secret, mas a troca deve ser revisada como configuração antes do próximo commit.

Crie `apps/worker/.dev.vars` localmente:

```dotenv
ADMIN_FIREBASE_UIDS=uid_do_proprietario
ALLOWED_ORIGINS=http://localhost:5173
```

Depois do primeiro login no aplicativo implantado, abra Firebase Console → `quizgomes-cbc48` → Authentication → Users, clique na sua conta e copie **User UID**. No diretório `apps/worker`, grave-o como secret criptografado:

```bash
npx wrangler secret put ADMIN_FIREBASE_UIDS
```

Cole apenas o UID e confirme; para mais de um administrador, use UIDs separados por vírgula. Não coloque esse valor em `wrangler.jsonc`, `.env`, issue, log ou commit. Atualize a página após a nova versão do Worker ficar ativa.

`FIREBASE_PROJECT_ID` e `ALLOWED_ORIGINS` são configurações públicas e podem permanecer em `vars`. Tokens da Cloudflare, credenciais de CI e qualquer futuro segredo de servidor devem ficar no provedor de secrets do ambiente, sem arquivos versionados.

## 3. Migrations

Desenvolvimento local, quando necessário:

```bash
npm run db:migrate:local
npm run db:seed:local
```

Produção, a partir da raiz e somente depois de substituir os UUIDs:

```bash
npm run db:migrate:remote -w @quiz-gomes/worker
```

Seeds são somente desenvolvimento e **nunca** devem rodar em produção. O comando remoto aplica `0001_core.sql`, `0002_live_matches.sql` e `0001_questions.sql`; migrations já aplicadas não são reescritas.

## 4. Validar antes de publicar

```bash
npm run check
```

O build do Worker usa `apps/web/dist` como static assets e `not_found_handling: single-page-application`. `/api/**` executa o Worker primeiro; assets são servidos diretamente.

## 5. Deploy

```bash
npm run deploy -w @quiz-gomes/worker
```

O Wrangler solicitará confirmação/autenticação da conta Cloudflare se ainda não configurada. Não adicione cartão e não aceite upgrade. Se Durable Objects/D1 não estiverem disponíveis no plano gratuito da conta, interrompa o provisionamento e revise os limites.

O primeiro deploy aplica a migration Durable Objects `v1` de `wrangler.jsonc` e cria as classes SQLite `MatchRoom`, `MatchmakingQueue`, `PresenceHub` e `TicketBroker`; não há comando separado e não deve ser escolhida uma classe paga.

O Wrangler imprimirá uma URL semelhante a `https://quiz-gomes.<seu-subdominio>.workers.dev`. Esse valor ainda não existe nesta execução. Assim que existir:

```bash
curl --fail-with-body https://quiz-gomes.<seu-subdominio>.workers.dev/api/health
```

O JSON esperado é `{"name":"QUIZ GOMES","status":"ok","version":"0.1.0"}`. Em Firebase Authentication → Settings → Authorized Domains, adicione exatamente `quiz-gomes.<seu-subdominio>.workers.dev`, sem protocolo ou caminho.

Depois:

- faça login Google;
- obtenha/configure o UID pelo procedimento da seção 2;
- confirme criação do perfil e acesso ADMIN após atualizar a página;
- importe apenas conteúdo de teste aprovado pela API administrativa; não use os seeds de desenvolvimento;
- em dois perfis/navegadores, rode uma partida Casual completa, confirme pergunta X/Y, timer após os dois READY, bolinha amarela sem segredo, score após resolução e empate sem desempate;
- durante outra partida Casual, desconecte um navegador por menos de 7 s, confirme pausa integral/restauração e depois repita por mais de 7 s;
- confirme dupla queda/falha sem Conhecimento/XP e que cada perfil consegue buscar nova partida depois do término;
- confira métricas D1/DO e logs sem tokens/PII.

Registre esses itens como **testes reais Cloudflare** somente quando forem executados no hostname implantado. Até lá, eles permanecem pendentes no ExecPlan.

## Rollback

- código: deploy de commit anterior validado;
- schema: migrations são forward-only; criar migration corretiva, nunca editar uma aplicada;
- conteúdo: status permite desativar pergunta/tema sem exclusão destrutiva;
- resultados: ledger idempotente evita reprocessamento durante retry.

## R2

Não há binding R2 na V1 inicial. Quando houver decisão explícita, criar bucket gratuito, binding e adapter `R2ImageStorage`; impor `<100 KB` antes de persistir.
