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
- [x] 2026-08-14 — smoke real do Milestone 8 confirmou reconexão dentro de 7 s, `VOID` acima da graça e nova partida imediata com as mesmas contas.
- [x] 2026-08-11 — Milestone 8.5 — Gameplay Presentation Polish implementado e validado localmente, sem alteração de gameplay ou rede.
- [x] 2026-08-11 — reteste visual real do Milestone 8.5 aprovado pelo proprietário: timer, layout, animações e tela de resultado satisfatórios em produção.
- [x] 2026-08-11 — calibração final do Milestone 8.5 implementada localmente com resultado em 2.000 ms e apresentação da próxima pergunta em 1.600 ms.
- [x] 2026-08-11 — reteste real da cadência `2.000 / 1.600` melhorou novamente a partida e motivou uma última calibração pequena.
- [x] 2026-08-11 — calibração `2.400 / 1.900` e revelação autoritativa das duas escolhas implementadas e validadas localmente.
- [x] 2026-08-21 — smoke físico aprovado pelo proprietário: partida Fácil real com dois usuários, cadência `2.900 / 1.900`, acerto, erro e timeout.
- [x] 2026-08-12 — sistema unificado de arte dos temas implementado e validado localmente, com ícones próprios, upload ADMIN em D1 e auditoria de carregamento.
- [x] 2026-08-12 — falha remota da migration de arte isolada no parser multi-statement do D1; `0004` pendente tornada robusta sem triggers e coberta por gate pré-deploy.
- [x] 2026-08-18 — smoke real do Theme Artwork aprovado pelo proprietário em produção: arte e migration D1-safe `0004` operantes, sem regressão reportada.
- [x] 2026-08-13 — correção de escopo do Milestone 8.5 concluída localmente: matchmaking visual/autoritativo, apresentação do adversário, preload seguro, marca oficial e avatar personalizado.
- [x] 2026-08-21 — smoke físico aprovado pelo proprietário: apresentação real do adversário e upload/troca/remoção de avatar com usuários autenticados.
- [x] 2026-08-14 — correção final do Milestone 8 concluída localmente: deadline de reconexão autoritativo, recuperação terminal, cleanup/self-healing, códigos seguros e pool sintético ampliado.
- [x] 2026-08-14 — produção aprovou o fluxo `partida 1 → queda >7 s → VOID → partida 2 imediata` com as mesmas contas; não houve lock terminal persistente.
- [x] 2026-08-14 — hardening final de UX/liveness concluído localmente: questão removida na perda local/`PAUSED`, heartbeat leve e matchmaking modal de verdade.
- [x] 2026-08-18 — smoke físico de modo avião e modalidade real aprovado: pergunta removida localmente, pausa/retomada/VOID corretos, revanche imediata e navegação integralmente bloqueada durante matchmaking.
- [x] 2026-08-18 — sincronização visual pré-9A concluída localmente: perda local sem contador fictício e graça visual derivada somente de `graceRemainingMs` autoritativo com relógio monotônico.
- [x] 2026-08-21 — smoke físico final de sincronização visual aprovado pelo proprietário nos dois aparelhos; perda local sem contador fictício e graça exclusivamente autoritativa.
- [x] 2026-08-21 — Milestones 8 e 8.5 oficialmente FROZEN após aprovação física em produção; motor, reconexão e matchmaking permanecem congelados, exceto integração mínima obrigatória de bloqueios na fila ou regressão comprovada.
- [x] 2026-08-21 — Milestone 9A Social Foundation implementado e validado localmente: descoberta pública, amizades, recusas direcionais, bloqueios, compatibilidade na fila e FCM opcional por instalação.
- [x] 2026-08-21 — smoke físico parcial do 9A aprovado: busca nominal/ID, pedido, primeira recusa, bloqueio, invisibilidade e incompatibilidade competitiva.
- [x] 2026-08-21 — Milestone 9A.1 implementado e validado localmente: cancelamento pré-partida identificado, retorno ao tema e canal Social hibernável com contador global/invalidações realtime.
- [x] 2026-08-21 — smoke físico integral do Milestone 9A.1 aprovado pelo proprietário em produção: cancelamento por nome/contexto, usuários online únicos e pedidos atualizados com Social aberta.
- [x] 2026-08-21 — Milestone 9A.1 oficialmente concluído após aprovação física; M8/M8.5, Social Foundation e realtime global permanecem preservados.
- [ ] Milestone 9A — smoke físico pós-deploy pelo proprietário: descoberta, pedidos, três recusas direcionais, bloqueios/pareamento e push real somente após configuração opcional do Firebase/Cloudflare.
- [x] 2026-08-21 — Milestone 9B implementado e validado localmente: presença privada/autoritativa entre amigos, snapshot versionado, fanout direcionado e Social responsivo refinado.
- [ ] Milestone 9B — smoke físico pós-deploy pelo proprietário: amigos online/busca/partida/reconexão/offline, múltiplas sessões e transições visuais em aparelhos reais.
- [ ] Milestone 9C — desafio simultâneo entre amigos.
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
15. **Conteúdo de smoke real é isolado e temporário.** Categoria, tema e pool com 250 perguntas artificiais usam IDs reservados, texto inequívoco e a flag `SYNTHETIC_SMOKE_TEST`; Questions migra antes de Core. A limpeza fica fora do pipeline até autorização posterior, remove apenas o conteúdo marcado e preserva referências históricas com tombstones desativados.
16. **Polimento da partida não muda autoridade.** O deadline e `remainingMs` do Durable Object continuam sendo a única referência; CSS anima apenas a barra, React atualiza o número inteiro isoladamente e o cliente envia `ROUND_READY` somente após a apresentação local, sem calcular score, resposta ou timeout.
17. **Cadência local respeita o piso do servidor.** `roundPresentationDelay()` usa o maior valor entre `MATCH_ROUND_TRANSITION_MS` e `payload.transitionMs`; a calibração atual usa `ROUND_RESULT` de 2.900 ms e apresentação de 1.900 ms. `QUESTION_DURATION_MS` permanece em 10.000 ms e só começa depois do READY dos dois jogadores.
18. **Escolhas são reveladas somente após resolução autoritativa.** Durante `ANSWERING`, a projeção informa apenas se o adversário respondeu. Em `ROUND_RESULT` ou estado equivalente já resolvido, `resolution` recebe do estado do MatchRoom as opções selecionadas por ambos, inclusive erro ou `null` por timeout; o cliente nunca deriva a escolha adversária pelo score.
19. **Arte de tema é uma união exclusiva e versionada.** `ICON`, `CUSTOM` e `NONE` não coexistem. SVG padrão é estático/reutilizável; WebP personalizado ocupa uma única row BLOB separada no Core D1. Catálogo nunca lê o BLOB, URL pública contém versão, alteração exige versão esperada e somente ADMIN pode gravar.
20. **Migrations remotas D1 não usam triggers compostos.** O endpoint `/query` recebe a migration inteira e seu parser pode truncar corpos `BEGIN … SELECT CASE … END; END`. A `0004` usa `CHECK`, chave única, FK composta e batches transacionais; o pipeline bloqueia `CREATE TRIGGER`, valida parse/exec/upgrade/rollback localmente e mantém o Workers Build remoto como smoke definitivo.
21. **Busca visual não substitui autoridade.** A fila envia `SEARCHING.timeoutAt`; o cliente deriva `startedAt = timeoutAt - 60.000`, atualiza apenas o texto por segundo e nunca estende a fila. `MATCH_FOUND` entra em apresentação explícita e não navega imediatamente.
22. **Preload não inicia gameplay.** Durante 2.900 ms o cliente pode abrir/bufferizar o socket da sala e baixar somente chunk/assets públicos. `READY` fica proibido até a MatchScreen assumir o socket; `correctOption`, resposta adversária e pergunta futura não entram na projeção.
23. **Avatar customizado é separado e substitutivo.** O BLOB WebP 256 × 256 fica em `user_custom_avatars`; perfil/ranking/partida leem apenas versão ativa. Firebase UID autenticado define o dono e a resolução única em UI é `custom → Google → iniciais`.
24. **A marca deriva da fonte oficial.** Browser, PWA, Apple e marca interna usam derivados dimensionados do anexo oficial. A variante escura troca somente áreas brancas por near-black, sem `filter: invert()` e sem alterar os ícones canônicos instalados.
25. **A fronteira persistida de 7 segundos é definitiva.** Em `PAUSED`, tanto `CONNECT` quanto `ALARM` comparam `graceDeadlineMs`; 6.999 ms restaura exatamente a fase e o tempo congelados, enquanto 7.000 ms ou mais finaliza em `VOID`, independentemente da ordem da corrida ou do atraso do alarme.
26. **Terminal nunca volta a ser jogável.** `FINALIZING` não projeta pergunta e força finalização idempotente; `VOID`/`FINISHED` restauram o summary do storage/D1. Tempo local sem conectividade não declara estado terminal: o cliente consulta novamente a sala em cadência limitada e aplica `ANSWERING`, `PAUSED`, `VOID` ou `FINISHED` conforme a fonte autoritativa, inclusive em `online`, foco e visibilidade.
27. **Locks terminais têm reparo restrito.** A transação de resultado continua removendo os dois locks; uma associação histórica que aponta para `VOID`/`FINISHED` é apagada ao ser consultada, mas locks de `PREPARING`/`PLAYING` nunca são tratados como órfãos. Presence terminal residual volta a `idle` somente quando a membership e o recurso confirmam a mesma sala terminal.
28. **Falha de pareamento expõe somente código seguro.** `PLAYER_BUSY`, `PROFILE_REQUIRED`, `QUESTION_POOL_EMPTY`, `QUESTION_POOL_INCONSISTENT` e `QUESTION_POOL_INSUFFICIENT` chegam ao cliente sem SQL, stack ou detalhe interno. O dataset reservado cresceu de 30 para 250 perguntas; a regra global de 200 recentes não mudou e perguntas futuras não exibidas não entram no histórico ao anular.
29. **Perda local fecha a superfície da pergunta sem inventar graça.** `offline`, close/error do socket ou ausência de `PONG` tiram imediatamente a `MatchScreen` jogável do DOM e mostram uma tela opaca local sem número. O heartbeat de 1.500 ms considera a conexão silenciosa após 3.000 ms, mas nunca decide pausa, deadline, score, `RESUMED` ou `VOID`; toda decisão de gameplay permanece no MatchRoom.
30. **Matchmaking ocupa o top layer.** A busca usa `dialog.showModal()` em Portal, torna o AppShell explicitamente `inert`, confina Tab, trata Escape como cancelamento seguro durante busca/timeout e restaura o foco ao fechar. Busca, cancelamento, timeout e apresentação do adversário mantêm o fundo indisponível até o estado `idle` ou a navegação para a sala.
31. **A graça visual possui uma única fonte.** Somente uma projeção `PAUSED` cria contador. O cliente ancora o `graceRemainingMs` calculado pelo MatchRoom em `performance.now()` ao recebê-lo; não usa `Date.now()`, timestamp enviado pelo jogador, deadline local ou chegada visual a zero para decidir `VOID`.
32. **M8/M8.5 estão congelados após aprovação física.** Reconexão, MatchRoom, timers, locks, score, Knowledge, XP, perguntas, apresentação, avatar, marca e modalidade não recebem alteração sem bug comprovado. O M9A só acrescenta a checagem obrigatória de incompatibilidade por bloqueio na `MatchmakingQueue`, sem tocar a sala.
33. **Identidade social pública é mínima.** Pesquisa nominal usa prefixo indexado/limitado; `#QG...` exige igualdade exata. A projeção social inclui somente nome, ID público, avatar e frame; UID Firebase, email, IDs internos e FIDs nunca aparecem em superfícies públicas. Bloqueio em qualquer direção equivale a usuário indisponível para ambos.
34. **Recusas e bloqueios são conceitos independentes.** Três recusas explícitas contam exclusivamente para remetente → destinatário e impõem 30 dias; expiração reseta sob demanda, aceite limpa o ciclo, cancelamento não incrementa. `D1Database.batch()`, nonce de resolução e índice único parcial da dupla impedem pedidos cruzados/efeitos duplicados. Bloquear remove amizade/pedidos, preserva cooldown e não interrompe partida existente.
35. **Cloud Messaging gratuito é a única exceção Firebase autorizada além do Google Auth.** Firebase JS SDK `12.17.1` usa `register()`/`onRegistered()` e Firebase Installation IDs; FCM HTTP v1 recebe `message.fid`, sem APIs/token legados. A chave VAPID pública pode estar no bundle; `FCM_SERVICE_ACCOUNT_JSON` existe somente como secret de runtime Cloudflare. Push é opt-in, multi-device, pós-persistência, best-effort e inexistente com credencial ausente.
36. **Workbox e push compartilham um único service worker.** `injectManifest` preserva shell offline, precache, atualização e APIs `NetworkOnly`; a registration existente é entregue explicitamente ao Firebase Messaging. Foreground atualiza badge/lista, background cria uma notificação controlada e o clique abre Social/Pedidos. Não há segundo root scope, polling, billing, Firestore, Storage ou Functions.
37. **Cancelamento pré-partida tem semântica própria sem efeito competitivo.** `VOID/CANCELLED` persiste somente o assento do jogador autoritativo e projeta nome público real; o adversário não vê placar nem UID, quem cancelou retorna imediatamente, e route state preserva tema/dificuldade/modalidade. A alteração mínima de domínio/projeção não toca reconexão, timers, score, XP, Knowledge, locks ou demais voids.
38. **Presença global e individual compartilham um único canal.** `SocialRealtimeHub` global aceita tickets curtos autenticados, conta IDs internos únicos entre sockets hibernáveis e mantém `ONLINE_COUNT`; várias abas não duplicam usuários. O 9B acrescenta presença privada somente entre amizades válidas, sem presença pública, last-seen, desafios ou canal adicional.
39. **Realtime social acorda somente por mudança real.** Mutação persistida aciona `waitUntil` com `SOCIAL_INVALIDATED` genérico para todas as sessões das pessoas afetadas; o cliente atualiza summary/snapshot sob demanda, sem revelar bloqueio. `PING/PONG` a cada 45 s usa auto-response Cloudflare sem acordar o DO, sem polling HTTP/D1 e sem depender de FCM.
40. **Conectividade e atividade têm autoridades separadas.** A última sessão `SocialRealtimeHub` encerrada sempre produz `OFFLINE`, mesmo se `PresenceHub` conservar atividade competitiva; sessão ativa combina `idle/invite → ONLINE`, `matchmaking → MATCHMAKING`, `preparing/playing/finished → IN_MATCH` e `reconnecting → RECONNECTING`. Nenhuma informação de sala, UID, recurso ou adversário cruza o socket social.
41. **Fanout e snapshot de presença são privados e versionados.** D1 resolve amizades válidas sem bloqueio somente diante de mudança/snapshot real; o navegador nunca escolhe destinatários. Revisão lógica é reservada antes de awaits, snapshot antigo não substitui evento novo e gerações descartam respostas HTTP obsoletas após remoção/bloqueio.
42. **Motion social usa somente CSS e WAAPI/FLIP.** Amigos online/offline são ordenados por disponibilidade, busca, partida e nome; verde/amarelo/cinza têm tokens próprios, estado textual acessível e animações pontuais. Dark/mobile/desktop/reduced-motion não exigem dependências, loops de animação, polling ou segundo WebSocket.

