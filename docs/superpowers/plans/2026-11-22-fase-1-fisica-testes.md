# Fase 1 — Núcleo Matemático e Física (M1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o núcleo determinístico de simulação do Asteroids 3D (shared/math + shared/physics) com fixed timestep de 30Hz, fronteira magnética quadrática, Spatial Hash 3D e Swept Collision, coberto por testes Vitest.

**Architecture:** Monorepo PNPM com pacote `shared/` isomórfico (sem DOM/Three/Node). A física usa `gl-matrix` (`Float32Array`) e funções puras/determinísticas sobre estado mutável via scratch buffers para evitar alocações no hot-loop. A detecção de colisão usa Spatial Hash 3D com células de 40u³ e testes contínuos swept segment-to-sphere/sphere-to-sphere.

**Tech Stack:** TypeScript 5.x (strict), PNPM Workspaces, gl-matrix v3.4+, Vitest, ESLint, tsup (futuro para shared/server), Vite (client futuro; M0 mínimo aqui).

**Spec:** `Documento Oficial de Projeto.pdf` (raiz do workspace), v3.0 — seções 2 (ADRs), 3.2/3.3 (estrutura/padrões), 4.1 (constantes), 4.2 (física/colisão), 4.3 (contratos), 5.1 (M0/M1), 5.2 (US-01..US-04), 5.3 (DoD).

## Global Constraints

- `FIXED_TICK_RATE = 30` e `dt = 1/30` (`0.033333...s`); cliente nunca envia `dt` arbitrário (ADR-06).
- `shared/` é isomórfico: **proibido** importar `three`, `window`, `document`, `fs`, `crypto` ou qualquer API de browser/Node.
- Zero alocação de objetos no hot-loop de simulação/render: não usar `new` por tick em vetores/quaterniões/arrays temporários; usar scratch buffers pré-alocados.
- TypeScript `strict: true` e `noUncheckedIndexedAccess: true`, target ES2022.
- Constantes físicas e contratos devem seguir os valores/nomes do spec (seção 4.1 e 4.3).
- Arena esférica: `ARENA_RADIUS=500`, `SOFT_BOUNDARY_START=450`, `HARD_BOUNDARY_LIMIT=515`, `BOUNDARY_SPRING_K=140`, `BOUNDARY_RADIAL_DAMPING=3.0`.
- Swept collision obrigatório: projétil vs esfera (segment-to-sphere) e nave vs asteroide (sphere-to-sphere) para evitar tunelamento.
- DoD: compila sem warnings/erros TS strict; zero alocações em `tick()`/hot paths; testes Vitest aprovados para regras de `shared/`.

## Review Focus

- **Input não finito/NaN em comandos físicos:** eixos, dt externo ou estados corrompidos com `NaN/Infinity` devem ser rejeitados ou normalizados com segurança; não podem propagar `NaN` silenciosamente para posição/rotação.
- **Tunelamento em alta velocidade:** projétil a `240 u/s` contra asteroide `SMALL (r=3)` e nave em boost (`113.75 u/s`) contra asteroide devem registrar colisão em 100% dos casos de teste de regressão.
- **Fronteira acima de 450u com boost:** com velocidade radial de saída máxima, a força restauradora quadrática (`140*u^2`) + damping radial deve impedir escape além do limite útil; nave não deve "atravessar" a arena.
- **Alocação oculta no hot-loop:** closures, spreads, `map/filter` criando arrays, `new Float32Array`/`vec3.create()` por tick, ou retorno de objetos novos em funções de física invalidam o SLA; revisar paths de `step`/`integrate`/`collision`.
- **Determinismo entre execuções:** mesma sequência de inputs e estado inicial deve produzir estado final bit-a-bit/numérico idêntico (dentro de Float32Array) em execuções repetidas; sem uso de `Math.random()`/tempo de parede no `shared/`.

---
## File Structure

### Criar
- `package.json` — raiz do workspace PNPM, scripts (`build`, `test`, `lint`, `typecheck`).
- `pnpm-workspace.yaml` — pacotes `shared`, `client`, `server`.
- `tsconfig.base.json` — TS estrito compartilhado.
- `.gitignore` — `node_modules`, `dist`, cobertura, arquivos temporários.
- `shared/package.json` — pacote isomórfico, dependência `gl-matrix`, dev `vitest`, `typescript`.
- `shared/tsconfig.json` — estende base, inclui `src` e `test`.
- `shared/vitest.config.ts` — configuração de testes do shared.
- `shared/src/index.ts` — exports públicos do shared.
- `shared/src/constants.ts` — constantes físicas/calibradas do spec 4.1.
- `shared/src/types.ts` — contratos do spec 4.3.
- `shared/src/math.ts` — helpers gl-matrix, clamp/finite, SpatialHash3D, swept collision.
- `shared/src/physics.ts` — integração determinística, damping exponencial, quatérnio, fronteira, step de nave.
- `shared/test/constants.test.ts` — valida valores críticos do spec.
- `shared/test/math.test.ts` — valida spatial hash e swept collisions.
- `shared/test/physics.test.ts` — valida movimento, fronteira, determinismo.

