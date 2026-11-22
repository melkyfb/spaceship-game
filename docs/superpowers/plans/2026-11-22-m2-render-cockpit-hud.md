# M2 — Render Tri-Modal, Cockpit e HUD Diegético (US-05/06/07) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o cockpit 3D procedural, pipeline de renderização tri-modal (Flat, VR Box estéreo com distorção em barril, Quest 3 WebXR), e HUD diegético com radar 3D e indicadores off-screen, sem assets externos.

**Architecture:** `client/` ganha Three.js e módulos separados por responsabilidade: `core/` (GameApp bootstrap, RenderPipeline, CockpitRig), `ui/` (DiegeticHUD, OffscreenPips), e utilitários de projeção/radar testáveis em Vitest (node). Renderização usa loops `requestAnimationFrame`/`setAnimationLoop` sem alocações por frame; HUD usa `CanvasTexture` com dirty-flag limitado a 15Hz.

**Tech Stack:** TypeScript 5.x strict, Vite, Three.js r170+, WebXR Device API, Vitest, pnpm workspaces.

**Spec:** `Documento Oficial de Projeto.pdf` (raiz), v3.0 — seções 1.4 (SLA), 2 (ADR-01/02/04), 3.2 (estrutura), 3.3 (padrões), 4.4 (CockpitRig, RenderPipeline, HUD), 5.2 (US-05/06/07). Planos anteriores: Fase 1 e M0.

## Global Constraints

- **ADR-04:** Zero assets externos; sem pós-processamento pesado (`UnrealBloomPass`). Brilho por Fresnel/emissivos.
- **ADR-01:** Em VR, cabeça controla apenas câmera dentro do `PilotHeadRig`; nave/mira controladas por controles manuais (inputs completos chegam em M3 - aqui apenas estruturar rig corretamente).
- **ADR-02:** Paridade tática: Radar 3D diegético no console central e Offscreen Pips ao redor da retícula.
- **Performance:** 72–90 FPS Quest 3, 60 FPS Android Flat/VR Box. Zero alocações no hot-loop render/tick.
- **HUD dirty-flag:** `CanvasTexture.needsUpdate = true` apenas quando valor exibido muda, teto 15Hz.
- **TypeScript:** `strict: true`, `noUncheckedIndexedAccess: true`, ES2022.
- **YAGNI:** Sem gameplay completo, sem netcode, sem inputs completos M3, sem inimigos reais; usar dados mock/simulados mínimos para validar HUD/radar/pips.

## Review Focus

- **Alocações por frame:** `new Vector3/Quaternion/Matrix4/Euler` ou arrays em render/HUD update quebram SLA; usar scratch buffers/module-scope.
- **HUD atualizando acima de 15Hz:** `needsUpdate` a cada frame em mobile/Quest é custo alto; dirty-flag e throttle devem ser verificáveis.
- **VR Box distorção/barrel shader incorreta:** shader Brown-Conrady com k1/k2 errados ou IPD aplicado errado causa desconforto visual; valores spec: k1=0.22, k2=0.24, IPD 56-74mm.
- **WebXR reference space/orientação incorreta:** Quest 3 deve usar `immersive-vr` + `local`; recenter X deve resetar yaw e posição relativa ao assento do piloto.
- **Pips/radar com coordenadas erradas:** ameaças atrás/frente/laterais devem mapear corretamente para indicador radial e radar 3D; erros confundem o jogador e quebram ADR-02.

---
## File Structure

### Criar
- `client/src/core/GameApp.ts` — bootstrap da cena, câmera, renderer, loop, estado de modo.
- `client/src/core/RenderPipeline.ts` — Flat, VRBoxStereoBarrel, WebXR; resize, DPR<=2.
- `client/src/core/CockpitRig.ts` — hierarquia ShipRoot/CockpitFrame/HUD/Crosshair/Muzzle/PilotHeadRig.
- `client/src/core/Starfield.ts` — campo estelar procedural (Points/BufferGeometry), sem assets.
- `client/src/ui/DiegeticHUD.ts` — CanvasTexture 512x256, dirty-flag 15Hz, shield/energy/score/wave/radar.
- `client/src/ui/OffscreenPips.ts` — cálculo/projeção de pips radiais para ameaças fora do FOV.
- `client/src/ui/hud-math.ts` — funções puras testáveis: clamp, radar projection, pip angle/visibility.
- `client/test/hud-math.test.ts` — testes Vitest para radar/pip/dirty logic helpers.
- `client/test/render-config.test.ts` — testes de constantes/config de render (DPR, barrel k1/k2, IPD bounds/clamp). FOV não é constantizada nem testada nesta entrega (fica na câmera do `CockpitRig`).
- `docs/superpowers/specs/2026-11-22-m2-render-cockpit-hud-design.md` — evidências/limitações de validação.