## Descobertas e riscos

- O repositório está **público** por decisão explícita do proprietário. A árvore versionável foi auditada antes da publicação; somente a configuração Web pública do Firebase foi mantida no frontend.
- O ambiente não possui `gh`; publicação, quando segura, usará a API Git do conector ou exigirá instalação externa.
- A logo oficial foi recebida em 2026-08-13. O JPEG fonte não é distribuído; somente derivados técnicos WebP/PNG/ICO dimensionados entram no app, sem redesenho.
- Alterar slots ativos exige versionar/migrar bitmaps; a V1 bloqueará publicação durante migração para preservar descoberta exata.
- Revogação imediata de Firebase tokens não é consultada por request sem Admin API; avaliar em hardening para ações críticas.
- Bindings D1 precisam de UUIDs distintos; IDs iguais fazem o Wrangler compartilhar o mesmo arquivo SQLite entre shards. Os UUIDs reais configurados em 2026-08-11 foram testados em armazenamento local vazio e permaneceram isolados.
- O helper de evicção do runtime Vitest bloqueou com WebSockets hibernáveis ativos. O teste simulado comprova estado pausado no storage e reconexão WebSocket pelo mesmo caminho de restauração; evicção/hibernação efetiva permanece parte do smoke test em `workers.dev` e não foi declarada como executada localmente.
- `wrangler whoami`, executado nesta sessão local em 2026-08-10, retornou `You are not authenticated`; por isso nenhum deploy foi feito pelo Codex. Depois, o proprietário conectou Workers Builds e confirmou externamente o primeiro deploy e `/api/health`, sem disponibilizar credenciais à sessão.
- O token automático documentado do Workers Builds não inclui `D1 Edit` e inclui permissões desnecessárias de KV/R2. A conexão deve selecionar token de usuário restrito a `Workers Scripts: Edit` e `D1: Edit` na conta correta, sem R2 ou Billing.
- O primeiro erro real era reduzido a uma mensagem genérica depois da etapa criptográfica, portanto a causa específica da rejeição original não pode ser recuperada retroativamente. A investigação confirmou projeto/issuer, bundle, domínio, certificados X.509 atuais e importação/verificação RS256 no `workerd`; novos logs registram somente `stage` e `reason`, sem token, UID, email, cookies ou payload.
- O tema sintético será referenciado pelas partidas reais de smoke. Por isso, a limpeza futura não pode apagar o tema quando houver histórico: perguntas/pool são removidos, catálogo é desativado e o registro mínimo permanece como tombstone para não tocar em partidas, usuários ou resultados.
- A projeção simultânea continua sem expor `opponent.selectedOption`, correção ou resposta correta durante `ANSWERING`. A revelação das escolhas certa ou errada existe exclusivamente dentro de `resolution`, depois que `resolveRound()` já produziu o estado autoritativo; score não é usado para inferir alternativa.
- `coverImageKey` existia no modelo, mas não possuía resolução HTTP ligada aos temas: migrations/seeds atuais usam `NULL` e `LocalImageStorage` atende somente fixtures de perguntas. A arte dinâmica passou a ter endpoint próprio; `coverImageKey` permanece apenas como ponte compatível, sem URL inventada.
- Wrangler `4.120.1` separa migrations localmente antes do `db.batch()`, mas envia a migration remota inteira, junto do tracking, para o endpoint D1 `/query`. O primeiro `SELECT CASE … END` sem parênteses do trigger `validate_theme_artwork_blob_insert` foi interpretado como fim do trigger e chegou incompleto ao SQLite remoto; `PRAGMA`, `RAISE` isolado e CRLF não foram a causa. A `4.121.0` não contém correção de migration/parser/trigger e não foi adotada.
- A documentação D1 garante rollback da migration que falha. Como a tentativa da `0004` não foi registrada, corrigir a própria `0004` preserva produção em `0003`, instalações vazias e o princípio de nunca reescrever uma migration já aplicada. O próximo Workers Build é a confirmação remota; teste D1 local não substitui esse smoke.

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
- Dataset de smoke: uma categoria interna, um tema, somente EASY, 250 slots densos, quatro opções, distribuição 63/63/62/62, nenhuma imagem/fonte/trivia e flag editorial exata; limpeza deve preservar todo histórico.
- M8.5: timer sem rerender de alta frequência, segundo inteiro sincronizado, pausa por `phaseRemainingMs`, retomada por `remainingMs`, resultado por 2.900 ms, READY após apresentação de 1.900 ms, título de rodada único, escolhas autoritativas com dois avatares, resultado com dois perfis e `prefers-reduced-motion`.
- Arte de tema: união exclusiva, 16 chaves/SVGs, fallback, imagem quebrada, crop/reencode/cap, magic bytes/chunks/dimensões, autorização ADMIN, conflito de versão, replace/remove, URL/ETag/cache, ausência de BLOB no catálogo, migration vazia e chunks lazy fora do precache.
- Compatibilidade remota de migrations: parse de cada arquivo com o Wrangler fixado, proibição de trigger composto, banco vazio, upgrade exato `0003 → 0004`, schema/FK/constraints, invariantes metadata/BLOB e rollback sem resíduo em schema ou `d1_migrations`; smoke hospedado continua obrigatório.
- Correção M8.5: `SEARCHING.timeoutAt`, 00:00–01:00, cancelamento imediato, globo/lupa/personagens/reduced-motion, `MATCH_FOUND` sem navegação imediata, apresentação 1.200/800/900 ms, payload individual sem segredo, preload sem READY, avatar custom→Google→iniciais, upload/replace/remove/version/cache, manifesto/logo claro/escuro e Chromium desktop/mobile.
- Fechamento M8: corrida 6.999/7.000/7.001 ms, CONNECT/ALARM após deadline, todas as fases pausáveis, FINALIZING neutro, reconexão terminal, offline além da graça, recuperação por retorno de rede, lock/Presence, finalização idempotente e `partida 1 → VOID → partida 2` com os mesmos usuários.
- Hardening UX M8: offline imediato, socket silencioso com `navigator.onLine=true`, retomada da mesma pergunta/tempo, `VOID` sem retorno da questão, `PAUSED` opaco nos dois clientes, modal top-layer, Tab/Escape, cancelamento/Presence, encontrado e timeout com fundo inerte, desktop e viewport mobile.

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
- naquele checkpoint, o reteste real de cinco perguntas com `2.000 / 1.600` permanecia pendente; ele foi posteriormente aprovado pelo proprietário e fundamentou a calibração abaixo. Milestone 9 não foi iniciado.