### Modificar
- Nenhum (workspace atualmente contém apenas `Documento Oficial de Projeto.pdf`).

### Responsabilidades
- `constants.ts`: fonte única de valores calibrados; sem lógica.
- `types.ts`: contratos e unions; sem lógica.
- `math.ts`: matemática vetorial/geométrica reutilizável e sem estado global mutável, exceto scratch buffers explícitos documentados.
- `physics.ts`: evolução de estado por tick fixo; usa `math.ts` e `constants.ts`.

---
### Task 1: Bootstrap mínimo do monorepo (pré-requisito F0 para M1)

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/vitest.config.ts`
- Create: `shared/src/index.ts`
- Test: execução de `pnpm install`, `pnpm -C shared test`, `pnpm -C shared typecheck`

**Interfaces:**
- Consumes: nenhum.
- Produces: workspace PNPM funcional; pacote `shared` com Vitest e TypeScript strict; script base para tasks seguintes.

- [ ] **Step 1: Criar arquivos de workspace e TS base**

Criar `pnpm-workspace.yaml` com pacotes:
```yaml
packages:
  - "shared"
  - "client"
  - "server"
```

Criar `tsconfig.base.json` com:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "outDir": "dist"
  }
}
```

- [ ] **Step 2: Criar manifests de pacote**

`package.json` raiz (nome `asteroids-3d`, private, packageManager pnpm) com scripts mínimos:
```json
{
  "name": "asteroids-3d",
  "private": true,
  "packageManager": "pnpm@10.0.0",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint"
  }
}
```

`shared/package.json`:
```json
{
  "name": "@asteroids/shared",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "echo 'lint not configured yet'"
  },
  "dependencies": {
    "gl-matrix": "^3.4.3"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Criar configs do shared e placeholder de export**

`shared/tsconfig.json` estendendo `../tsconfig.base.json`, `include: ["src", "test"]`.
`shared/vitest.config.ts` usando ambiente `node`.
`shared/src/index.ts` exportando placeholder `export const SHARED_READY = true;`.

- [ ] **Step 4: Instalar dependências e verificar falha/ok inicial**

Run: `pnpm install`
Expected: instalação concluída sem erro de workspace.

Run: `pnpm -C shared test`
Expected: PASS (0 ou 1 teste placeholder) ou falha clara se nenhum teste; se falhar por ausência de testes, adicionar `shared/test/smoke.test.ts` com `expect(SHARED_READY).toBe(true)` e repetir.

- [ ] **Step 5: Verificar typecheck e commit**

Run: `pnpm -C shared typecheck`
Expected: PASS.

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore shared
git commit -m "chore: bootstrap pnpm workspace and shared package"
```

---
### Task 2: Constantes e contratos do spec (US-01/US-03 base)

**Files:**
- Create: `shared/src/constants.ts`
- Create: `shared/src/types.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/test/constants.test.ts`

**Interfaces:**
- Consumes: Task 1 workspace.
- Produces: `WORLD_CONFIG`, `SHIP_CONFIG`, `ASTEROID_TIERS` com valores exatos do spec; tipos `PlatformMode`, `AsteroidSize`, `EnemyArchetype`, `ShipCommand`, `ShipState`, `AsteroidState`, `EnemyState`, `ProjectileState`, `PickupState`, `ClientMessage`, `ServerMessage`.

- [ ] **Step 1: Escrever teste falhando para constantes críticas**

