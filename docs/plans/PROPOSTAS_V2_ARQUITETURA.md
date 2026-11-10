# Propostas V2 — estudo de arquitetura

> **Status: estudo. Nada aqui foi implementado.** Escrito em 2026-11-10 a partir
> da leitura do código na `main` (`1ef5c36`). Cada item só vira regra em
> `AGENTS.md` quando as decisões pendentes dele forem respondidas.

## 1. O que foi aprovado

O proprietário aprovou as maquetes de proposta, com uma exceção.

| # | Item | Situação |
|---|---|---|
| A1 | Navegação própria para computador | Aprovado |
| A2 | Início do celular com "seu dia" (ofensiva, missões, continuar) | Aprovado |
| A3 | Aviso das teclas 1–4 / A–D na partida | Aprovado |
| — | Selo de "virada" no placar | **Rejeitado. Não implementar.** |
| A4 | Tela de instalar com capturas e atalhos | Aprovado |
| B1 | Página de entrada para visitante | Aprovado |
| B2 | Cartões de Stories de liga e de Top do tema | Aprovado |
| B3 | `sitemap.xml` e `robots.txt` | Aprovado |
| B4 | Aviso de que o convite por link deu certo | Aprovado (sem prêmio) |
| C1 | Placar acumulado contra cada amigo | Aprovado, regras a definir |
| C2 | Estatísticas pessoais | Aprovado, regras a definir |
| C3 | Temporadas por tema | Aprovado, regras a definir |
| C4 | Sala privada com código (3 a 8) | Aprovado, regras a definir |
| C5 | Torneio de fim de semana | Aprovado, regras a definir |
| C6 | Avatares desenhados | Já aprovado antes; depende de quem cria a arte |

Fora do escopo por decisão anterior: treino solo, pergunta do dia, "Hora do
Duelo" e fila "Qualquer tema".

## 2. Regras de arquitetura que valem para todos os itens

1. **O motor do duelo não muda.** `MatchRoom`, `packages/domain/src/match/live-match.ts`
   e o lote transacional de `LiveMatchRepository.finalize` estão congelados
   (M8/M8.5). Tudo que precisa reagir a um resultado entra como **efeito
   pós-finalização** em `MatchRoom.persistFinalized`, do mesmo jeito que
   `recordMatchProgress` e `recordThemeRewards`: lê o resultado já gravado,
   tem guarda própria de idempotência e, se falhar, não altera nada competitivo.
2. **Migrations só novas.** Próximo número livre no Core: `0025`. Uma migration
   por fase, nunca reescrever as aplicadas.
3. **O servidor decide.** Pontos de temporada, placar entre amigos, estatísticas,
   chave de torneio e resultado de sala nunca vêm do cliente.
4. **Custo zero.** Nenhum produto novo da Cloudflare. Salas novas usam Durable
   Object SQLite com hibernação; agregados compactos em vez de uma linha por
   evento; toda leitura com `LIMIT` e índice.
5. **Uma fase = um PR** que passa em `npm run check` (lint, typecheck, testes,
   migrations e build, o mesmo portão do deploy).
6. **Regra de domínio nova nasce em `packages/domain` com teste.**

## 3. Resumo por item

| # | Onde mexe | Migration | DO novo | Tamanho | Risco |
|---|---|---|---|---|---|
| A1 | só CSS | não | não | P | baixo |
| A2 | web + 1 rota de leitura | não | não | P | baixo |
| A3 | web | não | não | P | baixo |
| A4 | `vite.config.ts` + imagens | não | não | P | baixo |
| B1 | web | não | não | M | baixo |
| B2 | web (`story-card.ts`) | não | não | M | baixo |
| B3 | Worker (2 rotas) + `wrangler.jsonc` | não | não | P | baixo |
| B4 | web + Worker | sim (1 coluna) | não | P | baixo |
| C1 | Worker + web | sim | não | M | médio |
| C2 | Worker + web | sim | não | M | médio |
| C3 | domínio + Worker + web + Cron | sim | não | G | médio |
| C4 | domínio + Worker + web | sim | **`PartyRoom`** | GG | alto |
| C5 | domínio + Worker + web | sim | **`TournamentHub`** | GG | alto |

P = uma sessão curta; M = uma sessão; G = duas ou três; GG = um marco inteiro.

## 4. Parte A — front-end

### A1. Navegação de computador

- A `.bottom-nav` já é `position: fixed`. No bloco `@media (min-width: 920px)`
  de `apps/web/src/styles/global.css` ela passa a ficar no topo, centralizada
  dentro da faixa do cabeçalho (76 px), com ícone e texto na horizontal. Sai o
  `padding-bottom: 102px` do `.app-shell`.
- **Nenhuma mudança em `app-shell.tsx`.** O mesmo `<nav>` serve aos dois
  tamanhos, então os testes que procuram os links continuam valendo e não há
  dois menus para o leitor de tela.
