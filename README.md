# Asteroids 3D

Monorepo do Asteroids 3D. Este repositório entrega a **Fase 1 (M1) — núcleo
matemático e física determinística** no pacote isomórfico `shared/`, o **M0 —
cliente Vite/TypeScript com servidor de desenvolvimento HTTPS confiável, status
WebSocket e proxy `/ws` na mesma origem** (além do stub WS em `server/`) e o
**M2 — cockpit 3D procedural, pipeline de render tri-modal (Flat / VR Box / Quest 3
WebXR) e HUD diegético com radar e offscreen pips, sem assets externos**. O
servidor de jogo real, os inputs completos (M3) e o loop/IA (M4) ainda serão
adicionados.

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
pnpm -C server test       # node:test via tsx: contrato hello/pong do stub WS
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
`/ws` → `ws://localhost:8080`, com `ws: true` e `changeOrigin: true`. A mesma configuração
de proxy vale para `dev` (5173) e `preview` (4173), para que ambos os comandos HTTPS
documentados se comportem de forma idêntica. A página usa
`buildWsUrl(window.location)` (`client/src/ws-status.ts`), que gera `wss://<host>/ws`
em páginas HTTPS e `ws://<host>/ws` em HTTP — evitando mixed content e dispensando
portas ou certificados adicionais nos dispositivos. O status aparece no HUD de texto:
`connecting` → `connected` → `hello received` (ou `error` / `closed` em caso de falha;
o código e o motivo do `close` são registrados no console).

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

> **Status de validação:** o contrato hello/pong do stub é coberto por teste automatizado
> (`pnpm -C server test`) e o proxy `/ws` foi verificado com cliente WS automatizado neste
> repositório. A exibição no navegador e o teste em Android Chrome / Meta Quest Browser
> **não foram executados**: o diálogo de confiança da CA do mkcert está bloqueado neste
> desktop (ver seção anterior).

## Checklist manual US-02 (validação em dispositivos)

Preenchido apenas com itens realmente executados; o que não foi executado está marcado como
`PENDENTE`. Fonte autoritativa e detalhes (troubleshooting, passos mkcert, evidência dos
comandos): `docs/superpowers/specs/2026-11-22-fase-0-client-https-ws-design.md`.

| Dispositivo | URL | Certificado confiável | Página carregou | WS `/ws` conectou | Evidência/data | Observações |
| --- | --- | --- | --- | --- | --- | --- |
| PC (Windows, Chrome/Edge) | `https://localhost:5173` e `https://<IP-LAN>:5173` | `PENDENTE` | `PENDENTE` | `PENDENTE` | 2026-11-22 (Task 2) | Tentativa de `pnpm -C client dev`: CA criada em `%USERPROFILE%\.vite-plugin-mkcert\`, mas `mkcert -install` travou no *Aviso de Segurança* do Windows; Vite não escutou em 5173. Requer aceite humano da CA. |
| Android Chrome | `https://<IP-LAN>:5173` | `PENDENTE` | `PENDENTE` | `PENDENTE` | 2026-11-22 | Não executado. Requer instalar `rootCA.pem` como CA no dispositivo e desktop com CA aceita. |
| Meta Quest Browser | `https://<IP-LAN>:5173` | `PENDENTE` | `PENDENTE` | `PENDENTE` | 2026-11-22 | Não executado. Mesmo pré-requisito de CA do Android; fluxo de CA do Quest pode variar por versão do sistema. |

> US-02 **não está validada em dispositivo**: o critério "sem alertas de certificado inválido"
> depende de evidência real nessas linhas. Código, proxy e URL `wss://` estão prontos e cobertos
> por checagens automatizadas; a abertura ao vivo está bloqueada pela confirmação interativa da
> CA do mkcert neste desktop.

### Verificação automatizada (executada em 2026-11-22)

