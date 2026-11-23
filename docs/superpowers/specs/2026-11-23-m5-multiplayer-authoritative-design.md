# M5 — Multiplayer Autoritativo, Respawn e Leaderboard

## Intento e por quê

Evoluir o Asteroids 3D de um vertical slice solo (M4) para um jogo jogável em **Treinamento** (solo/local) e **Multiplayer autoritativo** (US-13 + US-14 do spec v3.0), sem tela de game over. A morte passa a ser um evento de run: o jogador vê quem o matou, aguarda respawn, pode voltar à luta ou desistir para a tela inicial. O score passa a ter persistência local/global para dar progressão e comparação.

## Metas

- **US-13 — Servidor autoritativo:** sala online cooperativa via WebSocket binário (MessagePack), até 8 jogadores, sim 30Hz, broadcast 20Hz, sanitização de input, suporte a `INPUT_BATCH` redundante.
- **US-14 — Netcode cliente:** PING/PONG para clock sync, predição local com reconciliação suavizada (`lastProcessedTick` + `angVel`), interpolação de entidades remotas com buffer ~100ms, sem saltos bruscos.
- **Sem game over:** morte sempre oferece respawn; score da run é registrado e zerado no respawn.
- **UI de entrada/respawn/placar:** tela inicial com nome, modo, top 10 e iniciar; tela de respawn com contador 3s, botão respawn após timer e botão desistir.
- **Persistência:** nome em cookie; top 10 local (Treinamento) em `localStorage`; top 10 global (Multiplayer) em SQLite no servidor.

## Não-metas

- Matchmaking ranqueado, contas/auth, ELO, anti-cheat avançado além de sanitização/rate/payload.
- Múltiplos modos de jogo além de Treinamento e Multiplayer cooperativo/arena existente.
- Persistência cloud, cross-server, ou migração de schema complexa.
- Replay, espectador completo de partida, chat de texto/voz.
- Física nova além do necessário para suportar multiplayer/respawn/score.

## Anti-metas (falha mesmo “funcionando”)

- Duplicar lógica de sim entre `shared/` e `server/` causando drift.
- Corrigir reconciliação com teleporte brusco da câmera/ship local (especialmente desconfortável em VR).
- Travar o mundo no death; o jogador deve ver o jogo continuar.
- Gravar score sem regra clara ou permitir sobrescrever score de outro jogador por payload não confiável.
- Bloquear solo/offline por depender de SQLite/rede.

## Restrições

- Spec v3.0: ADR-06 determinismo (30Hz fixo), rede 20Hz, `INTERPOLATION_DELAY_MS=100`, `MAX_PLAYERS_PER_ROOM=8`, `RESPAWN_DELAY_SEC=3.0`, `SPAWN_INVULN_SEC=3.0`.
- `shared/` permanece isomórfico: sem `three`, DOM, Node.
- Hot loops sem alocações óbvias; TypeScript `strict`, `noUncheckedIndexedAccess`.
- Protocolo deve suportar `INPUT_BATCH` redundante e sanitização no servidor.
- Mudanças devem preservar Treinamento jogável sem servidor.

## Abordagens consideradas

| Abordagem | Resumo | Prós | Contras | Decisão |
|---|---|---|---|---|
| A. Reusar `shared/src/sim/GameRoom` no servidor + netcode cliente completo | Servidor hospeda instâncias do GameRoom shared por sala, faz IO WS/MessagePack/auth de sala/rate-limit. Cliente ganha `WsTransport`, `ClockSync`, `Predictor`, `Interpolator`. | Sem drift solo/multi; aproveita M4; alinhado ao spec 3.3; menor risco de lógica duplicada. | Requer adaptar GameRoom para multi-player real (múltiplos ships, join/leave, respawn por player, killer attribution). | **Escolhida** |
| B. Server GameRoom separado do shared | Implementar lógica de sala autoritativa só no server. | Liberdade para API de rede. | Alto risco de drift, duplicação, bugs de regras. | Rejeitada |
| C. US-13 primeiro sem predição/reconciliação | Só transporte/servidor autoritativo. | Menor bloco inicial. | Experiência ruim com latência; usuário já escolheu M5 completo. | Rejeitada |

