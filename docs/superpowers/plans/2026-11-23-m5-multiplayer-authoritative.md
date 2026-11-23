# M5 Multiplayer Autoritativo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar M5 completo: multiplayer autoritativo cooperativo (US-13 + US-14) com Treinamento/Multiplayer, respawn sem game over, leaderboard local/global e persistência SQLite.

**Architecture:** Reutilizar `shared/src/sim/GameRoom` como sim autoritativa isomórfica. Servidor Node/ws hospeda salas, valida/sanitiza input, broadcasta snapshots MessagePack 20Hz. Cliente usa `ITransport` (`LocalTransport`/`WsTransport`), com `ClockSync`, predição local reconciliada por `lastProcessedTick` e interpolação remota com buffer 100ms. UI é overlay HTML; scores gravados em morte/quit/desconexão (run score zera no respawn), localStorage no Treinamento e SQLite no Multiplayer.

**Tech Stack:** TypeScript strict, pnpm workspaces, Vitest (shared/client), tsx+node:test (server), Three.js, ws, `@msgpack/msgpack`, `better-sqlite3` (server), Web Crypto/cookie/localStorage no cliente.

**Spec:** `docs/superpowers/specs/2026-11-23-m5-multiplayer-authoritative-design.md`

## Global Constraints

- `shared/` isomórfico: sem `three`, DOM/browser APIs, Node `fs/crypto/net`.
- Determinismo ADR-06: sim fixa `1/30s` (`WORLD_CONFIG.FIXED_TICK_RATE`); `dt` externo não altera física.
- Rede: broadcast `20Hz` (`WORLD_CONFIG.NETWORK_BROADCAST_RATE`), interpolação `100ms` (`WORLD_CONFIG.INTERPOLATION_DELAY_MS`), sala até `8` (`WORLD_CONFIG.MAX_PLAYERS_PER_ROOM`).
- Respawn: `RESPAWN_DELAY_SEC=3.0`, `SPAWN_INVULN_SEC=3.0`; sem game over; score da run zera no respawn.
- `INPUT_BATCH` redundante suportado; servidor sanitiza tipos, finitude, clamp `[-1,1]`, tamanho máximo payload `512` bytes.
- Zero alocação óbvia em hot loops de sim/render/tick; reutilizar buffers/scratch.
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`.
- Treinamento funciona offline sem servidor/SQLite.

## Review Focus

- **Payload malformado/não finito/excessivo na borda WS:** servidor deve rejeitar/ignorar com segurança, nunca crashar nem corromper sala.
- **Reconciliação após perda/reordenação de input:** nave local não deve teletransportar bruscamente; erro residual suavizado; câmera confortável.
- **Morte/quit/desconexão com score > 0:** score deve ser registrado exatamente uma vez por evento elegível, antes de zerar/sair.
- **Sala cheia/join concorrente:** 9º jogador recebe erro claro; estado da sala permanece consistente.
- **Modo Treinamento offline:** leaderboard/nome funcionam via cookie/localStorage sem chamadas de rede/SQLite.

## File Structure

### Shared (isomórfico, reuso server/worker)
- Modify: `shared/src/types.ts` — protocolo/estado para respawn, killer, leaderboard, tokens, quit.
- Modify: `shared/src/constants.ts` — apenas se constante M5 faltar (evitar churn).
- Modify: `shared/src/sim/GameRoom.ts` — multi-player, join/leave, respawn elegível, killer attribution, score recording hooks, snapshot por sala.
- Modify: `shared/src/sim/ids.ts` / `spawn.ts` / `EnemyAI.ts` / `WaveManager.ts` — apenas ajustes necessários para N players/respawn; manter determinismo.
- Modify: `shared/src/index.ts` — exports novos.
- Test: `shared/test/sim/game-room.test.ts`, `shared/test/sim/game-room-multiplayer.test.ts`.

### Server
- Modify: `server/package.json` — deps `@msgpack/msgpack`, `better-sqlite3`, tipos.
- Modify: `server/src/index.ts` — bootstrap HTTP/WS/RoomManager/DB.
- Modify: `server/src/ws-server.ts` ou substituir por `server/src/net/WsGateway.ts` — gateway WS.
- Create: `server/src/RoomManager.ts` — ciclo de vida sala default, join/leave, cleanup.
- Create: `server/src/ServerRoom.ts` — wrapper GameRoom shared + conexões + tick/broadcast.
- Create: `server/src/LeaderboardStore.ts` — SQLite, record/list/rank por token.
- Create: `server/src/protocol.ts` — decode/validate/encode msgpack/json seguro.
- Test: `server/test/*.test.ts` (atualizar script para glob).

### Client
- Modify: `client/package.json` — `@msgpack/msgpack`.
- Modify: `client/src/net/ITransport.ts` — manter contrato; opcional eventos de conexão.
- Create: `client/src/net/WsTransport.ts` — WS binário MessagePack.
- Create: `client/src/net/ClockSync.ts` — PING/PONG offset/RTT.
- Create: `client/src/net/Predictor.ts` — predição local + reconciliação.
- Create: `client/src/net/Interpolator.ts` — buffer snapshots remotos.
- Modify: `client/src/net/local.worker.ts` / `LocalTransport.ts` — novo protocolo/mensagens.
- Create: `client/src/ui/StartScreen.ts` — nome/modo/top10/iniciar.
- Create: `client/src/ui/RespawnOverlay.ts` — contador 3s, Respawn, Desistir.
- Create: `client/src/ui/LeaderboardHud.ts` — top10 + você.
- Create: `client/src/state/player-profile.ts` — cookie nome, token local.
- Create: `client/src/state/leaderboard-local.ts` — localStorage top10.
- Modify: `client/src/core/GameApp.ts` — modos, telas, morte/respawn, killer camera, netcode.
- Modify: `client/src/main.ts` — bootstrap tela inicial.
- Test: `client/test/net/*.test.ts`, `client/test/ui/*.test.ts` (DOM/mock), `client/test/state/*.test.ts`.

## Task 1: Protocolo e tipos M5

**Files:**
- Modify: `shared/src/types.ts`
- Test: `shared/test/protocol-types.test.ts` (type-level/runtime guards if added)

**Interfaces:**
- Consumes: tipos M4 existentes.
- Produces: tipos para `RESPAWN_REQUEST`, `QUIT`, `LEADERBOARD`, `SCORE_RECORDED`, `PLAYER_DEATH` estendido (`playerId`, `killerId?`, `killerKind?`, `respawnDelaySec`), `WELCOME` com `playerToken?`/`protocol?` conforme decisão, `SNAPSHOT` sem `gameOver` obrigatório (remover ou opcional deprecated).

- [ ] **Step 1: Write failing tests** for protocol guard/shape expectations (ou testes de compilação/runtime narrow helpers) cobrindo novas mensagens.
- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm -C shared test -- protocol-types.test.ts`
  Expected: FAIL (missing types/guards).
- [ ] **Step 3: Implement minimal types/guards** em `shared/src/types.ts`. Manter compatibilidade com LocalTransport atual onde possível; adicionar campos opcionais antes de tornar obrigatórios.
- [ ] **Step 4: Run test to verify it passes**
  Run: `pnpm -C shared test -- protocol-types.test.ts`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add shared/src/types.ts shared/test/protocol-types.test.ts && git commit -m "feat(shared): extend M5 protocol types"`

## Task 2: GameRoom multi-player, respawn e score recording

**Files:**
- Modify: `shared/src/sim/GameRoom.ts`
- Modify: `shared/src/sim/WaveManager.ts` (se necessário para N players vivos)
- Modify: `shared/src/sim/EnemyAI.ts` (alvo entre jogadores vivos; sem PvP)
- Test: `shared/test/sim/game-room-multiplayer.test.ts`

**Interfaces:**
- Consumes: `ShipCommand`, `ClientMessage` shapes, `WORLD_CONFIG`.
- Produces: `GameRoom` suporta múltiplos jogadores, `addPlayer/removePlayer` (ou API equivalente), respawn elegível após 3s, `requestRespawn(playerId)`, `quit(playerId)` registra score se >0, eventos `PLAYER_DEATH` com killer, `SCORE_RECORDED` antes de zerar score, snapshot inclui todos os ships vivos/mortos conforme regra.

- [ ] **Step 1: Write failing tests**: dois jogadores entram; comandos de um não afetam outro; morte registra score e zera no respawn; quit registra score; killer attribution para inimigo/asteroid.
- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm -C shared test -- game-room-multiplayer.test.ts`
  Expected: FAIL.
- [ ] **Step 3: Implement minimal multi-player/respawn/score hooks**. Sem PvP: projéteis player não colidem com players. Respawn só por request elegível ou regra definida (documentar no código).
- [ ] **Step 4: Run test to verify it passes**
  Run: `pnpm -C shared test -- game-room-multiplayer.test.ts`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add shared/src/sim/GameRoom.ts shared/src/sim/WaveManager.ts shared/src/sim/EnemyAI.ts shared/test/sim/game-room-multiplayer.test.ts && git commit -m "feat(sim): support multiplayer respawn and score recording"`

## Task 3: Server protocol gateway e validação

**Files:**
- Create: `server/src/protocol.ts`
- Modify/Create: `server/src/ws-server.ts` or `server/src/net/WsGateway.ts`
- Modify: `server/package.json` (add `@msgpack/msgpack`, types)
- Test: `server/test/protocol.test.ts`

**Interfaces:**
- Produces: `decodeClientMessage(bytes): Result<ClientMessage>`; valida tamanho <=512, shape, finitude/clamp; `encodeServerMessage(msg): Uint8Array`.

- [ ] **Step 1: Write failing tests** para payload malformado, oversize, NaN/Infinity, campos extras ignorados/rejeitados conforme regra.
- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm -C server test`
  Expected: FAIL (script may need update to glob).
- [ ] **Step 3: Implement protocol codec/validation** com `@msgpack/msgpack`. Sem crash em input inválido.
- [ ] **Step 4: Run test to verify it passes**
  Run: `pnpm -C server test`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add server/package.json server/src/protocol.ts server/src/ws-server.ts server/test/protocol.test.ts pnpm-lock.yaml && git commit -m "feat(server): add validated msgpack protocol gateway"`

## Task 4: RoomManager e ServerRoom autoritativa

**Files:**
- Create: `server/src/RoomManager.ts`
- Create: `server/src/ServerRoom.ts`
- Modify: `server/src/index.ts`
- Test: `server/test/server-room.test.ts`

**Interfaces:**
- Consumes: shared `GameRoom`, protocol codec.
- Produces: sala default, join até 8, erro sala cheia, tick 30Hz, broadcast 20Hz, INPUT_BATCH redundante, QUIT/desconexão remove player e registra score elegível.

- [ ] **Step 1: Write failing tests** com dois clientes simulados: join/welcome/snapshot, sala cheia, quit registra score.
- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm -C server test`
  Expected: FAIL.
- [ ] **Step 3: Implement RoomManager/ServerRoom**. Gravação de score via callback/fila (stub em Task 4, SQLite Task 5).
- [ ] **Step 4: Run test to verify it passes**
  Run: `pnpm -C server test`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add server/src/RoomManager.ts server/src/ServerRoom.ts server/src/index.ts server/test/server-room.test.ts && git commit -m "feat(server): add authoritative room manager"`

## Task 5: SQLite leaderboard e playerToken

**Files:**
- Create: `server/src/LeaderboardStore.ts`
- Modify: `server/src/ServerRoom.ts` / `RoomManager.ts`
- Modify: `server/package.json` (`better-sqlite3`, `@types/better-sqlite3`)
- Test: `server/test/leaderboard-store.test.ts`

**Interfaces:**
- Produces: `recordScore({token,name,score,wave,mode})`, `getTop(mode, limit)`, `getBestForToken(mode, token)`, `getOrCreateToken()`. DB em `server/data/`; gitignore data file.

- [ ] **Step 1: Write failing tests** com DB temporária: grava score, top10 ordenado, melhor do token, nome display atualizável.
- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm -C server test`
  Expected: FAIL.
- [ ] **Step 3: Implement LeaderboardStore**. Escrita fora do hot tick (fila/microtask boundary).
- [ ] **Step 4: Run test to verify it passes**
  Run: `pnpm -C server test`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add server/src/LeaderboardStore.ts server/test/leaderboard-store.test.ts server/package.json .gitignore pnpm-lock.yaml && git commit -m "feat(server): persist multiplayer leaderboard in sqlite"`

## Task 6: Cliente WsTransport + ClockSync

**Files:**
- Create: `client/src/net/WsTransport.ts`
- Create: `client/src/net/ClockSync.ts`
- Modify: `client/package.json`
- Test: `client/test/net/ws-transport.test.ts`, `client/test/net/clock-sync.test.ts`

**Interfaces:**
- Produces: `WsTransport implements ITransport` (MessagePack, connect/send/onMessage/close). `ClockSync` calcula offset por PING/PONG; expõe `serverNow()`.

- [ ] **Step 1: Write failing tests** com WebSocket mock: encode/decode, PING/PONG offset.
- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm -C client test -- ws-transport.test.ts clock-sync.test.ts`
  Expected: FAIL.
- [ ] **Step 3: Implement WsTransport/ClockSync**.
- [ ] **Step 4: Run test to verify it passes**
  Run: `pnpm -C client test -- ws-transport.test.ts clock-sync.test.ts`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add client/src/net/WsTransport.ts client/src/net/ClockSync.ts client/test/net/ws-transport.test.ts client/test/net/clock-sync.test.ts client/package.json pnpm-lock.yaml && git commit -m "feat(client): add websocket transport and clock sync"`

## Task 7: Predictor e Interpolator

**Files:**
- Create: `client/src/net/Predictor.ts`
- Create: `client/src/net/Interpolator.ts`
- Test: `client/test/net/predictor.test.ts`, `client/test/net/interpolator.test.ts`

**Interfaces:**
- Produces: `Predictor` guarda comandos locais, aplica previsão, reconcilia por `lastProcessedTick` com smoothing de erro. `Interpolator` bufferiza snapshots/remotos e amostra em `serverTime - 100ms`.

- [ ] **Step 1: Write failing tests**: reconciliação reaplica comandos não-ack; smoothing não teleporta; interpolador retorna posição entre snapshots.
- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm -C client test -- predictor.test.ts interpolator.test.ts`
  Expected: FAIL.
- [ ] **Step 3: Implement Predictor/Interpolator** com buffers pré-alocados onde prático.
- [ ] **Step 4: Run test to verify it passes**
  Run: `pnpm -C client test -- predictor.test.ts interpolator.test.ts`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add client/src/net/Predictor.ts client/src/net/Interpolator.ts client/test/net/predictor.test.ts client/test/net/interpolator.test.ts && git commit -m "feat(client): add prediction and remote interpolation"`

## Task 8: Perfil, leaderboards local/global e UI inicial/respawn

**Files:**
- Create: `client/src/state/player-profile.ts`
- Create: `client/src/state/leaderboard-local.ts`
- Create: `client/src/ui/StartScreen.ts`
- Create: `client/src/ui/RespawnOverlay.ts`
- Create: `client/src/ui/LeaderboardHud.ts`
- Test: `client/test/state/player-profile.test.ts`, `client/test/state/leaderboard-local.test.ts`

**Interfaces:**
- Produces: nome cookie, token local, top10 localStorage, UI overlays DOM com callbacks `onTrain`, `onMultiplayer`, `onRespawn`, `onQuit`.

- [ ] **Step 1: Write failing tests** para cookie/localStorage e ranking local.
- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm -C client test -- player-profile.test.ts leaderboard-local.test.ts`
  Expected: FAIL.
- [ ] **Step 3: Implement state helpers e overlays DOM**. Sem dependência de assets externos.
- [ ] **Step 4: Run test to verify it passes**
  Run: `pnpm -C client test -- player-profile.test.ts leaderboard-local.test.ts`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add client/src/state client/src/ui client/test/state && git commit -m "feat(client): add profile, leaderboard state and UI overlays"`

## Task 9: Integração GameApp/main — modos, morte, killer cam, respawn

**Files:**
- Modify: `client/src/core/GameApp.ts`
- Modify: `client/src/main.ts`
- Modify: `client/src/net/LocalTransport.ts`, `client/src/net/local.worker.ts`
- Test: `client/test/gameapp-respawn.test.ts` (onde viável por mocks)

**Interfaces:**
- Consumes: Predictor/Interpolator/WsTransport/ClockSync, overlays, leaderboard stores.
- Produces: fluxo completo Treinamento/Multiplayer, respawn 3s com botões, desistir volta tela inicial, câmera segue killer até ação, score registrado e zerado ao respawn.

- [ ] **Step 1: Write failing tests** para lógica pura extraída (respawn timer, killer target selection, score record decision).
- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm -C client test -- gameapp-respawn.test.ts`
  Expected: FAIL.
- [ ] **Step 3: Implement integration**. Treinamento usa LocalTransport; Multiplayer usa WsTransport. Em morte, não game over: mostra overlay, segue killer, registra score.
- [ ] **Step 4: Run test to verify it passes**
  Run: `pnpm -C client test -- gameapp-respawn.test.ts`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add client/src/core/GameApp.ts client/src/main.ts client/src/net/LocalTransport.ts client/src/net/local.worker.ts client/test/gameapp-respawn.test.ts && git commit -m "feat(client): integrate M5 modes respawn and spectator death cam"`

## Task 10: Verificação E2E/integration, docs e checklist

**Files:**
- Modify: `README.md`
- Create: `docs/superpowers/specs/2026-11-23-m5-multiplayer-authoritative-verification.md`
- Modify: server/client scripts as needed

**Interfaces:**
- Produces: comandos de verificação, checklist manual de 2 clientes, Treinamento offline, respawn/desistir, leaderboard local/global.

- [ ] **Step 1: Run automated verification**
  Run: `pnpm -r typecheck`
  Expected: PASS.
  Run: `pnpm -r test`
  Expected: PASS.
  Run: `pnpm -C client build`
  Expected: PASS.
- [ ] **Step 2: Add/adjust integration tests** if gaps found (server two-client join/snapshot, score recording on quit).
- [ ] **Step 3: Write verification doc** com resultados reais e PENDENTE para testes de latência real/Quest/Android.
- [ ] **Step 4: Update README** com modos Treinamento/Multiplayer, leaderboard, respawn, comandos server/client.
- [ ] **Step 5: Commit**
  `git add README.md docs/superpowers/specs/2026-11-23-m5-multiplayer-authoritative-verification.md server/package.json client/package.json && git commit -m "docs: add M5 multiplayer verification checklist"`

## Notas de Execução

- Executar após aprovação do plano. Subagent-driven recomendado pelo volume e dependências; Native possível se preferir menor custo.
- Não inventar validação de dispositivo/latência real. Marcar PENDENTE onde não executado.
- Manter SQLite/data files fora do git; incluir `.gitignore` para `server/data/*.db`.
- Se o protocolo mudar, atualizar LocalTransport/worker e WsTransport juntos para evitar drift.
- Confirmar antes de implementar: o botão `Respawn` envia `RESPAWN_REQUEST` e servidor só aceita após 3s (autoritativo), evitando respawn antecipado por cliente adulterado.
