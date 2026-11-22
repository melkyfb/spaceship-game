# M3 — Controles Cross-Platform (US-08/09/10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o sistema de input cross-platform com normalização comum, InputManager e quatro adaptadores (Desktop, Touch, VR Box, Quest XR), produzindo comandos de nave consistentes para PC, Android Flat, VR Box e Meta Quest 3.

**Architecture:** `client/src/input/` conterá helpers puros testáveis (`input-math.ts`) para deadzone/curva/clamp, um `InputManager` que acumula estado dos adaptadores e emite `ShipCommand`-like snapshots, e adaptadores por plataforma. Adaptadores são finos sobre APIs de browser/WebXR; a lógica de normalização permanece nos helpers puros. Integração inicial no `GameApp` apenas para capturar/mostrar estado de input e manter hooks prontos para M4.

**Tech Stack:** TypeScript 5.x strict, Vite, Vitest, Browser APIs (Pointer Lock, Gamepad, Touch Events, DeviceOrientation, Screen Orientation/WakeLock, WebXR XRInputSource/Gamepad haptics), tipos compartilhados de `@asteroids/shared`.

**Spec:** `Documento Oficial de Projeto.pdf` (raiz), v3.0 — seções 2 (ADR-01/02), 4.3 (ShipCommand), 4.4 (Regras dos 4 Adaptadores de Input), 5.2 (US-08/09/10). Planos anteriores: Fase 1, M0, M2.

## Global Constraints

- **ADR-01:** Em VR, cabeça controla apenas câmera dentro do `PilotHeadRig`; nave/mira controladas por controles manuais. Adaptadores VR não devem mover nave pela orientação da cabeça.
- **ADR-02:** Desktop deve suportar Alt para Free-Look temporário no cockpit (sem acoplar rotação da nave à câmera).
- **Normalização global:** Deadzone radial de 0.15 com reescalonamento linear para [0,1] e curva exponencial `v_out = sign(v) * |v|^1.6` para yaw e pitch.
- **TypeScript:** `strict: true`, `noUncheckedIndexedAccess: true`, ES2022.
- **Performance:** Zero alocações desnecessárias no hot path de polling/input; reaproveitar objetos/scratch onde possível.
- **YAGNI:** Não implementar física de gameplay completa/M4; apenas produzir e expor comandos/input state. Não implementar rede.
- **Validação de dispositivo:** testes automatizados para helpers puros; validações WebXR/gyro/touch/gamepad em dispositivo real podem ficar PENDENTE com checklist honesto.

## Review Focus

- **Deadzone/curva incorreta:** deadzone radial aplicada errado ou curva aplicada em eixos errados altera sensibilidade e torna controle instável; yaw/pitch devem usar `|v|^1.6`.
- **Acoplamento cabeça-nave em VR:** VRBox/QuestXR não podem usar orientação da cabeça para yaw/pitch da nave; apenas câmera.
- **Touch identifiers vazando:** joysticks virtuais devem ser isolados por `Touch.identifier`; multitouch cruzado quebra controle mobile.
- **PointerLock/Fullscreen/WakeLock sem tratamento de falha:** APIs de browser podem falhar ou ser negadas; UI/estado deve permanecer recuperável.
- **Mapeamento Gamepad BT genérico:** controles não-standard precisam de wizard/mapeamento persistido; não assumir layout padrão sempre.

---
## File Structure

### Criar
- `client/src/input/input-math.ts` — funções puras: clamp, radial deadzone, response curve, normalize axis.
- `client/src/input/InputManager.ts` — orquestra adaptadores, mantém estado atual, gera `ShipCommand` snapshot.
- `client/src/input/types.ts` — tipos internos de input (InputAdapter, InputState, NormalizedAxes).
- `client/src/input/DesktopInput.ts` — teclado/mouse pointer lock/gamepad/Alt free-look.
- `client/src/input/TouchInput.ts` — joysticks virtuais dinâmicos multi-touch + botões ação.
- `client/src/input/VRBoxInput.ts` — giroscópio relativo, wake lock, fullscreen/orientation, wizard gamepad BT.
- `client/src/input/QuestXRInput.ts` — WebXR XRInputSource, recenter, haptics.
- `client/src/input/gamepad-mapping.ts` — persistência/carregamento de mapeamento BT genérico.
- `client/test/input-math.test.ts` — testes deadzone/curva/clamp.
- `client/test/input-manager.test.ts` — testes de merge/prioridade/reset de estado.
- `client/test/gamepad-mapping.test.ts` — testes de persistência/validação de mapeamento.
- `docs/superpowers/specs/2026-11-22-m3-inputs-cross-platform-design.md` — verificação e pendências de dispositivo.

