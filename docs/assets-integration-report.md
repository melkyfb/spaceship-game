# Relatório de Integração de Assets 3D (Fase 2)

Data: 2026-11-23  
Escopo: inventário da pasta `assets/`, avaliação por asset e plano de mudanças para integrar ao projeto Asteroids 3D.

## Resumo executivo

- A pasta `assets/` contém **modelos fonte** (Blend/FBX/OBJ/MAX), texturas, zips e rar. **Não** está pronta para uso direto em runtime web.
- O cliente atual (`client/`) não possui pipeline de modelos 3D (sem `GLTFLoader`/`FBXLoader`); usa renderização procedural/Three.js existente. A integração exigirá pipeline de assets + loader + substituição dos placeholders/procedurais.
- Recomendação principal: **manter `assets/` como source/raw**, exportar versões otimizadas para **glTF 2.0 binário (`.glb`)** com Draco/Meshopt quando aplicável, texturas comprimidas (KTX2/Basis preferencial; fallback WebP/PNG), e colocar runtime em `client/public/assets/`.
- Arquivos grandes (HDR 114MB, interior .blend 250MB, vários zips) exigem política de versionamento: **Git LFS** para raw, ou manter raw fora do git e commitar apenas exports otimizados.

## P1 Export Status (2026-11-23)

Automated export attempted with `node scripts/assets/export-glb.mjs --only p1 --report scripts/assets/out/export-report.json` using Blender 5.3.0 at `C:\Program Files\Blender Foundation\Blender 5.3\blender.exe`.

| Asset | Status | Output | Reason / Notes |
|---|---|---|---|
| `player_ship` | exported | `client/public/assets/models/ships/player_ship.glb` | Exported (887,576 bytes). Normalized to `targetRadius=2.2`, forward `-Z`, `rotationDeg=[0,0,0]`. Blender warnings: some texture images had no size/could not be exported; verify material appearance in-game. |
| `missile` | exported | `client/public/assets/models/projectiles/missile.glb` | Exported (270,416 bytes). Normalized to `targetRadius=0.6`, forward `-Z`, `rotationDeg=[0,0,0]`. Blender warnings: some texture images had no size/could not be exported; verify material appearance in-game. |
| `crystal_shield` | manual | `client/public/assets/models/pickups/crystal_shield.glb` | `nodeFilter "Shield"` matched no mesh objects in `assets/crystal/Crystals_Set/Files/Crystals_Set_FBX.fbx`. Available meshes: `Crystal:LP_005`, `LP_005`, `Crystal_set_OBJ:polySurface1`. Manual DCC selection/mapping required before export. |
| `crystal_energy` | manual | `client/public/assets/models/pickups/crystal_energy.glb` | `nodeFilter "Energy"` matched no mesh objects in `assets/crystal/Crystals_Set/Files/Crystals_Set_FBX.fbx`. Available meshes: `Crystal:LP_005`, `LP_005`, `Crystal_set_OBJ:polySurface1`. Manual DCC selection/mapping required before export. |
| `asteroid_large_01` | exported | `client/public/assets/models/asteroids/asteroid_large_01.glb` | Exported (37,816 bytes). Source `Aster_Small_1_` from `Asteroid_Small_6X.blend`; normalized to `targetRadius=14`, `rotationDeg=[0,0,0]`. Reuses small-pack variant for large tier; visual validation PENDENTE. |
| `asteroid_large_02` | exported | `client/public/assets/models/asteroids/asteroid_large_02.glb` | Exported (40,192 bytes). Source `Aster_Small_2_`; `targetRadius=14`, `rotationDeg=[0,0,0]`. Visual validation PENDENTE. |
| `asteroid_medium_01` | exported | `client/public/assets/models/asteroids/asteroid_medium_01.glb` | Exported (36,900 bytes). Source `Aster_Small_3_`; `targetRadius=7`, `rotationDeg=[0,0,0]`. Visual validation PENDENTE. |
| `asteroid_medium_02` | exported | `client/public/assets/models/asteroids/asteroid_medium_02.glb` | Exported (33,640 bytes). Source `Aster_Small_4_`; `targetRadius=7`, `rotationDeg=[0,0,0]`. Visual validation PENDENTE. |
| `asteroid_small_01` | exported | `client/public/assets/models/asteroids/asteroid_small_01.glb` | Exported (37,772 bytes). Source `Aster_Small_5_`; `targetRadius=3`, `rotationDeg=[0,0,0]`. Visual validation PENDENTE. |
| `asteroid_small_02` | exported | `client/public/assets/models/asteroids/asteroid_small_02.glb` | Exported (44,512 bytes). Source `Aster_Small_6_`; `targetRadius=3`, `rotationDeg=[0,0,0]`. Visual validation PENDENTE. |