### 2026-08-11 — Milestone 8.5 — calibração 2.400/1.900 e escolhas autoritativas

Evidência real confirmada pelo proprietário:

- a cadência `2.000 / 1.600` melhorou bastante a partida em produção, mas ainda justificava um pequeno aumento de leitura e fades mais suaves;
- testes reais mostraram que o avatar adversário aparecia principalmente em acertos e que o avatar do próprio jogador não aparecia na alternativa escolhida;
- a causa foi confirmada: `LiveMatchProjection.resolution` não enviava `opponent.selectedOption`, e o frontend tentava localizar a escolha adversária pelo aumento do score.

Implementação concluída:

- `LIVE_ROUND_RESULT_MS` passou de 2.000 para 2.400 ms; o cálculo autoritativo continua concluído antes da janela de apresentação;
- a revelação usa aproximadamente 0–250 ms para veredito/avatar próprio, 250–550 ms para o avatar adversário, 550–850 ms para `+N` e placar, estabilidade até 2.100 ms e saída suave de 2.100–2.400 ms;
- `MATCH_ROUND_TRANSITION_MS` passou de 1.600 para 1.900 ms; a composição central usa aproximadamente 320 ms para entrada e saída, e a pergunta continua entrando bloqueada nos 300 ms finais;
- `roundPresentationDelay()` preserva `max(1.900, payload.transitionMs)`, `ROUND_READY` sai somente ao fim da apresentação e os 10.000 ms nascem no servidor apenas após READY dos dois;
- durante `ANSWERING`, o objeto público do adversário continua contendo somente `answered`, identidade pública e score já revelável, sem `selectedOption` ou `correct`;
- somente depois da resolução, `resolution` projeta diretamente dos `LiveRoundAnswer` autoritativos `correctOption`, as duas `selectedOption`, as duas correções e scores necessários; timeout usa `selectedOption: null`;
- uma pausa iniciada em `ROUND_RESULT` preserva a revelação já autorizada, enquanto pausa de `ANSWERING` continua selada;
- o frontend não contém mais inferência por diferença de score: avatar próprio e adversário aparecem nas alternativas autoritativas, sejam corretas, erradas, iguais ou diferentes;
- alternativa correta fica verde mesmo sem votos; alternativas erradas escolhidas ficam vermelhas sem perder os avatares; duas escolhas iguais usam uma fileira legível, com molduras existentes preservadas;
- `prefers-reduced-motion` remove movimentos não essenciais, mas os intervalos funcionais de 2.400 e 1.900 ms permanecem;
- não houve alteração de scoring, XP, Conhecimento, matchmaking, 5/10/15 perguntas, randomização, timer de 10 segundos, transporte WebSocket, reconexão ou regra de 7 segundos; Milestone 9 não foi iniciado.