- Conferir: faixa 920–1040 px (o selo "online" não pode encostar na barra),
  foco visível, indicador deslizante (`--nav-index`) e tema escuro.

### A2. Início com "seu dia"

- Rota nova e enxuta `GET /api/profile/today` (autenticada, `no-store`):
  ofensiva ativa, missões do dia (feitas/total), Rankeadas da semana e o último
  tema jogado. São quatro leituras indexadas que já existem
  (`StreakRepository`, `MissionRepository`, `WeeklyMissionRepository`,
  `ProfileHistoryRepository.recentMatches(…, 1)`), em paralelo.
  Não reaproveitar `/api/profile/summary`: ele faz 13 leituras e a tela inicial
  é a mais aberta do app.
- Web: cartão em `pages/themes-page.tsx`, só para quem tem perfil. Visitante e
  sessão em restauração não veem nada (sem "piscar").
- Testes: rota sem token responde 401; formato da resposta; cartão escondido
  para visitante.

### A3. Aviso das teclas

- `components/match-screen.tsx`: um `<kbd aria-hidden="true">` por alternativa
  e uma linha de dica. `aria-hidden` mantém o nome acessível dos botões igual,
  então os testes atuais não quebram.
- CSS: visível só em `@media (hover: hover) and (pointer: fine)`.
- A lógica das teclas (`OPTION_KEYS`) já existe e não muda.

### A4. Tela de instalar

- Bloco `manifest` de `apps/web/vite.config.ts`: `screenshots` (três em pé,
  uma deitada) e `shortcuts` para `/`, `/social` e `/perfil`.
- As capturas entram em `apps/web/public/screenshots/` e na lista
  `globIgnores` do service worker, para não pesarem na instalação.
- **As capturas precisam ser do app real**, com temas de verdade. Não usar o
  dataset `SYNTHETIC_SMOKE_TEST` em material de divulgação.

## 5. Parte B — atrair público

### B1. Página de entrada

- Componente novo `components/visitor-hero.tsx`, mostrado no topo de
  `themes-page.tsx` quando `!loading && firebaseUser === null`.
- O "duelo de exemplo" é uma animação fixa em CSS, sem partida, sem pergunta do
  banco e sem chamada ao servidor. Com `prefers-reduced-motion`, fica parado.
- Botões: "Entrar com Google" (o `signIn()` de `auth-context`) e "Ver os temas"
  (rola até o catálogo, que continua aberto a visitante como hoje).

### B2. Cartões de liga e de Top

- `lib/story-card.ts` ganha dois tipos, `league` e `top`, reaproveitando
  `drawBackdrop`, `drawBrand` e as paletas existentes.
- Disparo: `components/celebration-host.tsx`, nas comemorações que já existem
  (nova liga; `MATCH_REWARDS` com `top.after` até 10).
- Todos os dados do cartão vêm do servidor. O cliente só desenha.

### B3. `sitemap.xml` e `robots.txt`

- `wrangler.jsonc`: incluir `/sitemap.xml` e `/robots.txt` em
  `assets.run_worker_first`.
- Worker: as duas rotas ficam ao lado de `link-preview.ts`. O sitemap lista
  `/` e `/temas/:slug` dos temas que passam em `PLAYABLE_THEME_SQL` (ativos e
  visíveis), com `LIMIT 5000` e `Cache-Control: public, max-age=3600`.
  O `robots.txt` bloqueia `/api/`, `/admin`, `/partida/` e `/desafio/`.
- Teste: tema oculto ou desativado não aparece; XML escapado.

### B4. Convite por link

- Migration: `ALTER TABLE friend_requests ADD COLUMN source TEXT` (nulo ou
  `'INVITE_LINK'`).
- `pages/invite-page.tsx` envia `viaInvite: true` ao criar o pedido; o schema
  Zod aceita só esse valor. É um rótulo, sem efeito competitivo.
- A aba Social mostra "Entrou pelo seu link" no pedido e na amizade recém-feita.
- O aceite continua obrigatório: um link vazado não pode virar amizade sozinho.

## 6. Parte C — novidades

### C1. Placar acumulado contra cada amigo

**Achado:** partidas ao vivo (`matches`, `match_players`) nunca vencem, então
dá para recontar o passado. Já o desafio assíncrono só guarda a pontuação em
`challenge_answers`, que a limpeza apaga em 15 dias. Sem um agregado, o placar
dos assíncronos antigos se perde.

- Tabelas novas (Core):
  - `duel_pair_totals(pair_low_id, pair_high_id, low_wins, high_wins, draws,
    last_results, last_ref)`: uma linha por dupla. `last_results` guarda os
    cinco últimos resultados em texto curto.
  - `duel_pair_themes(pair_low_id, pair_high_id, theme_id, low_wins, high_wins,
    draws)`: uma linha por dupla e tema.
  - Ambas com `ON DELETE CASCADE` em `users`, para a exclusão de conta (LGPD).