Notes:
- No GLBs were faked. Crystal outputs were not produced.
- Asteroid GLBs were exported via Blender 5.3.0 in this fix wave using nodeFilter per mesh from `Asteroid_Small_6X.blend`. The same small-pack geometry is reused across LARGE/MEDIUM/SMALL tiers with different targetRadius; this is an honest mapping, not a per-tier art pass. Visual validation remains PENDENTE.
- `scripts/assets/out/export-report.json` is generated/gitignored; regenerate with the command above.
- A small export-script fix was applied: pass `--forward=-Z` form to Blender argparse to avoid `-Z` being parsed as a flag.
- Raw `assets/` remains untracked and must not be committed.

## Convenções alvo (projeto)

| Item | Convenção recomendada | Motivo |
|---|---|---|
| Formato runtime | `.glb` (glTF 2.0) | Melhor suporte Three.js, único arquivo, PBR, animações/hierarquia |
| Sistema de coordenadas | Three.js: **+Y up, +Z forward para câmera, -Z forward de objetos**; validar por asset | Evitar nave/asteroide apontando para direção errada |
| Unidade | 1 unidade = 1 metro (aprox.) | Consistência com física/câmeras/colisão |
| Origem/pivot | Centro de massa/centro de gameplay no (0,0,0) local; nave no cockpit/centro definido | Rotação, colisão e mira corretas |
| Escala | Normalizar por bounding box alvo do gameplay | Evitar reescalas ad-hoc em runtime |
| Orientação nave | Nariz apontando para **-Z** local (forward do jogo) | Alinha com convenção usada no sim/câmera |
| Hierarquia | Root vazio/`Scene` com nós nomeados (`Hull`, `Cockpit`, `Turret`, `Hardpoint_*`) | Facilita animação, VFX, sockets |
| Texturas runtime | KTX2 (BasisU) preferencial; PNG/WebP fallback; normal maps linear | Tamanho/GPU upload/perf mobile |
| Diretório runtime | `client/public/assets/models/`, `client/public/assets/textures/`, `client/public/assets/hdr/` | Cache estático via Vite/public |
| Diretório source | `assets_src/` ou `assets/raw/` (LFS/fora do git) + `assets/export/` | Separar raw de runtime |

## Pipeline de integração (mudanças globais no projeto)

### 1. Estrutura de pastas
Criar/ajustar:
- `client/public/assets/models/` — GLBs otimizados runtime.
- `client/public/assets/textures/` — texturas compartilhadas/runtime.
- `client/public/assets/env/` — HDR/PMREM/skybox otimizado.
- `docs/assets/` ou manter este relatório + manifests.
- Opcional: `assets_src/` para raw versionado com LFS.

### 2. Loader e cache
Adicionar no cliente:
- `GLTFLoader` (+ `DRACOLoader`/`MeshoptDecoder` se usado).
- `KTX2Loader` + `BasisUniversalTranscoder` (se KTX2).
- Cache simples de `GLTF`/texturas por URL para evitar reload.
- Fallback para placeholder procedural se asset falhar.

Arquivos prováveis a criar/alterar:
- `client/src/assets/AssetLoader.ts` (novo)
- `client/src/assets/manifest.ts` (novo)
- `client/src/entities/*` (trocar geometria procedural por modelo)
- `client/src/core/GameApp.ts` (preload/lifecycle)

### 3. Normalização de escala e colisão
- Definir `targetSize` por tipo (asteroide S/M/L, nave player, inimigos, míssil, cristal).
- Após load: aplicar escala uniforme baseada em bounding box; congelar transformações quando exportado.
- Colisão: manter colliders simples (esfera/box/capsule) alinhados ao modelo; não usar mesh complexa como collider físico.

### 4. Versionamento/LFS
Adicionar `.gitattributes` (se optar por LFS):
```gitattributes
*.blend filter=lfs diff=lfs merge=lfs -text
*.fbx filter=lfs diff=lfs merge=lfs -text
*.obj filter=lfs diff=lfs merge=lfs -text
*.mtl filter=lfs diff=lfs merge=lfs -text
*.max filter=lfs diff=lfs merge=lfs -text
*.png filter=lfs diff=lfs merge=lfs -text
*.hdr filter=lfs diff=lfs merge=lfs -text
*.zip filter=lfs diff=lfs merge=lfs -text
*.rar filter=lfs diff=lfs merge=lfs -text
*.glb filter=lfs diff=lfs merge=lfs -text
```
Ou, alternativamente, **não commitar** `assets/` raw e manter apenas exports otimizados.

