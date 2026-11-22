import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { createWebSocketServer } from '../src/ws-server';

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for WS message')), 2000);
    socket.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

test('hello on connect and pong on ping', async () => {
  const wss = createWebSocketServer(0);
  await new Promise<void>((resolve) => wss.once('listening', resolve));
  const { port } = wss.address() as AddressInfo;

  const client = new WebSocket(`ws://127.0.0.1:${port}`);
  const hello = nextMessage(client);
  try {
    await new Promise<void>((resolve, reject) => {
      client.once('open', resolve);
      client.once('error', reject);
    });

    assert.deepEqual(await hello, { t: 'hello' });

    const pong = nextMessage(client);
    client.send(JSON.stringify({ t: 'ping' }));
    assert.deepEqual(await pong, { t: 'pong' });
  } finally {
    client.close();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  }
});
