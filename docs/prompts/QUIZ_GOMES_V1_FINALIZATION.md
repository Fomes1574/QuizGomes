# QUIZ GOMES V1 — prompt operacional de finalização

Use este prompt para retomar a V1 com contexto compacto. Regras mais recentes:
`AGENTS.md` → seção **Estado vigente** do `docs/plans/QUIZ_GOMES_V1.md` →
`ARCHITECTURE.md`/`DEPLOYMENT.md`/`FREE_TIER_GUARDRAILS.md` → código. Trechos
históricos explicam decisões passadas, mas não restabelecem regras antigas.

## Modo de trabalho

- Repo `Fomes1574/QuizGomes`, produção em `main`. Primeiro confira o HEAD remoto;
  se avançou, adapte sem reset/revert. Preserve alterações alheias.
- Leia os documentos acima e o código afetado antes de mudar algo. Faça commits
  lógicos e push fast-forward normal; sem force push e sem PR salvo pedido.
- Atualize o ExecPlan em cada marco. Teste automatizado não é smoke físico. Nunca
  alegue smoke/deploy não executado. Se a execução terminar antes, publique um
  checkpoint íntegro, atualize o plano e informe o próximo ponto exato.
- Não mexa em milestones FROZEN salvo regressão comprovada ou integração mínima.
  FROZEN: M8, M8.5, M9A.1, M9B e M9C+M10. O smoke completo deles reaparece no
  M12.

## Regras de domínio e infraestrutura já fechadas

- React/Vite PWA + Worker Cloudflare + D1 + DO/WebSocket; Firebase apenas Google
  Auth e FCM opcional. Sem polling, Firestore, RTDB, Storage, Functions, KV de
  presença, Workers Paid, billing ou serviço pago.
- Categoria → Tema → Dificuldade → Pergunta; sem subtemas. Navbar fora do jogo:
  Temas, Social, Criar, Perfil. UI pt-BR, claro/escuro/sistema.
- EASY/MEDIUM/HARD = **5/8/12**; 10 s; quatro opções distintas, uma correta.
  Seleção uniforme em slots densos sem `ORDER BY RANDOM()` e sem histórico entre
  partidas; apenas sem repetição na própria partida. Descoberta não afeta sorteio.
- Servidor é autoridade de tempo, resposta, score, XP, Conhecimento e terminal.
  Acerto = `10 + ceil(remainingMs/1000)` limitado a 10; erro/timeout 0; empate e
  VOID dão 0 XP/Conhecimento. Casual nunca altera Conhecimento.
- Reconexão `<7000 ms` retoma; `>=7000 ms` é `VOID`. Social realtime sem polling.
- Amigos: máximo 200; `ONLINE` é a única presença elegível para DIRECT. Desafios
  sempre Casual: DIRECT 30 s, ASYNC sem expiração, no máximo um vivo de cada tipo
  por dupla e podem coexistir. Preservar sigilo ASYNC, cancelamento, recovery e
  `CHALLENGE_UPDATED`.
- R2 não está autorizado nem provisionado. Manter `ImageStorage` intercambiável,
  chaves opacas e validação de servibilidade. Quando R2 for autorizado, criar só
  adapter/configuração; não alterar contratos editoriais nem aceitar imagem sem
  backend que a entregue.

## Escopo autorizado restante

### 1. Reports de perguntas — entregue; preservar

Modal discreto sem pausar timer, revisão pós-partida, motivos fechados, rate
limit, idempotência e fila ADMIN paginada já existem. A autorização depende de
`question_report_views` (Core `0011`): recibo por contexto/usuário/rodada
registrado somente na projeção de uma pergunta; nunca voltar a inferir
visualização apenas de `match_questions`/`challenge_questions`, pois o conjunto
é selado antecipadamente. A fila mostra snapshot, contexto, fontes HTTP(S)
seguras e stats existentes. O CRUD de editar/desativar fica no M11, sem ação
fantasma no painel de reports. Não recalcular score/XP/Conhecimento.