## Inventário e plano por asset

### 1) Asteroides — `assets/Asteroid_pack_small/Asteroid_pack_small/`

**Arquivos observados**
- `Asteroid_Small_6X.blend` (~1.4MB), `.obj` (~613KB), `.mtl` (~1.2KB)
- Texturas: `Aster_Small_1..6_Color.png`, `Aster_Small_1..6_NM.png` (3–8MB cada)
- Subpasta `gratis/space_1__360.png` etc. (imagens 360, não são asteroides)

**Uso no jogo**
- Substituir/variar asteroides procedurais em `client/src/entities/Asteroid*.ts` / pool.

**Orientação/origem/hierarquia (a validar no DCC)**
- OBJ contém 6 materiais/variantes (`Aster_Small_1_`..`6_`). Confirmar se são 6 meshes separados ou um conjunto.
- **Origem:** centralizar cada asteroide no seu próprio pivot (0,0,0).
- **Orientação:** sem "frente" gameplay; rotação aleatória ok. Garantir Y-up consistente.
- **Escala:** normalizar para 3 tamanhos de gameplay (S/M/L) ou usar 6 variantes como S e escalar para M/L com ajuste de collider.
- **Hierarquia alvo:** `Asteroid_Small_01`..`06` como meshes independentes; exportar como 6 GLBs separados ou 1 GLB com cenas/nós nomeados.

**Mudanças necessárias**
- Exportar cada variante para `client/public/assets/models/asteroids/asteroid_small_0X.glb`.
- Gerar texturas otimizadas: Color -> KTX2/BC7 ou WebP; Normal -> KTX2/BC5/normal.
- Criar mapping material PBR (BaseColor + Normal; Roughness/Metallic se disponível, senão defaults).
- Atualizar pool de asteroides para escolher variante por seed/rng determinístico.
- Manter collider esférico por raio da bounding sphere; não depender da malha.

**Riscos**
- OBJ sem mapas no MTL (MTL atual não referencia `map_Kd/map_Bump`) — ligação de textura pode precisar ser refeita no export.
- Normais/tangents precisam estar corretas para normal map.

### 2) Background/ambiente — `assets/background/`

**Arquivos observados**
- `Free+Galaxies+8k.hdr` (~114MB)
- `black+hole.blend` (~2.7MB)

**Uso no jogo**
- Skybox/environment map; buraco negro possivelmente como prop de cenário distante (se houver).

**Orientação/origem/hierarquia**
- HDR: equiretangular; orientação/rotação será ajustada no `scene.background`/`PMREM`.
- `black+hole.blend`: validar escala/origem; se usado, deve ser asset distante sem colisão.

**Mudanças necessárias**
- Converter HDR 8K para runtime viável:
  - opção A: `PMREM` pré-gerado/`envMap` + background menor (2K/4K).
  - opção B: cubemap/KTX2.
- Não carregar 114MB HDR direto no cliente móvel.
- Se usar buraco negro: exportar `.glb` separado, escala grande, sem física, material emissivo/alpha conforme necessário.

**Riscos**
- Custo de memória/tempo de load alto no mobile/VR.
- Orientação da galáxia pode afetar leitura visual; expor rotação em config.

### 3) Cristais/pickups — `assets/crystal/`

**Arquivos observados**
- `Crystal_Set.rar` (~86MB)
- `Crystals_Set/Files/Crystals_Set_FBX.fbx`, `.mb`, `_OBJ.obj/.mtl`, `.tbscene`
- Texturas 1K/2K para variantes Blue/Red/Purple/Yellow/Colorfull + emissive/normal/roughness/metallic/AO/thickness

**Uso no jogo**
- Pickups `SHIELD_CRYSTAL` e `ENERGY_CRYSTAL` (e talvez variações visuais).

**Orientação/origem/hierarquia**
- Validar quantos cristais existem no set e nome dos nós.
- **Origem:** base ou centro geométrico; para pickup flutuante, centro é melhor.
- **Orientação:** Y-up; rotação idle em runtime.
- **Escala:** normalizar para tamanho de pickup legível no cockpit.
- **Hierarquia alvo:** 1 GLB por variante (`crystal_shield.glb`, `crystal_energy.glb`) ou 1 GLB com nós nomeados.

