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
- [x] 2026-08-11 — D1 reais criados manualmente no Workers Free; bindings `CORE_DB` e `QUESTIONS_DB` atualizados somente com os UUIDs fornecidos.
- [x] 2026-08-11 — pipeline de produção Workers Builds, migrations remotas sem seed e origem própria dinâmica preparados e validados localmente.
- [x] 2026-08-11 — integração GitHub → Workers Builds configurada manualmente no Dashboard pelo proprietário; este commit documental dispara o primeiro build real, cujo resultado ainda aguarda confirmação da Cloudflare.
- [x] 2026-08-11 — primeiro Workers Build/deploy real confirmado em `quiz-gomes.teteumatheus1062.workers.dev`; `/api/health` respondeu `status: ok`.
- [x] 2026-08-11 — primeiro incidente real de autenticação/onboarding investigado; correção mantém RS256/audience/issuer e adiciona refresh único, diagnóstico seguro e saída do onboarding.
- [x] 2026-08-11 — reteste real aprovado: Google Authentication, onboarding, perfil persistido, `JOGADOR · ADMIN`, secret ADMIN e PWA no `workers.dev`.
- [x] 2026-08-11 — dataset temporário `SYNTHETIC_SMOKE_TEST` preparado em migrations próprias, com limpeza futura versionada e inativa.
- [x] 2026-08-11 — fluxo principal WebSocket real aprovado com dois usuários: matchmaking Casual, cinco perguntas EASY, respostas, pontuação e resultado.
- [ ] Milestone 8 — cenários reais de queda/reconexão e liberação de locks ainda não foram declarados como aprovados.
- [x] 2026-08-11 — Milestone 8.5 — Gameplay Presentation Polish implementado e validado localmente, sem alteração de gameplay ou rede.
- [x] 2026-08-11 — reteste visual real do Milestone 8.5 aprovado pelo proprietário: timer, layout, animações e tela de resultado satisfatórios em produção.
- [x] 2026-08-11 — calibração final do Milestone 8.5 implementada localmente com resultado em 2.000 ms e apresentação da próxima pergunta em 1.600 ms.
- [ ] Milestone 8.5 — repetir uma partida real de cinco perguntas após o deploy da calibração `2.000 / 1.600`.
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
11. **Deploy real não é simulado.** A criação manual dos D1 é evidência externa, mas migrations, Worker, Durable Objects, hostname e smoke tests só serão marcados como reais após o Workers Builds terminar na conta do proprietário.
12. **Workers Builds parte da raiz.** `npm ci` e o gate completo coordenam os três workspaces; o deploy é aceito somente na `main`, aplica migrations pendentes antes do Worker/PWA e nunca referencia seeds.
13. **Produção é mesma origem.** O Worker deriva sua própria origem de `request.url`; `ALLOWED_ORIGINS` é apenas uma lista adicional explícita de desenvolvimento, sem wildcard e sem hostname `workers.dev` hardcoded.
14. **401 de Firebase tem uma única recuperação.** O cliente reutiliza o ID Token atual uma vez, força `getIdToken(true)` após o primeiro 401 e repete exatamente uma vez. Uma segunda rejeição encerra o fluxo com mensagem clara; assinatura RS256, `kid`, `aud`, `iss`, `exp`, `iat`, `auth_time` e `sub` continuam obrigatórios no Worker.
15. **Conteúdo de smoke real é isolado e temporário.** Categoria, tema, pool e 30 perguntas usam IDs reservados, texto inequívoco e a flag `SYNTHETIC_SMOKE_TEST`; Questions migra antes de Core. A limpeza fica fora do pipeline até autorização posterior, remove apenas o conteúdo marcado e preserva referências históricas com tombstones desativados.
16. **Polimento da partida não muda autoridade.** O deadline e `remainingMs` do Durable Object continuam sendo a única referência; CSS anima apenas a barra, React atualiza o número inteiro isoladamente e o cliente envia `ROUND_READY` somente após a apresentação local, sem calcular score, resposta ou timeout.
17. **Cadência local respeita o piso do servidor.** `roundPresentationDelay()` usa o maior valor entre `MATCH_ROUND_TRANSITION_MS` e `payload.transitionMs`; a calibração aumenta somente `ROUND_RESULT` para 2.000 ms e a apresentação para 1.600 ms. `QUESTION_DURATION_MS` permanece em 10.000 ms e só começa depois do READY dos dois jogadores.

## Descobertas e riscos

