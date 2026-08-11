# ExecPlan — QUIZ GOMES V1

## Objetivo

Entregar uma fundação real, testável e retomável do QUIZ GOMES: PWA responsiva, autenticação Firebase validada no Worker, modelo D1, motores de ranking/XP/perguntas/partida e bases seguras para realtime, social, assíncrono e administração.

## Progresso

- [x] 2026-08-10 — prompt mestre consolidado em documentação persistente.
- [x] 2026-08-10 — repositório remoto identificado (`Fomes1574/QuizGomes`) e constatado vazio.
- [x] 2026-08-10 — validação Firebase e limites Cloudflare confirmados em documentação oficial atual.
- [x] 2026-08-10 — Milestone 0: scaffold, scripts, lint, typecheck, testes e build.
- [x] 2026-08-10 — Milestone 1: tokens, Claro/Escuro/Sistema, shell, quatro abas e PWA.
- [x] 2026-08-10 — Milestone 2: login Google, onboarding, verificação server-side e bootstrap ADMIN.
- [x] 2026-08-10 — Milestone 3: migrations e repositories D1.
- [x] 2026-08-10 — Milestone 4: busca, categorias, tema, Top 5, ranking e descoberta pessoal.
- [x] 2026-08-10 — Milestone 5: motores de ranking e XP completos.
- [x] 2026-08-10 — Milestone 6: pools, recentes 200, bitmap, fixtures e import foundation.
- [x] 2026-08-10 — Milestone 7: scoring, projeção segura e interface local isolada de partida.
- [x] 2026-08-10 — publicação pública autorizada pelo proprietário e auditoria específica de segredos concluída antes dos commits.
- [x] 2026-08-10 — 107 arquivos publicados em commits lógicos na `main`; árvore remota comparada byte a byte e auditoria pós-push sem secrets.
- [x] 2026-08-10 — Milestone 8: motor autoritativo, sala WebSocket, reconexão, resultado transacional e interface realtime concluídos e validados localmente.
- [x] 2026-08-10 — Milestone 8: runtime Workers simulado validado com WebSockets, D1 e storage real de Durable Object do ambiente de testes.
- [ ] Milestone 8 — validação real em `workers.dev` bloqueada somente pela autenticação Cloudflare do proprietário; nenhum recurso remoto foi criado ou alterado.
- [ ] Milestone 9 — social e desafio direto.
- [ ] Milestone 10 — assíncrono selado e revelação progressiva.
- [ ] Milestone 11 — criação/moderação/import/admin.
- [ ] Milestone 12 — e2e, performance, acessibilidade, segurança e deploy.

## Decisões

1. **Monorepo npm simples.** Três workspaces evitam tooling excessivo e isolam domínio puro.
2. **Validação Firebase sem Service Account.** `jose` valida RS256 e claims com certificados públicos rotativos, conforme a documentação Firebase para runtimes sem Admin SDK nativo.
3. **Durable Objects SQLite + Hibernation.** É o backend disponível no plano gratuito e evita duração ociosa.
4. **Estado usuário+pool binário.** Fila recente e bitmap histórico ficam em uma row compacta versionada.
5. **Slots densos.** Sorteio uniforme por inteiro e índice; nunca `ORDER BY RANDOM()`.
6. **Categoria usa média ordinal fracionária.** Apenas temas com Ranqueada, cap em Desafiante I, sem efeito competitivo.
7. **R2 adiado.** Adapter local existe; nenhum recurso pago será ativado.
8. **Repositório público autorizado.** A autorização explícita do proprietário em 2026-08-10 substitui a exigência anterior de repositório privado. Configuração Web Firebase pode ser pública; credenciais de servidor permanecem fora do Git.
9. **Sala simultânea é autoridade única.** O Durable Object recebe somente READY, opção escolhida e comandos de conexão; deadline, `remainingMs`, correção, score, progressão e resultado são derivados no servidor e persistidos a cada transição.
10. **Exclusividade e resultado no D1.** `active_match_players` impede duas partidas por usuário; `result_ledger`, `result_version` e um único `D1Database.batch()` tornam resultado, XP, Conhecimento, histórico e liberação do lock transacionais e idempotentes.
11. **Deploy real não é simulado.** Ausência de login Cloudflare é bloqueio externo; preview temporário, credenciais inventadas, billing e produtos pagos não substituem validação em conta real.

## Descobertas e riscos

