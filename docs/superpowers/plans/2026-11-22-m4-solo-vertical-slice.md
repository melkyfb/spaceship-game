# M4 — Vertical Slice Jogável / Modo Solo (US-11/US-12) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o vertical slice jogável em modo solo: loop determinístico em Web Worker via `LocalTransport`, asteroides fragmentáveis, inimigos com IA/ondas e áudio procedural 3D, integrando `InputManager.getCommand(tick)` ao ciclo de simulação.

**Architecture:** A simulação autoritativa do modo solo roda em `shared/` (isomórfico) dentro de um Web Worker, exposta ao cliente por `ITransport`/`LocalTransport`. O cliente envia `INPUT_BATCH` e recebe `SNAPSHOT`/`EVENT`; renderiza entidades com pools InstancedMesh e reproduz áudio procedural via Web Audio API/PannerNode. A lógica determinística (GameRoom/WaveManager/EnemyAI/spawn/fragmentação) fica em `shared/src/sim/` para ser reutilizável pelo server em M5.

**Tech Stack:** TypeScript 5.x strict, Vite (Web Worker bundling), Vitest, Three.js InstancedMesh, Web Audio API, `@asteroids/shared` (gl-matrix, física/colisão existentes), tipos/protocolo existentes.

**Spec:** `Documento Oficial de Projeto.pdf` v3.0 — seções 2 (ADR-06 determinismo, hot-loop zero-alloc), 3.3, 4.1-4.6, 5.1 M4, 5.2 US-11/US-12. Planos anteriores: Fase 1, M0, M2, M3.

## Global Constraints

- **Isolamento de `shared/`:** sem imports de `three`, browser (`window`, `document`) ou Node (`fs`, `crypto`). Código de sim deve rodar em Worker e testes Node/Vitest.
- **Determinismo ADR-06:** simulação em passo fixo `1/30s` (`WORLD_CONFIG.FIXED_TICK_RATE`); `dt` externo não altera física.
- **Zero alocação no hot-loop:** sem `new` por tick em sim/render/audio update críticos; usar pools/scratch/prealloc.
- **HUD dirty-flag:** `CanvasTexture.needsUpdate` apenas quando valor muda, teto 15Hz (já implementado; manter).
- **TypeScript:** `strict: true`, `noUncheckedIndexedAccess: true`, ES2022.
- **Validação de dispositivo/FPS real:** pode ficar PENDENTE com checklist honesto se não executado.

## Review Focus

- **Worker/transport ordering:** `INPUT_BATCH` fora de ordem ou atrasado não deve corromper sim; comandos devem ser saneados/clampados e aplicados por tick.
- **Fragmentação de asteroides:** LARGE deve gerar 3 MEDIUM e 2 SMALL (US-11) com IDs/velocidades/posições válidas e sem explosão infinita de entidades.
- **Alocação por tick:** pools/event buffers/scratch devem ser reutilizados; `InstancedMesh` não deve ser recriado por frame.
- **IA sem colisão constante:** 5-Ray Cone Avoidance deve reduzir colisões com asteroides; não precisa ser perfeito, mas comportamento deve ser observável e testável em cenários puros.
- **Audio autoplay/policy:** Web Audio deve iniciar apenas após gesto do usuário; falha de AudioContext não pode quebrar jogo.

## File Structure