```ts
import { describe, expect, it } from 'vitest'
import { ASTEROID_TIERS, SHIP_CONFIG, WORLD_CONFIG } from '../src/constants'

describe('spec constants', () => {
  it('matches world config from spec', () => {
    expect(WORLD_CONFIG.ARENA_RADIUS).toBe(500)
    expect(WORLD_CONFIG.SOFT_BOUNDARY_START).toBe(450)
    expect(WORLD_CONFIG.HARD_BOUNDARY_LIMIT).toBe(515)
    expect(WORLD_CONFIG.BOUNDARY_SPRING_K).toBe(140)
    expect(WORLD_CONFIG.BOUNDARY_RADIAL_DAMPING).toBe(3.0)
    expect(WORLD_CONFIG.FIXED_TICK_RATE).toBe(30)
    expect(WORLD_CONFIG.NETWORK_BROADCAST_RATE).toBe(20)
    expect(WORLD_CONFIG.INTERPOLATION_DELAY_MS).toBe(100)
    expect(WORLD_CONFIG.MAX_PLAYERS_PER_ROOM).toBe(8)
  })

  it('matches ship and asteroid tiers from spec', () => {
    expect(SHIP_CONFIG.MAX_SPEED).toBe(65)
    expect(SHIP_CONFIG.BOOST_MULTIPLIER).toBe(1.75)
    expect(SHIP_CONFIG.LINEAR_DRAG).toBe(1.8)
    expect(SHIP_CONFIG.THRUST_ACCEL).toBe(117)
    expect(ASTEROID_TIERS.LARGE).toEqual({ radius: 14, hp: 60, speed: 12, score: 100, children: 3, nextTier: 'MEDIUM' })
    expect(ASTEROID_TIERS.SMALL.nextTier).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar teste para ver falha**

Run: `pnpm -C shared test -- constants.test.ts`
Expected: FAIL com módulo/funções inexistentes.

- [ ] **Step 3: Implementar `constants.ts` e `types.ts` conforme spec 4.1/4.3**

Copiar os valores exatos do PDF para `WORLD_CONFIG`, `SHIP_CONFIG`, `ASTEROID_TIERS` usando `as const`. Implementar tipos/interfaces/unions exatamente com os nomes do spec. Em `index.ts`, exportar `constants`, `types`, `math` e `physics` (math/physics podem ser adicionados depois; manter exports estáveis).

- [ ] **Step 4: Rodar testes e typecheck**

Run: `pnpm -C shared test -- constants.test.ts`
Expected: PASS.

Run: `pnpm -C shared typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/constants.ts shared/src/types.ts shared/src/index.ts shared/test/constants.test.ts
git commit -m "feat(shared): add spec constants and protocol types"
```

---
### Task 3: Math base, Spatial Hash 3D e Swept Collision (US-04)

**Files:**
- Create: `shared/src/math.ts`
- Test: `shared/test/math.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: `gl-matrix` (`vec3`, `quat`), tipos básicos conforme necessidade.
- Produces:
  - `clamp(value: number, min: number, max: number): number`
  - `isFiniteNumber(value: unknown): value is number`
  - `SpatialHash3D` com `clear()`, `insert(id: number, pos: Float32Array | [number,number,number], radius: number): void`, `query(pos, radius, out: number[]): number[]|void` (usar padrão de out-array para zero-alloc).
  - `sweptSegmentSphere(ax,ay,az,bx,by,bz,cx,cy,cz,r): { hit: boolean; t: number; nx: number; ny: number; nz: number }` ou forma equivalente sem alocar por chamada (resultado em objeto scratch opcional).
  - `sweptSphereSphere(p1x,..., v1x,..., p2x,..., v2x,..., r): ...` para nave vs asteroide.

- [ ] **Step 1: Escrever testes falhando para colisões contínuas**

```ts
import { describe, expect, it } from 'vitest'
import { SpatialHash3D, sweptSegmentSphere } from '../src/math'

it('detects fast projectile hitting small asteroid', () => {
  // projectile 240 u/s, dt 1/30 => 8u segment; asteroid SMALL r=3 at origin
  const hit = sweptSegmentSphere( -4,0,0, 4,0,0, 0,0,0, 3.2 )
  expect(hit.hit).toBe(true)
  expect(hit.t).toBeGreaterThanOrEqual(0)
  expect(hit.t).toBeLessThanOrEqual(1)
})

it('spatial hash returns nearby ids in same/neighbor cells', () => {
  const h = new SpatialHash3D(40)
  h.insert(1, [0,0,0], 3)
  h.insert(2, [39,0,0], 3)
  h.insert(3, [200,0,0], 3)
  const out: number[] = []
  h.query([10,0,0], 5, out)
  expect(out).toContain(1)
  expect(out).toContain(2)
  expect(out).not.toContain(3)
})
```

- [ ] **Step 2: Rodar teste para ver falha**

Run: `pnpm -C shared test -- math.test.ts`
Expected: FAIL (módulo/funções ausentes).

- [ ] **Step 3: Implementar `math.ts` com foco em zero-alloc**

