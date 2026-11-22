# Fase 0 — Client Scaffold, HTTPS mkcert e Proxy WebSocket (US-02) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o scaffold do `client/` com Vite + TypeScript, HTTPS confiável via mkcert, proxy `/ws` para servidor local, e uma página base acessível por PC, Android Chrome e Meta Quest Browser sem alerta de certificado inválido.

**Architecture:** Adicionar pacote `client/` (Vite + TS) ao monorepo PNPM existente e um stub mínimo `server/` (Node + `ws`) apenas para validar o proxy `/ws` na mesma origem HTTPS. O cliente usa `vite-plugin-mkcert` para certificados locais confiáveis e configura `server.proxy['/ws']` para `ws://localhost:8080`. Nenhuma lógica de jogo é implementada nesta fase.

**Tech Stack:** PNPM Workspaces, TypeScript 5.x strict, Vite 5+, `vite-plugin-mkcert`, Node.js 22+, `ws`, Vitest (smoke/config tests onde aplicável).

**Spec:** `Documento Oficial de Projeto.pdf` (raiz), v3.0 — seções 3.1/3.2 (stack/estrutura), 5.1 (M0), 5.2 (US-02), 5.3 (DoD). Plano anterior: `docs/superpowers/plans/2026-11-22-fase-1-fisica-testes.md`.

## Global Constraints

- `shared/` é isomórfico: **proibido** importar `three`, `window`, `document`, `fs`, `crypto` ou qualquer API de browser/Node.
- TypeScript `strict: true` e `noUncheckedIndexedAccess: true`, target ES2022 (herdar `tsconfig.base.json`).
- Sem assets externos pesados; página base deve ser leve e procedural/simples.
- US-02: abrir `https://<IP>:5173` no PC, Android Chrome e Meta Quest Browser sem alertas de certificado inválido; proxy WebSocket `/ws` na mesma porta.
- YAGNI: não implementar render 3D, input VR, física cliente, netcode real ou gameplay nesta fase.
- DoD: compila sem warnings/erros TS strict; testes/checagens do pacote passam; validação manual documentada.

## Review Focus

- **Certificado não confiável em dispositivos móveis/Quest:** mkcert precisa estar instalado e a CA local confiável no dispositivo; a página pode carregar em HTTPS mas com aviso, falhando US-02. Registrar passos de confiança de CA no README/docs.
- **Proxy `/ws` falhando sob HTTPS/WSS:** Vite proxy precisa de `ws: true` e target correto; cliente deve conectar usando `wss://<host>/ws` na mesma origem, não `ws://localhost:8080` direto.
- **Binding de rede/local IP inacessível:** dev server deve escutar em `0.0.0.0`/`host: true` para permitir acesso por Android/Quest na mesma rede; firewall/porta pode bloquear.
- **Regressão no monorepo:** adicionar `client/` e `server/` não pode quebrar `pnpm -r test/typecheck/build` dos pacotes existentes, especialmente `shared/`.
- **Vazamento de configuração de dev para produção:** configurações mkcert/proxy são de dev; evitar hardcode de localhost no código de cliente além de fallback claro para mesma origem.

---
## File Structure

### Criar
- `client/package.json` — pacote Vite + TS, scripts dev/build/preview/typecheck/test.
- `client/tsconfig.json` — TS strict para client, estende base.
- `client/vite.config.ts` — Vite + mkcert + host 0.0.0.0 + proxy `/ws`.
- `client/index.html` — HTML base leve com status de conexão.
- `client/src/main.ts` — bootstrap mínimo: mostra ambiente, testa conexão `/ws`.
- `client/src/style.css` — estilo simples, sem assets externos.
- `client/src/ws-status.ts` — helper pequeno para construir URL WS mesma origem e reportar status.
- `client/test/ws-status.test.ts` — teste unitário de construção de URL WS.
- `client/vitest.config.ts` — Vitest para testes unitários do client (node/jsdom conforme necessidade).
- `server/package.json` — stub WS mínimo.
- `server/tsconfig.json` — TS strict.
- `server/src/index.ts` — servidor `ws` em `localhost:8080`, responde ping/hello.
- `server/vitest.config.ts` (opcional) / teste smoke se útil.
- `docs/superpowers/specs/2026-11-22-fase-0-client-https-ws-design.md` — verificação manual e setup mkcert.

### Modificar
- `package.json` (raiz) — scripts de conveniência opcionais (`dev:client`, `dev:server`, `dev`) sem quebrar existentes.
- `pnpm-workspace.yaml` — já inclui `client` e `server`; confirmar.
- `README.md` — adicionar instruções de dev HTTPS + proxy + validação em dispositivos.
- `.gitignore` — garantir ignorar certificados/cache gerados por mkcert/vite se necessário.

