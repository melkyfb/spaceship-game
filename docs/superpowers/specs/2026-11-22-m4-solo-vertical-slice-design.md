# M4 — Vertical Slice Jogável / Modo Solo (US-11/US-12): decisões, verificação e checklist

> Documento de execução da Task 8 (M4). Consolida o vertical slice solo implementado nas Tasks 1–7:
> sim determinística em `shared/src/sim`, transporte local em Web Worker, render por pools InstancedMesh,
> HUD com estado real e áudio procedural 3D. Este documento registra apenas resultados **executados** nesta
> sessão; validação de dispositivo real, FPS e balanceamento fino **não foram executados** e ficam `PENDENTE`.
>
> - Spec: `Documento Oficial de Projeto.pdf` v3.0 — ADR-04 (zero assets externos), ADR-06 (sim determinística 30Hz), M4/US-11/US-12.
> - Plano: `docs/superpowers/plans/2026-11-22-m4-solo-vertical-slice.md`
> - SDD: `.superpowers/sdd/2026-11-22-m4-solo-vertical-slice/`
> - Branch: `feat/m4-solo-vertical-slice`
> - Data da verificação automatizada: **2026-11-22**

## 1. Objetivo e escopo entregue

M4 entrega o vertical slice jogável em modo solo: o cliente envia comandos normalizados ao loop autoritativo
local via `LocalTransport`/Web Worker, recebe snapshots/eventos e renderiza estado real sem assets externos.

| US | Critério | Entrega |
| --- | --- | --- |
| US-11 | Solo jogável: nave, asteroides fragmentáveis, projéteis, colisões, score/wave, loop local | `shared/src/sim/GameRoom.ts` (30Hz), `LocalTransport` + `local.worker.ts`, pools de entidades, HUD com estado real. |
| US-12 | Inimigos com IA, ondas e orçamento de ameaça | `WaveManager`, `EnemyAI` (SCOUT/BRUISER/SCAVENGER, 5-ray cone avoidance), eventos `WAVE_CLEAR`. |
| M4 áudio | Feedback sonoro espacial procedural | `SoundSynth` Web Audio API + PannerNode, iniciado apenas por gesto do usuário. |

Fora do escopo executado: validação em dispositivo real (FPS/latência/conforto), balanceamento fino,
Quest/VR Box real, servidor multiplayer M5.

## 2. Arquitetura

### 2.1 Simulação autoritativa (isomórfica, `shared/src/sim`)

- **`ids.ts`**: `IdSeq` monotônico determinístico por instância.
- **`spawn.ts`**: `isSafeSpawn`, `spawnAsteroidInShell` (casca esférica, rejeição por distância mínima de jogador vivo), `fragmentAsteroid` determinístico com RNG injetado.
- **`WaveManager.ts`**: orçamento `computeWaveBudget(wave, playerCount) = 10 + 4*wave + 2*playerCount`; custos `WAVE_SPAWN_COSTS` (LARGE=3, SCOUT=3, SCAVENGER=2, BRUISER=6); spawn em casca `WAVE_SPAWN_CONFIG` (`MIN_R=280`, `MAX_R=420`, `MIN_PLAYER_DIST=120`).
- **`EnemyAI.ts`**: steering puro/determinístico por arquétipo com 5-ray cone avoidance contra asteroides; saída por `EnemyIntent` (scratch reutilizado).
- **`GameRoom.ts`**: fila/sanitização de comandos, passo fixo `FIXED_DT = 1/30`, snapshot a 20Hz (`FIXED_TICK_RATE / NETWORK_BROADCAST_RATE`), eventos drenáveis, colisões projétil/asteroide/nave/inimigo, pickups, progressão de onda.

A sim não importa `three`, DOM/browser APIs ou Node (`fs`, `crypto`).

### 2.2 Transporte local / Worker (`client/src/net`)

- **`ITransport.ts`**: contrato `connect/send/onMessage/close`.
- **`LocalTransport.ts`**: cria Web Worker module, aguarda `READY`, encaminha `ClientMessage`, distribui `ServerMessage`, trata close/erro/cleanup.
- **`local.worker.ts`**: instancia `GameRoom` com seed fixa (`seed: 1, playerId: 'p1'`), roda `setInterval` a `FIXED_DT*1000`, aplica `INPUT_BATCH` por `room.enqueue`, responde `WELCOME`/`PONG`, emite `SNAPSHOT` quando devido e drena `EVENT`s.

