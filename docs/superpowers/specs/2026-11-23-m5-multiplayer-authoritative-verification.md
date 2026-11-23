# M5 — Multiplayer Autoritativo, Respawn e Leaderboard: verificação e checklist

> Documento de execução da Task 10 (M5). Consolida verificação automatizada, cobertura de integração existente e checklist manual pendente para o M5 entregue nas Tasks 1–9.
>
> - Spec: `docs/superpowers/specs/2026-11-23-m5-multiplayer-authoritative-design.md`
> - Plano: `docs/superpowers/plans/2026-11-23-m5-multiplayer-authoritative.md`
> - Branch base verificada: `master`
> - Data da verificação automatizada: **2026-11-23**
> - Ambiente: Windows, workspace PNPM (`pnpm@10.0.0`), Node conforme ambiente local.

## 1. Escopo verificado

M5 entrega modos **Treinamento** (solo/offline, sem servidor/SQLite) e **Multiplayer autoritativo** (WebSocket/MessagePack), com fluxo de morte sem game over, respawn, desistir/quit, leaderboard local (`localStorage`) e global (SQLite no servidor), HUD de leaderboard e integração de UI no cliente.

Regras/valores chave confirmados no código/spec:
- Sim fixa `1/30s` (`WORLD_CONFIG.FIXED_TICK_RATE`); broadcast `20Hz` (`WORLD_CONFIG.NETWORK_BROADCAST_RATE`); interpolação `100ms` (`WORLD_CONFIG.INTERPOLATION_DELAY_MS`); sala até `8` (`WORLD_CONFIG.MAX_PLAYERS_PER_ROOM`).
- Respawn: `RESPAWN_DELAY_SEC=3.0`, `SPAWN_INVULN_SEC=3.0`; sem game over; score da run zera no respawn.
- `INPUT_BATCH` redundante suportado; servidor sanitiza tipos, finitude, clamp `[-1,1]`, payload máximo `512` bytes.
- `shared/` isomórfico (sem `three`, DOM/browser APIs, Node `fs/crypto/net`).

## 2. Verificação automatizada executada

Comandos executados a partir da raiz do workspace (`C:\Users\itsal\Downloads\Spaceship Game`).

| Comando | Status | Resultado observado |
| --- | --- | --- |
| `pnpm -r typecheck` | **PASS** | `Scope: 3 of 4 workspace projects`; `server typecheck: Done`, `shared typecheck: Done`, `client typecheck: Done`. |
| `pnpm -r test` | **PASS** | `server`: 31 testes, 31 pass, 0 fail (`node:test` via `tsx --test test/*.test.ts`). `shared`: 11 arquivos / 109 testes passados (Vitest). `client`: 25 arquivos / 133 testes passados (Vitest). Total: **273 testes passados, 0 falhas**. |
| `pnpm -C client build` | **PASS** | `tsc -p tsconfig.json --noEmit && vite build`; `vite v5.4.21 building for production...`; `✓ 81 modules transformed`; `dist/assets/local.worker-C99rhO5j.js 46.99 kB`; `dist/assets/index-CTmPMHpp.js 693.00 kB │ gzip: 176.76 kB`; `dist/assets/index-pgKYImn3.css 1.50 kB │ gzip: 0.72 kB`; `✓ built in 1.50s`. Aviso não bloqueante: chunk principal > 500 kB após minificação. |

## 3. Cobertura de integração (Task 10, Step 2)

Foi avaliada a necessidade de adicionar/ajustar testes de integração. **Não houve lacuna encontrada** para os casos explicitados no brief; testes existentes já cobrem:

- **Dois clientes join/snapshot:** `server/test/server-room.test.ts` — `two simulated clients join, receive WELCOME and SNAPSHOT` valida WELCOME distinto por player, roomId, e snapshot contendo ambos os players.
- **Score recording on quit:** `server/test/server-room.test.ts` — `QUIT removes player and records eligible score` valida registro de score elegível e remoção do player.
- **Score recording on disconnect:** `server/test/server-room.test.ts` — `disconnect removes player and records eligible score` valida registro no fechamento/desconexão.
- **INPUT_BATCH redundante:** `server/test/server-room.test.ts` — `INPUT_BATCH redundant commands are accepted and do not regress state`.
- **Sala cheia / erro claro:** `server/test/server-room.test.ts` — `room full rejects 9th join with clear error`.
- **Token de player/reassociação:** `server/test/server-room.test.ts` cobre token conhecido/desconhecido.
- **Protocolo/sanitização:** `server/test/protocol.test.ts` cobre JOIN/PING/RESPAWN_REQUEST/QUIT/INPUT_BATCH, clamp `[-1,1]`, payload > 512 bytes, NaN/Infinity, tipos desconhecidos, limites de batch.
- **Leaderboard SQLite:** `server/test/leaderboard-store.test.ts` cobre persistência top 10, ranking, best por token, nome editável, token opaco, retry/drain.
- **WS join/ping/pong:** `server/test/ws-server.test.ts` cobre WELCOME e PONG via WebSocket/msgpack.

