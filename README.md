# Asteroids 3D

Monorepo do Asteroids 3D. Este repositório entrega a **Fase 1 (M1) — núcleo
matemático e física determinística** no pacote isomórfico `shared/`, o **M0 —
cliente Vite/TypeScript com servidor de desenvolvimento HTTPS confiável, status
WebSocket e proxy `/ws` na mesma origem** (além do stub WS em `server/`), o
**M2 — cockpit 3D procedural, pipeline de render tri-modal (Flat / VR Box / Quest 3
WebXR) e HUD diegético com radar e offscreen pips, sem assets externos**, o
**M3 — sistema de input cross-platform com normalização comum, InputManager e
adaptadores Desktop/Touch/VR Box/Quest XR** e o **M4 — vertical slice jogável em
modo solo (US-11/US-12)** com sim determinística em Web Worker (`LocalTransport`/
`GameRoom`), asteroides fragmentáveis por tier, IA inimiga com ondas/orçamento e
áudio procedural 3D. O servidor multiplayer autoritativo real (M5) ainda será adicionado.

## Pré-requisitos

- Node.js 22+ (verificado com `v24.19.0`)
- PNPM 10 (`packageManager: pnpm@10.0.0`, verificado com `10.0.0`)
- mkcert — para confiar no certificado local no PC. O `vite-plugin-mkcert` baixa o
  binário automaticamente na primeira execução; também é possível instalar o mkcert
  manualmente (ver [HTTPS local (mkcert)](#https-local-mkcert)).

## Começando

```bash
pnpm install          # instala as dependências do workspace (lockfile estável)
```

## Comandos de execução

### Pacote `shared` (Fase 1)

```bash
pnpm -C shared test        # Vitest: suíte completa (5 arquivos, 38 testes)
pnpm -C shared typecheck   # tsc --noEmit (strict + noUncheckedIndexedAccess)
pnpm -C shared build       # tsc --noEmit (checagem de build; sem emissão nesta fase)
pnpm -C shared lint        # placeholder: "lint not configured yet" (ESLint ainda não configurado)
```

### Pacote `client` (M0)

```bash
pnpm -C client dev        # Vite em HTTPS, 0.0.0.0:5173 (strictPort)
pnpm -C client preview    # preview em HTTPS, 0.0.0.0:4173 (strictPort)
pnpm -C client build      # tsc --noEmit + vite build
pnpm -C client typecheck  # tsc --noEmit (strict + noUncheckedIndexedAccess)
pnpm -C client test       # Vitest (buildWsUrl + demais testes do cliente)
```

### Pacote `server` (stub WS do M0)

```bash
pnpm -C server dev        # stub WebSocket em ws://localhost:8080 (tsx)
pnpm -C server build      # tsc --noEmit (checagem; sem emissão nesta fase)
pnpm -C server typecheck  # tsc --noEmit (strict + noUncheckedIndexedAccess)
pnpm -C server test       # node:test via tsx: contrato hello/pong do stub WS
```

### Raiz do workspace (aplica o script a todos os pacotes via `pnpm -r`)

```bash
pnpm test                  # pnpm -r test
pnpm typecheck             # pnpm -r typecheck
pnpm build                 # pnpm -r build
pnpm lint                  # pnpm -r lint
pnpm dev:client            # atalho para pnpm -C client dev
pnpm dev:server            # atalho para pnpm -C server dev
```

Todos os comandos acima foram executados com sucesso (`exit 0`) nas verificações das fases
entregues. Evidências: Fase 1 (`docs/superpowers/specs/2026-11-22-fase-1-fisica-testes-design.md`),
M0 (`docs/superpowers/specs/2026-11-22-fase-0-client-https-ws-design.md`), M2
(`docs/superpowers/specs/2026-11-22-m2-render-cockpit-hud-design.md`), M3
(`docs/superpowers/specs/2026-11-22-m3-inputs-cross-platform-design.md`) e M4
(`docs/superpowers/specs/2026-11-22-m4-solo-vertical-slice-design.md`).

## HTTPS local (mkcert)

O `client/vite.config.ts` usa `vite-plugin-mkcert`: o Vite serve `https://` na porta
`5173` (e o preview na `4173`), com `host: '0.0.0.0'` e `strictPort: true`. O plugin
gera automaticamente uma autoridade certificadora (CA) local e um certificado que cobre
`localhost`, `::1`, `127.0.0.1` e os IPs da rede local — portanto o mesmo certificado
serve para acessar `https://<IP-LAN>:5173` a partir de outro dispositivo na LAN.

**PC (Windows):** na primeira execução de `pnpm -C client dev`, o mkcert cria a CA em
`%USERPROFILE%\.vite-plugin-mkcert\` e o Windows exibe um *Aviso de Segurança* para
confirmar a instalação da CA no repositório de certificados do usuário. Aceite uma vez;
as execuções seguintes reutilizam a CA e não voltam a perguntar. Como alternativa,
instale o mkcert manualmente e rode `mkcert -install` antes de iniciar o Vite.

**Android / Meta Quest:** a CA gerada no PC **não** é confiável nesses dispositivos até
ser instalada manualmente.

1. No PC, copie `%USERPROFILE%\.vite-plugin-mkcert\rootCA.pem` para o dispositivo
   (por exemplo, via `adb push`).
2. No Android: *Configurações → Segurança → Instalar a partir do armazenamento →
   Certificado CA*. No Quest Browser, use o gerenciador de certificados do sistema/
   fluxo de instalação de CA do dispositivo.
3. Descubra o IP da LAN do PC (`ipconfig` no Windows) e abra `https://<IP-LAN>:5173`
   no Chrome Android e no Meta Quest Browser.

O certificado é emitido para os IPs locais detectados no momento da geração; se o IP
do PC mudar, reinicie `pnpm -C client dev` para que o plugin regere o certificado.

> **Status de validação:** a configuração e a compilação foram verificadas neste
> repositório. A abertura em Android Chrome / Meta Quest Browser **ainda não foi
> executada** e, portanto, não é afirmada como válida neste documento.

## WebSocket de desenvolvimento (stub + proxy `/ws`)

O stub em `server/src/index.ts` escuta em `ws://localhost:8080`. Ao conectar, envia
`{"t":"hello"}`; ao receber `{"t":"ping"}`, responde `{"t":"pong"}`. É apenas um stub
de desenvolvimento — sem netcode, física ou gameplay.

O `client/vite.config.ts` expõe o stub na **mesma origem** da página via proxy:
`/ws` → `ws://localhost:8080`, com `ws: true` e `changeOrigin: true`. A mesma configuração
de proxy vale para `dev` (5173) e `preview` (4173), para que ambos os comandos HTTPS
documentados se comportem de forma idêntica. A página usa
`buildWsUrl(window.location)` (`client/src/ws-status.ts`), que gera `wss://<host>/ws`
em páginas HTTPS e `ws://<host>/ws` em HTTP — evitando mixed content e dispensando
portas ou certificados adicionais nos dispositivos. O status aparece no HUD de texto:
`connecting` → `connected` → `hello received` (ou `error` / `closed` em caso de falha;
o código e o motivo do `close` são registrados no console).

### Verificação manual do WS

```bash
# Terminal A
pnpm -C server dev
# Terminal B
pnpm -C client dev
```

Abra `https://localhost:5173` (ou `https://<IP-LAN>:5173`) e confirme que o status
mostra `WS: hello received`. O contrato do stub também pode ser checado diretamente:

```
conectar em ws://localhost:8080 → recebe {"t":"hello"}
enviar {"t":"ping"}             → recebe {"t":"pong"}
```

> **Status de validação:** o contrato hello/pong do stub é coberto por teste automatizado
> (`pnpm -C server test`) e o proxy `/ws` foi verificado com cliente WS automatizado neste
> repositório. A exibição no navegador e o teste em Android Chrome / Meta Quest Browser
> **não foram executados**: o diálogo de confiança da CA do mkcert está bloqueado neste
> desktop (ver seção anterior).

## Checklist manual US-02 (validação em dispositivos)

Preenchido apenas com itens realmente executados; o que não foi executado está marcado como
`PENDENTE`. Fonte autoritativa e detalhes (troubleshooting, passos mkcert, evidência dos
comandos): `docs/superpowers/specs/2026-11-22-fase-0-client-https-ws-design.md`.

| Dispositivo | URL | Certificado confiável | Página carregou | WS `/ws` conectou | Evidência/data | Observações |
| --- | --- | --- | --- | --- | --- | --- |
| PC (Windows, Chrome/Edge) | `https://localhost:5173` e `https://<IP-LAN>:5173` | `PENDENTE` | `PENDENTE` | `PENDENTE` | 2026-11-22 (Task 2) | Tentativa de `pnpm -C client dev`: CA criada em `%USERPROFILE%\.vite-plugin-mkcert\`, mas `mkcert -install` travou no *Aviso de Segurança* do Windows; Vite não escutou em 5173. Requer aceite humano da CA. |
| Android Chrome | `https://<IP-LAN>:5173` | `PENDENTE` | `PENDENTE` | `PENDENTE` | 2026-11-22 | Não executado. Requer instalar `rootCA.pem` como CA no dispositivo e desktop com CA aceita. |
| Meta Quest Browser | `https://<IP-LAN>:5173` | `PENDENTE` | `PENDENTE` | `PENDENTE` | 2026-11-22 | Não executado. Mesmo pré-requisito de CA do Android; fluxo de CA do Quest pode variar por versão do sistema. |

> US-02 **não está validada em dispositivo**: o critério "sem alertas de certificado inválido"
> depende de evidência real nessas linhas. Código, proxy e URL `wss://` estão prontos e cobertos
> por checagens automatizadas; a abertura ao vivo está bloqueada pela confirmação interativa da
> CA do mkcert neste desktop.

### Verificação automatizada (executada em 2026-11-22)

| Comando | Resultado |
| --- | --- |
| `pnpm install` | PASS — `Scope: all 4 workspace projects`, `Already up to date` |
| `pnpm -r typecheck` | PASS — shared, server e client (`tsc --noEmit`, sem erros) |
| `pnpm -r test` | PASS — client 2/2, shared 46/46, server 1/1 |
| `pnpm -C client build` | PASS — `✓ 5 modules transformed`, `✓ built in 97ms` |

## M2 — Render tri-modal, cockpit e HUD diegético (US-05/06/07)

O `client/` agora usa Three.js (`three@^0.187.0`) com cena bootstrap em `GameApp`,
hierarquia `CockpitRig` conforme spec 4.4, `RenderPipeline` tri-modal e HUD diegético
(`CanvasTexture` 512×256, dirty-flag 15Hz) com radar e 16 pips radiais. Constantes da
spec em `client/src/core/render-config.ts`: barrel `k1 = 0.22`, `k2 = 0.24`, IPD
`56–74 mm` (default `64`), `MAX_DPR = 2`, WebXR `immersive-vr` + `local`.

Selecione o modo por query: `?render=FLAT` (padrão), `?render=VR_BOX` ou
`?render=QUEST_3`. No modo Quest 3, o botão "Enter VR" aparece quando `immersive-vr` é
suportado; falha ao entrar aparece no próprio botão ("VR failed — retry", reabilitado para
nova tentativa) e em `getXrStatus()`. Hooks de dev apenas: `[`/`]` ajustam o IPD em ±1 mm e
`R` faz `recenter()` (o listener é removido no `beforeunload`). O mapeamento final
(D-Pad no VR Box / botão X no Quest) chega no **M3**.

> **ADR-04:** nenhum asset externo e nenhum pós-processamento pesado — a distorção do
> VR Box é um shader procedural e o HUD é desenhado em canvas gerado em código.

### Checklist manual M2 (validação em dispositivo)

Preenchido apenas com itens realmente executados; o que não foi executado está
`PENDENTE`. Meta de performance: **72–90 FPS no Quest 3** e **60 FPS no Android
(Flat/VR Box)** — sem medição real neste ambiente. Fonte autoritativa e detalhes:
`docs/superpowers/specs/2026-11-22-m2-render-cockpit-hud-design.md`.

| Modo | URL/dispositivo | FPS observado | HUD atualiza corretamente | Pips/radar corretos | Sem assets externos | Evidência |
| --- | --- | --- | --- | --- | --- | --- |
| Flat | `https://localhost:5173?render=FLAT` (PC Chrome/Edge) | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` em dispositivo (código auditado: ✅) | Checks automatizados 2026-11-22 (abaixo); abertura ao vivo não executada — CA do mkcert exige aceite humano. |
| Flat | `https://<IP-LAN>:5173?render=FLAT` (Android Chrome) | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` em dispositivo (código auditado: ✅) | Não executado; requer CA do mkcert instalada no dispositivo. |
| VR Box | Visitante óptico + Android Chrome, `https://<IP-LAN>:5173?render=VR_BOX` | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` em dispositivo (código auditado: ✅) | Não executado; estereoscopia/barrel/conforto exigem conferência visual no visor. |
| Quest 3 | Meta Quest Browser, `https://<IP-LAN>:5173?render=QUEST_3` | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` em dispositivo (código auditado: ✅) | Não executado; botão "Enter VR", sessão `immersive-vr` e recenter não exercitados em hardware. |

> Nenhuma linha foi validada em dispositivo. Código, constantes e hot paths foram
> verificados por tipagem, testes, build e auditoria de alocações; não reivindicar
> FPS, conforto ou correção visual "em dispositivo" sem preencher a tabela acima.

### Verificação automatizada M2 (executada em 2026-11-22)

| Comando | Resultado |
| --- | --- |
| `pnpm -r typecheck` | PASS — `client`, `server` e `shared` `Done` (sem erros/warnings). |
| `pnpm -r test` | PASS — `client` 6 arquivos / 22 testes, `shared` 5 arquivos / 46 testes, `server` 1 teste. |
| `pnpm -C client build` | PASS — `✓ 15 modules transformed`, `✓ built in 1.26s` (aviso pré-existente de chunk >500 kB do Three.js, não bloqueante). |

## M3 — Controles Cross-Platform (US-08/09/10)

O `client/src/input/` implementa normalização comum, `InputManager` e adaptadores por
plataforma. A lógica pura fica em helpers testáveis; adaptadores são finos sobre APIs de browser/WebXR.

- **Normalização global:** deadzone radial `0.15` com reescalonamento linear para `[0,1]`;
  curva exponencial `v_out = sign(v) * |v|^1.6` para yaw e pitch; `clampAxis` em `[-1,1]`.
- **ADR-01:** em VR, a cabeça controla apenas a câmera dentro do `PilotHeadRig`; nave/mira
  são controladas por controles manuais. `VRBoxInput` aplica quatérnio ao head rig, não à nave.
- **ADR-02:** Desktop suporta Alt para Free-Look temporário no cockpit (mouse move câmera,
  não yaw/pitch da nave).

### Mapeamentos resumidos

| Plataforma | Controle | Mapeamento |
| --- | --- | --- |
| Desktop | W/S, A/D, Space/Ctrl, Q/E, Shift | thrust, strafeX, strafeY, roll, boost |
| Desktop | Mouse (PointerLock) | yaw/pitch com curva 1.6 |
| Desktop | LMB/RMB, Alt | firePrimary/fireSecondary; Alt = free-look temporário (ADR-02) |
| Desktop | Gamepad padrão | left stick strafe, RT/LT thrust, right stick yaw/pitch 1.6, LB/RB roll, A/RT fire, B/LT missile, L3/Y boost |
| Android Flat | Joystick esquerdo dinâmico | strafeX/thrust (deadzone radial 0.15) |
| Android Flat | Joystick direito dinâmico | yaw/pitch com curva 1.6 |
| Android Flat | Botões FIRE/MISSILE/BOOST | firePrimary auto-fire ao segurar, fireSecondary, boost |
| VR Box | DeviceOrientation relativo (YXZ) | apenas `PilotHeadRig` (ADR-01), sem compass absoluto |
| VR Box | Gamepad padrão / BT wizard 3 passos | eixos/botões mapeados; wizard persiste em `localStorage` |
| VR Box | Fullscreen/Orientation/WakeLock | degradado com status quando API falha/indisponível |
| Quest 3 | Left stick/trigger/Y/squeeze/X | strafeX/thrust, strafeY, boost, recenter on-edge |
| Quest 3 | Right stick/trigger/squeeze | yaw/pitch curva 1.6, firePrimary, fireSecondary |
| Quest 3 | Haptics | fire 0.2/25ms, missile 0.5/60ms, shield 0.85/150ms; no-op seguro |

### Checklist manual M3 (validação em dispositivo)

Preenchido apenas com itens realmente executados; o que não foi executado está `PENDENTE`.
Validação automatizada de lógica/mapeamento puro **não** substitui validação em dispositivo.
Fonte autoritativa: `docs/superpowers/specs/2026-11-22-m3-inputs-cross-platform-design.md`.

| Plataforma | Controle mapeado | Comportamento esperado | Validado (SIM/NÃO/PENDENTE) | Evidência | Observações |
| --- | --- | --- | --- | --- | --- |
| Desktop (PC Chrome/Edge) | Teclado W/A/S/D/Space/Ctrl/Q/E/Shift | Translação/roll/boost conforme mapeamento | PENDENTE | `desktop-input-math`, `desktop-input` PASS (2026-11-22) | Sem navegador real/PointerLock exercitado neste ambiente. |
| Desktop (PC Chrome/Edge) | Mouse PointerLock + Alt free-look | Yaw/pitch curva 1.6; Alt move só câmera (ADR-02) | PENDENTE | Testes automatizados PASS (2026-11-22); código auditado | Requer gesto de usuário e confirmação visual. |
| Desktop (PC Chrome/Edge) | Gamepad padrão simultâneo | Deadzone radial 0.15, curva 1.6 yaw/pitch, botões mapeados | PENDENTE | Testes automatizados PASS (2026-11-22) | Gamepad físico não disponível. |
| Android Flat (Chrome Android) | Joysticks dinâmicos + FIRE/MISSILE/BOOST | Multitouch por `Touch.identifier`, deadzone 0.15, curva 1.6 yaw/pitch, FIRE auto-fire | PENDENTE | `touch-input-math` PASS (2026-11-22) | Sem dispositivo touch real; validar latência/overlay. |
| VR Box (Android + visor + gamepad BT) | Giroscópio relativo YXZ | Move apenas `PilotHeadRig` (ADR-01), sem compass absoluto | PENDENTE | `vrbox-math` PASS (2026-11-22); código ignora `absolute` | DeviceOrientation/WakeLock/Fullscreen variam por device. |
| VR Box (Android + visor + gamepad BT) | Gamepad padrão/BT wizard 3 passos | Mapeamento padrão ou wizard sequencial com persistência localStorage | PENDENTE | `vrbox-wizard`, `gamepad-mapping` PASS (2026-11-22) | Requer gamepad BT físico não-standard. |
| Quest 3 (Quest Browser/WebXR) | Controllers Touch + recenter | Sticks/triggers/squeeze/X mapeados; recenter on-edge; yaw/pitch curva 1.6 | PENDENTE | `quest-xr-mapping` PASS (2026-11-22) | Sessão `immersive-vr` real não exercitada. |
| Quest 3 (Quest Browser/WebXR) | Haptics | Fire 0.2/25ms, missile 0.5/60ms, shield 0.85/150ms; no-op seguro | PENDENTE | Código auditado: `QuestXRInput` | Haptics reais não exercitados. |

### Verificação automatizada M3 (executada em 2026-11-22)

| Comando | Resultado |
| --- | --- |
| `pnpm -r typecheck` | PASS — `server`, `shared` e `client` `Done` (sem erros). |
| `pnpm -r test` | PASS — `shared` 5 arquivos / 46 testes, `server` 1 teste, `client` 15 arquivos / 74 testes. |
| `pnpm -C client build` | PASS — `✓ 26 modules transformed`, `dist/assets/index-Dojbt6sJ.js 583.86 kB │ gzip: 147.38 kB`, `✓ built in 1.30s` (aviso pré-existente de chunk >500 kB do Three.js, não bloqueante). |

> **Limitações:** Giroscópio, WakeLock, PointerLock, Gamepad BT e WebXR haptics variam por
> navegador/dispositivo. Não marcar como validado sem evidência. Qualquer input VR que mova nave
> pela cabeça é bug de spec (ADR-01).

## M4 — Vertical Slice Jogável / Modo Solo (US-11/US-12)

O M4 roda a simulação autoritativa do solo em `shared/src/sim/` dentro de um Web Worker,
exposta ao cliente por `ITransport`/`LocalTransport`. O cliente envia `INPUT_BATCH`
(gerado por `InputManager.getCommand(tick)`) e recebe `SNAPSHOT`/`EVENT`; renderiza com
pools `InstancedMesh` e reproduz áudio procedural 3D via Web Audio/PannerNode.

- **ADR-04:** zero assets externos — geometria/material/áudio procedurais.
- **ADR-06:** sim determinística em passo fixo `1/30s` (`WORLD_CONFIG.FIXED_TICK_RATE`), snapshots 20Hz.
- **US-11 fragmentação:** fonte de verdade `ASTEROID_TIERS` — LARGE→3 MEDIUM, MEDIUM→2 SMALL, SMALL→0.
  O texto literal do US-11 menciona "3 MEDIUM e 2 SMALL" para LARGE; a ambiguidade está documentada e a
  implementação segue `ASTEROID_TIERS`.
- **US-12 ondas/IA:** orçamento `10 + 4*wave + 2*playerCount`; custos LARGE=3, SCOUT=3, SCAVENGER=2, BRUISER=6;
  spawn em casca `[280,420]` a >=120u de jogadores vivos; SCOUT/BRUISER/SCAVENGER com 5-ray cone avoidance.

### Como rodar (solo local)

```bash
pnpm install
pnpm -C client dev
```

Abra `https://localhost:5173?render=FLAT` (ou `VR_BOX` / `QUEST_3`). O modo solo local
não depende do stub WS do `server/` para gameplay; o overlay `WS: ...` do M0 pode
continuar aparecendo como diagnóstico do proxy `/ws`.

### Controles (resumo)

| Plataforma | Controles |
| --- | --- |
| Desktop | WASD/Space/Ctrl/Q/E/Shift, mouse PointerLock, LMB/RMB, Alt free-look temporário (ADR-02), gamepad padrão |
| Android Flat | Joysticks dinâmicos multitouch + FIRE/MISSILE/BOOST |
| VR Box | Giroscópio relativo só no `PilotHeadRig` (ADR-01) + gamepad/wizard BT |
| Quest 3 | Controllers WebXR, recenter, haptics quando disponíveis |

O áudio procedural inicia somente após gesto do usuário (pointerdown/keydown), conforme política de autoplay.

### Checklist manual M4 (validação em dispositivo)

Preenchido apenas com itens realmente executados; o que não foi executado está `PENDENTE`.

| Plataforma | Cenário | FPS observado | Gameplay/HUD/áudio corretos | Sem assets externos | Evidência |
| --- | --- | --- | --- | --- | --- |
| PC (Chrome/Edge, Flat) | `https://localhost:5173?render=FLAT` solo | `PENDENTE` | `PENDENTE` | `PENDENTE` em dispositivo (código auditado: ✅) | Typecheck/test/build PASS (2026-11-22); abertura ao vivo não executada. |
| Android Chrome (Flat) | `https://<IP-LAN>:5173?render=FLAT` | `PENDENTE` | `PENDENTE` | `PENDENTE` em dispositivo (código auditado: ✅) | Não executado; requer CA mkcert instalada no dispositivo. |
| VR Box (Android + visor) | `https://<IP-LAN>:5173?render=VR_BOX` | `PENDENTE` | `PENDENTE` | `PENDENTE` em dispositivo (código auditado: ✅) | Não executado; requer gamepad BT/giroscópio/conforto visual. |
| Quest 3 (WebXR) | `https://<IP-LAN>:5173?render=QUEST_3` | `PENDENTE` | `PENDENTE` | `PENDENTE` em dispositivo (código auditado: ✅) | Não executado; meta 72–90 FPS não medida. |

### Verificação automatizada M4 (executada em 2026-11-22)

| Comando | Resultado |
| --- | --- |
| `pnpm -r typecheck` | PASS — `shared`, `server` e `client` `Done`. |
| `pnpm -r test` | PASS — `shared` 9 arquivos / 91 testes, `server` 1 teste, `client` 18 arquivos / 93 testes. |
| `pnpm -C client build` | PASS — `✓ 56 modules transformed`, worker `local.worker-RJ_Sl2lZ.js 37.79 kB`, bundle `index-CiBgBPQg.js 621.45 kB │ gzip: 157.71 kB`, `✓ built in 1.51s` (aviso pré-existente de chunk >500 kB, não bloqueante). |

> **Limitações M4:** validação real de dispositivo/FPS/conforto/balanceamento fino não executada
> nesta sessão. AudioContext depende de gesto/política do browser e degrada silenciosamente em falha.
> LocalTransport é solo local com seed fixa; multiplayer autoritativo fica para M5.

## Estrutura atual

```
shared/
  src/
    constants.ts   # constantes calibradas do spec (seção 4.1)
    types.ts       # contratos de estado/comando/protocolo (seção 4.3)
    math.ts        # clamp/finite, SpatialHash3D, swept segment/sphere
    physics.ts     # FIXED_DT = 1/30, damping, quatérnio, fronteira magnética, stepShip
    collision.ts   # resolvers swept projétil/asteroide e nave/asteroide + pool de eventos
    sim/
      ids.ts         # IdSeq monotônico determinístico
      spawn.ts       # spawn seguro em casca + fragmentação por ASTEROID_TIERS
      WaveManager.ts # orçamento 10+4*w+2*Nplayers e planejamento de ondas
      EnemyAI.ts     # steering 3D + 5-ray cone avoidance (SCOUT/BRUISER/SCAVENGER)
      GameRoom.ts    # loop fixo 30Hz, snapshots 20Hz, eventos, colisões/pickups/waves
      index.ts       # exports da sim
    index.ts       # exports públicos
  test/            # Vitest: constants, math, physics, collision, smoke, sim/*
client/
  index.html       # página de entrada (#app)
  vite.config.ts   # HTTPS (mkcert), 0.0.0.0:5173 / preview 4173 + proxy /ws em ambos
  src/
    main.ts        # bootstrap GameApp + ?render= + hooks dev + gesto de áudio + status WS M0
    ws-status.ts   # buildWsUrl() — URL WS na mesma origem (wss para https)
    style.css
    core/
      GameApp.ts         # Scene/renderer, loop, input, transport, snapshot apply, pools, áudio
      Starfield.ts       # campo estelar procedural sem assets
      CockpitRig.ts      # hierarquia ShipRoot/CockpitFrame/PilotHeadRig (spec 4.4)
      render-config.ts   # constantes barrel/IPD/DPR/XR
      RenderPipeline.ts  # FLAT / VR_BOX (estéreo + barrel) / QUEST_3 (WebXR)
    net/
      ITransport.ts      # contrato connect/send/onMessage/close
      LocalTransport.ts  # ponte main thread <-> Web Worker
      local.worker.ts    # GameRoom em Worker (30Hz, snapshots 20Hz, eventos)
    entities/
      AsteroidPool.ts    # InstancedMesh por tier (LARGE/MEDIUM/SMALL)
      ProjectilePool.ts  # InstancedMesh de projéteis
      EnemyShip.ts       # InstancedMesh por arquétipo (SCOUT/BRUISER/SCAVENGER)
      ShipPool.ts        # InstancedMesh de naves remotas
      ParticleSystem.ts  # pool fixo de partículas vetoriais (EXPLOSION/HIT/DEATH)
    audio/
      SoundSynth.ts      # Web Audio API + PannerNode, síntese procedural, gesto obrigatório
    input/
      input-math.ts          # clampAxis, deadzone radial 0.15, curva exponencial 1.6
      types.ts               # InputAdapter/InputState/NormalizedAxes
      InputManager.ts        # orquestra adaptador ativo e gera ShipCommand
      desktop-input-math.ts  # mapeamento puro de teclas/botões desktop
      DesktopInput.ts        # teclado/mouse PointerLock/gamepad/Alt free-look (ADR-02)
      TouchInput.ts          # joysticks dinâmicos multitouch + FIRE/MISSILE/BOOST
      VRBoxInput.ts          # DeviceOrientation relativo YXZ, WakeLock/fullscreen, wizard BT
      vrbox-math.ts          # deviceOrientationToQuaternionYXZ
      vrbox-wizard.ts        # wizard sequencial de mapeamento BT (3 passos)
      gamepad-mapping.ts     # persistência/validação de mapeamento em localStorage
      QuestXRInput.ts        # WebXR XRInputSource, recenter, haptics seguros
      quest-xr-mapping.ts    # mapeamento puro Quest Touch (deadzone/curva 1.6)
    ui/
      hud-math.ts        # helpers puros: radar/pip/throttle
      DiegeticHUD.ts     # CanvasTexture 512x256, dirty-flag 15Hz, radar
      OffscreenPips.ts   # pool de 16 setas radiais (sem alocação por frame)
  test/
    ws-status.test.ts          # buildWsUrl (https → wss, http → ws)
    render-config.test.ts      # constantes da spec + limites de IPD
    hud-math.test.ts           # projeção radar/pip + throttle 15Hz
    offscreen-pips.test.ts     # pips dentro/fora do FOV
    diegetic-hud.test.ts       # sweep 15Hz com estado estático / idle com dt=0
    render-pipeline-xr.test.ts # botão Enter VR, sessão e falha recuperável (XR stubado)
    input-math.test.ts         # deadzone radial, curva, clamp
    input-manager.test.ts      # merge/prioridade/reset/dispose
    desktop-input-math.test.ts # mapeamento puro teclado/mouse
    desktop-input.test.ts      # comportamento do adapter desktop
    touch-input-math.test.ts   # normalização/atribuição de toques
    gamepad-mapping.test.ts    # persistência/validação de mapeamento
    vrbox-math.test.ts         # quaternion YXZ e calibração de eixo
    vrbox-wizard.test.ts       # wizard de mapeamento BT
    quest-xr-mapping.test.ts   # mapeamento puro Quest XR
    net/local-transport.test.ts    # contrato LocalTransport/Worker mockado
    entities/asteroid-pool.test.ts # mapeamento/capacidade de instâncias de asteroides
    audio/sound-synth.test.ts      # AudioContext mock, gesto/resume, playEvent seguro
  vitest.config.ts
server/
  package.json     # ws + tsx (scripts dev/test)
  tsconfig.json
  src/
    index.ts       # entry point: inicia o stub na porta 8080
    ws-server.ts   # createWebSocketServer(): hello/pong + handlers de erro
  test/ws-server.test.ts  # node:test: hello on connect, pong on ping (porta efêmera)
```

`shared/` é isomórfico: não importa `three`, `window`, `document`, `fs` ou `crypto`, e não
usa aleatoriedade nem relógio de parede. A física roda em passos fixos de 1/30 s (ADR-06) e
não aloca objetos no hot-loop (buffers pré-alocados reutilizados a cada tick).

## Documentação

- Spec: `Documento Oficial de Projeto.pdf` (v3.0)
- Plano da Fase 1: `docs/superpowers/plans/2026-11-22-fase-1-fisica-testes.md`
- Design e verificação da Fase 1: `docs/superpowers/specs/2026-11-22-fase-1-fisica-testes-design.md`
- Plano M0 (cliente HTTPS/WS): `docs/superpowers/plans/2026-11-22-fase-0-client-https-ws.md`
- Design e verificação M0 (HTTPS/WS + checklist US-02): `docs/superpowers/specs/2026-11-22-fase-0-client-https-ws-design.md`
- SDD/ledger M0: `.superpowers/sdd/2026-11-22-fase-0-client-https-ws/`
- Plano M2 (render/cockpit/HUD): `docs/superpowers/plans/2026-11-22-m2-render-cockpit-hud.md`
- Design e verificação M2 (checklist Flat/VR Box/Quest 3): `docs/superpowers/specs/2026-11-22-m2-render-cockpit-hud-design.md`
- SDD/ledger M2: `.superpowers/sdd/2026-11-22-m2-render-cockpit-hud/`
- Plano M3 (inputs cross-platform): `docs/superpowers/plans/2026-11-22-m3-inputs-cross-platform.md`
- Design e verificação M3 (checklist Desktop/Android Flat/VR Box/Quest 3): `docs/superpowers/specs/2026-11-22-m3-inputs-cross-platform-design.md`
- SDD/ledger M3: `.superpowers/sdd/2026-11-22-m3-inputs-cross-platform/`
- Plano M4 (solo vertical slice): `docs/superpowers/plans/2026-11-22-m4-solo-vertical-slice.md`
- Design e verificação M4 (LocalTransport/Worker, fragmentação, ondas/IA, áudio, checklist): `docs/superpowers/specs/2026-11-22-m4-solo-vertical-slice-design.md`
- SDD/ledger M4: `.superpowers/sdd/2026-11-22-m4-solo-vertical-slice/`

## Próximos passos

- M0 / US-02: validar a abertura em Android Chrome e Meta Quest Browser sem alertas
  de certificado (requer desktop com diálogo de confiança da CA disponível).
- M2 / US-05..07: validação em dispositivo do checklist acima (FPS, estereoscopia/barrel,
  HUD/pips, ausência de assets) — tudo `PENDENTE` neste ambiente.
- M3 / US-08..10: validação em dispositivo do checklist M3 (PointerLock, touch multitouch,
  giroscópio/WakeLock, gamepad BT wizard, WebXR controllers/haptics) — tudo `PENDENTE`
  neste ambiente. Não marcar validado sem evidência; qualquer input VR que mova nave pela
  cabeça é bug de spec (ADR-01).
- M4 / US-11..12: validação em dispositivo do checklist M4 (PC/Android/VR Box/Quest 3),
  FPS real, conforto, áudio após gesto e balanceamento fino — tudo `PENDENTE` neste ambiente.
  Ambiguidade US-11 documentada: implementação segue `ASTEROID_TIERS`.
- M5: evoluir LocalTransport/Worker para servidor autoritativo multiplayer, reaproveitando
  a sim isomórfica em `shared/src/sim`.
