# M3 — Controles Cross-Platform (US-08/09/10): decisões, verificação e checklist de dispositivo

> Documento de execução da Task 6. Consolida o sistema de input M3 implementado nas Tasks 1–5,
> os mapeamentos por plataforma, a normalização comum, os impactos de ADR-01/ADR-02 e o resultado
> **executado** da verificação automatizada. Nenhum resultado de validação em dispositivo é inferido
> ou inventado: o que não foi executado está marcado como `PENDENTE`.
>
> - Spec: `Documento Oficial de Projeto.pdf` v3.0 — seções 2 (ADR-01/02), 4.3 (ShipCommand),
>   4.4 (Adaptadores de Input) e 5.2 (US-08/09/10).
> - Plano: `docs/superpowers/plans/2026-11-22-m3-inputs-cross-platform.md`.
> - SDD: `.superpowers/sdd/2026-11-22-m3-inputs-cross-platform/`.
> - Branch: `feat/m3-inputs-cross-platform`.
> - Data da verificação automatizada: **2026-11-22**.

## 1. Objetivo e escopo entregue

O M3 entrega, no pacote `client/`, o sistema de input cross-platform com normalização comum,
`InputManager` e quatro adaptadores: Desktop, Touch, VR Box e Quest XR. O sistema produz
`InputState`/comando de nave normalizado para consumo futuro pelo loop de jogo (M4); não implementa
física de gameplay, rede ou loop de servidor.

| US | Critério | Entrega |
| --- | --- | --- |
| US-08 | Desktop: teclado/mouse + gamepad, Alt free-look temporário | `DesktopInput.ts` + `desktop-input-math.ts`; PointerLock, mouse yaw/pitch, gamepad padrão simultâneo. |
| US-09 | Android Flat: joysticks virtuais dinâmicos multitouch + botões | `TouchInput.ts` + overlay CSS; isolamento por `Touch.identifier`, FIRE/MISSILE/BOOST. |
| US-10 | VR Box: giroscópio relativo + gamepad BT + wizard; Quest 3: WebXR controllers + recenter + haptics | `VRBoxInput.ts`, `vrbox-math.ts`, `vrbox-wizard.ts`, `gamepad-mapping.ts`, `QuestXRInput.ts`, `quest-xr-mapping.ts`. |

## 2. Arquitetura e arquivos

| Arquivo | Papel |
| --- | --- |
| `client/src/input/input-math.ts` | Helpers puros: `clampAxis`, `applyRadialDeadzone` (radial, default 0.15, reescalonamento linear para [0,1]), `applyResponseCurve` (default expoente 1.6). |
| `client/src/input/types.ts` | Tipos internos: `InputState`, `InputAdapter`, `NormalizedAxes`. |
| `client/src/input/InputManager.ts` | Orquestra adaptador ativo, copia estado normalizado e gera `ShipCommand` via `getCommand(tick)`. |
| `client/src/input/desktop-input-math.ts` | Mapeamento puro de teclas/botões de mouse para estado de botões/eixos discretos. |
| `client/src/input/DesktopInput.ts` | Teclado/mouse PointerLock/gamepad padrão; Alt ativa free-look temporário; blur/pointer lock loss resetam eixos. |
| `client/src/input/TouchInput.ts` | Dois joysticks virtuais dinâmicos por `Touch.identifier`; botões FIRE/MISSILE/BOOST; overlay DOM com `touch-action: none`. |
| `client/src/input/VRBoxInput.ts` | DeviceOrientation relativo (YXZ) aplicado apenas ao `PilotHeadRig`; WakeLock/fullscreen/orientation lock com status degradado; wizard BT de 3 passos para gamepad não-standard. |
| `client/src/input/vrbox-math.ts` | Conversão `deviceOrientationToQuaternionYXZ` (graus → quatérnio, ordem YXZ intrínseca). |
| `client/src/input/vrbox-wizard.ts` | Máquina de estados do wizard de mapeamento BT (3 estágios, captura com release, evita reuso de eixo/botão). |
| `client/src/input/gamepad-mapping.ts` | Persistência/validação/sanitização de mapeamento em `localStorage` (`asteroids.vrbox.gamepadMapping`). |
| `client/src/input/QuestXRInput.ts` | Adapter WebXR: lê `XRSession.inputSources`, mapeia via `quest-xr-mapping`, dispara recenter on-edge e haptics on-edge; cleanup em `end`. |
| `client/src/input/quest-xr-mapping.ts` | Mapeamento puro Quest Touch: left stick translação, right stick yaw/pitch com curva 1.6, triggers/squeeze/buttons. |
| `client/src/core/GameApp.ts` | Integra `InputManager` e seleciona adaptador por modo; aplica free-look do desktop e quatérnio de cabeça do VR Box apenas ao `PilotHeadRig`. |
| `client/src/main.ts` | Bootstrap do app; seleção de render mode; hooks dev `[`/`]`/`R` (mapeamento final D-Pad/X pertence a M3/M4 conforme hardware). |