- O repositório está **público** por decisão explícita do proprietário. A árvore versionável foi auditada antes da publicação; somente a configuração Web pública do Firebase foi mantida no frontend.
- O ambiente não possui `gh`; publicação, quando segura, usará a API Git do conector ou exigirá instalação externa.
- A logo oficial não foi anexada. A UI usará slot técnico claramente substituível, sem redesenho artístico.
- Alterar slots ativos exige versionar/migrar bitmaps; a V1 bloqueará publicação durante migração para preservar descoberta exata.
- Revogação imediata de Firebase tokens não é consultada por request sem Admin API; avaliar em hardening para ações críticas.
- Bindings D1 precisam de UUIDs distintos; IDs iguais fazem o Wrangler compartilhar o mesmo arquivo SQLite entre shards. Os UUIDs reais configurados em 2026-08-11 foram testados em armazenamento local vazio e permaneceram isolados.
- O helper de evicção do runtime Vitest bloqueou com WebSockets hibernáveis ativos. O teste simulado comprova estado pausado no storage e reconexão WebSocket pelo mesmo caminho de restauração; evicção/hibernação efetiva permanece parte do smoke test em `workers.dev` e não foi declarada como executada localmente.
- `wrangler whoami`, executado nesta sessão local em 2026-08-10, retornou `You are not authenticated`; por isso nenhum deploy foi feito pelo Codex. Depois, o proprietário conectou Workers Builds e confirmou externamente o primeiro deploy e `/api/health`, sem disponibilizar credenciais à sessão.
- O token automático documentado do Workers Builds não inclui `D1 Edit` e inclui permissões desnecessárias de KV/R2. A conexão deve selecionar token de usuário restrito a `Workers Scripts: Edit` e `D1: Edit` na conta correta, sem R2 ou Billing.
- O primeiro erro real era reduzido a uma mensagem genérica depois da etapa criptográfica, portanto a causa específica da rejeição original não pode ser recuperada retroativamente. A investigação confirmou projeto/issuer, bundle, domínio, certificados X.509 atuais e importação/verificação RS256 no `workerd`; novos logs registram somente `stage` e `reason`, sem token, UID, email, cookies ou payload.
- O tema sintético será referenciado pelas partidas reais de smoke. Por isso, a limpeza futura não pode apagar o tema quando houver histórico: perguntas/pool são removidos, catálogo é desativado e o registro mínimo permanece como tombstone para não tocar em partidas, usuários ou resultados.
- A projeção simultânea não expõe a alternativa errada do adversário nem após a resolução. O polimento preserva esse contrato: o avatar só aparece na alternativa correta quando o aumento do score já torna o acerto inferível; nenhum novo dado foi adicionado ao WebSocket.

## Testes requeridos por marco

- M0/M1: lint, typecheck, unit, build e render responsivo básico.
- M2: token ausente/inválido, claim incorreta, ADMIN falsificado, onboarding idempotente.
- M5: thresholds, overflow, rebaixamento, cap, tabela, simulação ~2.457; XP exemplos/total/cap.
- M6: recentes 200/201, união, bitmap round-trip, uniformidade estrutural e pool insuficiente.
- M7: scoring em limites de ms, timeout, empate, navbar ausente e overflow.
- M8+: cancelamento, readiness, reconexão 7 s, dupla queda, finalização idempotente e vazamento assíncrono.
- M8 concluído local/simulado: 5/10/15 rodadas, empate, Casual sem Conhecimento, XP, abandono, dupla queda, lock único, payload estrito, sigilo do adversário, retry idempotente e transação D1; o health real passou, enquanto hibernação e smoke WebSocket reais continuam pendentes.
- Preparação de deploy: origem própria, localhost explícito, wildcard/origem externa e bloqueio do script fora do Workers Builds/`main`; migrations vazias devem preservar isolamento core/questions.
- Incidente de autenticação: retry único após 401 com refresh forçado, segunda falha terminal, saída real do onboarding, ADMIN posterior à autenticação, diagnóstico de algoritmo/chave/assinatura/claims sem token ou PII e fixture X.509 sintética no runtime Workers.
- Dataset de smoke: uma categoria interna, um tema, somente EASY, 30 slots densos, quatro opções, distribuição 8/8/7/7, nenhuma imagem/fonte/trivia e flag editorial exata; limpeza deve preservar todo histórico.
- M8.5: timer sem rerender de alta frequência, segundo inteiro sincronizado, pausa por `phaseRemainingMs`, retomada por `remainingMs`, resultado por 2.000 ms, READY após apresentação de 1.600 ms, título de rodada único, feedback escalonado, resultado com dois perfis e `prefers-reduced-motion`.

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
- naquele checkpoint, o bloqueio dependia de autenticação do proprietário; o fluxo atual foi substituído pela conexão via Workers Builds documentada na seção de 2026-08-11;
- Milestone 9 não foi iniciado.