**Mudanças necessárias**
- Escolher 2 variantes visuais (ex.: azul=shield, vermelho/verde=energia conforme design) e exportar GLBs leves.
- Usar mapas PBR: BaseColor, Emissive, Normal, Roughness, Metallic, AO.
- Garantir material emissivo para legibilidade.
- Atualizar entidade de pickup para instanciar modelo + animação de giro/bob (procedural leve).
- Collider simples (esfera) independente do mesh.

**Riscos**
- RAR não é ideal para pipeline automatizado; preferir extrair uma vez e versionar fonte organizada.
- Muitos mapas 2K por variante podem pesar; usar 1K no runtime mobile.

### 4) Míssil/projétil — `assets/missile/`

**Arquivos observados**
- `cgtrader_optimized_Roket2.fbx` (~253KB)
- `Roket1.rar`, `Roket2.rar` (37MB, 78MB)

**Uso no jogo**
- Visual de míssil/projétil secundário.

**Orientação/origem/hierarquia**
- **Forward:** alinhar nariz com **-Z** local.
- **Origem:** centro de massa ou base do bocal conforme sistema de disparo; preferir centro para física simples e nó filho `Muzzle` se necessário.
- **Escala:** pequena, coerente com nave e velocidade percebida.
- **Hierarquia alvo:** `MissileRoot` + `Body` + opcional `Thruster`/`Muzzle`.

**Mudanças necessárias**
- Extrair/avaliar FBX otimizado; exportar `missile.glb`.
- Verificar pivô/orientação no DCC e congelar transforms.
- Adicionar socket/trail VFX em runtime (partículas/sprite), não assar efeito pesado.
- Atualizar pool de projéteis para renderizar GLB instanciado.

**Riscos**
- RARs podem conter texturas/material extra não visíveis agora; confirmar antes de padronizar.
- Orientação errada gera míssil voando "de lado".

### 5) Nave do jogador — `assets/spaceship-player/`

**Arquivos observados**
- `SpaceShip.blend` (~9.3MB), `SpaceShip.fbx` (~1.2MB)
- `StarShip2.obj/.mtl`, `Texture.zip` (~18MB)

**Uso no jogo**
- Modelo externo da nave do jogador (terceira pessoa/morte espectador) e/ou referência de cockpit.

**Orientação/origem/hierarquia**
- **Forward:** nariz em **-Z**.
- **Origem:** centro de gameplay; idealmente próximo ao centro de massa/cockpit para câmera chase.
- **Escala:** normalizar para o tamanho atual da nave no gameplay.
- **Hierarquia alvo:** `ShipRoot`, `Hull`, `Cockpit`, `Engines`, `WeaponHardpoint_L/R`, `Thruster_VFX`.

**Mudanças necessárias**
- Selecionar fonte canônica (provavelmente `.blend`/`.fbx`) e exportar `player_ship.glb`.
- Separar cockpit interno se necessário; para primeira pessoa pode manter só canopy/interior mínimo.
- Definir hardpoints nomeados para muzzle/trails.
- Atualizar `Ship`/render para carregar GLB e alinhar câmera de cockpit/chase aos nós.

**Riscos**
- Texturas em zip podem não estar ligadas ao FBX/OBJ; revisar materiais.
- Escala/pivô incorretos vão quebrar mira, câmera e colisão.

### 6) Inimigo Bruiser — `assets/spaceship-bruiser/`

**Arquivos observados**
- `spaceCraft.obj/.mtl`, `spaceship.fbx` (~4.8MB)
- `textures_pbr.zip`, `textures_ue4.zip`, `textures_unity.zip` (35–40MB cada)

**Uso no jogo**
- Inimigo pesado (Bruiser).

**Orientação/origem/hierarquia**
- Forward -Z, origem no centro, escala maior que Scout.
- Hierarquia alvo: `BruiserRoot`, `Hull`, `Turrets`/`Weapons` (se houver), `Engines`, `DamageSockets`.

**Mudanças necessárias**
- Escolher set PBR (não UE4/Unity específico) e montar material glTF PBR.
- Exportar `enemy_bruiser.glb`.
- Validar bounding box e definir collider(s) simples.
- Mapear hardpoints para disparo/efeitos.

**Riscos**
- Três pacotes de textura podem confundir pipeline; escolher um padrão e documentar.
- OBJ grande (15MB) indica geometria pesada; pode precisar decimation/LOD.

### 7) Inimigo/Carga Cargo — `assets/spaceship-cargo/`

**Arquivos observados**
- `DAE.zip`, `FBX.zip`, `OBJ.zip` (~4.4MB cada)