## 3. Normalização global

Aplicada nos helpers puros (`input-math.ts`) e usada pelos adaptadores:

- **Deadzone radial:** default `0.15`, calculada sobre a magnitude do vetor `(x,y)`. Dentro da deadzone
  retorna `(0,0)`. Fora, reescalona linearmente para `[0,1]` preservando direção:
  `scaled = (clampedMag - dz) / (1 - dz)`, `norm = scaled / mag`.
- **Curva de resposta:** `applyResponseCurve(value, exponent=1.6) = sign(v) * |v|^1.6`.
  Usada para **yaw e pitch** (Desktop mouse/gamepad, Touch right stick, VR Box gamepad look, Quest right stick).
- **Clamp:** `clampAxis` limita a `[-1,1]` e trata `NaN/Infinity` como `0`.
- **Sem alocações desnecessárias no hot path:** adaptadores usam scratches/objetos reutilizados
  (`stickScratch`, `lookScratch`, `vrBoxHeadQuat`, `normScratch`, estados mutáveis).

## 4. Mapeamentos por plataforma

### 4.1 Desktop (US-08)

| Controle | Mapeamento | Observação |
| --- | --- | --- |
| W / S | `thrust` +1 / -1 | Discreto por teclado. |
| A / D | `strafeX` -1 / +1 | Discreto por teclado. |
| Space / CtrlLeft / CtrlRight | `strafeY` +1 / -1 | Discreto por teclado. |
| Q / E | `roll` -1 / +1 | Discreto por teclado. |
| ShiftLeft / ShiftRight | `boost` | Booleano. |
| Mouse LMB / RMB | `firePrimary` / `fireSecondary` | Booleano; `contextmenu` suprimido. |
| Mouse movimento (PointerLock) | `yaw` / `pitch` | `MOUSE_SENSITIVITY = 0.0025`; curva 1.6; yaw/pitch da nave exceto em free-look. |
| AltLeft / AltRight | Free-look temporário | **ADR-02:** enquanto ativo, mouse move apenas câmera (`PilotHeadRig`) com limites ±1.2 yaw / ±0.8 pitch; não altera comando de nave yaw/pitch. |
| Gamepad padrão (simultâneo) | Left stick strafeX/strafeY, triggers RT/LT thrust, right stick yaw/pitch, LB/RB roll, A/RT firePrimary, B/LT fireSecondary, L3/Y boost | Deadzone radial 0.15; curva 1.6 em yaw/pitch; leitura via `navigator.getGamepads()`. |

Comportamento de falha/recuperação: perda de PointerLock ou `blur` reseta eixos e estado de mouse/teclas;
PointerLock pode ser negado e o adapter continua aceitando teclado/gamepad.

### 4.2 Android Flat / Touch (US-09)

| Controle | Mapeamento | Observação |
| --- | --- | --- |
| Joystick esquerdo dinâmico | `strafeX`, `thrust` | Centro no ponto do toque; raio 56 px; deadzone radial 0.15; `thrust = -y` (cima = frente). |
| Joystick direito dinâmico | `yaw`, `pitch` | Centro no ponto do toque; curva 1.6; `pitch = -y`. |
| Botão FIRE | `firePrimary` | Segurar = auto-fire enquanto pressionado. |
| Botão MISSILE | `fireSecondary` | Booleano por toque. |
| Botão BOOST | `boost` | Booleano por toque. |

Multitouch: cada toque é atribuído por `Touch.identifier`; `assignTouchToSide` mantém atribuição existente
e usa ponto médio da viewport para novos toques. `touchend/cancel` limpam estado. Overlay usa
`touch-action: none` e `preventDefault` nos handlers tratados.

### 4.3 VR Box (US-10)

| Controle | Mapeamento | Observação |
| --- | --- | --- |
| DeviceOrientation (giroscópio) | `PilotHeadRig` quaternion | **ADR-01:** apenas câmera/cabeça. Conversão relativa por Euler YXZ (`deviceOrientationToQuaternionYXZ`), sem magnetômetro/compass absoluto (`event.absolute === true` ignorado). Não move nave. |
| Gamepad padrão (`mapping === 'standard'`) | Left stick strafeX/strafeY, RT-LT thrust, right stick yaw/pitch, A/RT firePrimary, B fireSecondary, L3/RB boost | Deadzone radial 0.15; curva 1.6 em yaw/pitch. |
| Gamepad BT não-standard | Wizard de mapeamento 3 passos | Passo 1: STRAFE/THRUST; Passo 2: YAW/PITCH; Passo 3: FIRE/MISSILE/BOOST. Captura com limiar e espera de release; mapeamento salvo em `localStorage`. |
| Fullscreen / Orientation lock / WakeLock | Status exposto (`getStatus`) | Falhas degradam graciosamente (`failed`/`unsupported`), sem bloquear input. |

