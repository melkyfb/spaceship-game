# Fase 1 — Núcleo Matemático e Física (M1): decisões, rastreabilidade e verificação

> Documento de execução da Task 6. Consolida as decisões das Tasks 1–5, a rastreabilidade
> com o spec e o resultado **executado** dos comandos de verificação (nenhum resultado é
> inferido ou inventado).
>
> - Spec: `Documento Oficial de Projeto.pdf` v3.0 — seções 2 (ADRs), 3.2/3.3, 4.1, 4.2,
>   4.3, 5.1 (M0/M1), 5.2 (US-01..US-04), 5.3 (DoR/DoD).
> - Plano: `docs/superpowers/plans/2026-11-22-fase-1-fisica-testes.md`.
> - Branch: `feat/fase-1-fisica-testes`.

## 1. Escopo e decisões de arquitetura

- **Monorepo PNPM**, pacote `shared/` isomórfico. `shared/src` não importa `three`, `window`,
  `document`, `fs`, `crypto` e não usa `Math.random()`, `Date.now()` ou relógio de parede
  (verificado por varredura de código — único "match" é um comentário em `collision.ts`).
- **Física determinística a 30 Hz** com vetores/quatérnios `gl-matrix` sobre `Float32Array`.
  Todo estado é mutado **in-place**; buffers de trabalho (`vec3.create()`, `quat.create()`,
  `HitResult`, arrays de candidatos, pool de eventos) são criados **uma única vez no escopo
  de módulo** e reutilizados — nenhuma alocação por tick no regime estacionário.
- **Fronteira magnética quadrática** e **colisão contínua (swept)** com Spatial Hash 3D
  de células de 40 u³ (`SpatialHash3D(40)` padrão).
- **YAGNI (Fase 1):** sem render, input, rede, IA, áudio, destruição de asteroide,
  destruição de projétil, shield/energy/cooldowns ou spawn de filhos. Isso pertence a
  F2+; o que existe hoje é o núcleo determinístico e os resolvers de colisão.
- **Tipagem:** `strict: true` + `noUncheckedIndexedAccess: true`, alvo ES2022
  (`tsconfig.base.json`). Leituras de arrays passam por `?? 0` ou type guards.

## 2. ADR-06 — Determinismo por Fixed Timestep

O spec (seção 2) define: *"Toda a física em `shared/` executa em passos discretos fixos de
Δt = 1/30 s (33,33 ms). O cliente nunca envia valores arbitrários de dt para o servidor,
prevenindo dessincronização entre taxas de quadros distintas (60 Hz vs. 90 Hz) e bloqueando
speed-hacks."*

Rastreabilidade da implementação:

| Aspecto | Onde | Como |
|---|---|---|
| Passo fixo | `shared/src/physics.ts` | `export const FIXED_DT = 1 / WORLD_CONFIG.FIXED_TICK_RATE` (= 1/30). |
| Sanitização de `dt` | `stepShip()` | o padrão é `FIXED_DT`; `dt` não finito ou `<= 0` cai no padrão. Um `dt` finito e positivo só é aceito como argumento explícito (uso interno/teste); o protocolo de rede não tem campo `dt` (ADR-06: o cliente nunca envia `dt`). |
| Damping na fronteira | `applyMagneticBoundary()` | usa `FIXED_DT` no termo de amortecimento radial, não um `dt` recebido. |
| Swept de nave | `shared/src/collision.ts` | `sweptSphereSphere(..., FIXED_DT, HIT)`. |
| Reprodutibilidade | `shared/test/physics.test.ts` | 200 ticks com a mesma sequência de comandos produzem arrays idênticos (pos/vel/rot/angVel). |
| Ausência de fontes externas de não determinismo | `shared/src/*` | sem `Math.random`, `Date.now`, `performance.now`, I/O ou relógio. |

## 3. Constantes do spec 4.1 usadas

