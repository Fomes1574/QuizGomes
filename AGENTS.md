# Regras permanentes — Quiz Gomes

Estas regras valem para toda alteração neste repositório.

## Produto

- O nome é **QUIZ GOMES**. A experiência é competitiva, rápida, sofisticada e centrada na pergunta.
- Todo texto visível ao usuário deve estar em português do Brasil.
- Fora da partida existem exatamente três destinos principais: Temas, Social e Perfil. A barra desaparece durante a partida. Criação pública fica desativada na V1; administração é uma rota separada, visível somente a ADMIN pelo Perfil.
- Não criar subtemas. A hierarquia é Categoria → Tema → Pergunta. Dificuldade (Fácil/Médio/Difícil) não existe mais como conceito operacional: não usá-la em produto, admin, importação, sorteio, matchmaking, XP ou Conhecimento. A UI pública mostra somente "Partida normal" e "Partida rankeada".
- Fontes e evidências são opcionais na V1: podem ser registradas quando disponíveis, mas sua ausência não bloqueia revisão, importação ou publicação de uma pergunta.
- Ranking e Conhecimento são por tema. Média de categoria é somente estatística.
- Matchmaking público é apenas simultâneo. Assíncrono é apenas entre amigos.
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
- Normal (Casual) = 7 perguntas, vale 20 XP na vitória e nunca altera Conhecimento. Rankeada = 10 perguntas, vale 30 XP na vitória e altera Conhecimento pela tabela que antes pertencia só a Difícil (Empate/Anulada nunca alteram Conhecimento; abandono ranqueado aplica a perda que antes era de Difícil). Ambas usam 10 s por pergunta. Um tema libera Normal com 7 perguntas ativas e Rankeada com 10.
- Matchmaking Normal pareia só por tema. Matchmaking Rankeado pareia por tema e Conhecimento, com banda de divisão que se alarga pelo tempo de espera: mesma divisão até 15 s, divisões vizinhas até 30 s, até duas divisões até 45 s, qualquer divisão do mesmo tema depois disso.
- No máximo 200 amizades ativas por usuário. Por dupla podem coexistir no máximo um desafio ASYNC vivo e um DIRECT vivo; DIRECT dura 30 s, ASYNC não expira e ambos são sempre Casual (7 perguntas, nunca alteram Conhecimento; desafio ranqueado não existe).
- Manter camada de repository e roteamento de shards para perguntas.
- Migrations D1 são versionadas e nunca reescritas depois de aplicadas.

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
