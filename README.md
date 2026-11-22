# Asteroids 3D

Monorepo do Asteroids 3D. Este repositório entrega atualmente a **Fase 1 (M1) — núcleo
matemático e física determinística** no pacote isomórfico `shared/`. Cliente 3D, servidor e
infraestrutura HTTPS/WebXR (F0/F2+) ainda serão adicionados.

## Pré-requisitos

- Node.js 22+ (verificado com `v24.19.0`)
- PNPM 10 (`packageManager: pnpm@10.0.0`, verificado com `10.0.0`)

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

### Raiz do workspace (aplica o script a todos os pacotes via `pnpm -r`)

```bash
pnpm test                  # pnpm -r test
pnpm typecheck             # pnpm -r typecheck
pnpm build                 # pnpm -r build
pnpm lint                  # pnpm -r lint
```

Todos os comandos acima foram executados com sucesso (`exit 0`) na verificação da Fase 1.
Os detalhes e a evidência estão em
`docs/superpowers/specs/2026-11-22-fase-1-fisica-testes-design.md`.

## Estrutura atual

```
shared/
  src/
    constants.ts   # constantes calibradas do spec (seção 4.1)
    types.ts       # contratos de estado/comando/protocolo (seção 4.3)
    math.ts        # clamp/finite, SpatialHash3D, swept segment/sphere
    physics.ts     # FIXED_DT = 1/30, damping, quatérnio, fronteira magnética, stepShip
    collision.ts   # resolvers swept projétil/asteroide e nave/asteroide + pool de eventos
    index.ts       # exports públicos
  test/            # Vitest: constants, math, physics, collision, smoke
```

`shared/` é isomórfico: não importa `three`, `window`, `document`, `fs` ou `crypto`, e não
usa aleatoriedade nem relógio de parede. A física roda em passos fixos de 1/30 s (ADR-06) e
não aloca objetos no hot-loop (buffers pré-alocados reutilizados a cada tick).

## Documentação

- Spec: `Documento Oficial de Projeto.pdf` (v3.0)
- Plano da Fase 1: `docs/superpowers/plans/2026-11-22-fase-1-fisica-testes.md`
- Design e verificação da Fase 1: `docs/superpowers/specs/2026-11-22-fase-1-fisica-testes-design.md`

## Próximos passos

- Fase 0 / US-02: HTTPS com `mkcert` e proxy reverso `/ws` na mesma porta.
- M2 / US-05..07: pipeline 3D tri-modal (plano, VR Box, WebXR), cockpit e HUD diegético.