O worker é bundleado pelo Vite (`dist/assets/local.worker-*.js` no build).

### 2.3 Render / cliente (`client/src`)

- **`GameApp.ts`**: orquestra input, transport, snapshot application, HUD, pools, partículas e áudio. Envia `INPUT_BATCH` com redundância (`COMMAND_BUFFER_SIZE = 6`) e tick monotônico; GameRoom ignora comandos antigos.
- **Pools InstancedMesh:** `AsteroidPool` (3 tiers, capacidade por tier), `ProjectilePool`, `EnemyPool` (3 arquétipos), `ShipPool` (naves remotas; local não renderizada em pool), `ParticleSystem` (pool fixo para EXPLOSION/HIT/PLAYER_DEATH).
- **HUD:** `DiegeticHUD` continua com dirty-flag e teto 15Hz; agora alimentado por snapshot real (shield/energy/score/wave) e contatos de asteroides/inimigos/naves.
- **Áudio:** `SoundSynth` sintetiza eventos sem assets externos; gesto do usuário chama `resumeFromGesture()` (`pointerdown`/`keydown` no `main.ts`).

## 3. Regras de gameplay implementadas

### 3.1 Fragmentação de asteroides (US-11)

Fonte de verdade: `ASTEROID_TIERS` em `shared/src/constants.ts`.

| Tier | radius | hp | speed | score | children | nextTier |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| LARGE | 14 | 60 | 12 | 100 | 3 | MEDIUM |
| MEDIUM | 7 | 30 | 20 | 250 | 2 | SMALL |
| SMALL | 3 | 10 | 30 | 500 | 0 | null |

Comportamento: `fragmentAsteroid` gera exatamente `children` filhos do `nextTier` com IDs do `IdSeq` e variação
determinística por RNG injetado. SMALL não fragmenta. **Nota de ambiguidade US-11:** o texto literal do US-11
menciona "LARGE fragmentam em 3 MEDIUM e 2 SMALL"; a implementação segue `ASTEROID_TIERS` (LARGE->3 MEDIUM,
MEDIUM->2 SMALL, SMALL->0), que é a fonte canônica de constantes e evita explosão de entidades.

### 3.2 Orçamento e progressão de ondas (US-12)

- Fórmula: `10 + 4*wave + 2*playerCount`.
- Custos: LARGE=3, SCOUT=3, SCAVENGER=2, BRUISER=6.
- Spawn seguro: casca `[280,420]`, distância mínima 120u de jogadores vivos, tentativas limitadas.
- Wave clear: quando inimigos restantes chegam a 0, emite `WAVE_CLEAR`, avança onda e planeja próxima.

### 3.3 Arquétipos de IA (US-12)

| Arquétipo | HP | Speed | Comportamento |
| --- | ---: | ---: | --- |
| SCOUT | 35 | 52 | Seek jogador mais próximo, strafe senoidal <120u, 5-ray avoidance, rajada dupla plasma em cone <15° (180 u/s). |
| BRUISER | 180 | 24 | Arrive/orbita 140u, 5-ray avoidance, proa alinhada ao alvo, míssil lento 65 u/s (HP10, homing, destrutível por laser). |
| SCAVENGER | 60 | 48 | Seek SMALL/cristais, Flee se jogador <55u, sem ataque; ao morrer dropa 2 cristais (Shield + Energy, TTL 30). |

O 5-ray cone avoidance usa lookahead 60u e padding por raio de asteroide; é determinístico e sem alocações por tick no hot path de steering.

### 3.4 Áudio procedural 3D

- `SoundSynth` usa Web Audio API + `PannerNode` (HRTF, inverse distance).
- Eventos: `EXPLOSION`/`PLAYER_DEATH` (noise + thump), `HIT`, `PICKUP`, `WAVE_CLEAR`.
- Política de autoplay: contexto criado/resumido apenas em gesto (`resumeFromGesture`); falhas degradam silenciosamente.
- `dispose()` fecha contexto de forma segura.

## 4. Verificação automatizada executada (2026-11-22)

Ambiente: Windows, `pnpm@10.0.0`, workspace do repositório. Comandos executados via `cmd /c` conforme ambiente.