Nenhum teste de integração novo foi adicionado nesta task porque os casos requeridos já estavam presentes e passando.

## 4. Checklist manual / validação em dispositivo (PENDENTE)

Preenchido apenas com itens realmente executados. A verificação automatizada **não** substitui teste real de dispositivo, rede com latência/perda, conforto VR, ou UX visual completa.

| Cenário | Comportamento esperado | Status | Evidência | Observações |
| --- | --- | --- | --- | --- |
| PC (Chrome/Edge) — Treinamento offline | Tela inicial mostra nome/modo/top 10 local; Treinar inicia sem servidor/SQLite; morte mostra respawn 3s, Respawn/Desistir funcionam; score zera ao respawn e registra ao morrer/desistir com score>0 | **PENDENTE** | Não executado em navegador real nesta sessão | Validar offline/sem WS server ativo. |
| PC (Chrome/Edge) — Multiplayer 2 clientes | Dois clientes entram na mesma sala, recebem snapshots autoritativos, veem remoto interpolado, leaderboard global aparece/atualiza | **PENDENTE** | Não executado nesta sessão | Exige `pnpm -C server dev` + dois browsers. |
| PC — Respawn/desistir multiplayer | Morte mostra killer e contador 3s; Respawn habilita após timer; Desistir envia QUIT e volta à tela inicial; score registrado conforme regra | **PENDENTE** | Não executado nesta sessão | Confirmar câmera de morte/killer fallback. |
| Android Chrome (Flat) | Start screen, touch controls, treino/multiplayer, HUD legível, desempenho aceitável | **PENDENTE** | Não executado em dispositivo | Requer CA mkcert instalada e rede LAN. |
| VR Box (Android + gamepad BT) | Head look só na câmera (ADR-01), nave por controles, respawn/quit utilizáveis, conforto aceitável | **PENDENTE** | Não executado em dispositivo | Requer visor + gamepad BT. |
| Meta Quest 3 (WebXR) | Enter VR, controllers, recenter, HUD/leaderboard/respawn overlay legíveis, sem desconforto grave | **PENDENTE** | Não executado em headset | Meta 72–90 FPS não medida. |
| Latência real 100ms+ / perda de pacote | Predição/reconciliação/interpolação sem saltos bruscos intoleráveis; inputs redundantes toleram perda | **PENDENTE** | Não executado | Não afirmar validação de rede real. |
| Persistência SQLite global | Leaderboard global persiste entre reinícios do servidor; token opaco preserva identidade; nome editável | **PENDENTE** | Teste automatizado cobre store; integração real de processo não executada | Validar com restart real do server. |

## 5. Limitações / riscos conhecidos

- **Validação de dispositivo/latência real não executada.** Quest 3, VR Box, Android Chrome e redes com 100ms+/perda permanecem PENDENTE.
- **Bundle grande:** build do client gera chunk principal ~693 kB minificado / ~177 kB gzip; aviso do Vite não bloqueante.
- **SQLite no servidor:** `server/data/` deve conter DB local; validar permissões/caminho em deploy/local.
- **Câmera de morte/killer:** comportamento depende de dados do evento e entidades presentes no snapshot; validar visualmente em dispositivo real.
- **Multiplayer sala default única:** M5 usa sala/arena default simples; sala cheia retorna erro claro.

## 6. Arquivos relevantes (M5)

- Server: `server/src/index.ts`, `server/src/ws-server.ts`, `server/src/RoomManager.ts`, `server/src/ServerRoom.ts`, `server/src/protocol.ts`, `server/src/LeaderboardStore.ts`.
- Client: `client/src/core/GameApp.ts`, `client/src/core/m5-flow.ts`, `client/src/net/WsTransport.ts`, `client/src/net/ClockSync.ts`, `client/src/net/Predictor.ts`, `client/src/net/Interpolator.ts`, `client/src/ui/StartScreen.ts`, `client/src/ui/RespawnOverlay.ts`, `client/src/ui/LeaderboardHud.ts`, `client/src/state/player-profile.ts`, `client/src/state/leaderboard-local.ts`.
- Shared/sim: alterações M5 em `shared/src/types.ts`, `shared/src/constants.ts`, `shared/src/sim/*` conforme plano/spec.
- Testes de integração/contrato: `server/test/server-room.test.ts`, `server/test/protocol.test.ts`, `server/test/leaderboard-store.test.ts`, `server/test/ws-server.test.ts`.
