# QUIZ GOMES — contexto operacional compacto (V1 → V2)

Use para retomar o projeto. Fonte de verdade, nesta ordem: `AGENTS.md` →
**Estado vigente** de `docs/plans/QUIZ_GOMES_V1.md` →
`ARCHITECTURE.md`/`DEPLOYMENT.md`/`FREE_TIER_GUARDRAILS.md` → código. Histórico
não reativa regra antiga.

## Processo

- Produção: `main`; confira HEAD remoto, adapte sem reset/revert, preserve trabalho
  alheio. Commit lógico e push fast-forward direto; sem PR/force-push.
- Antes de mudar: leia os documentos acima e o código afetado. Atualize o ExecPlan
  em marco relevante. Nunca alegue smoke/deploy físico sem executá-lo.
- Para regra/código: lint, typecheck, testes aplicáveis, Worker/DO/WS,
  migrations, build, audit de produção, secrets e diff. Migration aplicada é
  imutável; toda correção é forward-only.
- Sem billing, Workers Paid, R2, KV para presença, Firestore/RTDB/Storage/
  Functions, polling, serviço externo ou OpenAI no app sem autorização explícita.

## Produto e regras congeladas

- Stack: React/TS/Vite PWA; um Worker Cloudflare com CORE_DB + QUESTIONS_DB,
  Durable Objects/WebSockets; Firebase apenas Google Auth e FCM opcional.
- UI pt-BR; claro/escuro/sistema; fora do jogo: **Temas, Social, Perfil**.
  Criação pública está desativada; ADMIN é rota interna pelo Perfil.
- Hierarquia: Categoria → Tema → Dificuldade → Pergunta; nunca subtema.
  Fonte/evidência é opcional na V1.
- Fácil/Médio/Difícil = **5/8/12**, 10 s, 4 alternativas distintas/1 correta.
  Slots densos + sorteio uniforme, sem `ORDER BY RANDOM()` e sem histórico entre
  partidas; somente não repetir dentro da mesma partida.
- Servidor decide deadline, resposta, score, terminal, XP e Conhecimento. Acerto
  `10 + ceil(remainingMs/1000)` (máx. 20); erro/timeout 0; empate/VOID 0 XP e
  Conhecimento; Casual nunca muda Conhecimento. Ranking é por tema.
- Reconnect: `<7000 ms` retoma; `>=7000 ms` é VOID. Sem polling ou escrita D1
  periódica de presença.
- Amigos: máximo 200; somente ONLINE é elegível a DIRECT. DIRECT dura 30 s;
  ASYNC não expira; um de cada por dupla, coexistem e são sempre Casual. Preserve
  sigilo ASYNC, cancelamento, recovery, locks e `CHALLENGE_UPDATED`.

## Entregue e não regredir

- M8/M8.5, M9A.1, M9B e M9C+M10 estão FROZEN/aprovados. MatchRoom e
  ChallengeRoom são autoridade; não duplicar motor/realtime. Correctives recentes
  cobrem grace indevida de 7 s em convite, corrida accept×cancel/decline,
  recovery ASYNC, efeitos XP/stats/missões idempotentes e accept duplicado.
- Social: busca segura, pedidos, mute/block/unfriend, presença autorizada e
  realtime sem polling. A regressão integral volta no smoke final.
- M11 está implementado: categorias/temas/OWNER, CRUD e revisão versionada de
  perguntas, moderação, import CSV/JSON idempotente sem parcial, lotes,
  audit log, roles, reports, stats, missões/streak e Perfil real. Pergunta em
  revisão não entra no pool; editar ACTIVE mantém a publicada até aprovação.
- Reports: só para pergunta realmente vista; idempotência/rate limit, fila ADMIN
  paginada e sem alterar resultado retroativamente.
- Arte de tema e avatar custom usam BLOB D1 versionado. O leitor normaliza o
  formato remoto `number[]`/`ArrayBuffer` e valida tamanho antes de servir;
  correção publicada e aprovada fisicamente. Pergunta continua sem imagem até R2.
- Conteúdo real inicial: **Games → Elden Ring**, 50 perguntas Fáceis ativas.
  Adicionar 8 Médias e 12 Difíceis antes de divulgar os três níveis. Não misturar
  fixture `SYNTHETIC_SMOKE_TEST` com catálogo real.

## Estado real da V1

**V1 READY FOR FINAL PHYSICAL SMOKE; não finalizada.** M12 recebeu auditoria
pontual, mas a suíte originalmente pedida `test:e2e`/`check:full` ainda não
existe. Para finalizar honestamente:

1. Criar/rodar E2E (dev-only) para auth/onboarding/intent, catálogo, Casual/
   Ranked, XP/ranking, Social/200/mute/block, matchmaking, DIRECT/ASYNC/7 s,
   reports, missões/streak e ADMIN/import.
2. Executar e o proprietário aprovar o smoke de produção em
   `DEPLOYMENT.md` §7: login/reload/PWA, 5/8/12, desafio, presença, bloqueio,
   imagens/avatar, admin/import, missões e mobile/desktop/dark.
3. Só após a aprovação explícita: registrar smoke, concluir M11/M12 se preciso,
   marcar **V1 FINALIZADO** e fazer commit final apenas de docs.

O `workers.dev` atual é público. Domínio próprio é configuração externa:
exige domínio registrado; adicionar zona Cloudflare, Custom Domain no Worker e
hostname em Firebase Authorized Domains. Sem domínio pago, é possível mudar o
subdomínio **da conta** `workers.dev`, o que muda URLs de todos os Workers da
conta; não renomear o Worker `quiz-gomes` sem plano de migração de DOs.

## V2 — R2, somente após autorização

R2 não bloqueia V1. A documentação Cloudflare exige checkout/assinatura mesmo
com cota gratuita: parar e pedir autorização de billing antes de provisionar.
V2/R2 deve começar somente quando houver imagens reais licenciadas para perguntas:

- bucket privado + binding somente no Worker; sem `r2.dev`, credenciais no cliente
  ou upload fantasma;
- adapter `ImageStorage` compatível, chaves opacas/versionadas, GET via Worker
  com ETag/cache, ACL ADMIN/OWNER e limites/rate limit;
- validar licença, tipo, dimensão, tamanho, metadados e abuso; transcodar WebP;
  import atômico, referências consistentes e limpeza segura de objetos;
- testes de auth/IDOR/retry/orphan, orçamento Free Tier e migração forward-only.

Não migrar arte/avatar D1 que já funciona sem necessidade. Antes de qualquer
V2, registrar escopo, custo e aprovação explícita do proprietário.
