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

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for WS message')), 2000);
    socket.once('message', (data) => {
      clearTimeout(timer);
      resolve(decode(toBytes(data)));
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
    client.send(encode({ t: 'PING', clientTime: 123 }));
    const msg = (await pong) as { t: string; clientTime: number; serverTime: number };
    assert.equal(msg.t, 'PONG');
    assert.equal(msg.clientTime, 123);
    assert.equal(typeof msg.serverTime, 'number');
  } finally {
    client.close();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  }
});