| Comando | Resultado |
| --- | --- |
| `pnpm install` | PASS — `Scope: all 4 workspace projects`, `Already up to date` |
| `pnpm -r typecheck` | PASS — shared, server e client (`tsc --noEmit`, sem erros) |
| `pnpm -r test` | PASS — client 2/2, shared 46/46, server 1/1 |
| `pnpm -C client build` | PASS — `✓ 5 modules transformed`, `✓ built in 97ms` |

## M2 — Render tri-modal, cockpit e HUD diegético (US-05/06/07)

O `client/` agora usa Three.js (`three@^0.187.0`) com cena bootstrap em `GameApp`,
hierarquia `CockpitRig` conforme spec 4.4, `RenderPipeline` tri-modal e HUD diegético
(`CanvasTexture` 512×256, dirty-flag 15Hz) com radar e 16 pips radiais. Constantes da
spec em `client/src/core/render-config.ts`: barrel `k1 = 0.22`, `k2 = 0.24`, IPD
`56–74 mm` (default `64`), `MAX_DPR = 2`, WebXR `immersive-vr` + `local`.

Selecione o modo por query: `?render=FLAT` (padrão), `?render=VR_BOX` ou
`?render=QUEST_3`. No modo Quest 3, o botão "Enter VR" aparece quando `immersive-vr` é
suportado; falha ao entrar aparece no próprio botão ("VR failed — retry", reabilitado para
nova tentativa) e em `getXrStatus()`. Hooks de dev apenas: `[`/`]` ajustam o IPD em ±1 mm e
`R` faz `recenter()` (o listener é removido no `beforeunload`). O mapeamento final
(D-Pad no VR Box / botão X no Quest) chega no **M3**.

> **ADR-04:** nenhum asset externo e nenhum pós-processamento pesado — a distorção do
> VR Box é um shader procedural e o HUD é desenhado em canvas gerado em código.

### Checklist manual M2 (validação em dispositivo)

Preenchido apenas com itens realmente executados; o que não foi executado está
`PENDENTE`. Meta de performance: **72–90 FPS no Quest 3** e **60 FPS no Android
(Flat/VR Box)** — sem medição real neste ambiente. Fonte autoritativa e detalhes:
`docs/superpowers/specs/2026-11-22-m2-render-cockpit-hud-design.md`.

| Modo | URL/dispositivo | FPS observado | HUD atualiza corretamente | Pips/radar corretos | Sem assets externos | Evidência |
| --- | --- | --- | --- | --- | --- | --- |
| Flat | `https://localhost:5173?render=FLAT` (PC Chrome/Edge) | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` em dispositivo (código auditado: ✅) | Checks automatizados 2026-11-22 (abaixo); abertura ao vivo não executada — CA do mkcert exige aceite humano. |
| Flat | `https://<IP-LAN>:5173?render=FLAT` (Android Chrome) | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` em dispositivo (código auditado: ✅) | Não executado; requer CA do mkcert instalada no dispositivo. |
| VR Box | Visitante óptico + Android Chrome, `https://<IP-LAN>:5173?render=VR_BOX` | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` em dispositivo (código auditado: ✅) | Não executado; estereoscopia/barrel/conforto exigem conferência visual no visor. |
| Quest 3 | Meta Quest Browser, `https://<IP-LAN>:5173?render=QUEST_3` | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` em dispositivo (código auditado: ✅) | Não executado; botão "Enter VR", sessão `immersive-vr` e recenter não exercitados em hardware. |

> Nenhuma linha foi validada em dispositivo. Código, constantes e hot paths foram
> verificados por tipagem, testes, build e auditoria de alocações; não reivindicar
> FPS, conforto ou correção visual "em dispositivo" sem preencher a tabela acima.

### Verificação automatizada M2 (executada em 2026-11-22)

