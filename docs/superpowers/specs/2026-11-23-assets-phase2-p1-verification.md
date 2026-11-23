# P1 Assets 3D — Pipeline and Integration: verification

> Documento de execução da Task 10 (P1 Assets). Consolida verificação automatizada, estado real dos artefatos exportados e checklist manual pendente.
>
> - Spec: `docs/superpowers/specs/2026-11-23-assets-phase2-integration-design.md`
> - Plano: `docs/superpowers/plans/2026-11-23-assets-phase2-p1-integration.md`
> - Branch verificada: `master`
> - Data da verificação automatizada: **2026-11-23**
> - Ambiente: Windows, workspace PNPM (`pnpm@10.0.0`), Node `v24.19.0`.

## 1. Escopo verificado

P1 entrega pipeline de export GLB (`scripts/assets/export-glb.mjs` + `scripts/assets/blender_export.py` + `scripts/assets/sources.p1.json`), loader/cache/fallback no cliente (`client/src/assets/*`), preload e wiring visual em pools/entidades para player ship, asteroids, crystals/pickups e missile, mantendo sim autoritativa em `shared/` isomórfica e fallback procedural quando GLB ausente/falha.

Regras/constraints confirmadas no design/plano:
- Forward gameplay **-Z** para naves/mísseis.
- Pivô/origem no centro de gameplay; sem mesh collider.
- Escala normalizada para raios de gameplay (`ASTEROID_TIERS.*.radius`, `SHIP_CONFIG.RADIUS`).
- `shared/` sem imports Three.js/DOM/Node APIs.
- Fallback procedural preferido em qualquer falha de asset.
- 0.1.0-alpha: score apenas Multiplayer; Treinamento sem persistência local de leaderboard.
- Não commitar `assets/` raw ou binários gigantes sem decisão explícita.

## 2. Estado real dos artefatos (factual)

| Asset | Source mapping (`scripts/assets/sources.p1.json`) | Runtime GLB esperado | Estado |
| --- | --- | --- | --- |
| Player ship | `assets/spaceship-player/SpaceShip.fbx` | `client/public/assets/models/ships/player_ship.glb` | **Presente** (exportado) |
| Missile | `assets/missile/cgtrader_optimized_Roket2.fbx` | `client/public/assets/models/projectiles/missile.glb` | **Presente** (exportado) |
| Crystal shield | `assets/crystal/Crystals_Set/Files/Crystals_Set_FBX.fbx` (`nodeFilter: Shield`) | `client/public/assets/models/pickups/crystal_shield.glb` | **Ausente** — manual pendente (nodeFilter mismatch no FBX) |
| Crystal energy | `assets/crystal/Crystals_Set/Files/Crystals_Set_FBX.fbx` (`nodeFilter: Energy`) | `client/public/assets/models/pickups/crystal_energy.glb` | **Ausente** — manual pendente (nodeFilter mismatch no FBX) |
| Asteroids P1 | Mapeados em `sources.p1.json` (6 variantes: large/medium/small ×2, source `assets/Asteroid_pack_small/Asteroid_pack_small/Asteroid_Small_6X.blend`, nodeFilter por `Aster_Small_1..6`) | `client/public/assets/models/asteroids/asteroid_{large,medium,small}_{01,02}.glb` | **Presente** (exportados via Blender 5.3.0 em 2026-11-23; ~34-45KB cada). Mapeamento reusa variantes do pack small para tiers large/medium por targetRadius; validação visual PENDENTE. |

Observações:
- O cliente deve usar fallback procedural para assets ausentes/falhos; isso está coberto por testes automatizados, mas **não** foi validado visualmente em dispositivo nesta sessão.
- `assets/` permanece raw/local e não deve ser commitado por padrão.

## 3. Verificação automatizada executada

Comandos executados a partir da raiz do workspace (`C:\Users\itsal\Downloads\Spaceship Game`).

