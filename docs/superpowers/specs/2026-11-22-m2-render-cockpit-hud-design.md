# M2 — Render Tri-Modal, Cockpit e HUD Diegético (US-05/06/07): decisões, verificação e checklist de dispositivo

> Documento de execução da Task 5. Consolida o que foi implementado nas Tasks 1–4, o resultado
> **executado** dos comandos de verificação e um checklist manual honesto para Flat / VR Box /
> Quest 3. Nenhum resultado de validação em dispositivo é inferido ou inventado: o que não foi
> executado está marcado como `PENDENTE`.
>
> - Spec: `Documento Oficial de Projeto.pdf` v3.0 — seções 1.4 (SLA), 2 (ADR-01/02/04), 3.2/3.3,
>   4.4 (CockpitRig, RenderPipeline, HUD) e 5.2 (US-05/06/07).
> - Plano: `docs/superpowers/plans/2026-11-22-m2-render-cockpit-hud.md`.
> - SDD/ledger: `.superpowers/sdd/2026-11-22-m2-render-cockpit-hud/`.
> - Branch: `feat/m2-render-cockpit-hud`.
> - Data da verificação automatizada: **2026-11-22**.

## 1. Objetivo e escopo entregue

O M2 entrega, no pacote `client/`, o cockpit 3D procedural, a pipeline de renderização tri-modal e
o HUD diegético com radar e indicadores off-screen — **sem assets externos** e sem pós-processamento
pesado (ADR-04). Não há gameplay, netcode, inimigos reais nem inputs completos: o estado exibido é
mock e isolado para substituição nas fases seguintes (YAGNI).

| US | Critério | Entrega |
| --- | --- | --- |
| US-05 | Hierarquia `CockpitRig` conforme spec 4.4 | `CockpitRig.ts` — árvore exata, materiais procedurais. |
| US-06 | Pipeline tri-modal (Flat, VR Box estéreo com barrel, Quest 3 WebXR) | `RenderPipeline.ts` + `render-config.ts` + seleção de modo em `main.ts`. |
| US-07 | HUD diegético 512×256 com radar 3D e offscreen pips | `DiegeticHUD.ts`, `OffscreenPips.ts`, `hud-math.ts`. |

## 2. Arquivos criados / modificados (Tasks 1–4)

| Arquivo | Task | Papel |
| --- | --- | --- |
| `client/package.json`, `pnpm-lock.yaml` | 1 | `three@^0.187.0` + `@types/three@^0.187.0`. |
| `client/src/core/GameApp.ts` | 1–4 | Scene/camera/renderer, loop via `setAnimationLoop`, estado mock, lifecycle. |
| `client/src/core/Starfield.ts` | 1 | `createStarfield(count)` — `Points`/`BufferGeometry` procedural com seed fixa. |
| `client/src/core/CockpitRig.ts` | 2, 4 | Hierarquia do spec + container `OffscreenPips` exposto. |
| `client/src/core/render-config.ts` | 3 | Constantes barrel/IPD/DPR/XR + `clampIpdMm`. |
| `client/src/core/RenderPipeline.ts` | 3 | FLAT / VR_BOX / QUEST_3, resize, IPD, recenter, dispose. |
| `client/src/main.ts` | 1, 3 | Bootstrap `new GameApp(root).start()`, seleção `?render=`, hooks dev `[`/`]`/`R`. |
| `client/src/ui/hud-math.ts` | 4 | Helpers puros: `clamp`, `normalizeAngle`, `projectToRadar`, `computePip`, `shouldUpdateHud`. |
| `client/src/ui/DiegeticHUD.ts` | 4 | CanvasTexture 512×256, dirty-flag 15Hz, barras/score/wave/radar. |
| `client/src/ui/OffscreenPips.ts` | 4 | Pool fixo de 16 setas radiais, projeção por câmera sem alocação. |
| `client/test/render-config.test.ts` | 3 | Constantes da spec + limites de IPD. |
| `client/test/hud-math.test.ts` | 4 | 9 testes de radar/pip/throttle. |
| `client/test/offscreen-pips.test.ts` | 4 (fix) | Pips para contatos fora do FOV; nenhum pip para contatos dentro. |

## 3. Hierarquia `CockpitRig` implementada (spec 4.4 / US-05)

```text
ShipRoot
├── CockpitFrame
│   ├── CanopyStruts (LineSegments)
│   ├── DiegeticHUDMesh (Plane 1.4×0.7; position [0,-0.42,-0.85]; rotation.x = -35°)
│   └── CrosshairGroup (position.z = -60)
│       ├── MainReticle (LineSegments, renderOrder 10)
│       ├── LeadIndicator (CircleGeometry, renderOrder 11)
│       └── OffscreenPips (Group — pool de 16 setas preenchido por OffscreenPips)
├── MuzzleLeft  [-1.2, -0.4, -2.5]
├── MuzzleRight [ 1.2, -0.4, -2.5]
└── PilotHeadRig [0, 0.35, 0.4]
    └── Camera (PerspectiveCamera fov 75, near 0.05, far 1500)
        └── ComfortVignette (RingGeometry, z = -0.15, renderOrder 999, visible = false)
```

