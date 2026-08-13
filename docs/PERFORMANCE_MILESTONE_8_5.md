# Performance — correção de escopo do Milestone 8.5

Medições locais de produção com `VITE_ENABLE_REALTIME_MATCHES=true`, Vite 8.2.1 e Node 24. Os valores de gzip são os impressos pelo Vite; WebP/PNG são registrados pelo tamanho do arquivo, pois já são formatos comprimidos.

## Chunks e precache

| Medida | Antes (`856aaa1`) | Depois | Variação / decisão |
|---|---:|---:|---|
| JS necessário no startup | 372,72 KB / 116,70 KB gzip | 367,71 KB / 117,80 KB gzip | -5,01 KB bruto / +1,10 KB gzip |
| CSS | 47,63 KB / 9,96 KB gzip | 53,47 KB / 10,99 KB gzip | +5,84 KB / +1,03 KB gzip para globo, transições, frames e editor responsivo |
| MatchScreen | dentro do chunk inicial | 15,03 KB / 5,02 KB gzip lazy | requisitado durante os 2,9 s de apresentação |
| Editor de avatar | inexistente | 4,92 KB / 2,04 KB gzip lazy | fora do startup e do precache |
| Editor de arte do tema | 6,46 KB / 2,61 KB gzip lazy | 6,50 KB / 2,63 KB gzip lazy | preservado e fora do precache |
| Precache | 9 entradas / 417,07 KiB | 11 entradas / 433,03 KiB | +15,96 KiB; não inclui cropper, editores, ícones PWA ou logos WebP |

Composição final do startup: `index` 214,81/67,47 KB, `auth-context` 101,87/31,11 KB, `preloaded-match-room` 39,59/14,35 KB, `button` 8,59/3,30 KB, `dist` 1,52/0,85 KB e `theme-artwork` 1,33/0,72 KB. O chunk da partida é carregado por `import()` somente após um match real.

## Assets principais

| Asset | Tamanho | Uso/cache |
|---|---:|---|
| Logo interna clara WebP 256 | 16,34 KB | fingerprint Vite; carregada somente no tema claro |
| Logo interna escura WebP 256 | 19,98 KB | fingerprint Vite; carregada somente no tema escuro |
| Ícone PWA 192 WebP | 11,04 KB | manifesto; fora do precache do shell |
| Ícone PWA 512 WebP | 39,86 KB | manifesto; fora do precache do shell |
| Ícone maskable 512 WebP | 29,44 KB | manifesto; safe area própria; fora do precache do shell |
| Apple touch icon 180 PNG | 58,44 KB | browser/OS; fora do precache do shell |
| Favicon 32 PNG / ICO | 2,68 / 15,09 KB | browser; fora do precache do shell |
| Globo, lupa e personagens | 0 request | SVG inline + CSS, sem biblioteca ou mídia externa |

A JPEG fonte de 1.254 × 1.254 não é distribuída pelo app. Apenas derivados técnicos dimensionados entram no repositório. APIs autenticadas e WebSockets continuam `NetworkOnly`; avatares ativos e arte do tema usam URLs públicas versionadas com cache imutável.

## Requests: Tema → Matchmaking → MatchRoom → Pergunta 1

| Etapa | Antes | Depois |
|---|---|---|
| Tema | `GET /api/themes/:slug`; arte CUSTOM quando aplicável | igual; nenhum request extra do globo |
| Entrada na fila | `POST /api/realtime/tickets` + WS matchmaking | igual |
| Relógio da busca | timeout local de 60 s | evento WS `SEARCHING { timeoutAt }`; zero polling |
| Match formado | `MATCH_FOUND { roomId }` e navegação imediata | projeção individual mínima com adversário real e primeira pergunta pública; sem resposta/correção/futuro |
| Apresentação 2,9 s | inexistente | import do chunk da partida, ticket de sala, WS de sala, avatar/frame e imagem pública da pergunta atual |
| READY da sala | após navegação imediata | somente depois que `LiveMatchPage` assume o socket pré-carregado; nenhum READY durante a apresentação |
| Pergunta 1 | recebida pela sala depois da preparação | a imagem pública pode estar em cache; os 10 s continuam iniciando apenas depois dos READY autoritativos dos dois jogadores |

Se sala/chunk ainda não estiverem prontos após 2,9 s, a composição permanece em `JOGADOR ENCONTRADO` com `Preparando partida...`. Não há preload de `correctOption`, resposta do adversário ou pergunta futura.