### Criar
- `shared/src/sim/GameRoom.ts` — loop fixo 30Hz, fila de inputs, step de sim, snapshots 20Hz, eventos.
- `shared/src/sim/WaveManager.ts` — threat budget, spawn seguro em casca esférica, progressão de onda.
- `shared/src/sim/EnemyAI.ts` — steering behaviors 3D + 5-ray cone avoidance para SCOUT/BRUISER/SCAVENGER.
- `shared/src/sim/ids.ts` — gerador determinístico/monotônico de IDs para entidades de sim.
- `shared/src/sim/spawn.ts` — helpers puros de spawn seguro e fragmentação de asteroides.
- `shared/src/sim/index.ts` — exports da sim.
- `shared/test/sim/spawn.test.ts`
- `shared/test/sim/wave-manager.test.ts`
- `shared/test/sim/enemy-ai.test.ts`
- `shared/test/sim/game-room.test.ts`
- `client/src/net/ITransport.ts` — contrato agnóstico.
- `client/src/net/LocalTransport.ts` — ponte main thread <-> Worker.
- `client/src/net/local.worker.ts` — Web Worker executando `GameRoom`.
- `client/src/entities/AsteroidPool.ts` — `InstancedMesh` para asteroides.
- `client/src/entities/ProjectilePool.ts` — `InstancedMesh` para projéteis.
- `client/src/entities/RemoteShip.ts` / `EnemyShip.ts` (ou arquivo único simples) — render de naves inimigas/aliadas mínimo.
- `client/src/entities/ParticleSystem.ts` — pool estático de partículas vetoriais.
- `client/src/audio/SoundSynth.ts` — Web Audio API + PannerNode espacial 3D.
- `client/test/net/local-transport.test.ts` (mock worker/contrato)
- `docs/superpowers/specs/2026-11-22-m4-solo-vertical-slice-design.md`

### Modificar
- `shared/src/constants.ts` — constantes faltantes de armas/asteroides/inimigos/limites conforme spec.
- `shared/src/types.ts` — ajustar/confirmar campos necessários para eventos/snapshot/ids se necessário.
- `shared/src/index.ts` — exportar sim.
- `client/src/core/GameApp.ts` — integrar transport, snapshot application, pools, audio, input batch.
- `client/src/main.ts` — bootstrap/gesto para iniciar áudio e modo solo.
- `client/src/ui/DiegeticHUD.ts` / `hud-math.ts` — consumir estado real de sim.
- `README.md` — controles/status M4 e checklist.

### Responsabilidades
- `shared/src/sim/*`: determinismo e regras; sem render/audio.
- `client/src/net/*`: transporte/mensageria; sem regras de jogo.
- `client/src/entities/*`: visualização/pools; sem autoridade de sim.
- `client/src/audio/*`: síntese/reprodução; sem mutar estado de sim.
- `GameApp`: orquestração.

---
## Task 1: Sim foundations — IDs, spawn seguro e fragmentação (US-11/US-12 base)

**Files:**
- Create: `shared/src/sim/ids.ts`
- Create: `shared/src/sim/spawn.ts`
- Create: `shared/test/sim/spawn.test.ts`
- Modify: `shared/src/constants.ts` (apenas se constante necessária faltar)
- Modify: `shared/src/index.ts` (exportar sim/novos helpers)

**Interfaces:**
- Consumes: `ASTEROID_TIERS`, `WORLD_CONFIG`, tipos `AsteroidState`/`PickupState`/`EnemyState`.
- Produces:
  - `class IdSeq { next(): number }` (monotônico determinístico por instância)
  - `spawnAsteroidInShell(...)` / `isSafeSpawn(pos, players, minDist)` (puros)
  - `fragmentAsteroid(asteroid, idSeq, rng): AsteroidState[]` seguindo `ASTEROID_TIERS`

- [ ] **Step 1: Escrever testes falhando**

```ts
import { describe, expect, it } from 'vitest'
import { fragmentAsteroid, isSafeSpawn } from '../../src/sim/spawn'
import { IdSeq } from '../../src/sim/ids'

it('fragments LARGE into 3 MEDIUM and MEDIUM into 2 SMALL', () => {
  const ids = new IdSeq(100)
  const rng = () => 0.5
  // LARGE -> 3 MEDIUM, MEDIUM -> 2 SMALL, SMALL -> []
})
```

- [ ] **Step 2: Rodar teste para ver falha**