### 2026-08-11 — D1 reais e Workers Builds preparados

Configuração concluída:

- `CORE_DB` aponta para `quiz-gomes-core` (`3260deba-54ab-4e47-8c7f-a4d088dad728`);
- `QUESTIONS_DB` aponta para `quiz-gomes-questions-01` (`40ea8ac4-9dd6-40a8-b032-89cb3cede229`);
- nomes, bindings, migrations, regras de jogo e Durable Objects não foram alterados;
- root scripts `build:cloudflare` e `deploy:cloudflare` coordenam os workspaces npm;
- o deploy remoto é bloqueado fora de `WORKERS_CI=1` + branch `main`, aplica migrations antes de `wrangler deploy` e usa `--experimental-provision=false`;
- nenhum comando remoto referencia seeds, R2, billing ou produto pago;
- produção aceita dinamicamente a própria origem; `localhost:5173` ficou somente em `.dev.vars` e CORS não aceita `*`.

Validação local realmente executada:

- `npm run build:cloudflare` partiu de dependências limpas, executou `npm ci` e concluiu todo o gate;
- lint e typecheck passaram nos três workspaces;
- 14 arquivos/89 testes unitários passaram;
- 2 arquivos/7 testes no runtime Workers passaram, incluindo origem própria e bloqueio de origem externa;
- builds de domínio, PWA e Worker passaram; o bundle PWA também foi gerado com `VITE_ENABLE_REALTIME_MATCHES=true`;
- o guard de deploy recusou execução local antes de qualquer chamada D1/Cloudflare;
- migrations aplicaram do zero usando os UUIDs reais: 2 no core e 1 em questions; core não contém tabela `questions` e questions não contém tabela `users`;
- nenhum seed foi usado nessa validação.

Validação real Cloudflare ainda não executada:

- a criação manual dos dois D1 foi informada pelo proprietário e não é classificada como execução desta sessão;
- não foram aplicadas migrations remotas, provisionadas classes Durable Objects, criada versão Worker, gerado hostname `workers.dev`, chamado `/api/health` remoto ou aberto WebSocket remoto;
- o próximo passo externo é conectar `Fomes1574/QuizGomes` ao Workers Builds com os valores de `docs/DEPLOYMENT.md` e iniciar o primeiro build da `main`;
- Milestone 9 permanece não iniciado.

### 2026-08-11 — primeiro deploy real e correção de autenticação/onboarding

Evidência real confirmada:

- Workers Builds publicou `quiz-gomes.teteumatheus1062.workers.dev` e a PWA real foi recuperada desse hostname;
- `/api/health` respondeu `{"name":"QUIZ GOMES","status":"ok","version":"0.1.0"}`;
- domínio autorizado, login Google, criação do Firebase User e secret `ADMIN_FIREBASE_UIDS` foram confirmados pelo proprietário;
- o POST do primeiro perfil recebeu 401 antes desta correção; o motivo criptográfico específico não ficou disponível porque a versão implantada reduzia todas as falhas posteriores à seleção de chave à mesma mensagem.

Investigação local e no runtime Workers:

- configuração pública, API key, `FIREBASE_PROJECT_ID=quizgomes-cbc48`, issuer e bundle implantado foram comparados;
- os quatro certificados X.509 publicados pelo Secure Token em 2026-08-11 foram importados com RS256 pelo `workerd` em harness temporário;
- um JWT RS256 sintético, com X.509 e formato completo de Firebase ID Token, passou pelo verificador no runtime Workers;
- `ADMIN_FIREBASE_UIDS` permanece fora de `requireUser` e só é consultado depois que o token produz uma identidade válida;
- a segurança não foi afrouxada: algoritmo, `kid`, assinatura, `aud`, `iss`, `exp`, `iat`, `auth_time` e `sub` continuam obrigatórios.

Correção implementada:

- o Worker classifica falhas por etapa e motivo seguro, sem registrar token, payload, UID, email, cookie ou credencial;
- toda requisição autenticada pode forçar `getIdToken(true)` após o primeiro 401 e repete no máximo uma vez;
- uma segunda rejeição encerra com mensagem clara, sem loop;
- o onboarding mostra o erro de sessão e oferece “Sair / trocar conta” por `signOut()` real do Firebase;
- nenhuma regra de ranking, XP, matchmaking, partida ou perguntas foi alterada; Milestone 9 não foi iniciado.

Validação executada antes da publicação:

- `npm run check` com realtime habilitado: lint, typecheck, 16 arquivos/96 testes unitários, 3 arquivos/8 testes runtime Workers e builds dos três workspaces aprovados;
- migrations aplicadas em D1 local vazio: 2 no core e 1 em questions; isolamento confirmado e nenhum seed executado;
- `npm audit --audit-level=high`: 0 vulnerabilidades;
- auditoria de secrets: nenhuma chave privada, Service Account, token de provedor, JWT completo, arquivo `.env` ou `.dev.vars`; somente a API key Web pública já autorizada do Firebase;
- reteste real do perfil e smoke WebSocket completo permanecem pendentes do deploy automático deste commit.

### 2026-08-11 — autenticação real aprovada e dataset do smoke WebSocket preparado

Evidência real confirmada pelo proprietário:

- Google Authentication, onboarding e persistência do primeiro perfil passaram em produção;
- a conta foi reconhecida como `JOGADOR · ADMIN`, comprovando o secret `ADMIN_FIREBASE_UIDS` após autenticação válida;
- a aplicação carregou normalmente em `quiz-gomes.teteumatheus1062.workers.dev`;
- o incidente de autenticação/onboarding está resolvido.

Preparação temporária:

- `QUESTIONS_DB/0002` cria somente o pool EASY com 30 perguntas artificiais, slots 1..30, alternativas A/B/C/D e flag `SYNTHETIC_SMOKE_TEST`;
- `CORE_DB/0003` publica a categoria interna e o tema `Teste Multiplayer` somente depois do shard de perguntas;
- não há trivia, imagens, fontes, seed de desenvolvimento ou alteração de regra competitiva;
- a estratégia de limpeza está versionada fora das migrations ativas e não será executada neste deploy;
- o smoke WebSocket real com duas contas permanece o último gate do Milestone 8; o Milestone 9 não foi iniciado.

Validação executada antes da publicação:

- lint e typecheck dos três workspaces aprovados;
- 16 arquivos/96 testes unitários e 4 arquivos/10 testes no runtime Workers aprovados;
- builds do domínio, PWA com realtime ativado e Worker aprovados;
- migrations aplicadas em bancos locais vazios: 2 em Questions e 3 em Core, sem seed e com isolamento preservado;
- dataset conferido com 30 perguntas, 30 slots distintos de 1 a 30, nenhuma imagem/fonte e distribuição correta 8/8/7/7;
- limpeza aplicada duas vezes num banco descartável com histórico sintético: perguntas/pool removidos, enquanto usuário, perfil, partida, jogador, snapshot, resposta, ledger, ranking e estado de pool permaneceram; catálogo virou tombstone desativado;
- `npm audit --audit-level=high`: 0 vulnerabilidades;
- auditoria de secrets: nenhuma credencial, chave privada, Service Account, token, JWT, arquivo real de ambiente ou URL autenticada; somente a configuração Web pública já autorizada do Firebase.

### 2026-08-11 — Milestone 8.5 — Gameplay Presentation Polish inicial

Evidência real confirmada pelo proprietário:

- a primeira partida Casual em produção completou matchmaking, cinco perguntas EASY, respostas, pontuação e resultado com dois usuários;
- esta evidência aprova o fluxo principal, mas não declara como executados os cenários separados de queda abaixo/acima de 7 segundos, dupla queda e liberação de locks.

Implementação concluída:

- o timer deixou de rerenderizar a tela 20 vezes por segundo: uma animação linear de `transform: scaleX()` desenha a barra no compositor e um subcomponente atualiza apenas o número inteiro;
- pausa usa diretamente `phaseRemainingMs`; reconexão recria o deadline com o `remainingMs` autoritativo; o timeout visual apenas bloqueia interação local e não finaliza a rodada;
- a transição de rodada dura 900 ms, mostra uma única composição `PERGUNTA` + `N / TOTAL` e só então envia um único `ROUND_READY`;
- pergunta, respostas, resolução, ✓/×, indicador adversário, scores e `+N` receberam movimento curto baseado principalmente em opacity/transform;
- desktop acima de 1024 px ganhou palco mais largo, tipografia e respostas proporcionais, placar nos cantos e melhor uso vertical, preservando o grid mobile;
- o resultado mostra os dois perfis, nomes, scores, vencedor/empate/anulação, halo discreto, XP e Conhecimento em revelação progressiva e mantém apenas “Voltar aos temas”; o contêiner de ações admite futura rematch sem expor função inexistente;
- molduras já equipadas recebem somente um contorno estrutural a partir do `frameId` existente; nenhum cosmético ou catálogo foi inventado;
- `prefers-reduced-motion` remove movimentos não essenciais, mantém a resolução legível e troca a barra contínua por passos de um segundo;
- nenhuma alteração foi feita em domínio, Worker, Durable Objects, WebSockets, D1, matchmaking, scoring, ranking, XP, Conhecimento, perguntas ou sigilo.