| Comando | Resultado |
| --- | --- |
| `pnpm -r typecheck` | PASS — `client`, `server` e `shared` `Done` (sem erros/warnings). |
| `pnpm -r test` | PASS — `client` 6 arquivos / 22 testes, `shared` 5 arquivos / 46 testes, `server` 1 teste. |
| `pnpm -C client build` | PASS — `✓ 15 modules transformed`, `✓ built in 1.26s` (aviso pré-existente de chunk >500 kB do Three.js, não bloqueante). |

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
  index.html       # página de entrada (#app)
  vite.config.ts   # HTTPS (mkcert), 0.0.0.0:5173 / preview 4173 + proxy /ws em ambos
  src/
    main.ts        # bootstrap GameApp + ?render= + hooks dev + status WS do M0
    ws-status.ts   # buildWsUrl() — URL WS na mesma origem (wss para https)
    style.css
    core/
      GameApp.ts         # Scene/renderer, setAnimationLoop, estado mock, dispose
      Starfield.ts       # campo estelar procedural sem assets
      CockpitRig.ts      # hierarquia ShipRoot/CockpitFrame/PilotHeadRig (spec 4.4)
      render-config.ts   # constantes barrel/IPD/DPR/XR
      RenderPipeline.ts  # FLAT / VR_BOX (estéreo + barrel) / QUEST_3 (WebXR)
    ui/
      hud-math.ts        # helpers puros: radar/pip/throttle
      DiegeticHUD.ts     # CanvasTexture 512x256, dirty-flag 15Hz, radar
      OffscreenPips.ts   # pool de 16 setas radiais (sem alocação por frame)
  test/
    ws-status.test.ts       # buildWsUrl (https → wss, http → ws)
    render-config.test.ts   # constantes da spec + limites de IPD
    hud-math.test.ts        # projeção radar/pip + throttle 15Hz
    offscreen-pips.test.ts  # pips dentro/fora do FOV
    diegetic-hud.test.ts     # sweep 15Hz com estado estático / idle com dt=0
    render-pipeline-xr.test.ts # botão Enter VR, sessão e falha recuperável (XR stubado)
  vitest.config.ts
server/
  package.json     # ws + tsx (scripts dev/test)
  tsconfig.json
  src/
    index.ts       # entry point: inicia o stub na porta 8080
    ws-server.ts   # createWebSocketServer(): hello/pong + handlers de erro
  test/ws-server.test.ts  # node:test: hello on connect, pong on ping (porta efêmera)
```

`shared/` é isomórfico: não importa `three`, `window`, `document`, `fs` ou `crypto`, e não
usa aleatoriedade nem relógio de parede. A física roda em passos fixos de 1/30 s (ADR-06) e
não aloca objetos no hot-loop (buffers pré-alocados reutilizados a cada tick).

## Documentação

- Spec: `Documento Oficial de Projeto.pdf` (v3.0)
- Plano da Fase 1: `docs/superpowers/plans/2026-11-22-fase-1-fisica-testes.md`
- Design e verificação da Fase 1: `docs/superpowers/specs/2026-11-22-fase-1-fisica-testes-design.md`
- Plano M0 (cliente HTTPS/WS): `docs/superpowers/plans/2026-11-22-fase-0-client-https-ws.md`
- Design e verificação M0 (HTTPS/WS + checklist US-02): `docs/superpowers/specs/2026-11-22-fase-0-client-https-ws-design.md`
- SDD/ledger M0: `.superpowers/sdd/2026-11-22-fase-0-client-https-ws/`
- Plano M2 (render/cockpit/HUD): `docs/superpowers/plans/2026-11-22-m2-render-cockpit-hud.md`
- Design e verificação M2 (checklist Flat/VR Box/Quest 3): `docs/superpowers/specs/2026-11-22-m2-render-cockpit-hud-design.md`
- SDD/ledger M2: `.superpowers/sdd/2026-11-22-m2-render-cockpit-hud/`

## Próximos passos

- M0 / US-02: validar a abertura em Android Chrome e Meta Quest Browser sem alertas
  de certificado (requer desktop com diálogo de confiança da CA disponível).
- M2 / US-05..07: validação em dispositivo do checklist acima (FPS, estereoscopia/barrel,
  HUD/pips, ausência de assets) — tudo `PENDENTE` neste ambiente.
- M3: inputs Desktop/Touch/VR Box/Quest XR (D-Pad de IPD e botão X de recenter).
- M4: loop solo em Worker + IA/ondas.
