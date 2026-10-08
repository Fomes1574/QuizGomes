# Regras permanentes — Quiz Gomes

Estas regras valem para toda alteração neste repositório.

## Produto

- O nome é **QUIZ GOMES**. A experiência é competitiva, rápida, sofisticada e centrada na pergunta.
- Todo texto visível ao usuário deve estar em português do Brasil.
- Fora da partida existem exatamente três destinos principais: Temas, Social e Perfil. A barra desaparece durante a partida. Criação pública fica desativada na V1; administração é uma rota separada, visível somente a ADMIN pelo Perfil.
- Não criar subtemas. A hierarquia é Categoria → Tema → Pergunta. Dificuldade (Fácil/Médio/Difícil) não existe mais como conceito operacional: não usá-la em produto, admin, importação, sorteio, matchmaking, XP ou Conhecimento. A UI pública mostra somente "Partida normal" e "Partida rankeada".
- Fontes e evidências são opcionais na V1: podem ser registradas quando disponíveis, mas sua ausência não bloqueia revisão, importação ou publicação de uma pergunta.
- Ranking e Conhecimento são por tema. Média de categoria é somente estatística.
- Ranking do tema: Top 100 (Conhecimento > 0, conta ativa), empate divide a posição, e quem está abaixo vê a própria posição com dois vizinhos de cada lado; aba Amigos mostra só a própria roda. Bloqueio vale nos dois sentidos: a pessoa some da lista sem renumerar. Perfil de outro jogador só para quem entrou; bloqueio, conta desativada ou ID inexistente respondem igual ("não encontrado") e o ID interno nunca sai.
- Matchmaking público é apenas simultâneo. Assíncrono é apenas entre amigos.
- Rankeada só existe na fila pública simultânea, contra adversário sorteado. Nada que junte amigos (desafio ou revanche) é Rankeado.
- Revanche imediata: só os dois jogadores de uma partida ao vivo concluída há até 3 min, fila privada da dupla (mesmo tema, sempre Normal mesmo após Rankeada, 30 s, fora da contagem pública da fila).
- Conquistas (7 dias, cada 100 dias, 365 e 730 dias de ofensiva, dia completo de missões, recorde batido) dão molduras equipáveis; nunca são vendidas nem apagadas.
- Conquistas por tema (só a Rankeada conta): primeira vitória, primeira subida de divisão, cada liga de Bronze a Desafiante, 10/50/100/500 Rankeadas concluídas, 5 e 10 vitórias seguidas, 10 sem perder com 5+ vitórias, vencer alguém 2+ divisões acima e vencer com o dobro dos pontos (mínimo 100). Cada uma vira título equipável ("Ouro em Lost"); nunca somem. Conquistas gerais também viram título.
- Marcos de nível viram títulos (5, 10, 25, 50, 75, 100, 150, 200, 250, 300, 500 e 999), concentrados até o 300; o título vale enquanto o nível existir (nível nunca cai). O objetivo escolhido na vitrine é só um título a perseguir, sem efeito competitivo.
- Missões semanais (só Rankeada concluída; abandono e anulada não contam): jogar 10, vencer 5 e acertar 40. A semana vira na segunda à 0h de Brasília. Contam uma vez por partida, pela mesma guarda das conquistas de tema.
- Top do tema: Top 10 por Conhecimento entre quem tem 5+ Rankeadas concluídas e Conhecimento > 0, só em tema com pelo menos 30 qualificados (`TOP_TITLE_MIN_PLAYERS`). Empate divide a posição. Top 1 ouro com coroa, Top 2 prata, Top 3 bronze; brilho animado só em duelo e perfil, nunca em lista. É distinção atual, não conquista: some ao sair do Top 10 e o título volta ao permanente escolhido. "Top automático" mostra o Top do tema da partida. Vitrine com até 3 destaques. O servidor decide o título; o cliente nunca o informa.
- Empates não têm desempate. Normal (Casual) nunca altera Conhecimento; somente a Rankeada altera.
- Não inventar regras de jogo, conquistas, cosméticos, monetização ou catálogo editorial.

## Tecnologia e custo

- Frontend: React + TypeScript + Vite, SPA/PWA mobile-first.
- Backend e hospedagem: Cloudflare Workers; dados em D1; realtime em Durable Objects/WebSockets.
- Firebase é usado somente para Authentication com Google e Firebase Cloud Messaging gratuito/autorizado no Milestone 9A. Não usar Hosting, Firestore, Realtime Database, Storage, Functions ou Blaze.
- Não provisionar R2 sem autorização explícita. A camada de imagens deve permanecer abstrata, com contrato único de leitura/escrita, chaves opacas e validação de que toda `image_key` publicada é realmente servível pelo backend ativo. A futura adoção de R2 deve ser apenas um adapter/configuração, sem mudar contratos editoriais ou expor bucket/chaves ao cliente.
- A meta operacional é R$ 0/mês. Não ativar billing, assinatura, cartão ou recurso sem free tier.
- Não usar OpenAI API no aplicativo.

