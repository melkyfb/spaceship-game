# Fase 0 (M0) — Cliente HTTPS confiável + proxy WebSocket `/ws` (US-02): decisões, verificação e checklist de dispositivos

> Documento de execução da Task 4. Consolida os arquivos/decisões das Tasks 1–3, o resultado
> **executado** dos comandos de verificação e o checklist manual de US-02. Nenhum resultado de
> validação em dispositivo é inferido ou inventado: o que não foi executado está marcado como
> `PENDENTE`.
>
> - Spec: `Documento Oficial de Projeto.pdf` v3.0 — seções 5.1 (M0), 5.2 (US-02), 5.3 (DoD).
> - Plano: `docs/superpowers/plans/2026-11-22-fase-0-client-https-ws.md`.
> - SDD/ledger: `.superpowers/sdd/2026-11-22-fase-0-client-https-ws/`.
> - Branch: `feat/m0-client-https-ws`.
> - Data da verificação automatizada: **2026-11-22**.

## 1. Objetivo — US-02

Critério literal (do brief/plano):

> **US-02:** abrir `https://<IP>:5173` no PC, Android Chrome e Meta Quest Browser **sem
> alertas de certificado inválido**; proxy WebSocket `/ws` na **mesma porta**.

O M0 entrega a infraestrutura de cliente necessária para esse critério:

1. **HTTPS confiável no Vite** via `vite-plugin-mkcert` (Task 2) — o mesmo certificado cobre
   `localhost`, `::1`, `127.0.0.1`, os IPs da LAN detectados e `0.0.0.0`, servido em
   `0.0.0.0:5173` (`strictPort: true`); preview em `0.0.0.0:4173`.
2. **Proxy WebSocket na mesma origem** (Task 3) — `/ws` → `ws://localhost:8080`
   (`ws: true`, `changeOrigin: true`), com o cliente usando `buildWsUrl(window.location)` para
   gerar `wss://<host>/ws` em páginas HTTPS (sem mixed content, sem portas/certificados extras).
3. **Stub WS de desenvolvimento** em `ws://localhost:8080` (hello no connect, pong no ping).

> **Importante:** código/proxy prontos **não** equivalem a US-02 validada em dispositivo. A
> afirmação "sem alertas de certificado inválido" depende de evidência real de abertura em
> PC/Android/Quest — ver §4.

## 2. Arquivos criados / modificados (Tasks 1–3)

| Arquivo | Task | Papel |
| --- | --- | --- |
| `client/package.json` | 1, 2, 3 | scaffold `@asteroids/client`; scripts `dev`/`build`/`preview`/`typecheck`/`test`; devDeps `vite`, `vitest`, `typescript`, `vite-plugin-mkcert`. |
| `client/tsconfig.json` | 1 | estende `tsconfig.base.json` (strict + `noUncheckedIndexedAccess`, ES2022), `lib` DOM, `include` com `vite.config.ts`. |
| `client/index.html` | 1 | entry `#app` + `<script type="module" src="/src/main.ts">`. |
| `client/src/main.ts` | 1, 3 | mount strict-safe; status WS (`connecting` → `connected` → `hello received`; `error` / `closed`, com código e motivo do close no console). |
| `client/src/style.css` | 1 | tema escuro responsivo, sem assets externos. |
| `client/vitest.config.ts` | 1 | `environment: 'node'` (sem `passWithNoTests`: há testes desde a Task 3). |
| `client/vite.config.ts` | 2, 3 | `mkcert()`, `host 0.0.0.0`/`port 5173`/`strictPort`, preview 4173 e `proxy['/ws']` → `ws://localhost:8080` em **dev e preview**. |
| `client/src/ws-status.ts` | 3 | `buildWsUrl()` puro: `https:` → `wss://<host>/ws`, caso contrário `ws://<host>/ws`. |
| `client/test/ws-status.test.ts` | 3 | 2 testes de `buildWsUrl`. |
| `server/package.json`, `server/tsconfig.json`, `server/src/index.ts` | 3 | stub WS (`ws` + `tsx`) na porta 8080: `{"t":"hello"}` no connect, `{"t":"pong"}` no ping. |
| `server/src/ws-server.ts`, `server/test/ws-server.test.ts` | fix wave | `createWebSocketServer()` com handlers de erro (`wss`, socket, porta em uso) e normalização de `RawData`; teste `node:test` do contrato hello/pong em porta efêmera. |
| `package.json` | 3 | scripts de raiz `dev:client`, `dev:server`. |
| `pnpm-lock.yaml` | 1–3 | resolução de `vite`, `vitest`, `vite-plugin-mkcert`, `ws`, `tsx`, `@types/*`. |
| `README.md` | 2, 3, 4 | comandos, HTTPS/mkcert, WS/proxy, checklist manual US-02 (esta task). |
| `docs/superpowers/specs/2026-11-22-fase-0-client-https-ws-design.md` | 4 | **este documento** (verificação + checklist). |