### 4.4 Quest 3 / WebXR (US-10)

| Controle | Mapeamento | Observação |
| --- | --- | --- |
| Left stick (axes 2,3) | `strafeX`, `thrust` | Deadzone radial 0.15; `thrust = -stickY`. |
| Left trigger (btn 0) / Y (btn 5) | `strafeY` + / - | Valor analógico/digital lido por `readButtonValue`. |
| Left squeeze (btn 1) | `boost` | Booleano. |
| Left X (btn 4) | `recenter` (edge) | Dispara `onRecenter()` apenas na transição pressionado; estado `recenter` não permanece no comando. |
| Right stick (axes 2,3) | `yaw`, `pitch` | Deadzone radial 0.15; curva 1.6; `pitch = -stickY`. |
| Right trigger (btn 0) | `firePrimary` | Booleano; haptics fire 0.2/25ms no edge. |
| Right squeeze (btn 1) | `fireSecondary`/missile | Booleano; haptics missile 0.5/60ms no edge. |
| Dano de escudo (evento futuro M4) | `pulseShieldDamage()` | Haptics 0.85/150ms em todos os gamepads disponíveis; no-op seguro se indisponível. |

Ciclo de vida: `attach(session)` registra listener `end`; `detach`/`end` limpa sessão e reseta estado.
Leitura de `session.inputSources` sem alocação por frame (index loop). **ADR-01:** controles XR movem nave/mira;
cabeça continua controlando apenas câmera via WebXR/runtime.

## 5. Impactos ADR-01 / ADR-02

- **ADR-01 (cabeça nunca move nave em VR):** `VRBoxInput` escreve quatérnio de cabeça em `getHeadQuat()` e
  `GameApp.applyFreeLook()` aplica ao `cockpit.pilotHeadRig.quaternion` somente no modo `VR_BOX`.
  Em `QUEST_3`, `resetHeadLook()` é usado para não impor rotação local conflitante com o pose XR da câmera.
  Nenhum adaptador VR escreve yaw/pitch/thrust da nave a partir de orientação de cabeça.
- **ADR-02 (Alt free-look desktop):** `DesktopInput` mantém `freeLookState.active` quando Alt está pressionado;
  enquanto ativo, delta do mouse vai para `freeLookState` e yaw/pitch do comando de nave ficam 0.
  `GameApp.applyFreeLook()` aplica rotação local limitada ao `PilotHeadRig` apenas em `FLAT`.

## 6. Verificação automatizada executada (2026-11-22)

Ambiente: Windows, `pnpm@10.0.0`, Node conforme workspace. Comandos executados via `cmd /c` devido ao
wrapper do harness.

| Comando | Esperado | Status | Evidência observada |
| --- | --- | --- | --- |
| `pnpm -r typecheck` | PASS | **PASS** | `Scope: 3 of 4 workspace projects`; `server typecheck: Done`, `shared typecheck: Done`, `client typecheck: Done`. |
| `pnpm -r test` | PASS | **PASS** | `shared`: 5 arquivos / **46 testes** passados; `server`: **1 teste** passado (`hello on connect and pong on ping`); `client`: 15 arquivos / **74 testes** passados. |
| `pnpm -C client build` | PASS | **PASS** | `tsc --noEmit && vite build`; `✓ 26 modules transformed`; `dist/assets/index-Dojbt6sJ.js 583.86 kB │ gzip: 147.38 kB`; `✓ built in 1.30s`. Aviso de chunk >500 kB pré-existente do Three.js, não bloqueante. |

Testes M3 relevantes no cliente: `input-math`, `input-manager`, `desktop-input-math`, `desktop-input`,
`touch-input-math`, `gamepad-mapping`, `vrbox-math`, `vrbox-wizard`, `quest-xr-mapping`, além das suítes
M0/M2 existentes.

## 7. Checklist manual M3 — validação em dispositivo

Preenchido apenas com itens realmente executados. O que não foi executado está `PENDENTE`.
A validação automatizada cobre lógica pura/mapeamentos; **não** substitui validação de dispositivo.

