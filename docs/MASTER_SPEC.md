# Especificação mestre — QUIZ GOMES V1

Status: consolidado em 17 de setembro de 2026. A seção **Estado vigente** do ExecPlan prevalece sobre qualquer trecho histórico deste documento.

## 1. Visão do produto

QUIZ GOMES é um quiz competitivo rápido, pessoal e sofisticado, inspirado apenas nos princípios gerais de descoberta e confronto direto de jogos de trivia. Não é clone visual ou técnico de outro produto.

Escala inicial: aproximadamente 20 pessoas e até 30 usuários ativos. A arquitetura editorial deve crescer para perto de 1.000.000 de perguntas sem reconstrução.

Princípios:

- a pergunta é o foco absoluto da partida;
- abrir, escolher tema, parear e responder deve ser rápido;
- mobile e desktop são experiências de primeira classe;
- XP e cosméticos nunca concedem vantagem;
- custo operacional alvo é R$ 0/mês;
- perguntas reais são produzidas e verificadas externamente pelo administrador;
- o aplicativo nunca chama OpenAI API para gerar perguntas.

## 2. Plataforma e identidade

- SPA/PWA em React, TypeScript e Vite.
- Backend e static assets em Cloudflare Workers (`workers.dev` inicialmente).
- D1 como banco principal; Durable Objects + WebSockets para presença, filas e salas.
- Firebase `quizgomes-cbc48` somente para Authentication com Google e Cloud Messaging opcional/gratuito autorizado no Milestone 9A.
- R2 fica atrás de `ImageStorage` e não será provisionado sem autorização.
- Todos os textos de interface são em português do Brasil.
- Logo oficial deve substituir o slot técnico em `apps/web/public/brand/` quando fornecida. Não redesenhar.

Paleta inicial via tokens semânticos: brand `#D92F36`, brandStrong `#A91824`, brandActive `#EA4543`, accent `#F05A38`, warm white `#FFF9F7`, white `#FFFFFF`, texto `#21191A` e secundário `#74696A`. Hexadecimais não devem ser espalhados por componentes.

Tipografia: Sora em títulos/números; Inter no corpo/perguntas, com fallbacks locais seguros.

Temas visuais obrigatórios: Claro, Escuro e Sistema, com preferência persistida. Não usar inversão global; fotos, logo, capas, imagens de pergunta e cores de correto/errado preservam seu significado.

## 3. Navegação e páginas

Fora da partida existem exatamente três destinos na barra inferior:

1. Temas
2. Social
3. Perfil

Não existe Home separada. Temas é a entrada principal. A barra desaparece completamente durante partidas.

### Temas

- busca por nome;
- categorias administradas pelo sistema;
- temas agrupados por categoria;
- hierarquia única: Categoria → Tema → Pergunta;
- não existem subtemas.

A página do tema contém capa opcional, nome, descrição curta, total de perguntas ativas, Top 5 do tema e cartão pessoal com foto/moldura, elo, Conhecimento, posição e descoberta histórica.

### Social

Amigos online/offline, pedidos, desafios, assíncronos pendentes, partidas aguardando desafiante e pesquisa por nome ou ID público. Perfil de amigo mostra dados cosméticos e competitivos básicos e permite desafiar.

### Administração

Não há aba pública de criação na V1. A rota administrativa, acessível pelo Perfil somente a ADMIN, preserva catálogo, moderação, importação e auditoria para a curadoria do conteúdo real. Propostas públicas de tema permanecem desativadas na interface até haver operação para avaliá-las; o pipeline e os dados existentes não são removidos.

### Perfil

Foto, moldura, nome, ID, nível, XP, título, melhores temas, médias de categoria, estatísticas e configurações. Sons e músicas ficam para o fim e não entram na V1 atual.

## 4. Conta e autorização

Qualquer pessoa com o link pode entrar com Google, ajustar nome e criar perfil. A foto Google é sugerida. Cada perfil recebe ID público permanente no formato `#QG` + caracteres legíveis e únicos.

O frontend envia Firebase ID Token por HTTPS. O Worker verifica assinatura e claims. UID, email ou role recebidos arbitrariamente do cliente não têm autoridade.

ADMIN é role adicional; o administrador continua jogador normal sem bônus. O bootstrap é uma lista de Firebase UIDs no ambiente do Worker. Nome e email nunca promovem alguém. Todas as APIs administrativas revalidam autorização no servidor.

## 5. Ranking por tema