### Responsabilidades
- `client/vite.config.ts`: configuração de dev/HTTPS/proxy; sem lógica de app.
- `client/src/ws-status.ts`: pura/formal para URL e estado, testável em Vitest.
- `client/src/main.ts`: wiring DOM mínimo; sem gameplay.
- `server/src/index.ts`: stub de eco/hello para validar proxy; sem regras de jogo.

---
### Task 1: Scaffold do pacote `client/` com Vite + TypeScript

**Files:**
- Create: `client/package.json`
- Create: `client/tsconfig.json`
- Create: `client/index.html`
- Create: `client/src/main.ts`
- Create: `client/src/style.css`
- Create: `client/vitest.config.ts`
- Test: `pnpm -C client typecheck`, `pnpm -C client build`

**Interfaces:**
- Consumes: `tsconfig.base.json`, workspace PNPM existente.
- Produces: pacote `client` buildável; página base em `https/dev` servível pelo Vite.

- [ ] **Step 1: Criar manifest e tsconfig do client**

`client/package.json` (nome `@asteroids/client`, private, type module) com scripts:
```json
{
  "name": "@asteroids/client",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0 --port 5173",
    "build": "tsc -p tsconfig.json --noEmit && vite build",
    "preview": "vite preview --host 0.0.0.0 --port 4173",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

`client/tsconfig.json` estende `../tsconfig.base.json`, com `lib: ["ES2022","DOM","DOM.Iterable"]`, `types: ["vite/client"]`, `noEmit: true`, `include: ["src","test","vite.config.ts"]`.

- [ ] **Step 2: Criar página base mínima**

`client/index.html` com `<div id="app"></div>` e script `type="module" src="/src/main.ts"`.
`client/src/main.ts` deve renderizar texto simples "Asteroids 3D - M0 Client Scaffold" e um placeholder de status WS.
`client/src/style.css` estilo escuro simples legível em mobile/desktop.

- [ ] **Step 3: Instalar e validar build/typecheck**

Run: `pnpm install`
Expected: workspace resolve `client`.

Run: `pnpm -C client typecheck`
Expected: PASS.

Run: `pnpm -C client build`
Expected: PASS, gera `client/dist/`.

- [ ] **Step 4: Commit**

```bash
git add client package.json pnpm-lock.yaml
git commit -m "chore(client): scaffold vite typescript client package"
```

---
### Task 2: HTTPS confiável com mkcert no Vite (US-02 parte 1)

**Files:**
- Modify: `client/package.json`
- Create: `client/vite.config.ts`
- Modify: `.gitignore` (se mkcert gerar cache local)
- Modify: `README.md`
- Test: `pnpm -C client dev` (verificação manual), `pnpm -C client build`

**Interfaces:**
- Consumes: Task 1 client scaffold.
- Produces: `vite.config.ts` com `mkcert()` e `server.host=true/0.0.0.0`; documentação de instalação/confiança da CA mkcert.

- [ ] **Step 1: Adicionar plugin mkcert**

Adicionar devDependency `vite-plugin-mkcert` no `client/package.json` e instalar.

- [ ] **Step 2: Criar `client/vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import mkcert from 'vite-plugin-mkcert'

export default defineConfig({
  plugins: [mkcert()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
  },
})
```

Ajustar apenas se necessário para compatibilidade Windows/rede local; manter intenção de HTTPS confiável.

- [ ] **Step 3: Verificar HTTPS local**

Run: `pnpm -C client dev`
Expected: Vite inicia em HTTPS (URL `https://localhost:5173` e/ou IP local). Sem erro de plugin.

Verificação manual: abrir no PC. Registrar no doc se CA foi confiada automaticamente pelo `vite-plugin-mkcert`/mkcert.

- [ ] **Step 4: Documentar setup de CA para Android/Quest**

Atualizar `README.md` com seção "HTTPS local (mkcert)": instalar mkcert, confiar CA, acessar `https://<IP-LAN>:5173`. Não inventar resultado de teste em dispositivo não executado.

- [ ] **Step 5: Commit**

```bash
git add client/vite.config.ts client/package.json README.md .gitignore pnpm-lock.yaml
git commit -m "chore(client): enable trusted https dev server with mkcert"
```

---
### Task 3: Stub de servidor WS e proxy `/ws` na mesma origem (US-02 parte 2)

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/src/index.ts`
- Modify: `client/vite.config.ts`
- Create: `client/src/ws-status.ts`
- Create: `client/test/ws-status.test.ts`
- Modify: `client/src/main.ts`
- Modify: `package.json` (scripts conveniência)
- Test: `client/test/ws-status.test.ts`, verificação manual WS

**Interfaces:**
- Consumes: Task 1-2 client HTTPS.
- Produces:
  - `server/src/index.ts`: WS server em `ws://localhost:8080`, envia `{"t":"hello"}` ao conectar, responde `{"t":"pong"}` a `{"t":"ping"}`.
  - `buildWsUrl(locationLike: { protocol: string; host: string }): string` em `client/src/ws-status.ts` retornando `wss://<host>/ws` para https e `ws://<host>/ws` para http.
  - Vite proxy `/ws` -> `ws://localhost:8080` com `ws: true`.