Run: `pnpm -C shared test -- spawn.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar helpers puros**

`fragmentAsteroid` usa `ASTEROID_TIERS[size].children/nextTier`; gera filhos com posições/velocidades derivadas determinísticas (rng injetado) dentro de limites razoáveis. `isSafeSpawn` garante distância >= `120u` de jogadores vivos. Sem `Math.random()` oculto.

- [ ] **Step 4: Rodar testes**

Run: `pnpm -C shared test -- spawn.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/sim/ids.ts shared/src/sim/spawn.ts shared/test/sim/spawn.test.ts shared/src/index.ts shared/src/constants.ts
git commit -m "feat(sim): add deterministic spawn and asteroid fragmentation helpers"
```

## Task 2: WaveManager e orçamento de ameaça (US-12)

**Files:**
- Create: `shared/src/sim/WaveManager.ts`
- Create: `shared/test/sim/wave-manager.test.ts`
- Modify: `shared/src/sim/index.ts`
- Modify: `shared/src/constants.ts` (custos/archetype config se faltar)

**Interfaces:**
- Consumes: `ASTEROID_TIERS`, config de inimigos, helpers de spawn.
- Produces:
  - `computeWaveBudget(wave: number, playerCount: number): number` => `10 + 4*wave + 2*playerCount`
  - `class WaveManager { planWave(...): SpawnPlan; onEnemyKilled(...); isWaveClear(...); advance(...) }`

- [ ] **Step 1: Escrever teste falhando do budget/spec**

```ts
expect(computeWaveBudget(1, 1)).toBe(16)
```

Custos: LARGE=3, SCOUT=3, SCAVENGER=2, BRUISER=6. Spawn em casca `R in [280,420]`, >=120u de qualquer jogador vivo.

- [ ] **Step 2: Rodar falha**

Run: `pnpm -C shared test -- wave-manager.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar WaveManager determinístico**

Sem DOM/Three/Node. Aceita rng injetado e estado; retorna plano. Reutilizar arrays internos quando possível.

- [ ] **Step 4: Rodar testes**

Run: `pnpm -C shared test -- wave-manager.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/sim/WaveManager.ts shared/test/sim/wave-manager.test.ts shared/src/sim/index.ts shared/src/constants.ts
git commit -m "feat(sim): add wave budget and spawn planning"
```

## Task 3: EnemyAI steering + 5-ray avoidance (US-12)

**Files:**
- Create: `shared/src/sim/EnemyAI.ts`
- Create: `shared/test/sim/enemy-ai.test.ts`
- Modify: `shared/src/constants.ts` (archetypes HP/vel se faltar)
- Modify: `shared/src/sim/index.ts`

**Interfaces:**
- Consumes: `EnemyState`, `ShipState`, `AsteroidState`, `PickupState`, math helpers.
- Produces:
  - `stepEnemyAI(...)` puro/determinístico por arquétipo:
    - SCOUT: Seek jogador mais próximo + 5-Ray Cone Avoidance + strafe senoidal a <120u; rajada dupla plasma (180 u/s) em cone <15°.
    - BRUISER: Arrive orbitando 140u + 5-Ray Avoidance; proa alinhada; míssil teleguiado lento (65 u/s, HP10) destrutível por lasers.
    - SCAVENGER: Seek asteroides SMALL/cristais; Flee se jogador <55u; sem ataque; ao morrer dropa 2 cristais.

- [ ] **Step 1: Escrever testes falhando de comportamento puro**

Testar flee threshold 55u, orbit 140u, seleção de alvo e que avoidance produz desvio quando obstáculo está à frente.

- [ ] **Step 2: Rodar falha**

Run: `pnpm -C shared test -- enemy-ai.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar AI determinística**

Vetores scratch; 5-ray cone avoidance contra asteroides. Sem alocações por tick. Saída é intenção/steering aplicada pelo GameRoom.

- [ ] **Step 4: Rodar testes**

Run: `pnpm -C shared test -- enemy-ai.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/sim/EnemyAI.ts shared/test/sim/enemy-ai.test.ts shared/src/constants.ts shared/src/sim/index.ts
git commit -m "feat(sim): add enemy steering behaviors and obstacle avoidance"
```

## Task 4: GameRoom determinístico + protocolo local (US-11)

**Files:**
- Create: `shared/src/sim/GameRoom.ts`
- Create: `shared/test/sim/game-room.test.ts`
- Create: `shared/src/sim/index.ts` (atualizar exports)
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: `stepShip`, resolvers de colisão, `fragmentAsteroid`, `WaveManager`, `EnemyAI`, `ShipCommand`/`ClientMessage`/`ServerMessage` types.
- Produces:
  - `class GameRoom { enqueue(cmds: ShipCommand[]): void; stepFixed(): void; createSnapshot(): ServerMessage; drainEvents(): ServerMessage[] }`
  - Loop fixo 30Hz; broadcast snapshot 20Hz; sanitização de input (finite/clamp [-1,1], payload shape).

- [ ] **Step 1: Escrever teste falhando de simulação**

Criar GameRoom com seed fixa; enfileirar comandos; avançar ticks; assert snapshot determinístico (posições/ids) e eventos de fragmentação/impacto.

- [ ] **Step 2: Rodar falha**

Run: `pnpm -C shared test -- game-room.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar GameRoom**

