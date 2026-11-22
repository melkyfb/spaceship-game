import { WebSocketServer, type RawData } from 'ws';

/** Normalize a ws RawData payload to a UTF-8 string before JSON parsing. */
export function rawDataToString(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data)).toString('utf8');
  return data.toString('utf8');
}

/**
 * Build the development WS stub with the hello/pong contract attached.
 * Kept separate from the entry point so the contract can be tested in-process.
 */
export function createWebSocketServer(port: number): WebSocketServer {
  const wss = new WebSocketServer({ port });

  wss.on('connection', (socket) => {
    // Greet every new client so the UI can confirm the proxy path works end to end.
    socket.send(JSON.stringify({ t: 'hello' }));

    socket.on('message', (data) => {
      let message: unknown;
      try {
        message = JSON.parse(rawDataToString(data));
      } catch {
        return;
      }

      if (
        typeof message === 'object' &&
        message !== null &&
        't' in message &&
        (message as { t: unknown }).t === 'ping'
      ) {
        socket.send(JSON.stringify({ t: 'pong' }));
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
