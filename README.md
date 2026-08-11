# QUIZ GOMES

Aplicativo de quiz competitivo, mobile-first e instalável, construído com React, TypeScript, Vite, Cloudflare Workers, D1, Durable Objects e Firebase Authentication.

> Estado atual: fundação da V1 em desenvolvimento. Os dados incluídos no repositório são fixtures sintéticas e não conteúdo editorial de produção.

## Pré-requisitos

- Node.js 22.12 ou superior
- npm 10.9 ou superior
- Conta Cloudflare no Workers Free
- Projeto Firebase `quizgomes-cbc48` com Google Authentication habilitado

## Desenvolvimento

```bash
npm install
npm run db:migrate:local
npm run db:seed:local
npm run dev:worker
npm run dev:web
```

O Vite roda em `http://localhost:5173` e encaminha `/api` ao Worker local em `http://localhost:8787`.

## Validação completa

```bash
npm run check
```

## Workers Builds

O deployment conectado ao GitHub parte da raiz do monorepo:

```bash
npm run build:cloudflare
npm run deploy:cloudflare
```

O primeiro script instala pelo lockfile e valida os três workspaces. O segundo é restrito ao Workers Builds na branch `main`, aplica migrations D1 remotas e publica Worker + PWA. Veja os campos exatos e o token de menor privilégio em [Deployment](docs/DEPLOYMENT.md). Seeds nunca integram o pipeline remoto.

## Documentação

- [Especificação mestre](docs/MASTER_SPEC.md)
- [Arquitetura](docs/ARCHITECTURE.md)
- [Sistema de perguntas](docs/QUESTION_SYSTEM.md)
- [Guardrails do free tier](docs/FREE_TIER_GUARDRAILS.md)
- [Deployment](docs/DEPLOYMENT.md)
- [ExecPlan da V1](docs/plans/QUIZ_GOMES_V1.md)