Nenhuma API de `shared/` foi alterada; YAGNI respeitado (sem render 3D, VR/input, física de
cliente, netcode real ou gameplay).

## 3. Comandos de verificação executados — saídas reais (2026-11-22)

Ambiente: `pnpm@10.0.0`, Node `v24.19.0`, Windows. O wrapper do shell do harness exige
`cmd /c "<comando>"`. Resultado esperado vem do brief; **observado** é a saída real obtida.

| Comando | Resultado esperado (brief) | Status | Evidência observada (executado) |
| --- | --- | --- | --- |
| `pnpm install` | PASS | **PASS** | `Scope: all 4 workspace projects` / `Already up to date` / `Done in 514ms`; `exit 0`. |
| `pnpm -r typecheck` | PASS (shared + client + server) | **PASS** | `Scope: 3 of 4 workspace projects`; `client typecheck: Done`, `server typecheck: Done`, `shared typecheck: Done` (tsc `--noEmit`, sem erros/warnings); `exit 0`. |
| `pnpm -r test` | PASS | **PASS** | `client`: 1 arquivo / **2 testes** passou (ws-status); `shared`: 5 arquivos / **46 testes** passou; `server`: **1 teste** passou (contrato hello/pong, `node:test` via `tsx`) — todos `Done`; `exit 0`. |
| `pnpm -C client build` | PASS | **PASS** | `tsc -p tsconfig.json --noEmit && vite build`; `✓ 5 modules transformed`; `dist/index.html 0.42 kB`, `dist/assets/index-*.css 0.52 kB`, `dist/assets/index-*.js 1.67 kB`; `✓ built in 97ms`; `exit 0`. |

> A tabela registra **somente** comandos executados. Não há resultado declarado para
> abertura em navegador/dispositivo, FPS ou qualquer validação ao vivo de HTTPS — esses itens
> estão em §4 como `PENDENTE`.

### 3.1 Fix wave da revisão final (2026-11-22)

A revisão final da branch encontrou 2 findings *Important* e 4 *Minor*; a fix wave os
endereçou e reexecutou as checagens automatizadas:

| Comando | Resultado observado |
| --- | --- |
| `pnpm -C server test` | PASS — `node:test` via `tsx`: `hello on connect and pong on ping`, `tests 1 / pass 1 / fail 0`. |
| `pnpm -r typecheck` | PASS — `client`, `server` e `shared` `Done` (sem erros/warnings). |
| `pnpm -r test` | PASS — `client` 2/2, `shared` 46/46, `server` 1/1; todos os pacotes `Done`. |
| `pnpm -C client build` | PASS — `✓ 5 modules transformed`, `✓ built in 213ms`. |

Mudanças: handlers de `error` em `wss`/socket (com mensagem específica para `EADDRINUSE`),
normalização de `RawData` antes do `JSON.parse`, `proxy['/ws']` também em `preview`, remoção
do comentário/`passWithNoTests` obsoletos em `vitest.config.ts`, e distinção entre os estados
`error` e `closed` no HUD (código/motivo no console). Detalhes em
`.superpowers/sdd/2026-11-22-fase-0-client-https-ws/task-final-fix-report.md`.

> O proxy de `preview` foi validado por tipagem, carregamento da config no `vite build` e
> inspeção do código do Vite 5 (`preview()` aplica `proxyMiddleware(httpServer, config.preview.proxy,
> config)`, que honra `ws: true`). Não foi exercitado em navegador pelo bloqueio da CA do mkcert
> registrado em §7.1.

### 3.2 Evidência complementar já executada nas Tasks 2–3 (contexto, não reexecutada aqui)

Estes itens são registrados como **histórico** dos reports das tasks anteriores e **não** foram
reexecutados nesta Task 4:

- **Contrato do stub WS** (Task 3): cliente Node `ws` recebeu `HELLO: {"t":"hello"}` e
  `PONG: {"t":"pong"}` em `ws://localhost:8080`.
- **Proxy `/ws`** (Task 3): com uma config Vite temporária sem mkcert (reaproveitando o `proxy`
  real) em `127.0.0.1:5174`, o cliente recebeu `HELLO`/`PONG` via `ws://127.0.0.1:5174/ws`.
  Ou seja, o proxy foi exercido **somente sobre HTTP plano**, não sobre `wss://` em navegador.