Cada usuário começa em Latão V, 0 Conhecimento, separadamente em cada tema. Os oito elos são Latão, Bronze, Prata, Ouro, Platina, Diamante, Mestre e Desafiante; cada um possui V, IV, III, II e I. V é inferior a I.

Conhecimento é um escalar acumulado por usuário+tema. Thresholds são derivados das transições:

| Elo | V→IV | IV→III | III→II | II→I | I→próximo V |
|---|---:|---:|---:|---:|---:|
| Latão | 300 | 400 | 500 | 600 | 700 |
| Bronze | 800 | 900 | 1.000 | 1.100 | 1.200 |
| Prata | 1.300 | 1.400 | 1.500 | 1.600 | 1.700 |
| Ouro | 1.800 | 1.900 | 2.000 | 2.100 | 2.200 |
| Platina | 2.300 | 2.400 | 2.500 | 2.600 | 2.700 |
| Diamante | 3.000 | 3.200 | 3.400 | 3.600 | 3.800 |
| Mestre | 4.200 | 4.500 | 4.800 | 5.100 | 5.400 |
| Desafiante | 6.000 | 6.500 | 7.000 | 7.500 | — |

O início de Desafiante I é 105.500. Overflow é preservado; perdas rebaixam; piso 0; sem proteção artificial. Desafiante I continua acumulando até 999.999, sem pontos ocultos acima do cap.

Ganhos/perdas usam o elo anterior à resolução. Só a Rankeada altera Conhecimento; a tabela é a que, até 2026-09-24, pertencia exclusivamente à extinta dificuldade Difícil (decisão de produto: Fácil/Médio deixaram de existir como conceito operacional, e a Rankeada herdou os valores de Difícil):

| Elo | Vitória | Derrota |
|---|---:|---:|
| Latão | +75 | -30 |
| Bronze | +69 | -33 |
| Prata | +63 | -36 |
| Ouro | +57 | -39 |
| Platina | +51 | -42 |
| Diamante | +45 | -45 |
| Mestre | +39 | -48 |
| Desafiante | +33 | -54 |

Empate, Anulada e Normal (Casual) alteram 0 — só a Rankeada altera. Top 5 ordena principalmente por Conhecimento; valores iguais compartilham posição lógica, sem desempate oculto.

Uma simulação perfeita na Rankeada deve exigir aproximadamente 2.457 vitórias para chegar a Desafiante I e nunca menos de 1.000. Abandonar uma partida Rankeada aplica a mesma derrota desta tabela (a que antes era exclusiva de Difícil); desafios entre amigos são sempre Casual e nunca alteram Conhecimento.

Média de categoria é estatística: entram somente temas com ao menos uma Ranqueada. Calcula-se a média da posição ordinal fracionária nas 40 divisões e exibe-se a divisão que contém a média, limitada a Desafiante I. Não afeta matchmaking ou Conhecimento.

## 6. XP global

Vitória concede 20 XP na Normal (Casual) e 30 XP na Rankeada. Derrota, empate e partida anulada concedem 0. No assíncrono (sempre Casual), XP só é finalizado após o segundo jogador.

Para passar de L para L+1, L de 1 a 998:

`XP(L) = 100 + 2 × (L - 1) + ceil((L - 1)² / 80)`

Nível máximo 999 (`MAX`), total 5.230.904 XP e mínimo teórico de 174.364 vitórias na Rankeada. XP é cosmético.

## 7. Perguntas e sorteio

Fácil/Médio/Difícil não existem mais como conceito operacional (decisão de produto de 2026-09-24): a UI pública mostra só Partida normal e Partida rankeada. Quantidade por partida: Normal 7, Rankeada 10. Cada pergunta tem 10 segundos. Um tema libera Normal com 7 perguntas ativas e Rankeada com 10.

Toda pergunta possui enunciado, quatro alternativas, exatamente uma correta, tema, status, fontes, imagem opcional e metadata administrativa. Publicada exige evidência. Conteúdo enviado por usuários entra em revisão.

Regra editorial: pergunta até 3 linhas no menor viewport; resposta ideal até 1,5 linha. O validador usa medição visual, não apenas caracteres. Excesso impede publicação automática e é sinalizado no admin.

Imagem opcional fica acima do enunciado e deve ter menos de 100 KB, teto inicial de 720 px e formato otimizado. Origem/licença é registrada.

O sorteio é uniforme sem reposição apenas dentro da própria partida. Entre partidas, perguntas podem reaparecer; descoberta histórica permanece independente e exata em bitmap por slots densos. Não há peso por popularidade, estatística, imagem ou assunto e nunca se usa `ORDER BY RANDOM()`.

## 8. Pontuação e timing

