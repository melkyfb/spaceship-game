import { ServerRoom, type ScoreRecorder, type SocketLike } from './ServerRoom';

export interface RoomManagerOptions {
  seed?: number;
  scoreRecorder?: ScoreRecorder;
  now?: () => number;
}

export class RoomManager {
  readonly defaultRoom: ServerRoom;
  private readonly rooms = new Map<string, ServerRoom>();

  constructor(opts: RoomManagerOptions = {}) {
    this.defaultRoom = new ServerRoom({
      roomId: 'default',
      seed: opts.seed,
      scoreRecorder: opts.scoreRecorder,
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