### Modificar
- `client/package.json` — adicionar `three` e `@types/three` (ou tipos incluídos conforme versão).
- `client/src/main.ts` — substituir placeholder M0 por bootstrap do `GameApp` mantendo diagnóstico WS opcional.
- `README.md` — instruções M2, modos de render, limitações de validação VR.
- **Não alterados na entrega real:** `client/index.html` e `client/src/style.css` (já prontos no M0 e reutilizados como estão).

### Responsabilidades
- `hud-math.ts`: matemática pura, sem Three/WebXR/DOM.
- `DiegeticHUD.ts`: desenho 2D no canvas e atualização de textura; consome math helpers.
- `OffscreenPips.ts`: atualiza objetos Three para pips; sem alocação por frame.
- `RenderPipeline.ts`: seleciona/ativa modo de saída; não contém lógica de HUD.
- `CockpitRig.ts`: monta hierarquia e materiais procedurais; não faz networking.

---
### Task 1: Dependências Three.js e bootstrap de cena

**Files:**
- Modify: `client/package.json`
- Modify: `client/src/main.ts`
- Create: `client/src/core/GameApp.ts`
- Create: `client/src/core/Starfield.ts`
- Test: `pnpm -C client typecheck`, `pnpm -C client build`

**Interfaces:**
- Consumes: M0 client scaffold, Vite.
- Produces:
  - `class GameApp { constructor(container: HTMLElement); start(): void; dispose(): void }`
  - `createStarfield(count: number): THREE.Points` (ou classe) com geometria procedural.

- [ ] **Step 1: Adicionar Three.js**

Adicionar `three` em dependencies e tipos compatíveis em devDependencies se necessário. Rodar `pnpm install`.

- [ ] **Step 2: Implementar `GameApp` mínimo**

`GameApp` cria `Scene`, `PerspectiveCamera(fov:75, near:0.05, far:1500)`, `WebGLRenderer({ antialias: true, alpha: false })`, seta `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))`, adiciona luz ambiente/emissivos simples conforme necessário, e inicia loop. Sem alocações por frame.

- [ ] **Step 3: Adicionar `Starfield` procedural**

Criar `BufferGeometry` com posições aleatórias determinísticas (seed fixa local) em esfera/casca grande; `PointsMaterial` simples. Sem texturas externas.

- [ ] **Step 4: Integrar em `main.ts`**

Substituir placeholder por `new GameApp(container).start()`. Manter build/typecheck limpos.

- [ ] **Step 5: Verificar e commit**

Run: `pnpm -C client typecheck && pnpm -C client build`
Expected: PASS.

```bash
git add client/package.json client/src/main.ts client/src/core pnpm-lock.yaml
git commit -m "feat(client): bootstrap three.js scene and procedural starfield"
```

---
### Task 2: CockpitRig e retícula conforme hierarquia do spec (US-05)

**Files:**
- Create: `client/src/core/CockpitRig.ts`
- Modify: `client/src/core/GameApp.ts`
- Test: `pnpm -C client typecheck`, `pnpm -C client build`

**Interfaces:**
- Consumes: Three.js scene/camera.
- Produces:
  - `class CockpitRig { readonly root: THREE.Group; readonly camera: THREE.PerspectiveCamera; readonly hudMesh: THREE.Mesh; readonly crosshairGroup: THREE.Group; update(dt: number): void }`
  - Hierarquia com nomes/posições do spec 4.4.

- [ ] **Step 1: Montar hierarquia do spec**

Criar grupos/meshes com a estrutura:
```text
ShipRoot
├── CockpitFrame
│   ├── CanopyStruts (LineSegments)
│   ├── DiegeticHUDMesh (Plane/Mesh, console inferior 35°)
│   └── CrosshairGroup (z: -60)
│       ├── MainReticle
│       ├── LeadIndicator
│       └── OffscreenPips (container)
├── MuzzleLeft [-1.2,-0.4,-2.5]
├── MuzzleRight [1.2,-0.4,-2.5]
└── PilotHeadRig [0,0.35,0.4]
    └── Camera (fov75 near0.05 far1500)
        └── ComfortVignette (z:-0.15 renderOrder 999, inicialmente invisível/baixo)
```

- [ ] **Step 2: Materiais procedurais**

