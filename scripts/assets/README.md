# P1 Asset Export Pipeline

Blender-first tooling for converting raw P1 asset sources into optimized runtime GLBs.

## Scope

P1 assets: player ship, missile, shield crystal, energy crystal. Asteroids may be added later; ambiguous node selections must be reported as `manual`.

## Prerequisites

- **Blender 4.x+** (5.x also supported). Required for automated `.fbx/.obj/.glb/.gltf/.blend` export.
- **Node.js** (repo uses pnpm; scripts run with `node`).

### Windows install

1. Install Blender from https://www.blender.org/download/.
2. Either add Blender to `PATH`, or set `BLENDER_BIN` to the full executable path.

```powershell
# Example: current shell
$env:BLENDER_BIN = "C:\Program Files\Blender Foundation\Blender 5.3\blender.exe"

# Verify
& $env:BLENDER_BIN --version
```

Common Windows install paths are auto-detected when `BLENDER_BIN` is not set:
- `C:\Program Files\Blender Foundation\Blender*\blender.exe`
- `C:\Program Files (x86)\Blender Foundation\Blender*\blender.exe`

## Commands

Dry-run (no Blender invocation, writes report):

```bash
node scripts/assets/export-glb.mjs --dry-run --report scripts/assets/out/export-report.json
```

Export P1 sources:

```bash
node scripts/assets/export-glb.mjs --only p1 --report scripts/assets/out/export-report.json
```

Require Blender (exit non-zero if Blender missing):

```bash
node scripts/assets/export-glb.mjs --only p1 --require-blender
```

## Output

- Runtime GLBs: `client/public/assets/models/{ships,asteroids,pickups,projectiles}/`
- Report: `scripts/assets/out/export-report.json` (gitignored output; contains status per asset)

Report statuses:
- `exported` — GLB written successfully.
- `manual` — automation cannot confidently produce the asset (missing Blender, missing source, ambiguous node selection, unsupported format like `.max`, archive inputs, missing textures). Includes `reason`.
- `failed` — hard export error; script continues other assets and records failure.

## Manual fallback

Use manual export when:
- Source is `.max`, `.rar/.zip`, or another format Blender cannot import directly.
- Textures are missing or external references are unresolved.
- Node selection is ambiguous (`nodeFilter` matches multiple/no meshes).
- Export report marks item `manual`.

Manual checklist:
1. Open source in Blender/DCC tool.
2. Select the correct object(s); isolate by name/filter when needed.
3. Apply transforms.
4. Set origin to gameplay center (bounds center/pivot expected by gameplay). **Do not use mesh collider.**
5. Normalize scale so bounding-sphere radius matches `targetRadius` (gameplay units).
6. Orient forward to **-Z** for ships/missiles; verify pickups/asteroids as needed.
7. Export GLB with +Y up, transforms applied.
8. Place optimized GLB at the `output` path from `sources.p1.json`.
9. Re-run dry-run/report and verify file loads in game.

## Rules

- **Do not commit raw assets** under `assets/` or large binaries without explicit user decision.
- Commit optimized runtime GLBs only after size check; prefer small files and Draco/meshopt only if runtime decoder is already planned.
- Keep gameplay pivot at center; normalize to gameplay radii (`ASTEROID_TIERS.*.radius`, `SHIP_CONFIG.RADIUS`).
- Forward gameplay axis is **-Z** for ships/missiles.
- Prefer procedural fallback on any asset failure; missing GLBs must not crash gameplay.