- **ADR-01:** a câmera vive **apenas** dentro de `PilotHeadRig`; HUD, retícula e pips ficam em
  `CockpitFrame`/`CrosshairGroup`, de modo que o movimento da cabeça em VR nunca desloca a mira.
- **ADR-04:** apenas `LineBasicMaterial` / `MeshBasicMaterial` com cores aditivas e uma
  `CanvasTexture` gerada em código. Sem texturas, modelos, fontes ou shaders externos; sem
  `UnrealBloomPass` ou qualquer pós-processamento pesado. O "brilho" é obtido por mistura aditiva
  e cores emissivas simples (não há shader de Fresnel dedicado nesta entrega).
- `update(dt)` aplica apenas uma pulsação decorativa na escala da retícula; `dispose()` libera
  geometry/material/textura e limpa a raiz.

## 4. Modos de render (US-06)

Seleção por `?render=FLAT|VR_BOX|QUEST_3` (gravado em `localStorage`, chave
`asteroids.renderMode`), com fallback `FLAT`. A API pública é
`RenderPipeline { setMode, render, resize, dispose }` complementada por `getMode`, `getIpdMm`,
`adjustIpd` e `recenter` (hooks de dev/M3).

| Modo | Comportamento |
| --- | --- |
| **FLAT** | `xr.enabled = false`; `setPixelRatio(min(devicePixelRatio, 2))`; `setSize(w, h, false)`; `renderer.render(scene, camera)` direto; `resize` atualiza `aspect`/`projectionMatrix`. |
| **VR_BOX** | Duas câmeras de olho criadas uma vez **como filhas da câmera da cabeça** (herdam o pose de `PilotHeadRig`, ADR-01), em `x = ±IPD/2` metros. Dois `WebGLRenderTarget`s `(w·dpr)/2 × (h·dpr)` renderizam L/R; um quad full-screen compõe as duas metades com shader Brown-Conrady (radial `r²`/`r⁴`), preto fora de `[0,1]` para o canto arredondado do visor. Exatamente 3 chamadas `render()` por frame (olho L, olho R, quad). |
| **QUEST_3** | `xr.enabled = true`, `referenceSpaceType = 'local'`. Detecta `immersive-vr` via `navigator.xr.isSessionSupported` e injeta o botão DOM "Enter VR"; no clique (gesto do usuário) solicita sessão `immersive-vr` com `optionalFeatures: ['local-floor', 'hand-tracking', 'layers']` e entrega a `renderer.xr.setSession()`. Fim de sessão reabilita o botão; sair do modo encerra a sessão e remove o botão. `GameApp` usa `renderer.setAnimationLoop`, que aciona tanto o rAF desktop quanto o rAF da sessão WebXR. |

### 4.1 Constantes da spec (`client/src/core/render-config.ts`)

| Constante | Valor | Uso |
| --- | --- | --- |
| `BARREL_K1` | `0.22` | Brown-Conrady (termo `r²`) no VR Box. |
| `BARREL_K2` | `0.24` | Brown-Conrady (termo `r⁴`) no VR Box. |
| `IPD_MIN_MM` / `IPD_MAX_MM` | `56` / `74` | Faixa confortável; `clampIpdMm` limita e usa `DEFAULT_IPD_MM` em `NaN`. |
| `DEFAULT_IPD_MM` | `64` | IPD padrão → olhos em `±0.032 m`. |
| `MAX_DPR` | `2` | Teto de `devicePixelRatio` (performance em mobile/Quest). |
| `XR_SESSION_MODE` | `'immersive-vr'` | Modo de sessão Quest 3. |
| `XR_REFERENCE_SPACE_TYPE` | `'local'` | Espaço de referência da spec. |
| `IPD_STORAGE_KEY` / `RENDER_MODE_STORAGE_KEY` | `'asteroids.ipdMm'` / `'asteroids.renderMode'` | Persistência simples substituível em M3. |

## 5. HUD diegético e radar (US-07)

- **Canvas 512×256** + `THREE.CanvasTexture` (`SRGBColorSpace`, `LinearFilter`, sem mipmaps) trocada
  em `mesh.material.map` no construtor e restaurada no `dispose`.
- Conteúdo desenhado: moldura, barras `SHIELD`/`ENERGY`, `SCORE`, `WAVE` e radar circular com
  anéis, cruz, sweep giratório e blips cujo tamanho/opacidade variam com a proximidade (`depth`).