- **`pnpm -C client dev`** (Task 2): o plugin baixou o binário e criou a CA em
  `C:\Users\itsal\.vite-plugin-mkcert\`, mas o comando `mkcert -install ...` ficou bloqueado no
  *Aviso de Segurança* do Windows; o Vite **nunca escutou em 5173**. Detalhes em §4 e §7.

## 4. Checklist manual US-02 — validação em dispositivos

Preenchido apenas com itens realmente executados. Como a validação ao vivo de HTTPS está
bloqueada neste ambiente (CA do mkcert exige confirmação humana numa janela nativa do Windows —
ver §7), **todas as células de validação permanecem `PENDENTE`**. Colunas exatas do brief.

| Dispositivo | URL | Certificado confiável | Página carregou | WS `/ws` conectou | Evidência/data | Observações |
| --- | --- | --- | --- | --- | --- | --- |
| PC (Windows, Chrome/Edge) | `https://localhost:5173` e `https://<IP-LAN>:5173` | `PENDENTE` | `PENDENTE` | `PENDENTE` | 2026-11-22 (Task 2) | Tentativa de `pnpm -C client dev`: CA criada em `%USERPROFILE%\.vite-plugin-mkcert\`, mas `mkcert -install` travou no *Aviso de Segurança* do Windows; Vite não escutou em 5173. Requer aceite humano da CA. |
| Android Chrome | `https://<IP-LAN>:5173` | `PENDENTE` | `PENDENTE` | `PENDENTE` | 2026-11-22 | Não executado. Requer instalar `rootCA.pem` como CA no dispositivo e desktop com CA aceita (§5). |
| Meta Quest Browser | `https://<IP-LAN>:5173` | `PENDENTE` | `PENDENTE` | `PENDENTE` | 2026-11-22 | Não executado. Mesmo pré-requisito de CA do Android (§5); fluxo de CA do Quest pode variar por versão do sistema. |

**Interpretação:** o critério "sem alertas de certificado inválido" de US-02 **não está
validado em nenhum dispositivo**. O que está pronto e verificado é a configuração (HTTPS,
proxy, URL `wss://`) e a suíte automatizada (§3). Não se deve marcar US-02 como "validada em
dispositivo" até que as células acima sejam preenchidas com evidência real (captura/data).

## 5. mkcert — tornando a CA confiável em Android e Meta Quest

A CA gerada no PC **não** é confiável em Android/Quest até ser instalada manualmente neles.

**No PC (origem da CA):**

1. Rode `pnpm -C client dev` uma vez e aceite o *Aviso de Segurança* do Windows para instalar a
   CA no repositório do usuário (necessário para o certificado ser confiável também no PC).
2. Localize a CA pública: `%USERPROFILE%\.vite-plugin-mkcert\rootCA.pem`.
   - Alternativa (mkcert manual): `mkcert -CAROOT` aponta o diretório da CA.

**Android (Chrome):**

1. Copie `rootCA.pem` para o dispositivo, por exemplo `adb push rootCA.pem /sdcard/Download/`.
2. *Configurações → Segurança → Instalar a partir do armazenamento → Certificado CA* (o rótulo
   exato varia entre fabricantes/Android versions; em alguns é "Credenciais e download").
3. Confirme a instalação (pode exigir PIN/senha do dispositivo).
4. Descubra o IP da LAN do PC (`ipconfig` → IPv4) e abra `https://<IP-LAN>:5173` no Chrome
   Android. Confirme que **não** aparece aviso de certificado e que o status mostra
   `WS: hello received`.

**Meta Quest Browser:**

1. Copie `rootCA.pem` para o Quest (via `adb push`, ou transfira o arquivo para o armazenamento
   do headset).
2. Instale como CA pelo fluxo de gerenciamento de certificados do sistema do Quest. O caminho
   exato depende da versão do sistema/Quest Browser; se a UI não expuser instalação de CA,
   registre a limitação em vez de assumir sucesso.
3. Com o PC na mesma rede, abra `https://<IP-LAN>:5173` no Quest Browser e verifique ausência de
   aviso de certificado e o status `WS: hello received`.

**Notas:** o certificado é emitido para os IPs detectados no momento da geração. Se o IP do PC
mudar (DHCP/rede diferente), reinicie `pnpm -C client dev` para regerar o certificado. O cliente
usa `wss://<host>/ws` na mesma origem, então **nenhuma porta ou certificado adicional** é
necessário para o WebSocket nos dispositivos — apenas a CA e o acesso à porta 5173.