Validação executada antes da publicação:

- lint e typecheck dos três workspaces aprovados;
- 18 arquivos/107 testes unitários aprovados, incluindo sigilo antes da resolução, escolha adversária certa/errada, timeout nulo prevalecendo sobre clique local, avatares iguais/diferentes, correta sem voto e READY único aos 1.900 ms;
- 4 arquivos/10 testes no runtime Workers/WebSocket aprovados, inclusive projeções reais antes e depois de `ROUND_RESOLVED`;
- builds do domínio, PWA com realtime ativado e Worker aprovados;
- o smoke real Fácil em dois usuários com `2.400 / 1.900`, acerto, erro e timeout permanece pendente do deploy automático.

### 2026-08-12 — sistema de arte dos temas

Implementação concluída:

- cada tema passou a ter exatamente uma apresentação ativa: ícone padrão, imagem personalizada ou fallback pelas iniciais; a resolução fica centralizada em `ThemeArtwork`, sem regras paralelas nas telas;
- foi criada uma biblioteca interna reutilizável com 16 símbolos vetoriais próprios em um único sprite SVG leve, sem emoji e sem dependência de ícones; catálogo, busca, detalhe, matchmaking e ADMIN usam o mesmo asset;
- `ThemeArtwork` mantém dimensões quadradas conhecidas, usa `object-fit: cover`, preserva o fallback durante o carregamento e memoriza URLs carregadas; o matchmaking recebe o objeto de tema já disponível e não repete a consulta;
- a rota Criar e o editor de arte são chunks lazy. O ADMIN escolhe claramente `Ícone padrão`, `Imagem personalizada` ou `Sem imagem`, vê a grade visual e pode substituir ou remover a escolha depois;
- o processamento local aceita apenas PNG/JPEG/WebP/AVIF, rejeita SVG, permite crop quadrado com zoom e deslocamento, reencoda por Canvas em WebP, remove metadata, tenta 512 px com redução progressiva até 256 px e busca até 55 KB, respeitando o hard cap de 60 KB; o original nunca é enviado nem armazenado;
- a migration versionada `core/0004_theme_artwork.sql` mantém somente metadados nas linhas de tema e guarda no máximo um WebP ativo por tema em `theme_artwork_blobs`; consultas textuais não selecionam o BLOB e R2 não foi provisionado;
- o Worker expõe URL pública própria e versionada `/api/theme-artwork/:themeId/v<versão>.webp`, com ETag, `HEAD`, `304` e cache imutável; versões antigas deixam de resolver depois da troca;
- gravações de arte exigem Firebase válido, role `ADMIN`, versão esperada e validação autoritativa. A leitura em streaming é interrompida ao ultrapassar 60 KB; o parser WebP verifica contêiner, chunks, dimensões e metadata proibida antes da transação, e um token único impede upload concorrente atrasado de tocar no BLOB vencedor;
- `coverImageKey` permanece apenas como ponte compatível para imagens personalizadas e não contém o BLOB; ícone e fallback usam a nova representação tipada;
- foram atualizadas a arquitetura, as proteções de free tier e os testes de domínio, UI, processamento, API, repository/runtime, migration e contrato do sprite. Nenhuma regra de partida foi alterada e o Milestone 9 não foi iniciado.

Auditoria de performance:

- baseline anterior: JS inicial 372,97 KB / 115,84 KB gzip e CSS 41,86 KB / 9,11 KB gzip;
- build final com realtime: JS comum dividido em 362,86 KB + 9,86 KB, total 372,72 KB / 116,70 KB gzip; variação aproximada de -0,25 KB bruto e +0,86 KB gzip;
- CSS final: 47,63 KB / 9,96 KB gzip; variação aproximada de +5,77 KB bruto e +0,85 KB gzip;
- o chunk de gestão `create-page` tem 8,53 KB / 3,08 KB gzip, o editor 6,46 KB / 2,61 KB gzip e o sprite 5,36 KB / 1,37 KB gzip; os três ficaram fora do precache do service worker;
- imagens personalizadas adicionam zero byte ao startup: só são requisitadas pelo componente nas telas que efetivamente as exibem. O sprite também só é requisitado quando um tema com ícone padrão é renderizado.

Validação executada antes da publicação:

- `npm run check` com realtime ativado aprovou lint sem warnings, typecheck dos três workspaces, 25 arquivos/127 testes unitários, 5 arquivos/14 testes no runtime Workers/WebSocket e builds de domínio, PWA e Worker;
- todas as migrations de Questions `0001–0002` e Core `0001–0004` foram aplicadas do zero em bancos D1 locais separados; o Core contém a tabela de arte e não contém perguntas, e o Questions contém perguntas e não contém arte;
- a seleção de ícone/fallback, substituição e remoção de imagem, concorrência de versão, cache/ETag, ausência de BLOB no catálogo, bloqueio sem ADMIN, rejeição de arquivo inválido/metadata/SVG e fallback de imagem quebrada têm cobertura automatizada;
- o smoke real autenticado de upload, troca de arte e renderização após deploy permanece pendente porque exige Firebase/D1/Worker reais. Esse ponto não é declarado como evidência local.

### 2026-08-12 — correção do deployment da arte dos temas

Investigação concluída:

- o Workers Build chegou ao comando remoto com Wrangler `4.120.1`, mas parou antes de publicar o novo Worker; Questions não tinha migration pendente e Core falhou na `0004_theme_artwork.sql`;
- o caminho local do Wrangler separa o SQL com `unstable_splitSqlQuery()` e envia statements completos ao batch local. O caminho remoto concatena a migration com o `INSERT` de tracking e envia a string inteira ao endpoint D1 `/query`;
- o primeiro statement incompatível era `CREATE TRIGGER validate_theme_artwork_blob_insert`, especificamente seu `SELECT CASE WHEN … THEN RAISE(ABORT, …) END;` sem parênteses. O parser multi-statement remoto interpretava esse primeiro `END` como término do trigger e entregava SQL truncado ao SQLite, resultando em `incomplete input`;
- a migration usa LF, e `PRAGMA foreign_keys`, `RAISE()` isolado e a sintaxe SQLite do trigger não eram a causa. Os outros triggers com `CASE … END` manteriam o mesmo risco mesmo se apenas o primeiro fosse contornado;
- as release notes oficiais de Wrangler `4.121.0` não incluem correção de D1 migrations, `/query`, splitter ou triggers. A versão permaneceu fixada em `4.120.1`, sem atualização especulativa;
- D1 documenta que uma migration com erro é revertida e não avança `d1_migrations`. Como a tentativa remota da `0004` falhou, produção permaneceu integralmente em `0003`; por isso a correção correta foi editar a `0004` ainda pendente, sem criar `0005` compensatória.

Correção restrita ao deployment:

- a `0004` passou a usar somente SQL remoto simples. `CHECK`s expressam a união exclusiva e a lista de ícones; PK limita a um BLOB por tema; índice único e FK composta ligam o BLOB `CUSTOM` à versão ativa; tipo, dimensões, byte cap e igualdade entre `byte_length`/BLOB permanecem no schema;
- o Worker continua sendo a autoridade para autenticação ADMIN e validação estrutural WebP. A escolha ICON/NONE agora remove condicionalmente o BLOB antes de atualizar metadata, no mesmo batch transacional; a substituição CUSTOM mantém update versionado + upsert com token único e `ON UPDATE CASCADE`;
- falha da segunda operação reverte a remoção, e uma requisição atrasada não remove o BLOB vencedor porque o `DELETE` também exige a versão esperada. Testes diretos cobrem estados inválidos, cap/dimensões/tipo, FK, unicidade, substituição, remoção e conflito;
- `scripts/validate-d1-migrations.mjs` foi incluído em `npm run check` e repetido imediatamente antes da migration remota. Ele usa o Wrangler real, bloqueia compound triggers, executa todas as migrations em banco vazio, executa upgrade exato `0003 → 0004`, inspeciona schema/constraints e comprova rollback sem resíduo;
- o gate local não finge reproduzir o parser hospedado de `/query`. A aprovação remota continua sendo o Workers Build disparado pelo push da `main`; nenhum SQL ou deploy manual foi executado.

Validação executada:

- `VITE_ENABLE_REALTIME_MATCHES=true npm run check`: lint sem warnings, typecheck dos três workspaces, 25 arquivos/127 testes unitários, 5 arquivos/14 testes no runtime Workers/WebSocket, gate D1 e builds de domínio/PWA/Worker aprovados;
- migration Core aplicada desde banco vazio e desde o estado exato `0003`; schema final, defaults do tema existente, FK composta, invariantes metadata/BLOB e rollback de migration inválida aprovados;
- revisão final da `0004`: LF, 2.168 bytes, zero trigger, zero `RAISE`, seis statements de schema + statement de tracking separados corretamente pelo Wrangler;
- `npm audit --audit-level=high`: zero vulnerabilidades; auditoria de secrets encontrou somente `.env.example` e `.dev.vars.example` com placeholders esperados, sem chave privada, Service Account ou token;
- ThemeArtwork, 16 SVGs, UX ADMIN/crop, endpoint/cache/lazy loading, storage D1 separado e auditoria de performance permaneceram inalterados. Nenhum R2, billing, seed, deploy manual ou Milestone 9 foi iniciado.

### 2026-08-13 — correção de escopo do Milestone 8.5

Auditoria antes de alterações:

- a `main` em `856aaa1` ainda possuía radar simples, texto antigo, Cancelar secundário, timeout local, navegação imediata, `QG`, assets PWA placeholder e nenhum avatar customizado;
- Theme Artwork, os 16 ícones, editor ADMIN e `0004_theme_artwork.sql` foram verificados e permaneceram sem diff;
- baseline de produção: 372,72 KB / 116,70 KB gzip de JS inicial, 47,63/9,96 KB de CSS e 9 entradas/417,07 KiB de precache.

Implementação concluída:

- a fila envia `SEARCHING.timeoutAt`; o frontend deriva o segundo inteiro e mantém o backend autoritativo, sem polling nem estado por frame;
- o diálogo preserva `ThemeArtwork`, remove o parágrafo antigo, usa Cancelar primário vermelho e apresenta globo/lupa/personagens próprios em SVG/CSS, com entrada/saída e reduced-motion;
- o MatchRoom projeta por jogador a identidade real do adversário, `knowledgeBefore` temático e somente a primeira pergunta pública. A apresentação usa 1.200 ms de entrada, 800 ms de permanência e 900 ms de saída;
- chunk, ticket, socket, avatar e imagem pública atual são preparados nos 2.900 ms. O socket fica bufferizado sem `READY`; a MatchScreen assume a conexão antes de iniciar o protocolo existente;
- `user_custom_avatars` guarda uma única versão ativa WebP 256 × 256/50 KB no Core D1. Upload e remoção usam o Firebase UID autenticado; perfil, Top 5 e partida consultam somente metadata;
- `Avatar` e `AvatarFrame` centralizam `custom → Google → iniciais` e preservam moldura no header, perfil, ranking do tema, jogador encontrado, MatchScreen, alternativas e resultado;
- a imagem oficial anexada gerou favicon, Apple, PWA `192/512/maskable` e logos internas WebP fingerprinted. A variante escura troca somente áreas brancas por near-black; placeholders foram removidos;
- performance e requests antes/depois estão registrados em `docs/PERFORMANCE_MILESTONE_8_5.md`.

Validação executada:

- gate final `VITE_ENABLE_REALTIME_MATCHES=true npm run check`: lint sem warnings, typecheck dos três workspaces, 30 arquivos/142 testes unitários, 6 arquivos/18 testes Workers/WebSocket, migrations e builds aprovados;
- migrations Core aprovadas em banco vazio, `0003 → 0004`, `0004 → 0005`, invariantes e rollback; a `0004` não foi alterada;
- Chromium real: busca/encontrado/preparando em desktop 1.440 × 900 e mobile 390 × 844, claro/escuro, sem overflow/console error; Cancelar computado em vermelho, lupa animada e movimentos desligados por reduced-motion;
- editor de avatar com arquivo real aprovado nas mesmas larguras, com preview, três controles, troca/remoção e variante escura da marca, sem overflow;
- `npm audit --audit-level=high`: zero vulnerabilidades; varredura de chave/token privado sem achados;
- build final: JS inicial 367,71/117,80 KB gzip, CSS 53,47/10,99 KB gzip, MatchScreen lazy 15,03/5,02 KB gzip, cropper lazy 4,92/2,04 KB gzip e precache 11 entradas/433,03 KiB;
- nenhum scoring, ranking, XP, Conhecimento, duração de 10 segundos, cadência 2.400/1.900, randomização, reconexão, regra de 7 segundos, Durable Object existente ou Milestone 9 foi alterado.

### 2026-08-14 — fechamento robusto de reconexão, locks e smoke dataset

Auditoria causal antes das alterações:

- o celular congelava porque, após 7 segundos de retries locais, `live-match-page.tsx` preservava a projeção `PAUSED` e a pergunta antiga; o ramo visual da pergunta tinha precedência sobre o erro e não existia recuperação terminal por retorno de rede/foco/visibilidade;
- `CONNECT` em `PAUSED` restaurava a fase sem comparar o `graceDeadlineMs` persistido. Um alarme atrasado permitia `RESUMED` depois da fronteira aprovada;
- `FINALIZING` ainda podia projetar a pergunta e uma reconexão nessa janela não forçava a finalização idempotente nem restaurava sempre o summary terminal;
- a finalização normal já apagava `active_match_players` no mesmo batch do ledger. Como as contas observadas conseguiam abrir a fila — cujo ticket e socket verificavam o lock — o segundo pareamento não falhou por lock preso. O pool de 30 perguntas, bloqueado pela união dos recentes, reproduziu `QUESTION_POOL_INSUFFICIENT`, mas a fila colapsava esse código em `MATCH_INITIALIZATION_FAILED` e a UI mostrava a mensagem genérica;
- associações historicamente órfãs apontando para uma partida já terminal e Presence terminal residual não possuíam reparo seguro, embora não tenham sido a causa do incidente observado;
- a finalização já marcava somente `questions.slice(0, roundIndex + 1)`: a pergunta efetivamente exibida continua vista, e as futuras selecionadas para a sala não entram no histórico de uma partida anulada.

Implementação:

- `CONNECT` e `ALARM` usam o mesmo deadline persistido; exatamente no deadline a única saída é `VOID`. O restore preserva a fase, pergunta, respostas, READY, scores e `phaseRemainingMs` quando ocorre antes da fronteira;
- na implementação de então, após 7 segundos locais o frontend mantinha somente retries terminais espaçados. A remoção da pergunta permaneceu válida, mas a decisão cliente de usar `terminal=1` por tempo local foi explicitamente substituída em 2026-08-18 pela recuperação do estado autoritativo atual;
- a sala não projeta pergunta em `FINALIZING`, repete finalização idempotentemente e recupera `MATCH_VOID`/`MATCH_FINISHED` do storage ou D1 para membros históricos;
- locks de partidas terminais são limpos de forma restrita na consulta/idempotência, Presence volta a `idle` sem poder sobrescrever uma atividade nova e partidas ativas permanecem bloqueadas;
- a fila propaga somente códigos allowlisted; detalhes internos continuam reduzidos a `MATCH_INITIALIZATION_FAILED` e logs estruturados seguros;
- migrations forward-only ampliam exclusivamente `SYNTHETIC_SMOKE_TEST` para 250 perguntas EASY mínimas. Nenhum histórico real pode ser resetado e o limite global de 200 recentes permanece intacto;
- `LIVE_ROUND_RESULT_MS` foi corrigido para 2.900 ms; a apresentação da próxima pergunta permanece 1.900 ms e o gameplay permanece 10.000 ms.

Cobertura adicionada:

- domínio em 6.999/7.000/7.001 ms, CONNECT versus ALARM, todas as fases pausáveis e projeção sem pergunta em `FINALIZING`;
- cliente offline além da graça confirmada pela sala, remoção da pergunta, recuperação por `online` e terminal sem retorno a gameplay;
- runtime com CONNECT primeiro depois do deadline, ALARM primeiro, reconexão histórica, Casual sem efeito, Ranqueada com penalidade somente no desconectado, cleanup/self-healing, Presence e finalização concorrente/idempotente;
- fluxo obrigatório `PARTIDA 1 → queda → VOID → locks 0/Presence idle → PARTIDA 2` com os mesmos usuários;
- Questions vazio e upgrade `0002→0003`, Core vazio e `0003→0004→0005→0006`, comprovando 250 slots densos, marcados e sem mídia/fonte.

Validação final local:

- `VITE_ENABLE_REALTIME_MATCHES=true npm run check`: lint sem warnings, typecheck dos três workspaces, 30 arquivos/156 testes unitários, 6 arquivos/26 testes Workers/WebSocket, migrations e builds aprovados;
- build Web: JS inicial 215,31/67,69 KB gzip, sala lazy 16,50/5,41 KB gzip, CSS 53,47/10,99 KB gzip e precache de 11 entradas/435,00 KiB; Worker 706,8 KB;
- `npm audit --audit-level=high`: zero vulnerabilidades; varredura de chaves/tokens privados sem achados fora dos arquivos `.example` esperados.

Branding, Theme Artwork, avatar, matchmaking visual, globo/lupa, apresentação do adversário, scoring, XP, ranking, Conhecimento, aleatoriedade, sigilo e Milestone 9 permaneceram fora do diff funcional.

### 2026-08-14 — hardening final de UX de desconexão e modalidade do matchmaking

Auditoria causal antes das alterações:

- na perda local, close/offline alteravam apenas retry e texto; a projeção anterior continuava `ANSWERING`, portanto `MatchScreen` mantinha pergunta, imagem, alternativas e escolha no DOM até a recuperação terminal;
- `PAUSED` era incluído explicitamente no ramo jogável e recebia apenas um overlay com fundo parcialmente transparente. As respostas ficavam desabilitadas, mas o conteúdo continuava legível;
- o MatchRoom já implementava `HEARTBEAT → PONG`, porém o frontend não o consumia. `navigator.onLine`, `offline` e o callback de close do edge não cobrem imediatamente uma conexão móvel silenciosa;
- `aria-modal` estava aplicado a uma `section` comum. O AppShell, header e barra inferior permaneciam clicáveis/focáveis porque não havia top layer, `inert` nem confinamento de Tab.

Implementação restrita à UX/liveness:

- o cliente mantém estado local explícito `CONNECTED / SUSPECTED_LOSS / RECONNECTING / TERMINAL_RECOVERY`. Offline, close/error ou ausência de dois ciclos de `PONG` removem imediatamente a tela jogável e mostram `CONEXÃO PERDIDA`; a contagem local 7→0 desta primeira implementação foi removida na correção de sincronização de 2026-08-18;
- heartbeat envia uma mensagem pequena a cada 1.500 ms enquanto o socket está aberto e considera a conexão silenciosa em 3.000 ms. Um watchdog de abertura e um timer único da graça evitam socket pendurado, sem polling HTTP ou estado por frame;
- `PAUSED_FOR_RECONNECT` desmonta `MatchScreen` nos dois clientes. O jogador conectado vê `AGUARDANDO JOGADOR`; o cliente localmente afetado vê `CONEXÃO PERDIDA`. A tela é opaca e entrada/saída usam somente opacity/transform;
- `RESUMED` aplica primeiro a projeção e o `remainingMs` autoritativos, mantém a tela de pausa durante 180 ms de saída e só então remonta a mesma pergunta. `MATCH_VOID` e recuperação terminal nunca remontam conteúdo jogável;
- matchmaking usa `dialog.showModal()` em Portal. O AppShell fica `inert` e `aria-hidden`, cliques/foco externos têm bloqueio defensivo, Tab permanece no modal, Escape cancela a fila durante busca ou fecha o timeout pelo mesmo caminho de `Voltar ao tema`, e o foco original é restaurado no cleanup;
- o visual existente do ThemeArtwork, globo/lupa, Cancelar vermelho, timer e apresentação do adversário foi preservado. Domínio, MatchRoom, regra 6.999/7.000/7.001 ms, scoring, pool e dataset não receberam alteração funcional.

Cobertura e validação local:

- A–E: offline imediato, socket silencioso com `navigator.onLine=true`, retomada suave da mesma pergunta/tempo, terminal depois da graça e `PAUSED` opaco para o adversário;
- F–J: navegação/header inertes, Tab confinado, Cancelar com close real da fila e Presence `idle`, encontrado ainda modal e timeout bloqueado até `Voltar ao tema`;
- `VITE_ENABLE_REALTIME_MATCHES=true npm run check` aprovou lint e typecheck dos três workspaces, 30 arquivos/163 testes unitários, 6 arquivos/27 testes Workers/WebSocket e todas as migrations; o build raiz foi repetido com update notifier desativado e aprovado;
- build Web: JS inicial 217,60/68,34 KB gzip, sala lazy 18,68/6,17 KB gzip, CSS 55,16/11,26 KB gzip e precache de 11 entradas/441,02 KiB; Worker 706,8 KB;
- `npm audit --audit-level=high`: zero vulnerabilidades; varredura de chaves/tokens privados sem achados. A chave Web pública do Firebase permanece classificada como configuração cliente, não segredo.

### 2026-08-18 — sincronização visual final da perda de conexão e da graça

Auditoria causal antes das alterações:

- o primeiro sinal local de perda criava `retryStartedAt + 7.000` e o passava à tela como se fosse um deadline da sala. Como o MatchRoom só começava a graça quando o edge detectava o socket morto, celular e computador animavam relógios iniciados em momentos diferentes;
- ao completar esses 7 segundos locais, o cliente trocava para recuperação `terminal=1`. Isso transformava tempo percebido pelo navegador em decisão de protocolo, apesar de a sala ainda poder estar legitimamente em `ANSWERING`;
- a projeção `PAUSED` já continha `graceRemainingMs` calculado pelo domínio no instante do envio. Não foi necessária alteração em domínio, MatchRoom, Hibernation API ou fronteira 6.999/7.000/7.001 ms;
- heartbeat e watchdog já operavam em 1.500/3.000 ms. Em uma sala normal são dois sockets, aproximadamente 1,33 mensagens HEARTBEAT de entrada por segundo no Durable Object, além dos PONGs; aumentar a frequência não eliminaria a janela física sem canal e elevaria tráfego/wakeups.

Implementação restrita à UI/reconexão cliente:

- perda local desmonta a `MatchScreen` imediatamente, exibe spinner e nunca mostra número. Após 3 segundos, a cópia muda para `Aguardando conexão para verificar a partida...`, sem declarar derrota, `VOID` ou partida anulada;
- somente `PAUSED_FOR_RECONNECT` cria relógio. `graceRemainingMs` é ancorado em `performance.now()` no recebimento e consumido monotonicamente; alterações em `Date.now()` não afetam o contador;
- reconexão normal não recebe mais `terminal=1` por expiração de cronômetro local. `ROOM_STATE` ainda em `ANSWERING` restaura a projeção e o `remainingMs` atuais, `PAUSED` usa o restante real, e `MATCH_VOID`/`MATCH_FINISHED` permanecem terminais;
- chegar visualmente a zero mostra apenas `Confirmando encerramento da partida...`; nenhum estado terminal é criado no frontend;
- as transições opacas de 180 ms e `prefers-reduced-motion` foram preservados. O indicador local passou a ser um arco CSS leve, sem request, polling HTTP, frame state ou dependência nova;
- Theme Artwork, branding, avatar, matchmaking, locks, dataset, perguntas, scoring, Conhecimento, XP, ranking, cadências e Milestone 9A ficaram fora do diff funcional.

Cobertura adicionada:

- perda local sem contador, cópia de espera, questão/alternativas ausentes e nenhuma decisão terminal após 7 segundos locais;
- recuperação autoritativa de `ANSWERING` mesmo após espera local, sem reset ou reembolso; recuperação durante `PAUSED` começando em 4, não em 7; `MATCH_VOID` somente após mensagem da sala;
- adversário em `PAUSED` usando 6.842 ms reais, relógio civil divergente sem efeito, dois consumidores do mesmo evento dentro de 25 ms e zero visual sem `MATCH_VOID` inventado;
- a suíte existente continua cobrindo heartbeat silencioso, todas as fases pausáveis, retomada em 6.999 ms, `VOID` em 7.000/7.001 ms, corrida CONNECT/ALARM e runtime completo de cleanup/revanche.

Validação local final:

- `VITE_ENABLE_REALTIME_MATCHES=true npm run check`: lint e typecheck dos três workspaces aprovados, 31 arquivos/168 testes unitários, 6 arquivos/27 testes Workers/WebSocket, migrations e builds aprovados;
- migrations: Core vazio e upgrades exatos `0003→0004→0005→0006`, Questions vazio e `0002→0003`, invariantes, rollback e schemas finais aprovados;
- build Web: JS inicial 217,60/68,34 KB gzip, sala lazy 19,15/6,32 KB gzip, CSS 54,87/11,19 KB gzip e precache de 11 entradas/441,18 KiB; Worker 706,8 KB;
- comparado ao hardening anterior, o chunk lazy da sala cresceu 0,47 KB bruto/0,15 KB gzip, o CSS caiu 0,29/0,07 KB gzip e não surgiu request, dependência ou chunk novo de startup;
- `npm audit --audit-level=high`: zero vulnerabilidades; varredura de chaves privadas/tokens sem achados.

### 2026-08-21 — congelamento físico de M8/M8.5 e Milestone 9A Social Foundation

O proprietário confirmou em produção todos os smokes físicos pendentes de M8/M8.5, incluindo cadência `2.900 / 1.900`, apresentação, avatar, modo avião, graça visual monotônica, `VOID`, revanche e modalidade. Ambos foram registrados como **FROZEN antes do início do 9A**. O motor autoritativo, `MatchRoom`, reconnect, locks, scores, Knowledge, XP, perguntas, dataset, arte, avatar e marca ficaram fora do diff funcional.

Auditoria inicial:

- `users`, `user_profiles.public_id`, `friendships`, `friend_requests` e o índice nominal já existiam no Core D1; a aba Social ainda era placeholder com presença e assíncronas fictícias;
- o índice pendente original impedia duplicação na mesma direção, mas permitia `A→B` e `B→A` simultaneamente; inexistiam recusas direcionais, bloqueios, instalações e filtro competitivo por bloqueio;
- Firebase JS SDK `12.17.1` já estava instalado. A documentação oficial atual recomenda `register()`/`onRegistered()` com Firebase Installation ID; a referência REST HTTP v1 aceita `message.fid` e identifica registration tokens como depreciados;
- o PWA existente usava `generateSW`; adicionar um `firebase-messaging-sw.js` separado criaria risco de dois service workers competindo no root scope.

Implementação:

- migration D1-safe `0007_social_foundation.sql`: `resolution_key`, índice parcial normalizado para um único pending por dupla, estados direcionais de recusa/cooldown, bloqueios com índices inversos e múltiplas instalações FID por usuário; nenhum trigger, banco novo, alteração do Questions DB ou produto pago;
- pesquisa autenticada por prefixo nominal case-insensitive limitado a 20 resultados e lookup exato por `#QG...`, omitindo self, usuários desativados e duplas bloqueadas; respostas incluem somente nome, public ID, avatar custom/Google/iniciais e moldura;
- pedidos, cancelamento do remetente, aceite idempotente/atômico, recusa explícita direcional e remoção de amizade reutilizam as tabelas existentes. A terceira recusa cria 30 dias; ciclos expiram sob demanda e aceite zera o histórico da direção;
- bloquear cancela pendings bidirecionais e remove amizade no mesmo batch, preserva cooldown, torna ambos invisíveis socialmente e mantém a lista privada somente em Perfil. Desbloquear não restaura vínculos nem envia notificação;
- única integração competitiva: a fila consulta bloqueio server-side antes de inicializar a sala, mantém dupla bloqueada procurando e escolhe o próximo candidato compatível. Uma partida já criada continua íntegra;
- Social funcional com pedidos recebidos/enviados, amigos, avatar/frame, aceite verde, recusa vermelha, badge real, busca debounced, confirmação acessível e ausência deliberada de presença/desafios/assíncronas;
- push opt-in multi-device usa um único service worker Workbox `injectManifest`, foreground sem alerta duplicado, background com clique em Social/Pedidos, FID moderno, OAuth RS256 via Web Crypto e `waitUntil` pós-persistência. Credenciais ausentes ou FCM indisponível não quebram o produto;
- Profile carrega bloqueados somente após gesto explícito; Firebase Messaging e Social são lazy quando aplicável. O bundle inicial caiu de `217,60 / 68,34 KB gzip` para `214,16 / 67,51 KB gzip`; Social soma `7,49 / 2,31 KB gzip`, SW único `69,43 / 21,60 KB gzip` e Worker `736,5 KB`.

