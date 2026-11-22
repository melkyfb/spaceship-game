import { WebSocketServer } from 'ws';

const PORT = 8080;

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (socket) => {
  // Greet every new client so the UI can confirm the proxy path works end to end.
  socket.send(JSON.stringify({ t: 'hello' }));

  socket.on('message', (data) => {
    let message: unknown;
    try {
      message = JSON.parse(data.toString());
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
});

wss.on('listening', () => {
  console.log(`[ws-stub] listening on ws://localhost:${PORT}`);
});