**Uso no jogo**
- Possível nave cargo, objetivo, inimigo ou cenário. Definir papel no design antes de integrar.

**Orientação/origem/hierarquia**
- Validar forward/origem após extração.
- Se for alvo grande, definir múltiplos colliders box/sphere.

**Mudanças necessárias**
- Extrair, inspecionar, escolher formato fonte.
- Exportar `cargo_ship.glb`.
- Decidir papel gameplay (não integrar sem papel definido).
- Criar LODs se for grande.

**Riscos**
- Asset sem papel claro pode virar peso morto.
- Formatos zipados dificultam inspeção rápida.

### 8) Interior da nave — `assets/spaceship-interior/`

**Arquivos observados**
- `Spaceship_interior.blend` (~250MB), `.fbx` (~47MB), `.glb` (~48MB), `.obj` (~41MB)
- `textures (2).zip` (~30MB)

**Uso no jogo**
- Cockpit/interior primeira pessoa. Potencialmente alto impacto visual, mas também alto custo.

**Orientação/origem/hierarquia**
- **Origem:** posição da cabeça/câmera do piloto deve ser definida com nó `CameraSeat`/`PilotHead`.
- **Orientação:** forward -Z alinhado ao nariz da nave/jogo.
- **Escala:** compatível com player ship e câmera.
- **Hierarquia alvo:** `CockpitRoot`, `Canopy`, `Dashboard`, `Seat`, `InteractiveScreens` (se houver), `PilotCameraSocket`.

**Mudanças necessárias**
- Não usar `.blend`/`.obj` pesado em runtime. O `.glb` existe, mas 48MB é pesado — otimizar.
- Otimizar: remover objetos invisíveis, bake/atlas quando possível, reduzir texturas, Draco/Meshopt, KTX2.
- Alinhar `PilotCameraSocket` ao rig de câmera existente (ADR de cockpit/câmera).
- Separar cockpit em asset próprio carregável apenas no modo necessário.

**Riscos**
- Maior risco de performance/VR. Precisa budget de draw calls, triângulos e memória de textura.
- Pode conflitar com cockpit procedural atual; planejar substituição gradual.

### 9) Nave Scout — `assets/spaceship-scout/`

**Arquivos observados**
- `Spaceship.FBX` (~41MB), `.obj` (~32MB), `.mtl`, `.max` (~58MB), `tex.zip` (~21MB)

**Uso no jogo**
- Inimigo leve (Scout).

**Orientação/origem/hierarquia**
- Forward -Z, origem centro, escala menor que Bruiser.
- Hierarquia alvo: `ScoutRoot`, `Hull`, `Engine`, `WeaponHardpoint`.

**Mudanças necessárias**
- Extrair `tex.zip`, revisar materiais PBR.
- Exportar `enemy_scout.glb`.
- Criar LOD0/LOD1 se necessário.
- Collider simples.

**Riscos**
- FBX/OBJ/MAX muito pesados para um scout; otimização obrigatória.
- `.max` requer 3ds Max; preferir FBX/OBJ/extração já disponível.

## Checklist de aceitação por asset

Para cada asset integrado, validar:
- [ ] Export `.glb` abre no Three.js sem erros.
- [ ] Forward -Z correto (nariz/direção).
- [ ] Pivot/origem correto.
- [ ] Escala normalizada para gameplay.
- [ ] Materiais PBR corretos (base/normal/roughness/metallic/emissive/AO conforme disponível).
- [ ] Collider simples alinhado.
- [ ] Nome/hierarquia estável (`Root`, sockets).
- [ ] Tamanho runtime aceitável (meta inicial: < 5–10MB por nave, < 2MB por projétil/cristal, asteroides otimizados; HDR/env separado).
- [ ] Carregamento com fallback.

## Próximos passos recomendados

1. **Definir política de versionamento**: LFS para `assets/` raw ou manter raw fora do git e commitar só exports otimizados.
2. **Criar pipeline de export**: Blender -> glTF/GLB + KTX2 + manifest JSON.
3. **Integrar por prioridade de gameplay**:
   - P1: player ship, asteroides, cristais, míssil
   - P2: scout/bruiser
   - P3: background otimizado, interior cockpit
4. **Adicionar loader e manifest** no `client/`.
5. **Validar em desktop e mobile/VR** (FPS, memória, tempo de load).

## Observações

- Este relatório foi baseado na inspeção do diretório `assets/` e metadados/arquivos disponíveis no workspace; **orientação/pivô/hierarquia interna final devem ser confirmados no DCC (Blender/3ds Max/Maya)** antes do export definitivo.