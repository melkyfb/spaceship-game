import { WebSocketServer, type RawData } from 'ws';
import { encode } from '@msgpack/msgpack';
import { decodeClientMessage, encodeServerMessage } from './protocol';

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

/**
 * Build the development WS stub with the hello/pong contract attached.
 * Kept separate from the entry point so the contract can be tested in-process.
 */
export function createWebSocketServer(port: number): WebSocketServer {
  const wss = new WebSocketServer({ port });

  wss.on('connection', (socket) => {
    // Greet every new client so the UI can confirm the proxy path works end to end.
    socket.send(encode({ t: 'hello' }));

    socket.on('message', (data, isBinary) => {
      const bytes = isBinary || typeof data !== 'string' ? rawDataToBytes(data) : null;
      if (!bytes) return;

      const result = decodeClientMessage(bytes);
      if (!result.ok) return;

      if (result.value.t === 'PING') {
        socket.send(
          encodeServerMessage({
            t: 'PONG',
            clientTime: result.value.clientTime,
            serverTime: Date.now(),
          }),
        );
      }
    });

    socket.on('error', (err) => {
      console.error('[ws-stub] socket error:', err);
    });
  });

  wss.on('listening', () => {
    const address = wss.address();
    const listeningPort = typeof address === 'object' && address ? address.port : port;
    console.log(`[ws-stub] listening on ws://localhost:${listeningPort}`);
  });

  wss.on('error', (err) => {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(`[ws-stub] port ${port} is already in use — is another "server dev" running?`);
      return;
    }
    console.error('[ws-stub] server error:', err);
  });

  return wss;
}