Fonte única: `shared/src/constants.ts` (`as const`). Valores conferidos por
`shared/test/constants.test.ts`.

### 3.1 `WORLD_CONFIG`

| Constante | Valor | Uso em M1 |
|---|---:|---|
| `ARENA_RADIUS` | 500 | declarada (raio de referência da arena esférica); não entra no cálculo da mola. |
| `SOFT_BOUNDARY_START` | 450 | início da fronteira magnética em `applyMagneticBoundary`. |
| `HARD_BOUNDARY_LIMIT` | 515 | limite superior validado no teste de contenção com boost. |
| `BOUNDARY_SPRING_K` | 140 | mola restauradora `a = -n · 140 · u²` (supera o empuxo de boost 113,75). |
| `BOUNDARY_RADIAL_DAMPING` | 3,0 | amortecimento radial da velocidade de saída. |
| `FIXED_TICK_RATE` | 30 | base de `FIXED_DT` e do swept de nave (ADR-06). |
| `NETWORK_BROADCAST_RATE` | 20 | declarada; consumo é do servidor (F5), fora do M1. |
| `INTERPOLATION_DELAY_MS` | 100 | declarada; consumo é do cliente (F5), fora do M1. |
| `MAX_PLAYERS_PER_ROOM` | 8 | declarada; consumo é do servidor (F5), fora do M1. |
| `RESPAWN_DELAY_SEC` / `SPAWN_INVULN_SEC` | 3,0 / 3,0 | declaradas; consumo é da lógica de jogo (F2+). |

### 3.2 `SHIP_CONFIG` (usadas na física/colisão)

| Constante | Valor | Uso em M1 |
|---|---:|---|
| `RADIUS` | 2,2 | raio da nave no swept sphere-sphere e na massa `M ∝ R³`. |
| `MAX_SPEED` | 65 | velocidade terminal natural (com `LINEAR_DRAG`); base do cenário de boost nos testes. |
| `BOOST_MULTIPLIER` | 1,75 | 65 × 1,75 = **113,75 u/s** (cenário de tunelamento e fronteira). |
| `LINEAR_DRAG` | 1,8 | `k` do damping exponencial (`THRUST_ACCEL / k = 117/1,8 = 65`). |
| `THRUST_ACCEL` | 117 | empuxo, multiplicado por 1,75 em boost. |
| `STRAFE_ACCEL` | 75 | aceleração de strafe no quadro local. |
| `ANGULAR_DRAG` | 8,5 | `k` do damping angular. |
| `TURN_ACCEL_PITCH` / `TURN_ACCEL_YAW` / `TURN_ACCEL_ROLL` | 12,75 / 15,3 / 18,7 | eixos angulares do comando. |

As demais (`PRIMARY_COOLDOWN`, `SECONDARY_COOLDOWN`, `MAX_SHIELD`, `MAX_ENERGY`,
`ENERGY_REGEN_RATE`, `BOOST_DRAIN_RATE`, `MISSILE_ENERGY_COST`) estão declaradas com os
valores do spec, mas só serão consumidas pela lógica de jogo de F2+.

### 3.3 `ASTEROID_TIERS`

| Tier | radius | hp | speed | score | children | nextTier |
|---|---:|---:|---:|---:|---:|---|
| `LARGE` | 14 | 60 | 12 | 100 | 3 | `MEDIUM` |
| `MEDIUM` | 7 | 30 | 20 | 250 | 2 | `SMALL` |
| `SMALL` | 3 | 10 | 30 | 500 | 0 | `null` |

Em M1 o `radius` alimenta o raio efetivo das colisões swept (`R_alvo + R_agente`) e a
massa `M ∝ R³` do rebote. `hp`, `score` e `children` ficam para F2+.

### 3.4 Regras de colisão do spec 4.2

- Projétil vs. esfera: segmento `[prevPos, pos]` contra `R_alvo + R_projétil` a 240 u/s.
- Nave vs. asteroide: movimento relativo contra `R_nave + R_asteroide`, restituição
  `e = 0,6`, massa `M ∝ R³`, dano `max(5, 0,45 · vrel)`.