Fila de comandos por tick/player; ignora comandos antigos/duplicados; aplica clamp/sanitização. Simula ship, projéteis, asteroides, inimigos, pickups. Usa pools/buffers existentes (CollisionEventBuffer) e scratch; sem aloc por tick. Fragmenta asteroides conforme tier. Emite EVENTs (EXPLOSION/HIT/PICKUP/WAVE_CLEAR/PLAYER_DEATH quando aplicável).

- [ ] **Step 4: Rodar testes**

Run: `pnpm -C shared test -- game-room.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/sim/GameRoom.ts shared/test/sim/game-room.test.ts shared/src/sim/index.ts shared/src/index.ts
git commit -m "feat(sim): add deterministic solo game room loop"
```

## Task 5: ITransport + LocalTransport + Web Worker (US-11)

**Files:**
- Create: `client/src/net/ITransport.ts`
- Create: `client/src/net/LocalTransport.ts`
- Create: `client/src/net/local.worker.ts`
- Test: `client/test/net/local-transport.test.ts`

**Interfaces:**
- Consumes: `ClientMessage`/`ServerMessage`, `GameRoom` de `@asteroids/shared`.
- Produces:
  - `interface ITransport { connect(): Promise<void>; send(msg: ClientMessage): void; onMessage(cb): () => void; close(): void }`
  - `LocalTransport` roda `GameRoom` em Worker; main thread envia `INPUT_BATCH`, recebe `SNAPSHOT`/`EVENT`.

- [ ] **Step 1: Escrever teste falhando de contrato**

Mockar Worker; verificar que `connect/send/onMessage/close` entregam mensagens e fazem cleanup.

- [ ] **Step 2: Rodar falha**

Run: `pnpm -C client test -- local-transport.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar Worker + transport**

Worker cria `GameRoom`, recebe comandos, roda loop fixo com `setInterval`/scheduler apropriado, envia snapshots em 20Hz e eventos. Transport mapeia callbacks sem expor Worker internals. Tratar `close` e `terminate`.

- [ ] **Step 4: Rodar testes**

Run: `pnpm -C client test -- local-transport.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/net/ITransport.ts client/src/net/LocalTransport.ts client/src/net/local.worker.ts client/test/net/local-transport.test.ts
git commit -m "feat(net): add local transport backed by simulation worker"
```

## Task 6: Render pools + snapshot application (US-11)

**Files:**
- Create: `client/src/entities/AsteroidPool.ts`
- Create: `client/src/entities/ProjectilePool.ts`
- Create: `client/src/entities/EnemyShip.ts` (mínimo procedural)
- Create: `client/src/entities/ParticleSystem.ts`
- Modify: `client/src/core/GameApp.ts`
- Test: `client/test/entities/asteroid-pool.test.ts` (lógica pura de mapeamento/capacidade, se possível)

**Interfaces:**
- Consumes: snapshots `ServerMessage` (`SNAPSHOT`), Three.js scene, `CockpitRig`.
- Produces: pools visuais atualizados por snapshot; sem recriar meshes por frame. Asteroides via `InstancedMesh` (3 variações por tier, se simples; ou 1 por tier com escala/material) — manter zero assets externos.

- [ ] **Step 1: Escrever teste falhando para mapeamento de instâncias**

Testar que atualização de N asteroides escreve matrizes/count sem criar novos objetos (função pura/helper).

- [ ] **Step 2: Rodar falha**

Run: `pnpm -C client test -- asteroid-pool.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar pools e integração no GameApp**