## 6. Troubleshooting

| Sintoma | Causa provável | Ação |
| --- | --- | --- |
| Aviso de certificado inválido no PC | CA do mkcert não aceita | Aceite o *Aviso de Segurança* do Windows na primeira execução; ou rode `mkcert -install` manualmente e reinicie o Vite. |
| Aviso de certificado inválido no Android/Quest | `rootCA.pem` não instalado no dispositivo | Instale a CA conforme §5; confirme que a CA aparece na lista de certificados do usuário. |
| `https://<IP-LAN>:5173` não carrega no dispositivo | PC e dispositivo em redes diferentes, ou IP mudou | Use `ipconfig` para obter o IP correto; garanta mesma LAN; reinicie o dev server para regerar o certificado com o IP atual. |
| Conexão recusada na porta 5173 | Vite não iniciou (ex.: mkcert `-install` travou) ou firewall bloqueou | Confirme o log do Vite e o aceite da CA; libere a porta 5173 no firewall do Windows para a rede privada. O dev server usa `strictPort`, então outra porta não é usada automaticamente. |
| Página abre mas status WS fica `error` ou `closed` | Stub WS em 8080 não está rodando, ou proxy `/ws` falhou | Inicie `pnpm -C server dev` (porta 8080) **antes**/junto com `pnpm -C client dev`; confirme `ws://localhost:8080` responde `{t:"hello"}`. Verifique também a porta 8080 no firewall (apenas localhost, mas valide se houver regras restritivas). |
| Vite diz que a porta 5173/4173 está em uso | Processo anterior não encerrado | Encerre o processo na porta (`netstat -ano | findstr :5173` e `taskkill /PID <pid> /F`) e reinicie. |
| Erro de mixed content | Página aberta via `http://` em vez de `https://` | Use sempre `https://`; `buildWsUrl` gera `ws://` em HTTP, o que é bloqueado em páginas HTTPS (o contrário). |

## 7. Revisão final contra DoD (M0 / Task 4)

| # | Item DoD | Status | Justificativa |
| --- | --- | --- | --- |
| 1 | Compila sem warnings/erros TS strict | ✅ | `pnpm -r typecheck` e `pnpm -C client build` (`tsc --noEmit`) limpos; `strict` + `noUncheckedIndexedAccess` em `tsconfig.base.json`. |
| 2 | Testes/checagens do pacote passam | ✅ | `pnpm -r test` (client 2/2, shared 46/46, server 1/1) e `pnpm -C client build` PASS; `pnpm install` estável. |
| 3 | Validação manual documentada | ✅ (documentada; **execução pendente**) | Checklist §4 com colunas exatas do brief; todas as células de dispositivo `PENDENTE` por bloqueio ambiental real (abaixo), sem resultados inventados. |

### 7.1 Bloqueio ambiental conhecido (não resolvido nesta task)

- `pnpm -C client dev` chega a baixar/gerar a CA, mas `mkcert -install` fica **bloqueado** numa
  janela nativa do Windows (*Aviso de Segurança*) exibida numa área de trabalho bloqueada; o
  Vite nunca escutou em 5173. Tentativas não interativas (`certutil`, `X509Store`) e automação
  de UI (`AppActivate`/`SendKeys`, UI Automation) falharam nos reports anteriores.
- Consequência direta no critério "sem alertas de certificado inválido": **não verificado**.
  Não há evidência de que `https://localhost:5173` respondeu nem de que a CA está confiável no
  PC; muito menos em Android/Quest.
- Para desbloquear: um humano deve aceitar a janela do Windows uma vez e então executar
  `pnpm -C server dev` + `pnpm -C client dev`, preenchendo §4 com capturas/datas reais.
- Nenhum processo deixado rodando pelas verificações desta task.

## 8. Riscos / pendências

1. **US-02 parcial:** infraestrutura e checks automatizados prontos; validação em PC/Android/
   Quest pendente (§4). Não reivindicar "validado em dispositivo".
2. **`wss://` ao vivo não exercitado:** o proxy `/ws` foi verificado sobre HTTP plano (Task 3);
   o caminho `wss://` é coberto por testes de `buildWsUrl` e pela config, mas não por um
   navegador real nesta sessão.
3. **CA do mkcert em desktop bloqueado:** depende de interação humana (§7.1).
4. **Próximo plano:** M2 — `RenderPipeline` tri-modal, `CockpitRig`, HUD diegético dirty-flag e
   Offscreen Pips (US-05/06/07), **após** M0/US-02 estabilizado com a validação manual de §4.