Deadline é autoritativo do servidor. Cliente apenas anima.

`displaySeconds = clamp(ceil(remainingMs / 1000), 0, 10)`

Resposta correta com `remainingMs > 0`: `10 + displaySeconds`. Errada ou timeout: 0. Portanto 10/9/1 exibidos valem 20/19/11.

Empate é resultado final válido: 0 Conhecimento e 0 XP.

## 9. Modos de partida

### Matchmaking público

Somente simultâneo e humano. Fila exige mesmo tema e modo (Normal ou Rankeada). Partida Normal pareia só por tema, na ordem de chegada, sem usar Conhecimento. Partida Rankeada pareia por tema e Conhecimento, com banda de divisão que se alarga pelo tempo de espera: mesma divisão até 15 s, divisões vizinhas até 30 s, até duas divisões até 45 s e qualquer divisão do tema depois disso. Timeout 60 s, cancelamento sempre disponível e sem penalidade. Não há segundo aceite nem fallback assíncrono/bot.

### Desafio simultâneo

Amigo ONLINE recebe convite Casual (7 perguntas, nunca ranqueado) com o tema por até 30 s. Ao aceitar: “PREPARE-SE PARA A PARTIDA”, 3–2–1 e cancelamento curto. Cancelamento anula sem consequência.

### Assíncrono

Somente amigos e Casual. ASYNC não expira e permite no máximo uma reserva viva por dupla; pode coexistir com uma reserva DIRECT. Perguntas, ordem, alternativas e imagens são idênticas. Primeiro joga imediatamente, mas resultado, XP e Conhecimento ficam selados. Segundo pode cancelar antes de iniciar.

Antes de cada resposta do segundo, o payload não inclui escolha, tempo, score da rodada/final do primeiro nem resposta correta. Após resposta/timeout local, revela somente a rodada atual e atualiza score acumulado revelado. O primeiro não pode cancelar após concluir sua metade.

## 10. Interface da partida

Sem barra inferior. No topo: adversário à esquerda com foto/moldura/nome/status e score apenas de rodadas resolvidas; score próprio à direita. Centro com imagem opcional, pergunta e quatro respostas grandes em grid responsivo 2×2.

No simultâneo, indicador do adversário é cinza e fica amarelo quando ele respondeu, sem revelar acerto. Score do adversário não muda enquanto o local pensa. Feedback usa verde/✓ e vermelho/×. Se ambos erram, a correta aparece verde.

Timer é barra na borda inferior, esvazia da direita para a esquerda e exibe segundos no canto. Começa apenas após payload, ambos READY e transição terminada.

Entre rodadas aparece “PERGUNTA N / TOTAL” em fade curto; resultado fica cerca de 1–1,3 s. Final mostra jogadores, scores, resultado, XP e Conhecimento, sem estética de cassino.

## 11. Conexão e autoridade

Queda individual pausa 100% da partida por até 7 s, preservando `remainingMs`. Reconexão abaixo de 7.000 ms restaura o estado, sem renovar 10 s; em 7.000 ms ou mais a partida inteira fica `VOID`, sem XP ou Conhecimento para qualquer jogador. Cliente nunca decide esse terminal.

Queda de ambos ou falha sistêmica anula sem efeito. Readiness desigual também aguarda até 7 s. Durable Object diferencia, na medida tecnicamente possível, queda individual e falha da sala.

Servidor pode preloadar perguntas, mas cliente recebe somente a rodada pública atual. APIs sensíveis usam `no-store`.

## 12. Administração e estatísticas

Área separada e server-protected para categorias, temas, moderação, perguntas, importação, fontes, usuários, roles, auditoria e métricas. Importação JSON/CSV tem validação rigorosa e idempotência.

Somente ADMIN vê estatísticas por pergunta: respostas, acertos, erros, distribuição A/B/C/D, tempo médio, uso e verificação. Estatística nunca pesa o sorteio.

Conquistas, catálogo final de molduras/títulos e uploads ficam somente como fundação extensível.

## 13. Qualidade e não-escopo

Obrigatórios: erros/loading/empty states, mobile/desktop, claro/escuro, console limpo, acessibilidade, testes, typecheck, lint, build e documentação.

Não implementar agora: monetização, anúncios, energia, moedas, loot boxes, chat/feed público, bots, IA no app, subtemas, sons, músicas, lojas nativas ou serviços Firebase além de Auth/FCM autorizado. R2 não é parte da V1 atual: manter somente a abstração pronta para um adapter futuro, sem bucket, binding, upload ou custo até autorização explícita.
