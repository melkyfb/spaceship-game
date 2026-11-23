import { randomUUID } from 'node:crypto';
import { WORLD_CONFIG } from '../../shared/src/constants';
import { GameRoom } from '../../shared/src/sim/GameRoom';
import type { ClientMessage, ServerMessage } from '../../shared/src/types';
import { decodeClientMessage, encodeServerMessage } from './protocol';

export interface ScoreRecord {
  playerToken: string;
  playerId: string;
  name: string;
  score: number;
  wave: number;
  roomId: string;
  mode: 'MULTIPLAYER';
}

export type ScoreRecorder = (record: ScoreRecord) => void;

export interface SocketLike {
  readyState: number;
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
}

interface ClientState {
  socket: SocketLike;
  playerId: string;
  playerToken: string;
  name: string;
  joined: boolean;
}

export interface ServerRoomOptions {
  roomId?: string;
  seed?: number;
  scoreRecorder?: ScoreRecorder;
  now?: () => number;
}

const OPEN_READY_STATE = 1;

export class ServerRoom {
  readonly roomId: string;
  readonly gameRoom: GameRoom;
  private readonly scoreRecorder: ScoreRecorder | undefined;
  private readonly now: () => number;
  private readonly clientsBySocket = new Map<SocketLike, ClientState>();
  private readonly socketByPlayerId = new Map<string, SocketLike>();
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(opts: ServerRoomOptions = {}) {
    this.roomId = opts.roomId ?? 'default';
    this.scoreRecorder = opts.scoreRecorder;
    this.now = opts.now ?? (() => Date.now());
    this.gameRoom = new GameRoom({
      seed: opts.seed ?? 1,
      spawnInitialWave: true,
      gameOverOnDeath: false,
      autoRespawn: false,
      createDefaultPlayer: false,
    });
  }

  get playerCount(): number {
    return this.gameRoom.playerCount();
  }

  start(): void {
    if (this.interval !== null) return;
    const ms = Math.round(1000 / WORLD_CONFIG.FIXED_TICK_RATE);
    this.interval = setInterval(() => this.tick(), ms);
  }