GameApp conecta `LocalTransport`, envia `INPUT_BATCH` com `InputManager.getCommand(tick)`, aplica snapshots ao estado render. HUD passa a usar estado real (shield/energy/score/wave) do snapshot do player local. Partículas para EVENT EXPLOSION/HIT (pool fixo).

- [ ] **Step 4: Rodar testes**

Run: `pnpm -C client test -- asteroid-pool.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/entities client/src/core/GameApp.ts client/test/entities/asteroid-pool.test.ts
git commit -m "feat(client): render solo snapshots with instanced entity pools"
```

## Task 7: Áudio procedural 3D + integração final (US-11)

**Files:**
- Create: `client/src/audio/SoundSynth.ts`
- Modify: `client/src/core/GameApp.ts`
- Modify: `client/src/main.ts` (iniciar AudioContext após gesto)
- Test: `client/test/audio/sound-synth.test.ts` (mock AudioContext)

**Interfaces:**
- Consumes: eventos de sim (`EXPLOSION`, `HIT`, `PICKUP`, `PLAYER_DEATH`, `WAVE_CLEAR`), posições para PannerNode.
- Produces:
  - `class SoundSynth { resumeFromGesture(): Promise<void>; playEvent(event): void; dispose(): void }`
  - Sons 3D sintetizados sem assets externos.

- [ ] **Step 1: Escrever teste falhando com AudioContext mock**

Verificar que resumeFromGesture cria/resume contexto e playEvent não lança sem contexto.

- [ ] **Step 2: Rodar falha**

Run: `pnpm -C client test -- sound-synth.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar SoundSynth**

Oscillators/noise buffers curtos gerados proceduralmente; PannerNode para espacialização. Respeitar política de autoplay (só após gesto). Falhas degradam silenciosamente.

- [ ] **Step 4: Rodar testes**

Run: `pnpm -C client test -- sound-synth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/audio/SoundSynth.ts client/src/core/GameApp.ts client/src/main.ts client/test/audio/sound-synth.test.ts
git commit -m "feat(audio): add procedural spatial sound synthesis"
```

## Task 8: Verificação M4, docs e checklist

**Files:**
- Modify: `README.md`
- Create: `docs/superpowers/specs/2026-11-22-m4-solo-vertical-slice-design.md`
- Test: comandos de verificação + checklist manual

- [ ] **Step 1: Rodar verificação automatizada**

Run: `pnpm -r typecheck`
Expected: PASS.

Run: `pnpm -r test`
Expected: PASS.

Run: `pnpm -C client build`
Expected: PASS.

- [ ] **Step 2: Escrever doc de verificação M4**

Incluir: arquitetura LocalTransport/Worker, fragmentação por tier, orçamento de ondas, arquétipos IA, áudio procedural, limitações/PENDENTE (FPS real dispositivos, balanceamento fino, Quest/VRBox real).

- [ ] **Step 3: Atualizar README**

Adicionar M4 status, como rodar solo, controles, checklist de validação (PC/Android/VR Box/Quest 3) com PENDENTE onde não executado.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-11-22-m4-solo-vertical-slice-design.md
git commit -m "docs: add M4 solo vertical slice verification checklist"
```

## Notas de Execução

- **M4 é grande:** manter tarefas pequenas e revisar após cada task. Se IA/Worker/Render ficarem grandes demais, dividir Task 3/4/6 em sub-passos internos sem mudar escopo.
- **US-11 fragmentação:** seguir `ASTEROID_TIERS` (LARGE->3 MEDIUM, MEDIUM->2 SMALL, SMALL->0). Documentar literal do US-11 se houver ambiguidade.
- **Server M5:** GameRoom em `shared/src/sim` facilita reuso; não adicionar dependências Node.
- **Dispositivo real/FPS:** validar e marcar PENDENTE honestamente.
