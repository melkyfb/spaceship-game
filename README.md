# Asteroids 3D

Monorepo do Asteroids 3D. Este repositório entrega a **Fase 1 (M1) — núcleo
matemático e física determinística** no pacote isomórfico `shared/`, e o **M0 —
cliente Vite/TypeScript com servidor de desenvolvimento HTTPS confiável, status
WebSocket e proxy `/ws` na mesma origem**, além do stub WS em `server/`. Cliente 3D,
servidor de jogo real e WebXR (F2+) ainda serão adicionados.

## Pré-requisitos

- Node.js 22+ (verificado com `v24.19.0`)
- PNPM 10 (`packageManager: pnpm@10.0.0`, verificado com `10.0.0`)
- mkcert — para confiar no certificado local no PC. O `vite-plugin-mkcert` baixa o
  binário automaticamente na primeira execução; também é possível instalar o mkcert
  manualmente (ver [HTTPS local (mkcert)](#https-local-mkcert)).

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

### Pacote `client` (M0)

```bash
pnpm -C client dev        # Vite em HTTPS, 0.0.0.0:5173 (strictPort)
pnpm -C client preview    # preview em HTTPS, 0.0.0.0:4173 (strictPort)
pnpm -C client build      # tsc --noEmit + vite build
pnpm -C client typecheck  # tsc --noEmit (strict + noUncheckedIndexedAccess)
pnpm -C client test       # Vitest (buildWsUrl + demais testes do cliente)
```

### Pacote `server` (stub WS do M0)

```bash
pnpm -C server dev        # stub WebSocket em ws://localhost:8080 (tsx)
pnpm -C server build      # tsc --noEmit (checagem; sem emissão nesta fase)
pnpm -C server typecheck  # tsc --noEmit (strict + noUncheckedIndexedAccess)
pnpm -C server test       # placeholder: sem testes nesta fase
```

### Raiz do workspace (aplica o script a todos os pacotes via `pnpm -r`)

```bash
pnpm test                  # pnpm -r test
pnpm typecheck             # pnpm -r typecheck
pnpm build                 # pnpm -r build
pnpm lint                  # pnpm -r lint
pnpm dev:client            # atalho para pnpm -C client dev
pnpm dev:server            # atalho para pnpm -C server dev
```

Todos os comandos acima foram executados com sucesso (`exit 0`) nas verificações da Fase 1 e do M0.
Os detalhes e a evidência estão em
`docs/superpowers/specs/2026-11-22-fase-1-fisica-testes-design.md`.

## HTTPS local (mkcert)

O `client/vite.config.ts` usa `vite-plugin-mkcert`: o Vite serve `https://` na porta
`5173` (e o preview na `4173`), com `host: '0.0.0.0'` e `strictPort: true`. O plugin
gera automaticamente uma autoridade certificadora (CA) local e um certificado que cobre
`localhost`, `::1`, `127.0.0.1` e os IPs da rede local — portanto o mesmo certificado
serve para acessar `https://<IP-LAN>:5173` a partir de outro dispositivo na LAN.

**PC (Windows):** na primeira execução de `pnpm -C client dev`, o mkcert cria a CA em
`%USERPROFILE%\.vite-plugin-mkcert\` e o Windows exibe um *Aviso de Segurança* para
confirmar a instalação da CA no repositório de certificados do usuário. Aceite uma vez;
as execuções seguintes reutilizam a CA e não voltam a perguntar. Como alternativa,
instale o mkcert manualmente e rode `mkcert -install` antes de iniciar o Vite.

**Android / Meta Quest:** a CA gerada no PC **não** é confiável nesses dispositivos até
ser instalada manualmente.

1. No PC, copie `%USERPROFILE%\.vite-plugin-mkcert\rootCA.pem` para o dispositivo
   (por exemplo, via `adb push`).
2. No Android: *Configurações → Segurança → Instalar a partir do armazenamento →
   Certificado CA*. No Quest Browser, use o gerenciador de certificados do sistema/
   fluxo de instalação de CA do dispositivo.
3. Descubra o IP da LAN do PC (`ipconfig` no Windows) e abra `https://<IP-LAN>:5173`
   no Chrome Android e no Meta Quest Browser.

O certificado é emitido para os IPs locais detectados no momento da geração; se o IP
do PC mudar, reinicie `pnpm -C client dev` para que o plugin regere o certificado.

> **Status de validação:** a configuração e a compilação foram verificadas neste
> repositório. A abertura em Android Chrome / Meta Quest Browser **ainda não foi
> executada** e, portanto, não é afirmada como válida neste documento.

## WebSocket de desenvolvimento (stub + proxy `/ws`)

O stub em `server/src/index.ts` escuta em `ws://localhost:8080`. Ao conectar, envia
`{"t":"hello"}`; ao receber `{"t":"ping"}`, responde `{"t":"pong"}`. É apenas um stub
de desenvolvimento — sem netcode, física ou gameplay.

O `client/vite.config.ts` expõe o stub na **mesma origem** da página via proxy:
`/ws` → `ws://localhost:8080`, com `ws: true` e `changeOrigin: true`. A página usa
`buildWsUrl(window.location)` (`client/src/ws-status.ts`), que gera `wss://<host>/ws`
em páginas HTTPS e `ws://<host>/ws` em HTTP — evitando mixed content e dispensando
portas ou certificados adicionais nos dispositivos. O status aparece no HUD de texto:
`connecting` → `connected` → `hello received` (ou `error/closed` em caso de falha).

### Verificação manual do WS

```bash
# Terminal A
pnpm -C server dev
# Terminal B
pnpm -C client dev
```

Abra `https://localhost:5173` (ou `https://<IP-LAN>:5173`) e confirme que o status
mostra `WS: hello received`. O contrato do stub também pode ser checado diretamente:

```
conectar em ws://localhost:8080 → recebe {"t":"hello"}
enviar {"t":"ping"}             → recebe {"t":"pong"}
```

> **Status de validação:** o contrato hello/pong do stub e o proxy `/ws` foram
> verificados com clientes WS automatizados neste repositório. A exibição no navegador
> e o teste em Android Chrome / Meta Quest Browser **não foram executados**: o diálogo
> de confiança da CA do mkcert está bloqueado neste desktop (ver seção anterior).

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
client/
  index.html       # página de entrada
  vite.config.ts   # HTTPS (mkcert), 0.0.0.0:5173 / preview 4173 + proxy /ws
  src/
    main.ts        # scaffold + status WS (connecting/connected/hello/error)
    ws-status.ts   # buildWsUrl() — URL WS na mesma origem (wss para https)
    style.css
  test/ws-status.test.ts  # Vitest: buildWsUrl (https → wss, http → ws)
  vitest.config.ts
server/
  package.json     # ws + tsx (script dev)
  tsconfig.json
  src/index.ts     # stub WS: hello on connect, pong on ping (porta 8080)
```

`shared/` é isomórfico: não importa `three`, `window`, `document`, `fs` ou `crypto`, e não
usa aleatoriedade nem relógio de parede. A física roda em passos fixos de 1/30 s (ADR-06) e
não aloca objetos no hot-loop (buffers pré-alocados reutilizados a cada tick).

## Documentação

- Spec: `Documento Oficial de Projeto.pdf` (v3.0)
- Plano da Fase 1: `docs/superpowers/plans/2026-11-22-fase-1-fisica-testes.md`
- Design e verificação da Fase 1: `docs/superpowers/specs/2026-11-22-fase-1-fisica-testes-design.md`
- Plano M0 (cliente HTTPS/WS): `.superpowers/sdd/2026-11-22-fase-0-client-https-ws/`

## Próximos passos

- M0 / US-02: validar a abertura em Android Chrome e Meta Quest Browser sem alertas
  de certificado (requer desktop com diálogo de confiança da CA disponível).
- M2 / US-05..07: pipeline 3D tri-modal (plano, VR Box, WebXR), cockpit e HUD diegético.