### Modificar
- `client/src/core/GameApp.ts` — instanciar `InputManager`, plugar adaptador apropriado, expor estado de input para debug/HUD futuro.
- `client/src/main.ts` — wiring básico de seleção de modo/input e cleanup.
- `client/src/style.css` / `client/index.html` — overlays mínimos para touch controls / status de input (se necessário).
- `README.md` — controles e checklist de validação por plataforma.

### Responsabilidades
- `input-math.ts`: puro, sem DOM/WebXR.
- `InputManager.ts`: estado e composição; sem listeners DOM diretos.
- Adaptadores: binding/teardown de APIs de plataforma; chamam InputManager/helpers.
- `GameApp.ts`: apenas integração/ciclo de vida.

---
### Task 1: Helpers de normalização e InputManager (base US-08/09/10)

**Files:**
- Create: `client/src/input/input-math.ts`
- Create: `client/src/input/types.ts`
- Create: `client/src/input/InputManager.ts`
- Test: `client/test/input-math.test.ts`
- Test: `client/test/input-manager.test.ts`

**Interfaces:**
- Consumes: `ShipCommand` shape/fields de `@asteroids/shared` (referência de contrato).
- Produces:
  - `applyRadialDeadzone(x: number, y: number, deadzone?: number): { x: number; y: number }`
  - `applyResponseCurve(value: number, exponent?: number): number` (default 1.6)
  - `clampAxis(value: number): number`
  - `class InputManager { setAdapter(adapter): void; update(dt: number): void; getCommand(tick: number): ShipCommand; dispose(): void }`

- [ ] **Step 1: Escrever testes falhando para deadzone/curva**

```ts
import { describe, expect, it } from 'vitest'
import { applyRadialDeadzone, applyResponseCurve } from '../src/input/input-math'

it('applies radial deadzone and rescales to [0,1]', () => {
  expect(applyRadialDeadzone(0.1, 0.0, 0.15)).toEqual({ x: 0, y: 0 })
  const out = applyRadialDeadzone(1, 0, 0.15)
  expect(out.x).toBeCloseTo(1)
})

it('applies exponential response curve for yaw/pitch', () => {
  expect(applyResponseCurve(0.5, 1.6)).toBeCloseTo(Math.sign(0.5) * Math.pow(0.5, 1.6))
})
```

- [ ] **Step 2: Rodar testes para ver falha**