## Decisões de produto/UX (confirmadas)

- **Modos na tela inicial:** `Treinamento` e `Multiplayer`. Botão “Treinar” inicia solo.
- **Tela inicial:** top 10 com posição/nome/placar, input de nome, seleção de modo, ação iniciar. Nome salvo em cookie.
- **Sem game over:** morte mostra overlay de respawn com contador 3s.
- **Respawn UI:** contador 3s; botão `Respawn` habilita ao terminar; botão `Desistir` volta à tela inicial sem respawn.
- **Câmera na morte:** segue em terceira pessoa o inimigo que matou o jogador até clicar `Respawn` ou `Desistir`.
- **Score:** a cada morte registra a pontuação atual da run e zera score no respawn. Treinamento salva no `localStorage`; Multiplayer salva no SQLite do servidor.
- **Leaderboard HUD:** canto superior esquerdo, sempre visível durante gameplay; mostra top 10 + posição/nome/score do jogador atual, conforme modo.

## Design técnico

### 1. Simulação e regras (`shared/src/sim`)

- **Reuso:** manter `GameRoom` como núcleo determinístico. Adaptar para N jogadores:
  - `addPlayer`/`removePlayer` ou equivalente interno; `WELCOME.playerId` estável por conexão.
  - Fila de comandos por player/tick; ignorar tick antigo/duplicado; `lastProcessedTick` por ship.
  - Respawn por ship: ao morrer, `alive=false`, `respawnAtTick`/timer, `killerId` opcional, score da run capturado para evento de “score recorded”.
- **Morte/respawn:**
  - `killShip` registra `killerId` quando aplicável (enemy projectile/enemy entity owner id). `PLAYER_DEATH` passa a carregar `playerId` e `killerId?` (extensão de protocolo).
  - Score atual é “run score”. Ao morrer: emitir evento de registro (`SCORE_RECORDED` ou payload no evento de morte) com `{playerId,name,score,wave,tick}` antes de zerar; `ship.score=0`; `invulnTimer` e respawn timer aplicados no respawn.
  - Respawn manual por UI: cliente envia comando/mensagem `RESPAWN_REQUEST` (ou input especial) apenas quando elegível; servidor valida timer. Alternativa simples: servidor auto-respawn após 3s se player não desistiu; botão “Respawn” confirma intenção de permanecer. **Decisão proposta:** servidor autoriza respawn após 3s; cliente envia `RESPAWN_REQUEST` quando botão clicado e timer expirado; `QUIT`/desconexão remove jogador da sala.
- **Game over:** não existe. `gameOver` no snapshot deixa de significar fim definitivo; pode ser removido ou mantido só para compatibilidade (sempre false) — preferir remover uso e limpar referências.

### 2. Protocolo (`shared/src/types.ts`)

Extensões compatíveis, versionadas por forma de tipo:

- `ClientMessage` adiciona:
  - `RESPAWN_REQUEST` `{ t:'RESPAWN_REQUEST' }` (servidor valida elegibilidade)
  - `QUIT` `{ t:'QUIT' }` (saída limpa)
  - opcional `LEADERBOARD_REQUEST` `{ t:'LEADERBOARD_REQUEST'; scope:'GLOBAL' }` (multiplayer) — ou enviar no welcome/periódico.
- `ServerMessage` adiciona:
  - `PLAYER_DEATH` evento com `playerId`, `killerId?: string | number`, `killerKind?: 'ENEMY'|'PLAYER'|'ASTEROID'|'UNKNOWN'`, `respawnDelaySec`.
  - `SCORE_RECORDED` evento `{ playerId, name, score, wave, rank? }` ou incluir rank após persistência.
  - `LEADERBOARD` `{ t:'LEADERBOARD'; scope:'GLOBAL'|'LOCAL'; entries:[{rank,name,score}...]; current?:{rank,name,score} }`.
  - `WELCOME` pode incluir `respawnDelaySec`, `serverVersion/protocol` se útil.