### 2. Conteúdo/admin (M11)

- Usuário propõe tema; aprovação torna o criador OWNER. OWNER+ADMIN criam/alteram
  perguntas só nos próprios temas USER; usuário comum nunca altera tema oficial.
- Pergunta ACTIVE editada gera revisão/versionamento; publicação atual permanece
  ativa até aprovação. IN_REVIEW não entra em pool.
- Admin: categorias CRUD/status/ordem; temas/ownership; perguntas/fontes/
  moderação; artwork existente; import JSON/CSV idempotente, pequeno, validado,
  sem import parcial; batches/diagnóstico; usuários/roles/audit logs/stats.
- Publicação exige fonte, quatro alternativas distintas, uma correta, validador
  editorial visual, slots densos, status/versionamento e atualização idempotente
  de `question_pools.active_count`/`themes.active_question_count`.
- Sem R2: deixar pergunta sem imagem e informar indisponibilidade; não criar
  upload fantasma.

### 3. Estatísticas, missões e perfil

- `question_statistics`: registrar idempotentemente respostas, certo/errado,
  A/B/C/D, tempo total e uso em matchmaking, DIRECT e ASYNC. Usar outbox/retry ou
  mecanismo equivalente CORE→QUESTIONS; analytics nunca atrasa resultado e nunca
  influencia sorteio.
- Três missões pessoais/dia, geradas uma vez por user/day: concluir partida válida,
  responder 8, acertar 5. Eventos autoritativos; VOID/cancel não contam; sem
  polling/timer writes/recompensa inventada.
- Study streak por user+tema: dia conta com uma partida válida concluída; guardar
  current/best/lastActiveDay, chave de dia server-side documentada (V1: UTC),
  idempotência e reset de current após lacuna. Fallback de tema ativo determinístico
  e indexado.
- Perfil: nível/XP, melhor tema real, Conhecimento, partidas W/L/D, média de
  categoria existente, missões/streak. Não inventar catálogo cosmético.
- FCM, se configurado: ASYNC pronto para segundo jogador, respeitando mute e
  best-effort; foreground só realtime, DIRECT sem push obrigatório.

### 4. M12 hardening

Adicionar/rodar E2E para auth/onboarding/intent, catálogo, Casual/Ranked,
ranking/XP, social/limite/mute/block, matchmaking, DIRECT/ASYNC/reconnect,
reports, missões/streak e admin/import. Playwright apenas dev dependency.

Auditar e corrigir: claims/ADMIN/OWNER/IDOR, schemas estritos, CSRF/origin,
no-store competitivo, rate limits, replay/double submit, multi-tab/device,
locks órfãos, índices/paginação/rows_read, CSP/HSTS/XCTO/referrer/permissions,
segredos, CSV abuse, offline/reload/PWA swap/Firebase restore, lazy chunks,
reduced motion, teclado/foco/dialog/inert/ARIA/contraste/touch e 360/390/412px +
desktop. Sem polling ou writes periódicos.

## Migrations e validação

- Migrations aplicadas são imutáveis; toda mudança nova é forward-only a partir de
  Core `0011` e Questions `0004`. Validar banco vazio, upgrade `0009→latest` e
  rollback. Questions antes de Core quando necessário.
- Antes do push final: lint, typecheck, unit/domain, Worker/DO/WebSocket,
  migrations, build, audit de produção, secrets, diff, E2E disponível,
  performance e Free Tier. Corrigir falhas; não reduzir escopo silenciosamente.
- Após código/testes e deploy, o único estado permitido é
  **`V1 READY FOR FINAL PHYSICAL SMOKE`**. Não marcar V1 finalizada. O proprietário
  executa smoke de login/intent/onboarding, 5/8/12 Casual/Ranked, DIRECT/ASYNC/7s,
  Social/200/mute/block, reports/admin, owner/import, missões/streak,
  notificações configuradas, mobile/desktop/dark/PWA. Só depois de aprovação
  explícita: docs-only commit final, M11/M12 concluídos e V1 finalizada.
