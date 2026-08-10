# Deployment

O destino é Cloudflare Workers com static assets, D1 e Durable Objects, inicialmente em `workers.dev`. Este documento não provisiona nem ativa billing.

## 1. Firebase

No console do projeto `quizgomes-cbc48`:

1. habilite Authentication → Sign-in method → Google;
2. mantenha `localhost` em Authorized Domains;
3. após obter o domínio `*.workers.dev`, adicione-o em Authentication → Settings → Authorized Domains;
4. faça o primeiro login e copie o Firebase UID do proprietário;
5. configure esse UID em `ADMIN_FIREBASE_UIDS` no Worker.

A configuração Web existente é pública e está no bundle, como previsto pelo Firebase. A API key deve permanecer restrita no Google Cloud às APIs Firebase necessárias e aos domínios autorizados. Nunca adicione JSON de Service Account, chave privada ou credencial do Firebase Admin SDK.

## 2. Cloudflare local

```bash
npm install
npx wrangler login
npx wrangler d1 create quiz-gomes-core
npx wrangler d1 create quiz-gomes-questions-01
```

Copie apenas os IDs retornados para os campos `database_id` de `apps/worker/wrangler.jsonc`. Os UUIDs `00000000-0000-0000-0000-000000000001` e `00000000-0000-0000-0000-000000000002` são placeholders locais distintos e devem ser substituídos antes do deploy. Não commite `.dev.vars`.

Crie `apps/worker/.dev.vars` localmente:

```dotenv
ADMIN_FIREBASE_UIDS=uid_do_proprietario
ALLOWED_ORIGINS=http://localhost:5173
```

Em ambientes remotos, `ADMIN_FIREBASE_UIDS` deve ser gravado como secret criptografado, nunca em `vars` do `wrangler.jsonc`:

```bash
npx wrangler secret put ADMIN_FIREBASE_UIDS
```

`FIREBASE_PROJECT_ID` e `ALLOWED_ORIGINS` são configurações públicas e podem permanecer em `vars`. Tokens da Cloudflare, credenciais de CI e qualquer futuro segredo de servidor devem ficar no provedor de secrets do ambiente, sem arquivos versionados.

## 3. Migrations

```bash
npm run db:migrate:local
npm run db:seed:local
npm run db:migrate:remote -w @quiz-gomes/worker
```

Seeds são somente desenvolvimento e nunca devem rodar em produção.

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

Depois:

- teste `/api/health`;
- adicione o domínio no Firebase Authorized Domains;
- faça login Google;
- confirme criação do perfil e role ADMIN pelo UID;
- rode smoke tests de tema, partida e reconexão em dois navegadores;
- confira métricas D1/DO e logs sem tokens/PII.

## Rollback

- código: deploy de commit anterior validado;
- schema: migrations são forward-only; criar migration corretiva, nunca editar uma aplicada;
- conteúdo: status permite desativar pergunta/tema sem exclusão destrutiva;
- resultados: ledger idempotente evita reprocessamento durante retry.

## R2

Não há binding R2 na V1 inicial. Quando houver decisão explícita, criar bucket gratuito, binding e adapter `R2ImageStorage`; impor `<100 KB` antes de persistir.