- `SNAPSHOT` mantém campos existentes; `gameOver` pode ser removido/ignorado. Ships continuam com `score` da run atual.

**Wire:** JSON para LocalTransport interno; **MessagePack binário** para WsTransport. Ambos carregam os mesmos tipos lógicos. Decodificação valida shape/tamanho.

### 3. Servidor (`server/src`)

- **`index.ts`**: HTTP + WS, `/health`, rate limit simples por IP/conexão, limite de payload (ex. 512 bytes msgpack/json), criação de `RoomManager`.
- **`RoomManager.ts`**: cria/reusa sala default “arena” para M5 simples (ou por roomId futuro); limpa salas vazias/inativas; limita MAX_PLAYERS_PER_ROOM.
- **`GameRoom.ts` (server wrapper, não duplicar sim)**: encapsula `shared` `GameRoom` + conexões. Tick 30Hz; recebe inputs; a cada 20Hz faz broadcast snapshot; drena eventos e envia. Faz sanitização final de mensagens recebidas.
- **SQLite leaderboard:** arquivo local em `server/data/leaderboard.db` (gitignored). Tabela simples: `scores(id INTEGER PK, name TEXT, score INTEGER, wave INTEGER, mode TEXT, created_at TEXT)`. API interna: `recordScore`, `getTop(limit)`, `getRank(score)`. Usar driver simples (`better-sqlite3` síncrono no server tick boundary, ou `node:sqlite` se estável no runtime alvo; decisão de implementação: preferir `better-sqlite3` por maturidade, salvo restrição). Escrita fora do hot path crítico por tick (fila/async boundary aceitável, sem bloquear sim).

### 4. Cliente (`client/src`)

- **Tela inicial (`ui/StartScreen.ts`)**: overlay HTML antes do jogo. Nome input (cookie `asteroids_player_name`), botões `Treinar` e `Multiplayer`, lista top 10. Troca de modo atualiza fonte do leaderboard. `Iniciar` monta GameApp/transport apropriado.
- **Respawn overlay (`ui/RespawnOverlay.ts`)**: aparece ao morrer; mostra “Você foi destruído por X”, contador 3s, botão `Respawn` (disabled até 0), `Desistir`. Em 0, habilita respawn; ao clicar respawn envia `RESPAWN_REQUEST`; desistir envia `QUIT` e retorna à tela inicial.
- **Leaderboard HUD (`ui/LeaderboardHud.ts` ou integrado ao HUD):** canto superior esquerdo, DOM overlay ou canvas HUD separado — preferir DOM overlay simples para texto nítido e baixo custo, atualizado só quando muda. Mostra top 10 + linha “Você: #N Nome Score”.
- **Net:**
  - `WsTransport.ts`: implementa `ITransport` usando `WebSocket` binário, encode/decode MessagePack, reconexão fora do escopo M5 (falha clara).
  - `ClockSync.ts`: PING periódico, calcula offset/RTT simples; expõe serverTime estimado.
  - `Predictor.ts`: mantém buffer de comandos enviados; aplica input local imediatamente no estado local previsto; ao receber snapshot, acha `lastProcessedTick`, reseta estado local para snapshot autoritativo e reaplica comandos pendentes; suaviza erro residual (offset decay) para não pular câmera.
  - `Interpolator.ts`: buffer circular de snapshots por entidade remota com timestamp; renderiza remotos em `serverTime - INTERPOLATION_DELAY_MS` usando LERP pos/vel escalar e SLERP quat.

### 5. Integração de modos