| Comando | Status | Resultado observado |
| --- | --- | --- |
| `pnpm -r typecheck` | **PASS** | `Scope: 3 of 4 workspace projects`; `server typecheck: Done`, `shared typecheck: Done`, `client typecheck: Done`. Observação: foi necessário adicionar `"allowJs": true` em `client/tsconfig.json` para destravar o typecheck porque `client/test/assets/export-script.test.ts` importa `scripts/assets/export-glb.mjs` sem declarações de tipo. |
| `pnpm -C client test` | **PASS** | Vitest: **31 arquivos / 158 testes passados**. Stderr esperado nos testes de falha/retry do `AssetLoader` (caminhos de erro intencionais). |
| `pnpm -r test` | **PASS** | `server`: 33 testes, 33 pass, 0 fail (`node:test` via `tsx`). `shared`: 11 arquivos / 109 testes passados (Vitest). `client`: 31 arquivos / 158 testes passados (Vitest). Total: **300 testes passados, 0 falhas**. |
| `pnpm -C client build` | **PASS** | `tsc -p tsconfig.json --noEmit && vite build`; `vite v5.4.21`; `✓ 87 modules transformed`; `dist/assets/local.worker-C99rhO5j.js 46.99 kB`; `dist/assets/index-DqbG4m2i.js 796.48 kB │ gzip: 205.31 kB`; `dist/assets/index-pgKYImn3.css 1.50 kB │ gzip: 0.72 kB`; `✓ built in 4.00s`. Aviso não bloqueante: chunk principal > 500 kB após minificação. |

## 4. Checklist manual / smoke (PENDENTE)

Preenchido apenas com itens realmente executados. **Não** foram executadas validações manuais/visuais/dispositivo nesta sessão.

| Cenário | Comportamento esperado | Status | Evidência | Observações |
| --- | --- | --- | --- | --- |
| Desktop — Treinamento com GLBs ausentes | Inicia sem crash; fallback procedural para player/asteroids/crystals/missile conforme ausência | **PENDENTE** | Não executado | Validar removendo/ocultando GLBs runtime ou em ambiente limpo. |
| Desktop — Multiplayer com GLBs ausentes | Inicia sem crash; fluxo 0.1.0-alpha preservado | **PENDENTE** | Não executado | Requer server + dois clientes. |
| Desktop — GLBs presentes | Orientação (-Z), escala, pivô/centro de gameplay e framerate aceitável para player/asteroids/crystals/missile | **PENDENTE** | Não executado | `player_ship.glb`, `missile.glb` e 6 asteroid GLBs presentes; crystals shield/energy ainda sem GLB runtime (nodeFilter mismatch). |
| 0.1.0-alpha behavior | Score apenas Multiplayer; Treinamento sem persistência local de leaderboard | **PENDENTE** | Não executado visualmente | Cobertura automatizada existente em M5/fluxos relacionados; confirmar manualmente sem regressão. |
| Pickups visíveis | Pickups aparecem quando spawnados/dropped; fallback quando GLB ausente | **PENDENTE** | Não executado | Crystal GLBs ausentes por nodeFilter mismatch. |

## 5. Limitações / riscos conhecidos

- **Validação visual/dispositivo não executada.** Não afirmar orientação/escala/pivô/framerate em runtime real.
- **Crystals não exportados automaticamente:** `nodeFilter` `Shield`/`Energy` não bateu no FBX; requer export manual/ajuste de filtro.
- **Asteroids P1 mapeados/exportados com ressalva:** `sources.p1.json` agora inclui 6 asteroids e os GLBs foram exportados via Blender 5.3.0. O mapeamento reusa variantes do pack `Asteroid_Small_6X` para tiers LARGE/MEDIUM/SMALL por targetRadius; validação visual/manual de aparência e escala em jogo permanece PENDENTE.
- **Build chunk grande:** chunk principal ~796 kB minificado / ~205 kB gzip (aviso Vite, não bloqueante).
- **Ajuste de config para typecheck:** `client/tsconfig.json` recebeu `allowJs: true` para permitir import do script `.mjs` pelo teste; mudança pequena e localizada, mas deve ser considerada na revisão.

## 6. Arquivos relevantes (P1)

- Pipeline/export: `scripts/assets/export-glb.mjs`, `scripts/assets/blender_export.py`, `scripts/assets/sources.p1.json`, `scripts/assets/README.md`, `scripts/assets/.gitignore`.
- Runtime assets: `client/public/assets/models/ships/player_ship.glb`, `client/public/assets/models/projectiles/missile.glb`, `client/public/assets/models/asteroids/asteroid_{large,medium,small}_{01,02}.glb` (presentes); pickups crystal shield/energy pendentes (nodeFilter mismatch).
- Client asset/runtime wiring: `client/src/assets/*`, `client/src/entities/*`, `client/src/core/GameApp.ts` (conforme Tasks 1-9).
- Testes relevantes: `client/test/assets/*`, `client/test/entities/*`, `client/test/gameapp-assets.test.ts`.
- Doc: `docs/superpowers/specs/2026-11-23-assets-phase2-p1-verification.md`.