- O repositório está **público** por decisão explícita do proprietário. A árvore versionável foi auditada antes da publicação; somente a configuração Web pública do Firebase foi mantida no frontend.
- O ambiente não possui `gh`; publicação, quando segura, usará a API Git do conector ou exigirá instalação externa.
- A logo oficial não foi anexada. A UI usará slot técnico claramente substituível, sem redesenho artístico.
- Alterar slots ativos exige versionar/migrar bitmaps; a V1 bloqueará publicação durante migração para preservar descoberta exata.
- Revogação imediata de Firebase tokens não é consultada por request sem Admin API; avaliar em hardening para ações críticas.
- Bindings D1 locais também precisam de UUIDs-placeholder distintos; IDs iguais fazem o Wrangler compartilhar o mesmo arquivo SQLite entre shards. A auditoria pré-publicação corrigiu essa colisão.
- O helper de evicção do runtime Vitest bloqueou com WebSockets hibernáveis ativos. O teste simulado comprova estado pausado no storage e reconexão WebSocket pelo mesmo caminho de restauração; evicção/hibernação efetiva permanece parte do smoke test em `workers.dev` e não foi declarada como executada localmente.
- `wrangler whoami`, executado em 2026-08-10, retornou `You are not authenticated`. Não foram criados D1, aplicadas migrations remotas, provisionados Durable Objects nem realizado deploy/seed remoto.

## Testes requeridos por marco

- M0/M1: lint, typecheck, unit, build e render responsivo básico.
- M2: token ausente/inválido, claim incorreta, ADMIN falsificado, onboarding idempotente.
- M5: thresholds, overflow, rebaixamento, cap, tabela, simulação ~2.457; XP exemplos/total/cap.
- M6: recentes 200/201, união, bitmap round-trip, uniformidade estrutural e pool insuficiente.
- M7: scoring em limites de ms, timeout, empate, navbar ausente e overflow.
- M8+: cancelamento, readiness, reconexão 7 s, dupla queda, finalização idempotente e vazamento assíncrono.
- M8 concluído local/simulado: 5/10/15 rodadas, empate, Casual sem Conhecimento, XP, abandono, dupla queda, lock único, payload estrito, sigilo do adversário, retry idempotente e transação D1; hibernação e smoke HTTP/WebSocket reais continuam pendentes do login Cloudflare.

## Diário de execução

### 2026-08-10 — início

- Repositório remoto sem commits/conteúdo.
- Stack atualizada com Node 22+, React/Vite, Wrangler, D1 e DO.
- Fontes oficiais consultadas e registradas.
- Próximo: concluir scaffold e motores puros, instalar dependências e fechar o primeiro ciclo `npm run check`.

### 2026-08-10 — checkpoint implementado

Entregue localmente:

- monorepo npm com domínio puro, React/PWA e Worker;
- sistema visual responsivo com as quatro abas exatas, tema Claro/Escuro/Sistema e `prefers-reduced-motion`;
- Firebase Google Auth, onboarding, ID público imutável e role ADMIN por UID do ambiente;
- D1 core/question shard com schemas de usuários, social, rankings, matches, perguntas, fontes, stats, cosméticos e auditoria;
- catálogo, busca, página de tema, Top 5, ranking pessoal e descoberta histórica por bitmap;
- ranking/Conhecimento, média de categoria, XP, scoring, resultado idempotente e regras de conexão;
- pool denso, seleção uniforme, união das últimas 200 e importação administrativa idempotente para revisão;
- tickets WebSocket de uso único, presença por jogador, fila exata com proximidade de elo, timeout server-side, sala, READY, preparação e reconexão;
- projeção que impede vazamento da escolha/score/resposta correta antes da trava local, inclusive assíncrono;
- validador editorial por largura medida, não só caracteres;
- fixtures sintéticas isoladas e adapters de imagem sem R2.

Validação realmente executada:

- `npm run lint`: passou, 0 warnings;
- `npm run typecheck`: passou nos 3 workspaces;
- `npm test`: 12 arquivos, 73 testes, todos passaram;
- `npm run build`: passou; PWA gerou manifest/service worker e Worker gerou bundle ESM;
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilidades;
- migrations core/questions aplicadas do zero em diretório D1 temporário;
- seeds executados: 4 categorias, 4 temas, 8 perguntas e 8 fontes verificadas.

Limitação do ambiente:

- `wrangler dev` reconheceu todos os bindings e databases, mas o runtime do contêiner encerrou antes de abrir a porta com `uv_interface_addresses returned Unknown system error 1`, inclusive em `127.0.0.1`. Portanto smoke test HTTP/WebSocket real permanece pendente em uma máquina/CI que permita interfaces de rede.

Autorização e segurança de publicação:

- o proprietário autorizou explicitamente manter `Fomes1574/QuizGomes` público, substituindo a restrição anterior;
- a revisão pré-publicação não encontrou chaves privadas, Service Accounts, tokens GitHub/Cloudflare, secrets do Worker, credenciais ou arquivos reais de ambiente na árvore versionável;
- `.gitignore`, `.env.example` e `.dev.vars.example` separam configuração pública, desenvolvimento local e secrets remotos;
- R2 e qualquer produto/plano pago permanecem desabilitados.

### 2026-08-10 — publicação pública concluída

- a `main` pública foi criada e avançada somente por commits fast-forward, sem force push;
- 107 arquivos foram publicados e a árvore Git remota coincidiu exatamente com a árvore local validada;
- `.gitignore`, exemplos de ambiente, configuração Firebase Web, Wrangler e documentação de deployment foram relidos diretamente do GitHub;
- buscas pós-push por assinaturas de chaves privadas, Service Accounts e tokens de provedores retornaram zero resultados;
- próximo trabalho: Milestone 8, com entrega autoritativa de cada pergunta no Durable Object e finalização transacional/idempotente da partida.

### 2026-08-10 — Milestone 8 implementado; deploy real bloqueado por autenticação

Implementação concluída:

- motor de estados puro para lobby, preparação, pergunta entregue, READY por rodada, resposta, resolução, pausa, finalização e anulação;
- pergunta pública atual projetada sem alternativa correta; perguntas futuras e segredo do adversário permanecem somente no servidor;
- 10 segundos iniciados apenas depois do READY dos dois jogadores, com deadline/`remainingMs` e score calculados pelo relógio do Durable Object;
- bolinha cinza/amarela baseada somente em submissão, score adversário congelado até a resolução e nenhuma alternativa/correção do adversário no payload;
- progressão exata de 5/10/15 perguntas, resultado visível por 1,2 s, empate sem desempate e finalização de Casual/Ranqueada;
- pausa integral por até 7 s, preservação do tempo, reconexão, restauração pelo storage, abandono individual, readiness desigual, dupla queda e falha sistêmica;
- locks D1 por jogador, membership server-side e claims de presença impedindo participação concorrente;
- resultado em batch transacional/idempotente com ledger, ranking, XP, respostas, histórico compacto das perguntas e liberação dos locks;
- retry de finalização e de limpeza de presença; falha durante inicialização anula sem penalidade e libera locks;
- cliente realtime em português, sem barra principal durante a partida, com pergunta X/Y, timer, pausa, resolução acessível e tela terminal.

Validação local realmente executada:

- `npm run lint`: aprovado, 0 warnings;
- `npm run typecheck`: aprovado nos três workspaces;
- `npm test`: 13 arquivos/85 testes unitários e 1 arquivo/5 testes no runtime Workers, todos aprovados;
- `npm run build`: aprovado para domínio, PWA e Worker;
- migrations `0001_core.sql`, `0002_live_matches.sql` e `0001_questions.sql` aplicadas do zero em diretório D1 temporário e tabelas verificadas;
- nenhum seed foi executado contra ambiente remoto.

Validação simulada no runtime Workers:

- WebSockets reais do runtime local para dois jogadores autenticados diretamente no stub da sala, READY, cinco rodadas, payload malicioso rejeitado, pausa/reconexão e término; emissão/consumo HTTP de ticket não foi classificada como smoke real;
- D1 do runtime com pergunta pública sem `correctOption`, lock de usuário, respostas, empate, Casual, dupla queda, Conhecimento/XP e retry idempotente;
- storage do Durable Object inspecionado durante a pausa para confirmar `phaseRemainingMs` preservado;
- não foi declarada evicção/hibernação local: o helper do Vitest bloqueou com sockets hibernáveis ativos.

Validação real Cloudflare não executada:

- `wrangler whoami` retornou `You are not authenticated`;
- não houve criação de `quiz-gomes-core`/`quiz-gomes-questions-01`, troca de UUID remoto, migration remota, deploy, domínio `workers.dev`, `/api/health` remoto ou smoke HTTP/WebSocket remoto;
- o bloqueio depende do proprietário executar `npx wrangler login`; os passos exatos e guardrails Free estão em `docs/DEPLOYMENT.md`;
- Milestone 9 não foi iniciado.

## Critério de saída desta execução

- código do Milestone 8 completo e Milestone 9 não iniciado;
- suíte unitária e runtime Workers/WebSocket simulada verdes;
- build Worker/PWA e migrations do zero aprovados;
- documentação separando evidência local, simulada e real;
- publicação em commits lógicos na `main` pública, seguida por nova auditoria do conteúdo remoto;
- deploy real pendente somente do login Cloudflare do proprietário, sem usar preview temporário ou produto pago.
