import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { decode, encode } from '@msgpack/msgpack';
import { WebSocket } from 'ws';
import { createWebSocketServer } from '../src/ws-server';

function toBytes(data: WebSocket.RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function nextMessage(socket: WebSocket, timeoutMs = 2000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for WS message')), timeoutMs);
    socket.once('message', (data) => {
      clearTimeout(timer);
      resolve(decode(toBytes(data)));
    });
  });
}

async function nextMessageOfType<T extends { t: string }>(
  socket: WebSocket,
  type: T['t'],
  timeoutMs = 2000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const msg = (await nextMessage(socket, remaining)) as T;
    if (msg && msg.t === type) return msg;
  }
  throw new Error(`timed out waiting for WS message type ${type}`);
}

test('join receives WELCOME and ping receives PONG', async () => {
  const wss = createWebSocketServer(0);
  await new Promise<void>((resolve) => wss.once('listening', resolve));
  const { port } = wss.address() as AddressInfo;

  const client = new WebSocket(`ws://127.0.0.1:${port}`);
  try {
    await new Promise<void>((resolve, reject) => {
      client.once('open', resolve);
      client.once('error', reject);
    });

    const welcomeP = nextMessageOfType<{ t: 'WELCOME'; playerId?: string; roomId?: string }>(client, 'WELCOME');
    client.send(encode({ t: 'JOIN', roomId: 'default', name: 'Pilot', platform: 'PC' }));
    const welcome = await welcomeP;
    assert.equal(welcome.t, 'WELCOME');
    assert.equal(welcome.roomId, 'default');
    assert.equal(typeof welcome.playerId, 'string');

    const pongP = nextMessageOfType<{ t: 'PONG'; clientTime: number; serverTime: number }>(client, 'PONG');
    client.send(encode({ t: 'PING', clientTime: 123 }));
    const msg = await pongP;
    assert.equal(msg.t, 'PONG');
    assert.equal(msg.clientTime, 123);
    assert.equal(typeof msg.serverTime, 'number');
  } finally {
    client.close();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  }
});