  stop(): void {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  handleOpen(socket: SocketLike): void {
    if (this.clientsBySocket.has(socket)) return;
    this.clientsBySocket.set(socket, {
      socket,
      playerId: '',
      playerToken: '',
      name: '',
      joined: false,
    });
  }

  handleMessage(socket: SocketLike, data: Uint8Array): void {
    let client = this.clientsBySocket.get(socket);
    if (!client) {
      this.handleOpen(socket);
      client = this.clientsBySocket.get(socket);
      if (!client) return;
    }

    const decoded = decodeClientMessage(data);
    if (!decoded.ok) {
      // Ignore malformed/invalid input silently; protocol layer already validates.
      return;
    }
    this.handleClientMessage(client, decoded.value);
  }

  handleClose(socket: SocketLike): void {
    const client = this.clientsBySocket.get(socket);
    if (!client) return;
    if (client.joined) {
      this.removeJoinedClient(client, 'disconnect');
    } else {
      this.clientsBySocket.delete(socket);
    }
  }

  tick(): void {
    this.gameRoom.stepFixed();
    this.drainAndRecordEvents();
    if (this.gameRoom.shouldEmitSnapshot()) {
      this.broadcast(this.gameRoom.snapshot() as ServerMessage);
    }
  }

  private handleClientMessage(client: ClientState, msg: ClientMessage): void {
    if (msg.t === 'PING') {
      this.send(client.socket, {
        t: 'PONG',
        clientTime: msg.clientTime,
        serverTime: this.now(),
      });
      return;
    }

    if (msg.t === 'JOIN') {
      this.handleJoin(client, msg);
      return;
    }

    if (!client.joined) {
      // Ignore gameplay messages before JOIN.
      return;
    }

    if (msg.t === 'INPUT_BATCH') {
      this.gameRoom.receiveForPlayer(client.playerId, msg.cmds);
      return;
    }

    if (msg.t === 'RESPAWN_REQUEST') {
      this.gameRoom.requestRespawn(client.playerId);
      return;
    }

    if (msg.t === 'QUIT') {
      this.removeJoinedClient(client, 'quit');
      return;
    }
  }

  private handleJoin(
    client: ClientState,
    msg: Extract<ClientMessage, { t: 'JOIN' }>,
  ): void {
    if (client.joined) {
      // Already joined - ignore duplicate JOIN.
      return;
    }

    // Simple single-default-room policy for M5.
    if (msg.roomId !== this.roomId) {
      this.reject(client.socket, 'ROOM_NOT_FOUND', 'Sala não encontrada');
      return;
    }

    if (this.gameRoom.playerCount() >= WORLD_CONFIG.MAX_PLAYERS_PER_ROOM) {
      this.reject(client.socket, 'ROOM_FULL', 'Sala cheia');
      return;
    }

    const playerId = randomUUID();
    const playerToken = randomUUID();
    const name = normalizeName(msg.name);

    const added = this.gameRoom.addPlayer({ id: playerId, name, platform: msg.platform });
    if (!added) {
      this.reject(client.socket, 'ROOM_FULL', 'Sala cheia');
      return;
    }

    client.playerId = playerId;
    client.playerToken = playerToken;
    client.name = name;
    client.joined = true;
    this.socketByPlayerId.set(playerId, client.socket);

    this.send(client.socket, {
      t: 'WELCOME',
      playerId,
      roomId: this.roomId,
      serverTick: this.gameRoom.currentTick,
      serverTime: this.now(),
      playerToken,
      protocol: 1,
    });

    // Send immediate snapshot so the client can render without waiting for next broadcast.
    this.send(client.socket, this.gameRoom.snapshot() as ServerMessage);
  }

  private reject(socket: SocketLike, code: string, message: string): void {
    // No dedicated ERROR ServerMessage type in shared protocol yet; close with clear reason.
    // The close reason is surfaced to clients; keep it human-readable.
    try {
      socket.close(4000, `${code}: ${message}`);
    } catch {
      // ignore close failures
    }
    this.clientsBySocket.delete(socket);
  }

  private removeJoinedClient(client: ClientState, _reason: 'quit' | 'disconnect'): void {
    const socket = client.socket;
    const playerId = client.playerId;
    if (playerId && this.gameRoom.hasPlayer(playerId)) {
      this.gameRoom.quit(playerId);
      this.drainAndRecordEvents();
    }
    if (playerId) this.socketByPlayerId.delete(playerId);
    this.clientsBySocket.delete(socket);
  }

  private drainAndRecordEvents(): void {
    const events = this.gameRoom.drainEvents();
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev === undefined) continue;
      if (ev.t === 'EVENT' && ev.kind === 'SCORE_RECORDED') {
        const scoreEv = ev as Extract<ServerMessage, { t: 'EVENT' }> & {
          kind: 'SCORE_RECORDED';
          playerId: string;
          name: string;
          score: number;
          wave: number;
        };
        this.recordScore(scoreEv);
      }
      // Broadcast gameplay events to all joined clients.
      this.broadcast(ev as ServerMessage);
    }
  }

  private recordScore(ev: { playerId: string; name: string; score: number; wave: number }): void {
    if (!this.scoreRecorder) return;
    if (!Number.isFinite(ev.score) || ev.score <= 0) return;
    const socket = this.socketByPlayerId.get(ev.playerId);
    const client = socket ? this.clientsBySocket.get(socket) : undefined;
    const playerToken = client?.playerToken;
    if (!playerToken) {
      console.warn(`[server-room] skipping SCORE_RECORDED for ${ev.playerId}: missing playerToken`);
      return;
    }
    this.scoreRecorder({
      playerToken,
      playerId: ev.playerId,
      name: ev.name,
      score: Math.max(0, Math.trunc(ev.score)),
      wave: Math.max(0, Math.trunc(ev.wave)),
      roomId: this.roomId,
      mode: 'MULTIPLAYER',
    });
  }

  private broadcast(msg: ServerMessage): void {
    const bytes = encodeServerMessage(msg);
    for (const client of this.clientsBySocket.values()) {
      if (!client.joined) continue;
      if (client.socket.readyState !== OPEN_READY_STATE) continue;
      try {
        client.socket.send(bytes);
      } catch {
        // Ignore per-socket send failures; close/cleanup happens on close event.
      }
    }
  }

  private send(socket: SocketLike, msg: ServerMessage): void {
    if (socket.readyState !== OPEN_READY_STATE) return;
    try {
      socket.send(encodeServerMessage(msg));
    } catch {
      // ignore
    }
  }
}

function normalizeName(name: string): string {
  const trimmed = name.trim().slice(0, 24);
  return trimmed.length > 0 ? trimmed : 'Pilot';
}