| Comando | Status | Evidência observada |
| --- | --- | --- |
| `pnpm -r typecheck` | **PASS** | `Scope: 3 of 4 workspace projects`; `shared typecheck: Done`, `server typecheck: Done`, `client typecheck: Done`. |
| `pnpm -r test` | **PASS** | `shared`: 9 arquivos / **91 testes** passados; `server`: **1 teste** passado (`hello on connect and pong on ping`); `client`: 18 arquivos / **93 testes** passados. |
| `pnpm -C client build` | **PASS** | `tsc -p tsconfig.json --noEmit && vite build`; `✓ 56 modules transformed`; `dist/assets/local.worker-RJ_Sl2lZ.js 37.79 kB`; `dist/assets/index-CiBgBPQg.js 621.45 kB │ gzip: 157.71 kB`; `✓ built in 1.51s`. Aviso de chunk >500 kB do bundle principal (Three.js + jogo) não bloqueante. |

## 5. Checklist manual M4 — validação em dispositivo

Preenchido apenas com itens realmente executados. O que não foi executado está `PENDENTE`. A verificação
automatizada **não** substitui FPS, conforto, input físico, WebXR real ou balanceamento percebido.

| Plataforma | Cenário | Comportamento esperado | Validado (SIM/NÃO/PENDENTE) | Evidência | Observações |
| --- | --- | --- | --- | --- | --- |
| PC (Chrome/Edge, Flat) | `pnpm -C client dev` + abrir `https://localhost:5173?render=FLAT` | Jogo solo inicia, nave responde, asteroides/inimigos aparecem, HUD atualiza, áudio após gesto | **PENDENTE** | Typecheck/test/build PASS (2026-11-22) | Não executado em navegador real neste ambiente; CA mkcert pode exigir aceite humano. |
| PC (Chrome/Edge, Flat) | Loop de combate | Laser/míssil acertam, asteroides fragmentam por tier, explosões/hits/WAVE_CLEAR tocam | **PENDENTE** | Testes sim/client PASS (2026-11-22) | Requer validação visual/auditiva real. |
| Android Chrome (Flat touch) | `https://<IP-LAN>:5173?render=FLAT` | Joysticks/botões controlam nave, performance aceitável, áudio após gesto | **PENDENTE** | Sem execução em dispositivo | Requer CA mkcert no device e teste touch real. |
| Android + VR Box | `?render=VR_BOX` com gamepad/giroscópio | Estéreo/barrel, head look só na câmera (ADR-01), nave por controles, áudio espacial | **PENDENTE** | Sem execução em dispositivo | Requer visor, gamepad BT e validação de conforto. |
| Meta Quest 3 (WebXR) | `?render=QUEST_3` + Enter VR | Sessão `immersive-vr`, controllers/haptics, recenter, 72–90 FPS alvo | **PENDENTE** | Sem execução em headset | Não afirmar FPS/performance sem medição real. |
| Todos | Balanceamento fino / dificuldade | Curva de onda justa e legível | **PENDENTE** | N/A | Não balanceado com playtest real. |

## 6. Limitações e pendências

1. **Validação em dispositivo real pendente.** PC browser real, Android Chrome, VR Box e Quest 3 não foram exercitados nesta sessão.
2. **FPS/performance não medidos.** Metas (72–90 FPS Quest 3, 60 FPS Android Flat/VR Box) permanecem não validadas.
3. **Balanceamento fino pendente.** Valores de IA, dano, spawn e progressão podem precisar ajuste após playtest.
4. **Áudio depende de gesto/política do browser.** `SoundSynth` degrada silenciosamente quando AudioContext não está disponível ou bloqueado.
5. **LocalTransport é modo solo/local.** Multiplayer/servidor autoritativo real fica para M5; worker atual usa seed fixa e sala única.
6. **Ambiguidade US-11 documentada.** Implementação segue `ASTEROID_TIERS` (LARGE->3 MEDIUM, MEDIUM->2 SMALL), não o texto literal ambíguo.

## 7. Próximos passos

- Validar checklist M4 em PC, Android Chrome, VR Box e Quest 3 com evidência (FPS, input, áudio, conforto).
- Ajustar balanceamento com playtests (ondas, IA, dano, pickups, TTk/TTD).
- M5: evoluir transporte/rede para servidor autoritativo, mantendo sim isomórfica em `shared/src/sim`.
- Revisitar orçamento de performance se FPS real ficar abaixo da meta (profiling, draw calls, pools, áudio).