- **Treinamento:** `LocalTransport` + worker + GameRoom shared. Leaderboard local em `localStorage` chave `asteroids_leaderboard_local_v1`. Morte grava score local, zera score, mostra respawn; desistir volta tela inicial.
- **Multiplayer:** `WsTransport` para `/ws`. Join com nome/plataforma. Leaderboard global via SQLite; servidor envia `LEADERBOARD` no welcome e após `SCORE_RECORDED`. Morte mostra killer, respawn/desistir; desistir fecha conexão e volta tela inicial.

### 6. Killer attribution

- Enemy projectile/ship: `killerKind='ENEMY'`, `killerId=enemy.id`.
- Asteroid collision: `killerKind='ASTEROID'`, `killerId=asteroid.id`.
- Player projectile (futuro PvP): `killerKind='PLAYER'`, `killerId=shipId`.
- Fallback `UNKNOWN`.
- Camera de morte: se killer for inimigo vivo, seguir inimigo; se asteroid, seguir posição do asteroid/fragmento mais próximo ou posição de impacto; se desconhecido, câmera lenta/orbita curta.

## Decisões resolvidas

- **Modo multiplayer é cooperativo (spec 1.3/US-13):** jogadores compartilham a mesma sala/onda; sem dano PvP/friendly fire em M5. Projéteis de player ignoram outros players; score é por jogador. Killer attribution PvP fica suportado no tipo, mas não ocorre no M5.
- **Respawn:** zera score da run; restaura shield/energia; aplica invuln de spawn; reposiciona em spawn seguro; mundo continua. Em Treinamento, o mundo continua durante a morte e após respawn. Em Multiplayer, o jogador renasce no mesmo estado vivo da sala.
- **Sala cheia/default:** M5 usa sala/arena default simples. Se cheia, servidor rejeita join com erro claro; cliente mostra mensagem e permanece na tela inicial. Sem matchmaking multi-sala no M5.
- **Killer camera fallback:** inimigo vivo -> segue inimigo; se morto/asteroid/desconhecido -> segue posição do impacto com câmera lenta/orbita curta até ação do usuário.

## Decisões confirmadas pelo usuário

- **Identidade leaderboard global:** servidor emite `playerToken` opaco (armazenado no cliente) e usa esse token para associar scores/posição “você”; nome é display name editável. Não usa nome como chave de identidade.
- **Registro de score:** registra a cada morte e também ao **Desistir/QUIT/desconexão** se a run atual tiver score > 0, antes de zerar/sair.
- **HUD “você”:** top 10 histórico do modo + linha do jogador com **score atual da run** e, quando disponível, **melhor posição/score registrado**.

## Riscos e mitigações

- **Drift de regras:** reuso de `shared` GameRoom no server; testes de integração cliente-servidor.
- **Jitter VR:** suavização exponencial de erro residual; nunca teleporte duro da câmera; correção limitada por frame.
- **Persistência no hot path:** gravação SQLite fora do tick; fila simples.
- **Payload/flood:** max 512 bytes, validação de shape, rate limit, drop/desconectar.
- **Escopo grande:** implementar em fatias verticais (US-13 base, depois netcode, depois UI/leaderboard/persistência), com testes em cada fatia.

## Critérios de aceite

- Compila em TS strict, testes passam.
- Treinamento continua offline, sem regressão de controles/render.
- Multiplayer: 2+ clientes entram na mesma sala, veem estado autoritativo, inputs redundantes aceitos, sem divergência óbvia.
- Morte: sem game over; mostra killer e contador 3s; Respawn habilita após 3s; Desistir volta à tela inicial.
- Score: ao morrer, score atual é registrado e zerado no respawn; top 10 e posição do jogador atual aparecem no HUD.
- SQLite persiste leaderboard global multiplayer; localStorage persiste leaderboard Treinamento; nome persiste em cookie.

## Fora do builder / pendências de validação

- Balanceamento fino de dificuldade com respawn/score reset.
- Validação real de latência 100ms+/perda em redes móveis.
- Teste Quest 3/VR Box/Android para conforto com reconciliação.
- Política de anti-cheat/rate limit forte além do básico.