## Segurança e integridade competitiva

- O Worker valida Firebase ID Tokens e autorizações. Nunca confiar em UID, role, score, tempo, resposta correta ou resultado enviados pelo cliente.
- ADMIN é uma role de servidor e pode ser inicializada somente por Firebase UID configurado no ambiente.
- Não commitar segredos, Service Accounts ou `.dev.vars`.
- APIs de partida não podem enviar respostas corretas futuras ou dados selados do adversário.
- Operações de resultado devem ser idempotentes e transacionais.
- Validar entradas, impedir IDOR, double-submit e cache de APIs autenticadas/sensíveis.

## Dados e escala

- O sistema de perguntas deve admitir cerca de 1.000.000 de perguntas sem `ORDER BY RANDOM()` e sem carregar catálogos completos no cliente.
- Existe exatamente um pool por tema (não mais um pool por dificuldade); usa slots densos e sorteio uniforme.
- O sorteio não consulta histórico de exibição: amostra uniforme sem reposição sobre os slots do pool. Repetir entre partidas diferentes é permitido; repetir dentro da mesma partida, não.
- Por usuário+pool, manter apenas a descoberta histórica em estado compacto.
- Normal (Casual) = 7 perguntas, vale 50 XP na vitória e nunca altera Conhecimento. Rankeada = 10 perguntas, vale 100 XP na vitória e altera Conhecimento pela tabela que antes pertencia só a Difícil (Empate/Anulada nunca alteram Conhecimento; abandono ranqueado aplica a perda que antes era de Difícil). Derrota ou empate de partida concluída vale XP de participação: 10 na Normal e no desafio, 20 na Rankeada; anulada e abandono valem 0. Ambas usam 10 s por pergunta, precedidos de 1,5 s fixos de leitura: a pergunta (e a foto, se houver) aparece sozinha, o anel do relógio carrega e só então as alternativas e o relógio de 10 s começam; a leitura nunca conta na pontuação e o servidor só envia as alternativas quando o relógio começa (vale também para desafios). Um tema libera Normal com 7 perguntas ativas e Rankeada com 10.
- Matchmaking Normal pareia só por tema. Matchmaking Rankeado pareia por tema e Conhecimento, com banda de divisão que se alarga pelo tempo de espera: mesma divisão até 15 s, divisões vizinhas até 30 s, até duas divisões até 45 s, qualquer divisão do mesmo tema depois disso.
- No máximo 200 amizades ativas por usuário. Por dupla podem coexistir no máximo um desafio ASYNC vivo e um DIRECT vivo; DIRECT dura 30 s, ASYNC não expira e ambos são sempre Casual (7 perguntas, nunca alteram Conhecimento; desafio ranqueado não existe).
- Manter camada de repository e roteamento de shards para perguntas.
- Migrations D1 são versionadas e nunca reescritas depois de aplicadas.
- O dia do jogo (missões, ofensiva, avisos) é o dia de Brasília (America/Sao_Paulo, UTC−3).
- Limpeza automática (Cron de hora em hora): detalhes de partida/desafio encerrados, recibos de denúncia e de estatística vencem em 15 dias (denúncia só vale nesse prazo); histórico de administração vence em 6 meses, exceto concessão/remoção de ADMIN. Partidas, placares, perfis, Conhecimento, recordes, ofensivas e conquistas nunca vencem.

## Interface e acessibilidade

- Todo componente nasce compatível com Claro, Escuro e Sistema usando tokens semânticos.
- Não inverter fotos, logo, capas ou imagens de pergunta com filtros CSS.
- Correto/errado usam cor e também ✓/×.
- Respeitar `prefers-reduced-motion`, foco visível, teclado e áreas de toque.
- Priorizar transform/opacity, imagens pequenas e respostas instantâneas.

## Qualidade e processo

- Atualizar `docs/plans/QUIZ_GOMES_V1.md` em todo marco relevante.
- Antes de declarar algo pronto, rodar lint, typecheck, testes e build aplicáveis.
- Adicionar testes para toda regra de domínio alterada.
- Usar fixtures sintéticas claramente marcadas; nunca misturá-las com produção.
- Fazer commits lógicos, revisar o diff e nunca usar force push.
- Registrar ambiguidades que alterem regra, custo ou segurança como decisão pendente.