Implementar `SpatialHash3D` usando `Map<number, number[]>` ou estrutura com pooling; limpar por `length = 0` nos arrays reutilizados quando possível. Célula 40u por padrão. `query` deve aceitar `out` array e limpá-lo (`out.length = 0`) para evitar alocação. `sweptSegmentSphere` deve resolver ponto mais próximo no segmento e verificar interseção com raio expandido. `sweptSphereSphere` deve reduzir para teste de ray/segment contra raio somado usando movimento relativo.

- [ ] **Step 4: Rodar testes e adicionar caso de tunelamento de boost**

Adicionar teste: esfera de raio nave+asteroide se deslocando `113.75/30` u por tick colide quando caminho cruza. Run: `pnpm -C shared test -- math.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/math.ts shared/src/index.ts shared/test/math.test.ts
git commit -m "feat(shared): add spatial hash and swept collision math"
```

---
### Task 4: Física determinística 30Hz, damping, quatérnio e fronteira (US-03)

**Files:**
- Create: `shared/src/physics.ts`
- Test: `shared/test/physics.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: `WORLD_CONFIG`, `SHIP_CONFIG`, `gl-matrix` (`vec3`, `quat`), helpers de `math.ts`.
- Produces:
  - `const FIXED_DT = 1 / WORLD_CONFIG.FIXED_TICK_RATE`
  - `integrateLinearVelocity(vel, accel, dt, dragK, outVel): void` usando `v = (v + a*dt) * exp(-k*dt)`
  - `integrateAngularVelocity(angVel, angAccel, dt, dragK, outAngVel): void`
  - `integrateRotation(rotQuat, angVel, dt, outRotQuat): void` com limiar `OMEGA > 1e-5`
  - `applyMagneticBoundary(pos, vel, outAccelOrVelEffect): void` aplicando força quadrática e damping radial de saída quando `r > 450`
  - `stepShip(state: ShipState, cmd: ShipCommand, dt = FIXED_DT): void` (ou função pura que escreve em estado/buffers) sem alocar.

- [ ] **Step 1: Escrever testes falhando de física**

```ts
import { describe, expect, it } from 'vitest'
import { FIXED_DT, applyMagneticBoundary, integrateLinearVelocity, stepShip } from '../src/physics'
import { SHIP_CONFIG, WORLD_CONFIG } from '../src/constants'

it('exponential drag slows velocity without thrust', () => {
  const v = new Float32Array([10,0,0])
  integrateLinearVelocity(v, new Float32Array([0,0,0]), FIXED_DT, SHIP_CONFIG.LINEAR_DRAG, v)
  expect(v[0]).toBeLessThan(10)
  expect(v[0]).toBeGreaterThan(0)
})

it('magnetic boundary pushes inward beyond 450u', () => {
  const pos = new Float32Array([460,0,0])
  const vel = new Float32Array([20,0,0])
  const accel = new Float32Array([0,0,0])
  applyMagneticBoundary(pos, vel, accel)
  expect(accel[0]).toBeLessThan(0)
})
```

- [ ] **Step 2: Rodar para ver falha**

Run: `pnpm -C shared test -- physics.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar física com buffers pré-alocados**

Usar scratch `vec3/quat` no escopo do módulo para cálculos intermediários. `applyMagneticBoundary`: `r = ||p||`; se `r <= 450` retorna; `u = clamp((r-450)/50,0,1.3)`; normal `n=p/r`; aceleração `-n*140*u*u`; se velocidade radial de saída `dot(v,n)>0`, aplicar amortecimento radial `v -= n*dot(v,n)*BOUNDARY_RADIAL_DAMPING*dt` ou forma equivalente estável conforme spec (documentar fórmula exata escolhida no código e teste). `stepShip` deve clamp de inputs em `[-1,1]`, ignorar `NaN/Infinity`, aplicar aceleração local->mundo, integrar, atualizar quatérnio, aplicar fronteira.

- [ ] **Step 4: Adicionar teste de determinismo e boost boundary**

```ts
it('same input sequence yields identical final state', () => {
  // criar dois estados idênticos, rodar N ticks com mesmos cmds, deep-equal arrays
})

it('boosting outward at boundary does not escape hard limit', () => {
  // posicionar nave perto de 450u com vel radial alta e boost/thrust para fora
  // simular 120 ticks; expect ||pos|| <= 515 (ou margem definida) e retorno para dentro
})
```

Run: `pnpm -C shared test -- physics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/physics.ts shared/src/index.ts shared/test/physics.test.ts
git commit -m "feat(shared): implement deterministic ship physics and magnetic boundary"
```

---
### Task 5: Integração de colisão swept no fluxo de simulação (US-04 conclusão M1)

