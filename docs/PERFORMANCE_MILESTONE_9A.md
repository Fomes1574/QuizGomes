# Performance — Milestone 9A Social Foundation

Referência M8/8.5 congelada: bundle inicial `217,60 KB / 68,34 KB gzip`, sala lazy `19,15 KB / 6,32 KB gzip`, CSS `54,87 KB / 11,19 KB gzip`, precache `11 entradas / 441,18 KiB` e Worker `706,8 KB`.

Build Social Foundation local com `VITE_ENABLE_REALTIME_MATCHES=true`:

| Artefato | Bruto | Gzip | Observação |
|---|---:|---:|---|
| JavaScript inicial | 214,16 KB | 67,51 KB | abaixo da referência congelada; Social virou chunk lazy |
| Página Social | 7,49 KB | 2,31 KB | carregada somente ao abrir a aba e excluída do precache |
| Sala de partida | 19,18 KB | 6,34 KB | motor, UI de conexão e protocolo preservados |
| CSS global | 57,40 KB | 11,58 KB | cards, badge e confirmação acessível sem biblioteca nova |
| Service worker único | 69,43 KB | 21,60 KB | Workbox + Firebase Messaging background no mesmo root scope |
| Precache | 477,75 KiB | — | 15 entradas; shell, atualização e API `NetworkOnly` preservados |
| Worker | 736,5 KB | — | APIs/repository sociais, compatibilidade por bloqueio e FCM HTTP v1 |

Regras operacionais:

- nenhuma dependência npm foi adicionada; o Firebase SDK `12.17.1` já existia;
- busca nominal usa prefixo case-insensitive indexado, debounce de 220 ms e limite de 20 resultados; ID público usa lookup exato e retorna no máximo um;
- startup autenticado faz somente `GET /api/social/summary` para o badge; não consulta lista de bloqueados, instalações ou catálogos sociais inteiros;
- Social abre seu chunk e usa `GET /api/social`; cada busca realiza uma consulta específica, sem polling;
- bloqueados são buscados somente após abrir `Perfil → Privacidade e Segurança → Usuários bloqueados`;
- Firebase Messaging roda em chunk separado e só inicia após permissão previamente concedida ou gesto explícito;
- `MatchmakingQueue` consulta bloqueio por par somente ao avaliar um candidato; jogadores incompatíveis continuam na mesma fila sem erro, polling ou alteração do MatchRoom;
- push consulta no máximo 20 instalações daquele destinatário, envia assincronamente depois da persistência e nunca faz rollback do pedido;
- APIs autenticadas mantêm `Cache-Control: no-store`; requests do Worker e WebSocket nunca são cacheados pelo service worker.