| Plataforma | Controle mapeado | Comportamento esperado | Validado (SIM/NÃO/PENDENTE) | Evidência | Observações |
| --- | --- | --- | --- | --- | --- |
| Desktop (PC Chrome/Edge) | Teclado W/A/S/D/Space/Ctrl/Q/E/Shift | Translação/roll/boost conforme mapeamento | **PENDENTE** | `input-math`, `desktop-input-math`, `desktop-input` PASS (2026-11-22) | Sem abertura de navegador real neste ambiente; PointerLock não exercitado. |
| Desktop (PC Chrome/Edge) | Mouse + PointerLock yaw/pitch | Yaw/pitch com curva 1.6; sem acoplamento indevido | **PENDENTE** | Testes automatizados PASS (2026-11-22) | Requer gesto de usuário e PointerLock real. |
| Desktop (PC Chrome/Edge) | Alt free-look (ADR-02) | Alt move apenas câmera no `PilotHeadRig`; nave não gira | **PENDENTE** | Código auditado: `DesktopInput`/`GameApp.applyFreeLook` | Confirmação visual/manual necessária. |
| Desktop (PC Chrome/Edge) | Gamepad padrão simultâneo | Eixos/botões mapeados com deadzone 0.15 e curva 1.6 | **PENDENTE** | Testes de mapeamento PASS (2026-11-22) | Gamepad físico não disponível no ambiente. |
| Android Flat (Chrome Android) | Joystick esquerdo dinâmico | Strafe/thrust por toque, deadzone radial 0.15 | **PENDENTE** | `touch-input-math` PASS (2026-11-22) | Sem dispositivo touch real. |
| Android Flat (Chrome Android) | Joystick direito dinâmico | Yaw/pitch com curva 1.6 | **PENDENTE** | `touch-input-math` PASS (2026-11-22) | Sem dispositivo touch real. |
| Android Flat (Chrome Android) | FIRE/MISSILE/BOOST | FIRE auto-fire ao segurar; botões isolados por touch id | **PENDENTE** | Código auditado: `TouchInput` | Requer validação visual/latência em mobile. |
| VR Box (Android + visor + gamepad BT) | Giroscópio relativo | Orientação move apenas cabeça/câmera (ADR-01), YXZ, sem compass absoluto | **PENDENTE** | `vrbox-math` PASS (2026-11-22); código ignora `event.absolute===true` | DeviceOrientation real não exercitado. |
| VR Box (Android + visor + gamepad BT) | WakeLock/fullscreen/orientation lock | Ativa quando suportado; degrada com status em falha | **PENDENTE** | Código expõe `VRBoxStatus` | APIs variam por browser/dispositivo. |
| VR Box (Android + visor + gamepad BT) | Wizard gamepad BT não-standard | 3 passos sequenciais, captura com release, persiste em localStorage | **PENDENTE** | `vrbox-wizard`, `gamepad-mapping` PASS (2026-11-22) | Requer gamepad BT físico não-standard. |
| Quest 3 (WebXR `immersive-vr`) | Left stick/trigger/squeeze/X | Translação, strafeY, boost, recenter on-edge | **PENDENTE** | `quest-xr-mapping` PASS (2026-11-22) | WebXR/session real não exercitada. |
| Quest 3 (WebXR `immersive-vr`) | Right stick/trigger/squeeze | Yaw/pitch curva 1.6, fire/missile | **PENDENTE** | `quest-xr-mapping` PASS (2026-11-22) | WebXR/session real não exercitada. |
| Quest 3 (WebXR `immersive-vr`) | Haptics fire/missile/shield | 0.2/25ms, 0.5/60ms, 0.85/150ms; no-op seguro sem actuator | **PENDENTE** | Código auditado: `QuestXRInput` | Haptics reais não exercitados. |
| Quest 3 (WebXR `immersive-vr`) | Recenter | Reseta yaw/posição relativa ao assento via callback `GameApp.recenter()` | **PENDENTE** | Integração por código (`onRecenter`) | Necessita sessão XR real para confirmar pose/reference space. |

## 8. Limitações e pendências

1. **Validação de dispositivo pendente.** Giroscópio, WakeLock, PointerLock, Gamepad BT, WebXR haptics
   e multitouch real não foram exercitados neste ambiente. Não marcar como validado sem evidência.
2. **Quest haptics dependem do runtime.** A implementação usa `pulse`/`playEffect` quando disponíveis e
   faz no-op seguro; comportamento percebido precisa de validação em Quest 3.
3. **VR Box compass absoluto não usado.** A implementação ignora `event.absolute === true` e usa
   `deviceorientation` relativo; deriva pode ocorrer e deve ser avaliada em dispositivo.
4. **M4 pendente.** `InputManager.getCommand(tick)` ainda não está ligado ao loop local/Worker
   (`LocalTransport/GameRoom`) para vertical slice jogável.
5. **Dev hooks permanecem.** Teclas `[`/`]`/`R` em `main.ts` continuam como hooks de desenvolvimento;
   mapeamento final de hardware pode evoluir em M3/M4.

## 9. Próximos passos

- Validar checklist M3 em dispositivos reais (Desktop, Android Flat, VR Box, Quest 3).
- M4: integrar `InputManager.getCommand(tick)` ao loop local/Worker para vertical slice jogável.
- Revisitar recenter XR com `referenceSpace`/offset se necessário após testes em headset.