- **Dirty-flag + teto 15Hz:** `update(state, dt)` marca `dirty` quando shield/energy/score/wave ou
  contagem/posições mudam (comparação contra snapshot `Float64Array` pré-alocado — f64 preserva
  posições exatas). Só redesenha e seta `texture.needsUpdate = true` quando `dirty` **e**
  `shouldUpdateHud(accumulator, dt, 1/15)` é verdadeiro; o acumulador é zerado a cada redesenho,
  tornando impossível exceder 15Hz com `dt > 0`. O sweep avança em tempo real fora do dirty-check.
- **Offscreen pips:** pool fixo de 16 triângulos no grupo `OffscreenPips`; `update` converte cada
  contato para espaço da câmera (`worldToLocal`), calcula projeção via `projectionMatrix`, marca
  `behind` quando `z_view > 0` e usa `|clip.x/y| > |z_view|` para detectar fora do FOV. A seta é
  posicionada no anel (raio 12) ao redor da retícula e girada `+PI` quando o alvo está atrás.
  Contatos dentro do FOV ocultam a seta (ADR-02: paridade tática com o radar).

### 5.1 Dados mock usados (isolados em `GameApp`)

- `shield = 0.6 + 0.4·sin(0.7t)` e `energy = 0.5 + 0.5·sin(1.1t + 1)` (oscilam 0–1).
- `score = floor(10t)`; `wave = 1 + floor(t / 12)`.
- 8 contatos orbitando de forma determinística: raio `35 + (i % 3)·12`, velocidade angular
  `0.25 + (i % 4)·0.08`, altura `sin(0.6·angle + phase)·8`.
- Estado em `HudState` (`shield`, `energy`, `score`, `wave`, `contacts`) — substituível pelo
  estado real do servidor sem tocar em `DiegeticHUD`/`OffscreenPips`.

## 6. Verificação automatizada executada (2026-11-22)

Ambiente: Windows, `pnpm@10.0.0`, Node `v24.19.0`. O wrapper do shell do harness exige
`cmd /c "<comando>"`. Resultado esperado vem do brief; **observado** é a saída real obtida nesta
task.

| Comando | Esperado (brief) | Status | Evidência observada |
| --- | --- | --- | --- |
| `pnpm -r typecheck` | PASS | **PASS** | `Scope: 3 of 4 workspace projects`; `client typecheck: Done`, `server typecheck: Done`, `shared typecheck: Done` (`tsc --noEmit`, sem diagnósticos); `exit 0`. |
| `pnpm -r test` | PASS | **PASS** | `client`: 4 arquivos / **15 testes**; `shared`: 5 arquivos / **46 testes**; `server`: **1 teste** (`hello on connect and pong on ping`, `pass 1 / fail 0`); todos `Done`; `exit 0`. |
| `pnpm -C client build` | PASS | **PASS** | `tsc --noEmit && vite build`; `✓ 15 modules transformed`; `dist/index.html 0.43 kB`, `dist/assets/index-*.css 0.52 kB`, `dist/assets/index-*.js 548.12 kB` (gzip 138.28 kB); `✓ built in 1.26s`; `exit 0`. |

A suíte do cliente cobre `ws-status` (2), `render-config` (2), `hud-math` (9) e
`offscreen-pips` (2). O aviso do Vite sobre chunk >500 kB é **pré-existente** e não bloqueante:
vem do bundle do Three.js, não de assets externos (ADR-04).

## 7. Auditoria de alocações no hot-loop (Notas de Execução)

Revisão dos caminhos executados a cada frame (`GameApp.tick` →
`cockpit.update` / `updateMockState` / `hud.update` / `pips.update` / `pipeline.render`):

| Caminho | Resultado |
| --- | --- |
| `GameApp.tick` e `updateMockState` | Sem `new`, arrays literais ou closures; apenas primitivas e mutação de campos. |
| `CockpitRig.update` | Apenas `Math.sin` e `reticle.scale.set(...)`. |
| `RenderPipeline.render` / `renderVrBox` | Apenas `.copy()`, `.setRenderTarget()` e `.render()`; olhos, targets, quad e uniforms pré-alocados no construtor; `resize()` reusa os targets via `setSize()`. |
| `OffscreenPips.update` | Dois `Vector3`/`Vector4` de scratch e um `PipResult` de scratch; laço por índice; só reescreve transforms do pool. |
| `DiegeticHUD.update` | Scratches pré-alocados e snapshot `Float64Array`; `new`/formatação de string/template literals ficam exclusivamente em `draw()`, limitado a 15Hz. |

Conclusão: **nenhuma alocação por frame** identificada nos hot paths de render/tick. Os helpers
puros de `hud-math` alocam o objeto de retorno apenas quando `out` é omitido (caso dos testes);
o hot-loop sempre passa `out` explicitamente.