Validação executada antes da publicação:

- lint e typecheck dos três workspaces aprovados;
- 18 arquivos/103 testes unitários aprovados, incluindo timer isolado, pausa, timeout visual, transição sem duplicidade, READY único aos 900 ms e tela final;
- 4 arquivos/10 testes no runtime Workers/WebSocket aprovados sem alteração;
- builds do domínio, PWA com realtime ativado e Worker aprovados;
- `npm audit --audit-level=high`: 0 vulnerabilidades; auditoria dos arquivos alterados sem credenciais, chaves privadas, tokens ou JWTs;
- naquele checkpoint, o reteste visual real ainda dependia do deploy automático; ele foi posteriormente aprovado pelo proprietário e está registrado na calibração abaixo. Milestone 9 não foi iniciado.

### 2026-08-11 — Milestone 8.5 — calibração final de cadência

Evidência real confirmada pelo proprietário:

- o polimento inicial melhorou consideravelmente a experiência em produção; timer fluido, layout, animações e tela de resultado foram aprovados;
- o intervalo entre uma resposta e a próxima pergunta ainda não dava tempo suficiente para absorver alternativa correta, escolhas, veredito, pontos e placar;
- a calibração escolhida para o próximo teste real é `2.000 / 1.600`; a alternativa `2.000 / 2.000` permanece apenas como decisão posterior ao reteste, não como regra implementada.

Implementação concluída:

- `LIVE_ROUND_RESULT_MS` passou de 1.200 para 2.000 ms sem atrasar o cálculo autoritativo já concluído pelo servidor;
- `MATCH_ROUND_TRANSITION_MS` passou de 900 para 1.600 ms; a mesma constante alimenta o timeout de READY e a duração CSS total, incluindo entrada, permanência e saída;
- a pergunta e as alternativas são montadas desabilitadas ainda em `ROUND_READY`, entram sob o fade nos 300 ms finais e só ficam interativas depois de `ROUND_STARTED`; assim a entrada visual não consome o deadline de resposta;
- `LIVE_ROUND_TRANSITION_MS` permanece em 450 ms no payload e `roundPresentationDelay()` continua escolhendo `max(1.600, payload.transitionMs)`, sem reduzir uma exigência maior do servidor;
- veredito local ocupa aproximadamente 0–200 ms, avatar permitido 200–450 ms, placar e `+N` 450–700 ms; de 700 a 2.000 ms o resultado permanece estável e legível;
- o score exibido é retido localmente até 450 ms, mas cálculo, persistência e payload autoritativos não são atrasados nem alterados;
- `prefers-reduced-motion` continua removendo movimento não essencial, enquanto os intervalos funcionais de 2.000 e 1.600 ms permanecem para sincronizar os clientes;
- `QUESTION_DURATION_MS` continua exatamente em 10.000 ms e só nasce no servidor após os dois `ROUND_READY`; nenhum milissegundo da apresentação reduz a janela de resposta;
- nenhuma alteração foi feita em scoring, XP, Conhecimento, matchmaking, quantidade de perguntas, WebSockets, Durable Objects, reconexão, regra de 7 segundos ou sigilo do adversário.

Validação executada antes da publicação:

- lint e typecheck dos três workspaces aprovados;
- 18 arquivos/103 testes unitários aprovados, incluindo resultado exato de 2.000 ms, piso de apresentação, READY único aos 1.600 ms e revelação do placar aos 450 ms;
- 4 arquivos/10 testes no runtime Workers/WebSocket aprovados sem alteração de protocolo;
- builds do domínio, PWA com realtime ativado e Worker aprovados;
- o reteste real de cinco perguntas com `2.000 / 1.600` permanece pendente do deploy automático; Milestone 9 não foi iniciado.

## Critério de saída desta execução

- código do Milestone 8 completo e Milestone 9 não iniciado;
- suíte unitária e runtime Workers/WebSocket simulada verdes;
- build Worker/PWA e migrations do zero aprovados;
- documentação separando evidência local, simulada e real;
- publicação em commits lógicos na `main` pública, seguida por nova auditoria do conteúdo remoto;
- deploy, health, autenticação, onboarding, ADMIN, fluxo principal WebSocket e polimento visual inicial reais confirmados; cenários de reconexão/locks e reteste real da cadência `2.000 / 1.600` ainda pendentes, sem preview de branch, R2 ou produto pago.
