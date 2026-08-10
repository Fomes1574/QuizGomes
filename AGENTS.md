# Regras permanentes — Quiz Gomes

Estas regras valem para toda alteração neste repositório.

## Produto

- O nome é **QUIZ GOMES**. A experiência é competitiva, rápida, sofisticada e centrada na pergunta.
- Todo texto visível ao usuário deve estar em português do Brasil.
- Fora da partida existem exatamente quatro destinos principais: Temas, Social, Criar e Perfil. A barra desaparece durante a partida.
- Não criar subtemas. A hierarquia é Categoria → Tema → Dificuldade → Pergunta.
- Ranking e Conhecimento são por tema. Média de categoria é somente estatística.
- Matchmaking público é apenas simultâneo. Assíncrono é apenas entre amigos.
- Empates não têm desempate. Casual não altera Conhecimento.
- Não inventar regras de jogo, conquistas, cosméticos, monetização ou catálogo editorial.

## Tecnologia e custo

- Frontend: React + TypeScript + Vite, SPA/PWA mobile-first.
- Backend e hospedagem: Cloudflare Workers; dados em D1; realtime em Durable Objects/WebSockets.
- Firebase é usado somente para Authentication com Google. Não usar Hosting, Firestore, Realtime Database, Storage, Functions ou Blaze.
- Não provisionar R2 sem autorização explícita. A camada de imagens deve permanecer abstrata.
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
- Pools tema+dificuldade usam slots densos e sorteio uniforme.
- Por usuário+pool, manter exatamente as últimas 200 perguntas e descoberta histórica em estado compacto.
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
