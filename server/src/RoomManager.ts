import { LeaderboardStore } from './LeaderboardStore';
import { ServerRoom, type ScoreRecorder, type SocketLike } from './ServerRoom';

export interface RoomManagerOptions {
  seed?: number;
  scoreRecorder?: ScoreRecorder;
  leaderboardStore?: LeaderboardStore;
  now?: () => number;
}

export class RoomManager {
  readonly defaultRoom: ServerRoom;
  readonly leaderboardStore: LeaderboardStore | undefined;
  private readonly rooms = new Map<string, ServerRoom>();

  constructor(opts: RoomManagerOptions = {}) {
    this.leaderboardStore = opts.leaderboardStore;
    const scoreRecorder: ScoreRecorder | undefined =
      opts.scoreRecorder ?? (this.leaderboardStore ? (r) => this.leaderboardStore!.recordScore(r) : undefined);
    this.defaultRoom = new ServerRoom({
      roomId: 'default',
      seed: opts.seed,
      scoreRecorder,
      createPlayerToken: this.leaderboardStore
        ? (existing) => this.leaderboardStore!.getOrCreateToken(existing)
        : undefined,
      now: opts.now,
    });
    this.rooms.set(this.defaultRoom.roomId, this.defaultRoom);
  }

  getRoom(roomId: string): ServerRoom | undefined {
    return this.rooms.get(roomId);
  }

  handleOpen(socket: SocketLike): void {
    // Route to default room for M5; JOIN validation happens in ServerRoom.
    this.defaultRoom.handleOpen(socket);
  }

  handleMessage(socket: SocketLike, data: Uint8Array): void {
    this.defaultRoom.handleMessage(socket, data);
  }

  handleClose(socket: SocketLike): void {
    // Notify all rooms; only the owning room will have the client.
    for (const room of this.rooms.values()) {
      room.handleClose(socket);
    }
  }

  tick(): void {
    for (const room of this.rooms.values()) room.tick();
  }

  start(): void {
    for (const room of this.rooms.values()) room.start();
  }

  stop(): void {
    for (const room of this.rooms.values()) room.stop();
  }
}