- Escrita: efeito pós-finalização no `MatchRoom` (partida ao vivo) e no
  `ChallengeRoom` (assíncrono), só para resultado concluído. A guarda é
  `last_ref`: a mesma partida nunca conta duas vezes.
- Carga inicial: a migration reconta as partidas ao vivo, no padrão da `0020`.
  Assíncronos entram só dos últimos 15 dias.
- Leitura: bloco `duel` em `GET /api/players/:code`, que já aplica bloqueio e
  conta desativada ("não encontrado").

### C2. Estatísticas pessoais

- **Acertos e tempo médio.** `match_answers.remaining_ms` vence em 15 dias.
  Tabela nova `user_answer_totals(user_id, theme_id, answers, correct,
  answered, remaining_ms_sum, last_ref)`. O efeito pós-finalização já lê
  `match_answers` em `recordMatchProgress`; a mesma leitura passa a somar o
  tempo. Pergunta sem resposta conta como erro e fica fora do tempo médio.
- **Evolução do Conhecimento.** Sem tabela nova: `match_players` guarda
  `knowledge_before`, `knowledge_delta` e `completed_at` para sempre, e existe
  o índice `idx_match_players_user_completed`. A rota lê as últimas Rankeadas da
  pessoa no tema, com teto de linhas. O gráfico fica "últimas 30 Rankeadas", não
  "últimos 30 dias".
- Rota `GET /api/profile/stats`, carregada só quando a aba abre.
- Web: aba nova no Perfil; gráficos em SVG puro, sem biblioteca.
- Histórico anterior de tempo não existe (só os últimos 15 dias entram na
  carga inicial).

### C3. Temporadas por tema

- Domínio: `seasonKey(nowMs)` em `packages/domain`, pelo mês de Brasília, com
  teste na virada do mês; a função de pontos da temporada.
- Tabelas (Core):
  - `theme_season_scores(season_key, theme_id, user_id, points, wins, matches,
    last_match_id)` com índice `(season_key, theme_id, points DESC, user_id)`.
  - `theme_season_results(season_key, theme_id, user_id, position)`: o pódio,
    guardado para sempre.
  - `theme_season_closures(season_key, theme_id)`: o que o Cron já fechou.
- Escrita: efeito pós-finalização da Rankeada, com guarda `last_match_id`
  (igual a `user_theme_progress`). Uma escrita a mais por jogador.
- Leitura: `GET /api/themes/:slug/ranking?scope=season`, reaproveitando o
  padrão do `RankingRepository` (Top 100, vizinhos, empate divide posição,
  bloqueio sem renumerar).
- Fechamento: o Cron de hora em hora que já existe fecha alguns temas por
  execução, dentro do orçamento de consultas, e grava o pódio. O título de
  campeão entra pelo sistema de títulos atual (`player-title-service`,
  `title-showcase-service`).
- Limpeza: pontos de temporada fechada saem depois de 15 dias; o pódio fica.
- Conhecimento e ranking geral não mudam.

### C4. Sala privada com código

É o item mais caro. O `MatchRoom` é uma máquina de dois assentos
(`LiveSeat = 1 | 2`, tuplas de dois jogadores) e está congelado; forçar N
jogadores nele quebraria o duelo.

- Domínio novo: `packages/domain/src/party/party-match.ts`, uma máquina de
  estados para N jogadores que reaproveita pontuação, relógio de 10 s, leitura
  de 1,5 s e o sorteio uniforme sem repetição.
- Durable Object novo `PartyRoom` (SQLite, hibernação), com tag de migration
  `v4` no `wrangler.jsonc`. Entrada por ticket curto do `TicketBroker`, como as
  outras rotas de tempo real.
- Sigilo: as alternativas só saem quando o relógio começa; a resposta certa e
  as escolhas dos outros só depois da rodada resolvida.
- Queda de conexão: a sala **não pausa** para todos. Quem cai perde as rodadas
  que passarem e pode voltar.
- Tabelas (Core): `party_rooms` (código único enquanto viva, anfitrião, tema,
  estado) e `party_players` (pontuação e posição final). Sem `result_ledger` e
  sem Conhecimento.
- Trava de jogador: `matches.kind` tem `CHECK` fechado e não aceita um tipo
  novo sem reconstruir a tabela. Proposta: tabela própria `active_party_players`
  e uma condição cruzada na entrada da sala e na fila, para ninguém estar em
  duas partidas. A condição na fila é o único toque em código congelado e
  precisa de teste dedicado.
