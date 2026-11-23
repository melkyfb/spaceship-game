import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { RoomManager } from './RoomManager';

/** Normalize ws RawData to a UTF-8 string (legacy helper kept for compatibility). */
export function rawDataToString(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data)).toString('utf8');
  return data.toString('utf8');
}

/** Normalize ws RawData to bytes for msgpack decoding. */
export function rawDataToBytes(data: RawData): Uint8Array {
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Buffer.isBuffer(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data as ArrayBuffer);
}

export interface CreateWebSocketServerOptions {
  roomManager?: RoomManager;
}

/**
 * Build the authoritative WS server wired to RoomManager/ServerRoom.
 * Kept as a factory for in-process tests and index bootstrap.
 */
export function createWebSocketServer(port: number, opts: CreateWebSocketServerOptions = {}): WebSocketServer {
  const wss = new WebSocketServer({ port });
  const roomManager = opts.roomManager ?? new RoomManager();
  roomManager.start();

  wss.on('connection', (socket: WebSocket) => {
    roomManager.handleOpen(socket);

    socket.on('message', (data, isBinary) => {
      const bytes = isBinary || typeof data !== 'string' ? rawDataToBytes(data) : Buffer.from(data, 'utf8');
      roomManager.handleMessage(socket, bytes);
    });

    socket.on('close', () => {
      roomManager.handleClose(socket);
    });

    socket.on('error', (err) => {
      console.error('[ws] socket error:', err);
    });
  });

  wss.on('listening', () => {
    const address = wss.address();
    const listeningPort = typeof address === 'object' && address ? address.port : port;
    console.log(`[ws] listening on ws://localhost:${listeningPort}`);
  });

  wss.on('close', () => {
    roomManager.stop();
  });

  wss.on('error', (err) => {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(`[ws] port ${port} is already in use — is another "server dev" running?`);
      return;
    }
    console.error('[ws] server error:', err);
  });

  return wss;
}