Run: `pnpm -C client test -- input-math.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar input-math e InputManager**

`input-math.ts`: clamp [-1,1], deadzone radial 0.15 com reescalonamento linear, curva `sign(v)*|v|^1.6`. `InputManager`: mantém estado normalizado (thrust/strafe/yaw/pitch/roll/firePrimary/fireSecondary/boost), gera `ShipCommand` com tick passado, reseta/limpa no dispose. Sem DOM.

- [ ] **Step 4: Rodar testes**

Run: `pnpm -C client test -- input-math.test.ts input-manager.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/input/input-math.ts client/src/input/types.ts client/src/input/InputManager.ts client/test/input-math.test.ts client/test/input-manager.test.ts
git commit -m "feat(input): add normalized input math and input manager"
```

---
### Task 2: DesktopInput — Teclado/Mouse/Gamepad/Free-Look (US-08)

**Files:**
- Create: `client/src/input/DesktopInput.ts`
- Modify: `client/src/input/InputManager.ts` (apenas se necessário para interface de adapter)
- Modify: `client/src/core/GameApp.ts`
- Test: `client/test/input-manager.test.ts` (extensão) ou `client/test/desktop-input-math.test.ts` para mapeamentos puros

**Interfaces:**
- Consumes: `InputManager`, helpers de `input-math`.
- Produces: `class DesktopInput { attach(target: HTMLElement): void; detach(): void; poll(gamepad?): void }` (assinatura exata conforme necessidade).

- [ ] **Step 1: Escrever teste falhando para mapeamento puro**

Extrair mapeamento de teclas/botões para uma função pura (ex.: `applyKeyboardState`/`mapDesktopButtons`) e testar: W/S thrust, A/D strafeX, Space/Ctrl strafeY, Q/E roll, Shift boost, LMB/RMB armas, Alt free-look flag.

- [ ] **Step 2: Implementar DesktopInput**

PointerLock no mouse para yaw/pitch; aplicar curva exponencial 1.6 em yaw/pitch. Alt ativa modo Free-Look temporário (flag exposta ao GameApp/câmera, sem alterar comando de nave). Suportar Gamepad padrão simultâneo quando disponível. Tratar perda de pointer lock e blur de janela resetando eixos.

- [ ] **Step 3: Integrar no GameApp**

Permitir ativar DesktopInput em modo FLAT/PC. Não acoplar free-look à rotação da nave.

- [ ] **Step 4: Verificar e commit**

Run: `pnpm -C client test -- input-math.test.ts input-manager.test.ts`
Expected: PASS.

Run: `pnpm -C client typecheck`
Expected: PASS.

```bash
git add client/src/input/DesktopInput.ts client/src/input/InputManager.ts client/src/core/GameApp.ts client/test
git commit -m "feat(input): add desktop keyboard mouse and gamepad adapter"
```

---
### Task 3: TouchInput — joysticks virtuais dinâmicos (US-09)

**Files:**
- Create: `client/src/input/TouchInput.ts`
- Modify: `client/src/style.css`
- Modify: `client/index.html` (se container necessário)
- Modify: `client/src/core/GameApp.ts`
- Test: `client/test/touch-input-math.test.ts`

**Interfaces:**
- Consumes: `InputManager`, `applyRadialDeadzone`, `applyResponseCurve`.
- Produces: `class TouchInput { attach(el: HTMLElement): void; detach(): void }` com isolamento por `Touch.identifier`.

- [ ] **Step 1: Escrever testes falhando para lógica de joystick**

Testar função pura que, dado centro e posição do toque, retorna eixo normalizado com deadzone; e função que atribui toques a lado esquerdo/direito sem cruzar identificadores.

- [ ] **Step 2: Implementar TouchInput**

Dois joysticks virtuais flutuantes dinâmicos: esquerda translação (thrust/strafe), direita rotação (yaw/pitch). Botões dedicados FIRE (auto-fire ao segurar), MISSILE, BOOST. Usar `touch-action: none` e `preventDefault` onde apropriado. Resetar estado no `touchend/cancel`.

- [ ] **Step 3: Integrar overlay no GameApp**

Ativar em modo ANDROID_FLAT/mobile. Garantir que não interfira com desktop.

- [ ] **Step 4: Verificar e commit**

Run: `pnpm -C client test -- touch-input-math.test.ts input-math.test.ts`
Expected: PASS.

Run: `pnpm -C client typecheck`
Expected: PASS.

```bash
git add client/src/input/TouchInput.ts client/src/core/GameApp.ts client/src/style.css client/index.html client/test/touch-input-math.test.ts
git commit -m "feat(input): add dynamic multitouch joystick adapter"
```

---
### Task 4: VRBoxInput — giroscópio, wake lock, wizard BT (US-10 parte VR Box)

**Files:**
- Create: `client/src/input/VRBoxInput.ts`
- Create: `client/src/input/gamepad-mapping.ts`
- Modify: `client/src/core/GameApp.ts`
- Test: `client/test/gamepad-mapping.test.ts`
- Test: `client/test/vrbox-math.test.ts`

**Interfaces:**
- Consumes: `InputManager`, helpers; browser APIs DeviceOrientation/ScreenOrientation/WakeLock/Gamepad.
- Produces:
  - `class VRBoxInput { attach(): Promise<void>; detach(): Promise<void> }`
  - `loadGamepadMapping()/saveGamepadMapping()/isMappingComplete()` em `gamepad-mapping.ts`.

- [ ] **Step 1: Escrever testes falhando para mapeamento e matemática pura**

Testar persistência do mapping em storage (mock localStorage) e funções puras de conversão/calibração de eixos (sem DOM). Não testar DeviceOrientation real.

- [ ] **Step 2: Implementar VRBoxInput**

Ativar Fullscreen, `screen.orientation.lock('landscape')` quando suportado, WakeLock. Usar `deviceorientation` relativo (sem magnetômetro/compass absoluto) convertido via Euler 'YXZ' para quatérnio sem gimbal lock; aplicar à câmera/head rig apenas, não à nave. Wizard de 3 passos para gamepad BT não-standard (`mapping !== 'standard'`) salvo em localStorage.

- [ ] **Step 3: Integrar e tratar falhas**

Se WakeLock/orientation lock falhar, expor status e continuar em modo degradado. Não acoplar orientação da cabeça à nave (ADR-01).

- [ ] **Step 4: Verificar e commit**

Run: `pnpm -C client test -- gamepad-mapping.test.ts vrbox-math.test.ts input-math.test.ts`
Expected: PASS.

Run: `pnpm -C client typecheck`
Expected: PASS.

```bash
git add client/src/input/VRBoxInput.ts client/src/input/gamepad-mapping.ts client/src/core/GameApp.ts client/test/gamepad-mapping.test.ts client/test/vrbox-math.test.ts
git commit -m "feat(input): add vr box gyro and bluetooth gamepad adapter"
```

---
### Task 5: QuestXRInput — WebXR controllers, recenter, haptics (US-10 parte Quest 3)

**Files:**
- Create: `client/src/input/QuestXRInput.ts`
- Modify: `client/src/core/GameApp.ts`
- Modify: `client/src/core/RenderPipeline.ts` (apenas se necessário para expor sessão/recenter hook limpo)
- Test: `client/test/quest-xr-mapping.test.ts`

**Interfaces:**
- Consumes: WebXR session/input sources, `InputManager`, recenter hook do RenderPipeline/GameApp.
- Produces: `class QuestXRInput { attach(session: XRSession): void; detach(): void; update(frame?: XRFrame): void }`

- [ ] **Step 1: Escrever testes falhando para mapeamento puro de gamepad XR**

Extrair mapeamento de botões/eixos Quest Touch para função pura e testar: left stick translação, right stick yaw/pitch, triggers fire/míssil, boost, recenter, strafeY. Testar que yaw/pitch usam curva 1.6.

- [ ] **Step 2: Implementar QuestXRInput**

Mapear XRInputSource gamepads: left = translação/boost/strafeY/recenter; right = rotação/tiro/míssil. Aplicar deadzone/curva. Disparar pulsos hápticos: fire (0.2,25ms), míssil (0.5,60ms), dano escudo (0.85,150ms) via API de haptics quando disponível, com no-op seguro quando ausente.

- [ ] **Step 3: Integrar recenter e ciclo de vida**

Conectar recenter ao método existente do RenderPipeline/GameApp (reset yaw e posição relativa ao assento do piloto). Limpar listeners em `end`.

- [ ] **Step 4: Verificar e commit**

Run: `pnpm -C client test -- quest-xr-mapping.test.ts input-math.test.ts`
Expected: PASS.

Run: `pnpm -C client typecheck`
Expected: PASS.

```bash
git add client/src/input/QuestXRInput.ts client/src/core/GameApp.ts client/src/core/RenderPipeline.ts client/test/quest-xr-mapping.test.ts
git commit -m "feat(input): add quest xr controller adapter and haptics"
```

---
### Task 6: Integração M3, documentação e checklist de validação

**Files:**
- Modify: `README.md`
- Create: `docs/superpowers/specs/2026-11-22-m3-inputs-cross-platform-design.md`
- Modify: `client/src/main.ts` (seleção de adaptador/modo se necessário)
- Test: comandos de verificação + checklist manual

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: documentação clara de controles, status de verificação por plataforma, e comandos de execução.

- [ ] **Step 1: Rodar verificação automatizada**

Run: `pnpm -r typecheck`
Expected: PASS.

Run: `pnpm -r test`
Expected: PASS.

Run: `pnpm -C client build`
Expected: PASS.

- [ ] **Step 2: Criar doc de design/verificação M3**

Incluir: mapeamentos por plataforma (valores do spec), deadzone/curva, ADR-01/02 impactos, limitações (device validation PENDENTE), e evidências executadas.

- [ ] **Step 3: Atualizar README com checklist M3**

Tabela por plataforma: Desktop, Android Flat, VR Box, Quest 3. Colunas: controle mapeado, comportamento esperado, validado (SIM/NÃO/PENDENTE), evidência, observações.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-11-22-m3-inputs-cross-platform-design.md client/src/main.ts
git commit -m "docs: add M3 input mappings and verification checklist"
```

---
## Notas de Execução

- **Dispositivo real:** giroscópio, WakeLock, PointerLock, Gamepad BT e WebXR haptics variam por navegador/dispositivo. Não marcar como validado sem evidência.
- **ADR-01 crítico:** qualquer input VR que mova nave pela cabeça é bug de spec.
- **M4 próximo:** após M3, integrar `InputManager.getCommand(tick)` ao loop local/Worker (LocalTransport/GameRoom) para vertical slice jogável.