## 8. Checklist manual M2 — validação em dispositivo

Preenchido apenas com itens realmente executados. O que não foi executado está `PENDENTE`.
Meta de performance da spec: **72–90 FPS em Quest 3** e **60 FPS em Android (Flat/VR Box)** —
não há medição real neste ambiente, então a coluna "FPS observado" permanece `PENDENTE`.
A mesma tabela está no `README.md`.

| Modo | URL/dispositivo | FPS observado | HUD atualiza corretamente | Pips/radar corretos | Sem assets externos | Evidência |
| --- | --- | --- | --- | --- | --- | --- |
| Flat | `https://localhost:5173` (PC Chrome/Edge) | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` (em dispositivo) — código auditado: ✅ | Verificação automatizada 2026-11-22 (§6); abertura ao vivo não executada (bloqueio da CA do mkcert, ver §10). |
| Flat | `https://<IP-LAN>:5173` (Android Chrome) | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` (em dispositivo) — código auditado: ✅ | Não executado; requer CA do mkcert instalada no dispositivo. |
| VR Box | Visitante óptico VR Box + Android Chrome (`https://<IP-LAN>:5173?render=VR_BOX`) | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` (em dispositivo) — código auditado: ✅ | Não executado; distorção/conforto e sinal do barrel precisam de conferência visual no visor. |
| Quest 3 | Meta Quest Browser (`https://<IP-LAN>:5173?render=QUEST_3`) | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` (em dispositivo) — código auditado: ✅ | Não executado; requer CA confiável e `immersive-vr` no headset. Botão "Enter VR" e recenter não exercitados em hardware. |

> **Interpretação:** nenhuma linha foi validada em dispositivo. O que está pronto e verificado é o
> código (tipagem, testes, build e auditoria estática de alocações, §6–7). Não se deve afirmar
> FPS, conforto visual, correção de HUD/pips ou ausência de assets "em dispositivo" até que as
> células acima sejam preenchidas com evidência real (captura/media/data).

## 9. Limitações e pendências

1. **Inputs M3 ausentes.** O mapeamento final do D-Pad (IPD) e do botão X do Quest (recenter)
   pertence ao M3. Nesta entrega existem apenas hooks de dev: teclas `[`/`]` para ±1 mm de IPD,
   `R` para `recenter()`, e os métodos `adjustIpd`/`recenter` na pipeline. O `recenter()` atual
   restaura posição/yaw de `PilotHeadRig`; em M3 poderá ser combinado com
   `getOffsetReferenceSpace(new XRRigidTransform(...))` para neutralizar o pose absoluto do
   reference space `local`.
2. **Validação de dispositivo pendente.** Quest 3, VR Box e Android Flat não foram exercitados:
   a sessão `immersive-vr`, o botão "Enter VR", o sinal do barrel (k1/k2) e o conforto de IPD
   foram verificados somente por tipagem/build e testes com renderer/XR stubados nas tasks
   anteriores — não em hardware (§8).
3. **HTTPS ao vivo pendente (herdado do M0).** A CA do mkcert exige aceite humano numa janela
   nativa do Windows; o Vite não escutou em 5173 neste desktop. Sem isso, nenhuma linha do §8
   pode ser executada aqui.
4. **Radar/sweep.** O sweep só é redesenhado quando outro valor muda (para respeitar o teto de
   15Hz); com os dados mock os contatos mudam a cada frame, então ele anima normalmente.
5. **Próximas fases:** M3 (Inputs Desktop/Touch/VRBox/QuestXR) e M4 (loop solo em Worker +
   IA/ondas). Nenhum desses elementos foi adicionado aqui (YAGNI).

## 10. Como executar a validação manual (quando o ambiente permitir)

1. Aceitar a CA do mkcert no desktop (ver `docs/superpowers/specs/2026-11-22-fase-0-client-https-ws-design.md`)
   e instalar `rootCA.pem` no Android/Quest; iniciar `pnpm -C server dev` e `pnpm -C client dev`.
2. **Flat:** abrir `https://<IP-LAN>:5173?render=FLAT` no PC/Android; confirmar imagem, HUD,
   radar/pips e medir FPS (meta 60).
3. **VR Box:** abrir `?render=VR_BOX` no Chrome Android dentro do visor; conferir estereoscopia,
   distorção em barril, ausência de canto quadrado e conforto; medir FPS (meta 60). Ajustar IPD
   com `[`/`]` no PC (ou D-Pad em M3).
4. **Quest 3:** abrir `?render=QUEST_3` no Quest Browser; tocar "Enter VR"; conferir imageamento
   estereoscópico, HUD/pips no cockpit, `R`/botão X para recenter; medir FPS (meta 72–90).
5. Preencher a tabela do §8 / README com FPS observado, evidência (captura/data) e eventuais
   ajustes de sinal do barrel/IPD.