Usar `MeshBasicMaterial`/`LineBasicMaterial`/`ShaderMaterial` simples com cores emissivas/Fresnel leve conforme ADR-04. Sem texturas externas.

- [ ] **Step 3: Integrar no `GameApp`**

`GameApp` instancia `CockpitRig`, adiciona `rig.root` à cena e usa `rig.camera` como câmera ativa.

- [ ] **Step 4: Verificar e commit**

Run: `pnpm -C client typecheck && pnpm -C client build`
Expected: PASS.

```bash
git add client/src/core/CockpitRig.ts client/src/core/GameApp.ts
git commit -m "feat(client): add procedural cockpit rig and reticle hierarchy"
```

---
### Task 3: RenderPipeline tri-modal (US-06)

**Files:**
- Create: `client/src/core/RenderPipeline.ts`
- Modify: `client/src/core/GameApp.ts`
- Modify: `client/src/main.ts` (seleção de modo por query/localStorage simples)
- Test: `client/test/render-config.test.ts`

**Interfaces:**
- Consumes: renderer, scene, camera, cockpit rig.
- Produces:
  - `type RenderMode = 'FLAT' | 'VR_BOX' | 'QUEST_3'`
  - `class RenderPipeline { setMode(mode: RenderMode): Promise<void>; render(scene, camera): void; resize(w,h): void; dispose(): void }`

- [ ] **Step 1: Escrever teste falhando de config/render constants**

```ts
import { describe, expect, it } from 'vitest'
import { BARREL_K1, BARREL_K2, IPD_MAX_MM, IPD_MIN_MM, MAX_DPR } from '../src/core/render-config'

it('matches spec barrel and dpr constants', () => {
  expect(BARREL_K1).toBe(0.22)
  expect(BARREL_K2).toBe(0.24)
  expect(IPD_MIN_MM).toBe(56)
  expect(IPD_MAX_MM).toBe(74)
  expect(MAX_DPR).toBe(2)
})
```

- [ ] **Step 2: Implementar Flat pipeline**

Flat: `renderer.xr.enabled=false`, `setPixelRatio(min(devicePixelRatio,2))`, render normal. Resize atualiza aspect/camera.

- [ ] **Step 3: Implementar VR_BOX estéreo + barrel shader**

Criar dois render targets (eye L/R), câmeras/offsets por IPD (default 64mm), compor com shader full-screen Brown-Conrady (`k1=0.22,k2=0.24`). IPD ajustável por teclas/gamepad stub (D-Pad) limitado 56-74mm; persistência pode ser localStorage simples.

- [ ] **Step 4: Implementar QUEST_3 WebXR**

Ativar `renderer.xr.enabled = true` ao entrar em modo. Solicitar sessão `immersive-vr` com `optionalFeatures` apropriados. `referenceSpaceType` local. Adicionar botão UI "Enter VR" (DOM overlay simples) quando disponível. Botão X/recenter: hook/placeholder documentado se input Quest completo ficar para M3; estruturar método `recenter()` que reseta yaw/posição do PilotHeadRig/camera offset.

- [ ] **Step 5: Testar, verificar e commit**

Run: `pnpm -C client test -- render-config.test.ts`
Expected: PASS.

Run: `pnpm -C client typecheck && pnpm -C client build`
Expected: PASS.

```bash
git add client/src/core client/src/main.ts client/test/render-config.test.ts
git commit -m "feat(client): add flat vr-box and webxr render pipelines"
```

---
### Task 4: HUD diegético, radar 3D e offscreen pips (US-07)

**Files:**
- Create: `client/src/ui/hud-math.ts`
- Create: `client/src/ui/DiegeticHUD.ts`
- Create: `client/src/ui/OffscreenPips.ts`
- Modify: `client/src/core/CockpitRig.ts`
- Modify: `client/src/core/GameApp.ts`
- Test: `client/test/hud-math.test.ts`

**Interfaces:**
- Consumes: CockpitRig HUD mesh e CrosshairGroup; dados mock de estado (shield, energy, score, wave, contacts).
- Produces:
  - `projectToRadar(localPos, radarRadius): { x: number; y: number; depth: number }`
  - `computePip(angle, visible): { show: boolean; x: number; y: number; rot: number }` (ou assinatura equivalente pura)
  - `class DiegeticHUD { update(state, dt): void; dispose(): void }` com dirty-flag 15Hz.
  - `class OffscreenPips { update(contacts, camera, dt): void }` sem alocações por frame.

- [ ] **Step 1: Escrever testes falhando para hud-math**