- Abuso: código de 6 caracteres sem letras ambíguas; limite de tentativas de
  entrada por IP e por sala; uma sala por anfitrião; sala parada no saguão
  expira em 10 minutos.
- Web: rota `/sala/:code` fora do `AppShell` (sem barra, como a partida), tela
  própria `party-screen.tsx` com o CSS das alternativas e do relógio, e pódio
  no fim. Entrada pela página do tema e pela aba Social.
- Denúncia de pergunta dentro da sala fica para uma segunda etapa.

### C5. Torneio de fim de semana

- Cada jogo da chave é uma partida comum no `MatchRoom`, criada como a fila
  cria hoje (`/initialize`). O motor do duelo é reaproveitado inteiro.
- Durable Object novo `TournamentHub`, um por torneio: guarda as inscrições,
  usa alarme para sortear a chave na hora marcada, cria as salas, trata
  ausência (W.O. após um prazo) e avança as fases.
- Ligação com o resultado: um passo novo em `MatchRoom.persistFinalized`,
  `reconcileTournament(matchId)`, no mesmo molde do `reconcileDirectChallenge`.
- Tabelas (Core): `tournaments`, `tournament_entries`, `tournament_matches`.
- Aviso de início: `SocialRealtimeHub` e, para quem aceitou, push.
- Depende de pelo menos 8 pessoas ao mesmo tempo. Por isso fica por último.

### C6. Avatares desenhados

Continua bloqueado por quem cria a arte. Quando houver arte: arquivos estáticos
em `public/`, posse nas tabelas `cosmetics` e `cosmetic_inventory` (já existem)
e mais um passo na ordem de resolução do avatar. Nenhuma arte será gerada.

## 7. Ordem sugerida

| Fase | Itens | Por quê |
|---|---|---|
| 1 | A1, A3, A4, B1, B2 | Só web, sem migration; resultado visível rápido |
| 2 | A2, B3, B4 | Servidor leve, sem regra nova |
| 3 | C1, C2 | Passam a guardar dados que hoje se perdem em 15 dias; quanto antes, melhor |
| 4 | C3 | Regra nova, mas sobre o motor atual |
| 5 | C4 | Sala nova para N jogadores |
| 6 | C5 | Só faz sentido com público simultâneo |

## 8. Custo no plano gratuito

- **Fases 1 e 2:** uma rota a mais por abertura da tela inicial (A2). O sitemap
  é lido por robôs, com cache de uma hora.
- **Fase 3:** de 4 a 6 escritas a mais por partida concluída (hoje uma partida
  já grava dezenas no lote final).
- **Fase 4:** 2 escritas a mais por Rankeada; o fechamento mensal cabe no Cron
  existente.
- **Fases 5 e 6:** as salas hibernam entre mensagens. Uma sala de 8 com 7
  perguntas troca poucas centenas de mensagens, cobradas na razão de 20 por
  requisição.
- Nenhum item pede R2 novo, KV, fila, analytics ou plano pago.

## 9. Decisões pendentes do proprietário

Cada bloco trava o início da fase correspondente.

**A2**
- Mostrar a ofensiva na tela inicial, ou só o botão "Continuar"? (O aviso em
  texto da ofensiva foi removido em `90928bc`.)

**C1 — placar entre amigos**
- Conta só desafio e revanche, ou também encontros na fila pública?
- Continua contando se a amizade for desfeita e refeita?

**C2 — estatísticas**
- Entram Normal, Rankeada e desafios, ou só Rankeada?
- Outro jogador pode ver as suas estatísticas, ou são privadas?

**C3 — temporadas**
- O que pontua: vitórias em Rankeada, pontos da partida ou Conhecimento ganho
  no mês?
- Duração: mês fechado de Brasília?
- Mínimo de participantes para a temporada de um tema valer título (o Top do
  tema usa 30).
- O título de campeão é permanente? Quantas posições premiam?

**C4 — sala privada**
- Vale XP? (Pelas regras atuais seria sempre Normal, sem Conhecimento.)
- Conta para missões, ofensiva e estatísticas?
- Entra qualquer pessoa com o código, ou só amigos do anfitrião?
- Mínimo para começar (3?) e o que acontece se o anfitrião sair.
- Quem está bloqueado pelo anfitrião pode entrar?

**C5 — torneio**
- Empate não tem desempate hoje. No mata-mata, como decide: joga de novo?
- Altera Conhecimento ou só dá título? (A regra atual diz que Rankeada só
  existe na fila pública contra adversário sorteado.)
- Quem cria e agenda: só ADMIN?
- Com mais de 8 inscritos: várias chaves de 8 ou lista de espera?
- Prazo de tolerância para ausência.

**Geral**
- Capturas de tela reais para A4: o proprietário tira no próprio aparelho?
- Política de privacidade e termos continuam pendentes e passam a importar mais
  com a página de entrada pública (B1) e o sitemap (B3).