- Fronteira: `u = clamp((r-450)/50, 0, 1,3)`, `n = p/r`, `a_border = -n · 140 · u²`,
  amortecimento radial de saída `v -= n · (v·n) · 3,0 · FIXED_DT`.

## 4. Arquivos criados / modificados (Tasks 1–5)

| Arquivo | Task | Papel |
|---|---|---|
| `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `pnpm-lock.yaml` | 1 | bootstrap do workspace PNPM e TS estrito. |
| `shared/package.json`, `shared/tsconfig.json`, `shared/vitest.config.ts` | 1 | manifest, configs e scripts do pacote isomórfico. |
| `shared/src/index.ts` | 1–5 | exportações públicas (`constants`, `types`, `math`, `physics`, `collision`). |
| `shared/src/constants.ts`, `shared/src/types.ts` | 2 | constantes 4.1 e contratos 4.3 (US-03 base). |
| `shared/src/math.ts` | 3 | `clamp`, `isFiniteNumber`, `SpatialHash3D`, `sweptSegmentSphere`, `sweptSphereSphere`. |
| `shared/src/physics.ts` | 4 | `FIXED_DT`, integração linear/angular, quatérnio, fronteira magnética, `stepShip`. |
| `shared/src/collision.ts` | 5 | `CollisionEventBuffer` e os dois resolvers swept (US-04). |
| `shared/test/constants.test.ts`, `math.test.ts`, `physics.test.ts`, `collision.test.ts`, `smoke.test.ts` | 1–5 | suíte Vitest (38 testes). |

## 5. Cobertura de testes — US-03 / US-04

### US-03 (F1/Física)
*Critério do spec:* "Nave para suavemente sem empuxo; ao cruzar 450 u, é repelida antes de
atingir 500 u mesmo em Boost", com passos fixos de 1/30 s e damping exponencial.

| Verificação | Teste (`shared/test/physics.test.ts`) |
|---|---|
| `FIXED_DT = 1/30` e `FIXED_TICK_RATE = 30` | `FIXED_DT is 1/30 from world config`. |
| Damping exponencial `v=(v+a·dt)·e^(-k·dt)` | `exponential drag slows velocity without thrust`, `integrateLinearVelocity matches ...`, `integrateAngularVelocity ...`. |
| Integração de quatérnio (`Ω > 1e-5`, normalização) | `integrateRotation leaves ...`, `integrateRotation applies omega*dt ...`, `integrateRotation never propagates NaN ...`. |
| Fronteira magnética > 450 u e damping radial | `magnetic boundary pushes inward beyond 450u`, `... is a no-op at or inside 450u`, `... damps outward radial velocity`, `... adds to existing accel ...`. |
| Contenção em boost + retorno | `boosting outward at boundary does not escape hard limit` (120 ticks com thrust+boost; `maxR <= 515` e retorno para `< 470`). |
| Sanitização NaN/Infinity e clamp `[-1,1]` | `clamps axes to [-1,1] and ignores NaN/Infinity`, `sanitizes non-finite state ...`, `integration functions never propagate NaN/Infinity`. |
| Determinismo e zero-alloc (proxy) | `same input sequence yields identical final state` (200 ticks), `writes in place without replacing state arrays`. |

### US-04 (F1/Colisão)
*Critério do spec:* "Testes Vitest comprovam detecção de impacto entre projétil a 240 u/s e
asteroide SMALL (r=3 u) em 100% dos casos", com Spatial Hash 3D e swept para projéteis e
naves.

| Verificação | Teste |
|---|---|
| Swept segment-to-sphere, ambas extremidades fora | `math.test.ts`: `detects fast projectile hitting small asteroid` (r = 3,2); `collision.test.ts`: `projectile at 240u/s hits SMALL ...`. |
| Normal de contato e negação (miss) | `math.test.ts`: `misses when ...`, `reports a contact normal ...`; `collision.test.ts`: `does not emit when ...`. |
| Spatial Hash 3D (células/consulta, dedup, clear) | `math.test.ts`: `returns nearby ids ...`, `clears the out array ...`, `clear() removes all inserted ids`; `collision.test.ts`: `spatial hash culls asteroids far ...`. |
| Swept sphere-sphere em boost (113,75 u/s) | `math.test.ts`: `boosting ship does not tunnel ...`; `collision.test.ts`: `boosting ship does not tunnel through asteroid at 113.75 u/s`. |
| Física do rebote (`e=0,6`, `M ∝ R³`) e dano | `collision.test.ts`: `applies partial elastic bounce ...`, `damage has a floor of 5 ...`. |
| Zero-alloc do buffer de eventos | `collision.test.ts`: 3 testes de `CollisionEventBuffer` (reuso de objeto, `reset`/overflow, acumulação entre resolvers). |

Contagem da suíte executada: `constants` 2, `math` 9, `smoke` 1, `collision` 9,
`physics` 17 → **38 testes em 5 arquivos**.

## 6. Evidência de verificação (executado em 2026-11-22)

Todos os comandos foram executados neste workspace com `pnpm@10.0.0` / Node `v24.19.0`.
O wrapper do shell do harness exige `cmd /c "<comando>"`; a saída abaixo é a real.

| Comando | Resultado esperado (brief) | Status | Evidência executada |
|---|---|---|---|
| `pnpm install` | lockfile estável / instalação ok | **PASS** | `Scope: all 2 workspace projects` / `Already up to date` / `Done in 256ms`; `git status --short` limpo e `pnpm-lock.yaml` sem diff. `exit 0`. |
| `pnpm -C shared lint` | sem erro bloqueante; placeholder deve ser registrado | **PASS (placeholder)** | Script é `echo 'lint not configured yet'`; saída literal `'lint not configured yet'`. ESLint **não** está configurado nesta fase. `exit 0`. |
| `pnpm -C shared typecheck` | PASS | **PASS** | `tsc -p tsconfig.json --noEmit` sem saída de erro; `exit 0`. |
| `pnpm -C shared test` | PASS, incluindo tunelamento e fronteira | **PASS** | Vitest `v2.1.9`, `5 passed (5)` arquivos, `38 passed (38)` testes, `Duration 918ms`; `exit 0`. |

Comandos de verificação complementares executados (todos `exit 0`): scripts agregados da
raiz `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint` (usam `pnpm -r` e, portanto,
'passam' pelo mesmo placeholder de lint do pacote `shared`); varredura de `shared/src` por
imports/APIs proibidas (nenhuma ocorrência real); `git status --short` e
`git diff --stat pnpm-lock.yaml` após `pnpm install` (sem alterações).

> Nota: a tabela registra **somente** comandos executados. Não há resultado declarado para
> ESLint, build de produção (`tsup`), testes em dispositivo ou Fase 0/2.

## 7. Revisão final contra DoD (M1 / Fase 1)

| # | Item DoD (spec 5.3 / plano) | Status | Justificativa |
|---|---|---|---|
| 1 | TypeScript `strict` sem warnings/erros | ✅ | `tsc --noEmit` limpo; `noUncheckedIndexedAccess` ativo em `tsconfig.base.json`. |
| 2 | Zero alocações em `tick()`/hot-loop (revisão de código) | ✅ | `stepShip`, integradores, `applyMagneticBoundary`, swept e resolvers escrevem em buffers/estado pré-alocados; `SpatialHash3D.clear()` usa `length = 0`; `CollisionEventBuffer.push` sobrescreve slots. Sem `new`, literais `[]`/`{}`, `map/filter/reduce` ou `vec3.create()/quat.create()` dentro dos loops. (Ressalva: buckets do hash são alocados na **primeira** visita de cada célula — cold start, amortizado; ver riscos.) |
| 3 | Testes Vitest aprovados para regras de `shared/` | ✅ | 38/38 testes, 5/5 arquivos. |
| 4 | Swept cobre projétil rápido e nave em boost | ✅ | Casos com ambas as extremidades fora do raio efetivo em `math.test.ts` e `collision.test.ts` (240 u/s e 113,75 u/s). |
| 5 | Fronteira magnética validada | ✅ | Testes de sinal (empurra para dentro), no-op ≤ 450, damping radial documentado e contenção com boost até `<= 515`. |

O item 4 do DoD do spec ("validado manualmente nos dispositivos-alvo atingindo as metas de
FPS") depende de cliente/render (F2) e **não é reivindicado nesta Fase 1**.

## 8. Matriz de rastreabilidade

| Requisito | ADR / spec | Código | Teste |
|---|---|---|---|
| Passo fixo, sem `dt` arbitrário | ADR-06, 4.2 | `physics.ts` (`FIXED_DT`, `stepShip`) | `physics.test.ts` (FIXED_DT, determinismo, clamp) |
| Damping exponencial | 4.2.1, SHIP_CONFIG | `physics.ts` (`integrateLinearVelocity`, `integrateAngularVelocity`) | `physics.test.ts` (fórmula, NaN) |
| Quatérnio | 4.2.2 | `physics.ts` (`integrateRotation`) | `physics.test.ts` (ω > 1e-5, normalização) |
| Fronteira magnética (US-03) | 4.1, 4.2.3 | `physics.ts` (`applyMagneticBoundary`) | `physics.test.ts` (fronteira e boost) |
| Spatial Hash 3D + swept (US-04) | 4.2.4 | `math.ts` (`SpatialHash3D`, `swept*`) | `math.test.ts` (hash, segmento, esferas) |
| Resolução de colisão no tick | 4.2.4 | `collision.ts` (resolvers + buffer) | `collision.test.ts` (tunelamento, rebote, eventos) |
| Contratos de dados | 4.3 | `types.ts` | `constants.test.ts` (valores usados) |

## 9. Riscos residuais e fora de escopo

1. **`R_projétil = 0.2` é inferido**, não declarado no spec: o spec dá `R_alvo + R_projétil`
   e o padding `3,2 = 3 + 0,2` já era usado nos testes da Task 3. Se F2 definir outro valor,
   ajustar `PROJECTILE_RADIUS` em `collision.ts`.
2. **Evento de projétil com `damage = 0`**: o spec/brief não fornece dano de laser; a lógica
   de jogo (F2) deve atribuí-lo.
3. **Resolvers não filtram `alive`/`invulnTimer` nem consomem projéteis**, e a nave não é
   reposicionada para fora da sobreposição após o rebote em colisão múltipla no mesmo tick;
   são decisões de fluxo de jogo (F2+), documentadas no report da Task 5.
4. **Cold-start do Spatial Hash**: novos buckets `[]` e entradas em `Map` são criados na
   primeira visita de cada célula; o regime estacionário é zero-alloc. Em arena de 500 u com
   células de 40 u o conjunto de células é finito e estabiliza nos primeiros ticks.
5. **ESLint não configurado**: `pnpm -C shared lint` é apenas um placeholder (`echo`). A
   verificação estática real hoje é `tsc --noEmit` + a varredura manual de imports proibidos.
6. **Validação em dispositivo (Quest 3 / Android / PC) e SLA de FPS** não executada —
   depende do cliente 3D (F2). Fora do M1.
7. **US-02 (HTTPS mkcert + proxy `/ws`)** é infraestrutura de cliente F0/M0: não é
   necessária para validar a física em `shared/`, mas deve entrar no próximo plano.
8. **Próximo plano:** `M2 — Visual 3D e Pipeline Tri-Modal` (US-05..07), após Fase 0 de
   cliente (`vite`, `mkcert`, cockpit).