**Files:**
- Modify: `shared/src/physics.ts` (ou `shared/src/collision.ts` se separar; preferir manter simples)
- Create: `shared/src/collision.ts` (opcional, se melhorar clareza)
- Test: `shared/test/collision.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: `SpatialHash3D`, `sweptSegmentSphere`, `sweptSphereSphere`, tipos `ProjectileState`, `AsteroidState`, `ShipState`.
- Produces:
  - `resolveProjectileAsteroidCollisions(projectiles, asteroids, outEvents): void` usando segmento `prevPos->pos`.
  - `resolveShipAsteroidCollisions(ships, asteroids, outEvents): void` usando swept sphere-sphere, rebote elástico parcial `e=0.6`, massa `M ~ R^3`, dano `max(5, 0.45*vrel)`.

- [ ] **Step 1: Escrever teste falhando de tunelamento**

```ts
it('projectile at 240u/s hits SMALL asteroid (r=3)', () => {
  // prevPos fora, pos além; swept deve detectar
})

it('boosting ship does not tunnel through asteroid', () => {
  // ship speed 113.75u/s, dt 1/30 => ~3.79u displacement
})
```

- [ ] **Step 2: Rodar para ver falha**

Run: `pnpm -C shared test -- collision.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar resolução de colisão com zero-alloc**

Usar `SpatialHash3D` por tick: `clear()` e reinsert de asteroides. Para projéteis, consultar por segmento expandido e testar `sweptSegmentSphere`. Para naves, usar movimento relativo nave-asteroide e `sweptSphereSphere`. Escrever eventos em array pré-alocado/out param (ex.: `{kind, aId, bId, t, damage}`) com contador, sem `push` de objetos novos no hot path (usar pool ou struct arrays).

- [ ] **Step 4: Rodar testes de colisão e regressão total shared**

Run: `pnpm -C shared test`
Expected: PASS em todos os testes de `shared`.

Run: `pnpm -C shared typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src shared/test
git commit -m "feat(shared): add swept collision resolution for projectiles and ships"
```

---
### Task 6: Verificação de qualidade M1 e documentação de execução

**Files:**
- Create: `docs/superpowers/specs/2026-11-22-fase-1-fisica-testes-design.md` (resumo de decisões e rastreabilidade para o spec)
- Modify: `README.md` (opcional, criar se não existir) com comandos de execução
- Test: comandos de verificação

**Interfaces:**
- Consumes: Tasks 1–5 completas.
- Produces: documentação mínima para rodar/testar Fase 1; evidência de comandos; rastreabilidade US-03/US-04/ADRs.

- [ ] **Step 1: Escrever checklist de verificação no doc de design**

Criar spec/design curto de Fase 1 listando: ADR-06, constantes 4.1 usadas, arquivos criados, cobertura de testes US-03/US-04, e riscos residuais.

- [ ] **Step 2: Rodar verificação completa**

Run: `pnpm install`
Expected: lockfile estável / instalação ok.

Run: `pnpm -C shared lint` (se placeholder, registrar; se ESLint configurado, PASS)
Expected: sem erro bloqueante.

Run: `pnpm -C shared typecheck`
Expected: PASS.

Run: `pnpm -C shared test`
Expected: PASS, incluindo casos de tunelamento e fronteira.

- [ ] **Step 3: Registrar evidências na documentação**

No doc de design, incluir tabela de comandos, resultado esperado e status. Não inventar resultados não executados.

- [ ] **Step 4: Revisão final contra DoD**

Checklist DoD M1/Fase 1:
- [ ] TS strict sem erros.
- [ ] Sem alocações óbvias em hot-loop (revisão de código).
- [ ] Testes Vitest shared passando.
- [ ] Swept collision cobre projétil rápido e nave em boost.
- [ ] Fronteira magnética validada.

- [ ] **Step 5: Commit**

```bash
git add docs README.md shared
git commit -m "docs: add phase 1 physics design and verification notes"
```

---
## Notas de Execução

- **Dependência de Fase 0:** este plano inclui bootstrap mínimo (Task 1) porque o workspace está vazio. US-02 (HTTPS mkcert + proxy /ws) é Fase 0/M0 de infraestrutura de cliente; não é necessário para validar física determinística em `shared/`, mas deve ser planejado no próximo plano de Fase 0/2.
- **YAGNI:** não implementar render, input, rede, IA ou áudio nesta fase.
- **Performance:** antes de fechar M1, fazer revisão manual dos hot paths procurando `new`, `[]`, `{}`, `map/filter/reduce` criando arrays, e alocações de gl-matrix por tick.
- **Próximo plano:** `M2 — Visual 3D e Pipeline Tri-Modal` / US-05..07, dependendo de Fase 0 completa no client (`vite`, `mkcert`, cockpit).