```ts
import { describe, expect, it } from 'vitest'
import { projectToRadar, shouldUpdateHud } from '../src/ui/hud-math'

it('projects radar points within radius', () => {
  const p = projectToRadar({ x: 100, y: 0, z: 0 }, 50)
  expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(50)
})

it('throttles hud updates to 15hz', () => {
  expect(shouldUpdateHud(0, 1 / 60, 1 / 15)).toBe(false)
  expect(shouldUpdateHud(1 / 15, 0, 1 / 15)).toBe(true)
})
```

- [ ] **Step 2: Implementar hud-math puro**

Funções puras para projeção radar, clamp, normalização angular de pips, e throttle/dirty check. Sem Three/DOM.

- [ ] **Step 3: Implementar `DiegeticHUD`**

Canvas 512x256, `CanvasTexture`, `mesh.material.map = texture`. Desenhar shield, energy, score, wave e radar 3D simplificado. Só redesenhar e setar `needsUpdate = true` quando dirty e intervalo >= 1/15s.

- [ ] **Step 4: Implementar `OffscreenPips`**

Calcular posição relativa de ameaça no espaço da câmera; se fora do FOV, posicionar seta radial ao redor da retícula. Usar pool fixo de meshes/sprites/lines; atualizar transforms existentes, sem criar objetos por frame.

- [ ] **Step 5: Integrar dados mock no `GameApp`**

Fornecer estado mock (shield/energy/score/wave e alguns contacts orbitando) para validar visualmente HUD/radar/pips. Manter isolado para substituição futura por estado real.

- [ ] **Step 6: Verificar e commit**

Run: `pnpm -C client test`
Expected: PASS.

Run: `pnpm -C client typecheck && pnpm -C client build`
Expected: PASS.

```bash
git add client/src/ui client/src/core client/test/hud-math.test.ts client/src/main.ts
git commit -m "feat(client): add diegetic hud radar and offscreen pips"
```

---
### Task 5: Verificação M2, docs e checklist de dispositivo

**Files:**
- Create: `docs/superpowers/specs/2026-11-22-m2-render-cockpit-hud-design.md`
- Modify: `README.md`
- Test: comandos de verificação + checklist manual

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: evidência de checks automatizados e checklist honesto para Flat/VR Box/Quest 3.

- [ ] **Step 1: Rodar verificação automatizada**

Run: `pnpm -r typecheck`
Expected: PASS.

Run: `pnpm -r test`
Expected: PASS.

Run: `pnpm -C client build`
Expected: PASS.

- [ ] **Step 2: Criar doc de design/verificação M2**

Incluir: hierarquia CockpitRig implementada, modos de render, constantes barrel/IPD/DPR, dirty-flag 15Hz, dados mock usados, limitações (inputs M3 ausentes, validação Quest/VR Box pode estar pendente).

- [ ] **Step 3: Atualizar README com checklist M2**

Tabela: Modo (Flat/VR Box/Quest 3), URL/dispositivo, FPS observado, HUD atualiza corretamente, pips/radar corretos, sem assets externos, evidência, PENDENTE se não executado.

- [ ] **Step 4: Commit**

```bash
git add docs README.md client
git commit -m "docs: add M2 render cockpit hud verification checklist"
```

---
## Notas de Execução

- **Inputs M3 ausentes:** Quest recenter por botão X e IPD por D-Pad podem ter hooks/teclas temporárias de dev; documentar claramente que mapeamento final vem em M3.
- **Validação de dispositivo:** não marcar Quest 3/VR Box/Android como validado sem execução real. Registrar PENDENTE.
- **Performance:** revisar hot paths por alocações (`new`, arrays temporários) antes de fechar M2.
- **Próxima fase após M2:** M3 (Inputs Desktop/Touch/VRBox/QuestXR) e depois M4 (loop solo Worker + IA/ondas).

## Ajustes da revisão final (fix wave)

Entrega efetiva após a revisão de toda a branch (detalhes em
`.superpowers/sdd/2026-11-22-m2-render-cockpit-hud/task-final-fix-report.md`):

- O sweep do radar é fonte de dirty própria: o HUD redesenha no teto de 15Hz mesmo
  com estado estático. Coberto por `client/test/diegetic-hud.test.ts`.
- O fluxo "Enter VR" passou a expor falha na UI (texto do botão + `getXrStatus()`),
  com `navigator.xr` injetável para testes. Coberto por
  `client/test/render-pipeline-xr.test.ts`.
- Os render targets de olho só são redimensionados quando o tamanho muda.
- O hook de dev `keydown` de `main.ts` é removido no `beforeunload`.