Cobertura local:

- 36 arquivos / 185 testes unitários, incluindo Social, badge, confirmação, opt-in, foreground, background, notification click e shell Workbox;
- 7 arquivos / 43 testes Workers/WebSocket, incluindo busca/privacidade, pedidos cruzados, aceite/recusa concorrentes, 3 recusas e 30 dias direcionais, bloqueio/desbloqueio, FIDs/IDOR, falha/instalação inválida FCM, dupla bloqueada com terceiro compatível e bloqueio durante partida ativa;
- os testes históricos preservam a fronteira `6.999 / 7.000 / 7.001`, corrida `CONNECT`/`ALARM`, recuperação terminal, Presence, cleanup e segunda partida com a mesma dupla;
- lint, typecheck, builds PWA/Worker, migrations Core vazio e upgrade `0006→0007`, rollback, npm audit e varredura de secrets fazem parte do gate final; FCM real depende apenas da configuração manual opcional documentada em `docs/DEPLOYMENT.md`.

O smoke físico completo do Milestone 9A **permanece pendente da aprovação explícita do proprietário**. Os Milestones 9B/9C, presença individual social, desafio direto, assíncrono, chat, mensagens, grupos e recomendação não foram iniciados.

### 2026-08-21 — Milestone 9A.1: cancelamento pré-partida e realtime social

O proprietário aprovou em produção a busca nominal/ID, pedido, primeira recusa,
bloqueio, invisibilidade e filtro de bloqueio no matchmaking. Foram identificadas
somente duas lacunas: `CANCELLED` antes do início aparecia como `VOID` genérico
com placar fictício; Social dependia de foco/navegação/FCM para atualizar pedidos.

- domínio preserva `VOID/CANCELLED`, zero XP/Knowledge/score e grava somente o
  assento do cancelador; a projeção terminal acrescenta `{ seat, displayName }`
  derivado do jogador autoritativo, nunca UID ou dado privado;
- tela específica mostra “Partida cancelada por {nome}” sem `0 × 0`; route state
  devolve ao tema original com dificuldade e modalidade selecionadas;
- migration Durable Objects SQLite `v2` registra exclusivamente
  `SocialRealtimeHub`; não há migration D1, banco, SQL manual ou produto pago;
- ticket curto `scope: social` autentica o WebSocket; anexos/tags mantêm o ID
  interno, e o total publicado conta usuários únicos entre abas/dispositivos;
- criação/aceite/recusa/cancelamento de pedido, remoção de amizade e
  bloqueio/desbloqueio publicam apenas `SOCIAL_INVALIDATED` depois da escrita;
  todas as sessões afetadas recarregam o estado real, sem polling nem motivo do
  bloqueio;
- heartbeat social de 45 s e watchdog de 15 s utilizam
  `setWebSocketAutoResponse`, sem acordar o DO, sem timers server-side e sem
  alterar o heartbeat competitivo de 1.500 ms;
- 30 usuários por 24 h representam 57.600 heartbeats, até 2.880 requests DO
  equivalentes na razão conservadora 20:1, zero writes/reads D1 periódicos e
  duração ociosa nula por hibernação;
- Firebase Messaging permanece opcional apenas para background; Social aberto
  atualiza mesmo sem qualquer VAPID/service-account configurada.
- build medido: startup `214,83 / 67,69 KB gzip`, Social lazy inalterado
  `7,49 / 2,31 KB gzip`, sala `19,59 / 6,52 KB gzip`, precache
  `15 entradas / 480,69 KiB` e Worker `742,1 KB`.

O smoke físico do 9A.1 foi posteriormente **aprovado integralmente pelo
proprietário em produção**, autorizando exclusivamente o início do 9B. Desafio
9C e demais milestones futuros permanecem não iniciados.

### 2026-08-21 — Milestone 9B: presença privada e experiência Social refinada

Antes da implementação, o gate físico do 9A.1 foi marcado como aprovado e o
milestone como concluído. M8/M8.5 permanecem **FROZEN**; `MatchRoom`, fila,
reconexão, scoring, Knowledge, XP, perguntas, locks, marca, avatar e FCM ficaram
fora do diff funcional.

- `PresenceHub` comunica somente mudanças reais de atividade ao
  `SocialRealtimeHub` global já existente; o identificador do objeto é associado
  server-side à sessão autenticada, sem UID/room ID no evento público;
- somente a primeira/última sessão lógica altera online/offline. `OFFLINE`
  vence qualquer atividade antiga; segunda aba/aparelho não duplica presença;
- `/api/social/presence` autentica o ator, resolve amigos e bloqueios no D1 e
  consulta `PresenceHub` apenas para amigos com socket ativo. Busca pública e
  não-amigos não possuem lookup individual nem recebem eventos;
- `FRIEND_PRESENCE_CHANGED` contém apenas ID público, enum de atividade geral e
  revisão lógica. Fanout resolve novamente amizades válidas imediatamente antes
  da entrega; remoção/bloqueio limpa mapas por invalidação/snapshot;
- snapshots capturam revision antes dos awaits e o frontend compara revisões e
  gerações de request, impedindo sobrescrita por evento/resposta antiga;
- `SocialContext` mantém mapa privado em contexto separado; status de um amigo
  não exige atualização do header global, busca, requests ou segundo socket;
- Social separa online/offline, ordena disponibilidade → busca → partida →
  reconexão → nome, mostra dot verde/amarelo/cinza, moldura/avatar reais e usa
  FLIP/WAAPI de 390 ms apenas quando necessário, com fallback reduced-motion;
- heartbeat social permanece em 45 s com watchdog 15 s e auto-response
  hibernável; não existe timer/alarm no DO, polling HTTP, escrita D1 periódica,
  migration, serviço extra, biblioteca de motion, billing ou push de presença;
- baseline e impacto ficam registrados em `docs/PERFORMANCE_MILESTONE_9A.md`;
  build inicial passou de `214,83 / 67,69 KB gzip` para
  `215,00 / 67,76 KB gzip`, e a sala congelada permanece em
  `19,59 / 6,52 KB gzip`.

O smoke físico do Milestone 9B permanece **pendente da aprovação explícita do
proprietário**. Desafio direto, convite, assíncrono, chat, last-seen e Milestone
9C **não foram iniciados**.

## Critério de saída desta execução

- Milestones 8 e 8.5 aprovados fisicamente e congelados;
- Social Foundation 9A e realtime global 9A.1 preservados; smoke físico do 9A.1 aprovado e registrado;
- presença privada 9B implementada/validada localmente e publicada em commits lógicos na `main` por fast-forward;
- suíte unitária, runtime Workers/WebSocket, PWA, Worker, migrations, rollback, npm audit e secrets verdes;
- push FCM opcional sem impedir amizades/bloqueios quando não configurado;
- smoke físico completo do 9A e smoke físico do 9B continuam pendentes até confirmação externa do proprietário;
- Milestone 9C não iniciado; sem preview de branch, R2, billing, migration adicional ou produto pago.