- [ ] **Step 1: Escrever teste falhando para URL WS**

```ts
import { describe, expect, it } from 'vitest'
import { buildWsUrl } from '../src/ws-status'

describe('buildWsUrl', () => {
  it('uses wss for https pages', () => {
    expect(buildWsUrl({ protocol: 'https:', host: '192.168.0.10:5173' })).toBe('wss://192.168.0.10:5173/ws')
  })

  it('uses ws for http pages', () => {
    expect(buildWsUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/ws')
  })
})
```

- [ ] **Step 2: Rodar teste para ver falha**

Run: `pnpm -C client test -- ws-status.test.ts`
Expected: FAIL (módulo/função ausente).

- [ ] **Step 3: Implementar `ws-status.ts` e integrar no `main.ts`**

Implementar função pura `buildWsUrl`. Em `main.ts`, conectar ao WS na mesma origem e exibir status: `connecting`, `connected`, `hello received`, `error/closed`. Sem dependências externas.

- [ ] **Step 4: Criar stub `server/` e proxy Vite**

`server/package.json` com `ws`, `tsx`/`ts-node` ou build simples TS->JS; script `dev` para rodar `src/index.ts`. `server/src/index.ts` cria `WebSocketServer` na porta 8080.

Atualizar `client/vite.config.ts`:
```ts
server: {
  host: '0.0.0.0',
  port: 5173,
  strictPort: true,
  proxy: {
    '/ws': {
      target: 'ws://localhost:8080',
      ws: true,
      changeOrigin: true,
    },
  },
}
```

Adicionar scripts raiz opcionais:
```json
"dev:client": "pnpm -C client dev",
"dev:server": "pnpm -C server dev"
```

- [ ] **Step 5: Verificar proxy e testes**

Run: `pnpm -C client test -- ws-status.test.ts`
Expected: PASS.

Verificação manual:
- Terminal A: `pnpm -C server dev`
- Terminal B: `pnpm -C client dev`
- Abrir `https://localhost:5173`: UI mostra WS conectado/hello recebido via `/ws`.

- [ ] **Step 6: Commit**

```bash
git add client server package.json pnpm-lock.yaml README.md
git commit -m "feat(dev): add websocket stub and https dev proxy"
```

---
### Task 4: Verificação M0/US-02 e documentação de validação em dispositivos

**Files:**
- Create: `docs/superpowers/specs/2026-11-22-fase-0-client-https-ws-design.md`
- Modify: `README.md`
- Test: comandos de verificação + checklist manual

**Interfaces:**
- Consumes: Tasks 1-3 completas.
- Produces: documentação de setup e evidências reais de verificação; checklist explícito para PC/Android/Meta Quest.

- [ ] **Step 1: Criar doc de design/verificação**

Incluir: objetivo US-02, arquivos criados, comandos executados, resultado esperado/observado, passos mkcert para Android/Quest, troubleshooting (firewall, CA não confiada, porta 5173/8080).

- [ ] **Step 2: Rodar verificação automatizada**

Run: `pnpm install`
Expected: PASS.

Run: `pnpm -r typecheck`
Expected: PASS (shared + client + server).

Run: `pnpm -r test`
Expected: PASS.

Run: `pnpm -C client build`
Expected: PASS.

- [ ] **Step 3: Registrar checklist manual US-02**

Adicionar tabela com colunas: Dispositivo, URL, Certificado confiável, Página carregou, WS `/ws` conectou, Evidência/data, Observações. Preencher apenas itens realmente executados; marcar pendentes como `PENDENTE`.

- [ ] **Step 4: Commit**

```bash
git add docs README.md client server package.json pnpm-lock.yaml
git commit -m "docs: add M0 https/ws verification checklist"
```

---
## Notas de Execução

- **US-02 completo vs parcial:** o código/proxy pode estar pronto sem validação física em Quest/Android. Não marcar US-02 como validado em dispositivo sem evidência real.
- **mkcert:** `vite-plugin-mkcert` pode simplificar; se houver bloqueio de ambiente, registrar fallback e impacto no critério "sem alertas de certificado inválido".
- **Próximo plano (item 2 do usuário):** M2 - `RenderPipeline` tri-modal, `CockpitRig`, HUD diegético dirty-flag e Offscreen Pips (US-05/06/07), após M0/US-02 estabilizado.