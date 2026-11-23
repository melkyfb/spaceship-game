import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decode, encode } from '@msgpack/msgpack';
import { WORLD_CONFIG } from '../../shared/src/constants';
import type { ClientMessage, ServerMessage } from '../../shared/src/types';
import { RoomManager } from '../src/RoomManager';
import { ServerRoom, type ScoreRecord } from '../src/ServerRoom';

class MockSocket {
  readonly sent: Uint8Array[] = [];
  readyState = 1; // OPEN
  closedCode: number | undefined;
  closedReason: string | undefined;
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  send(data: Uint8Array): void {
    if (this.readyState !== 1) return;
    this.sent.push(data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer));
  }

  close(code?: number, reason?: string): void {
    if (this.readyState !== 1) return;
    this.readyState = 3; // CLOSED
    this.closedCode = code;
    this.closedReason = reason;
    this.emit('close');
  }

  on(event: string, cb: (...args: unknown[]) => void): this {
    const arr = this.listeners.get(event) ?? [];
    arr.push(cb);
    this.listeners.set(event, arr);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    const arr = this.listeners.get(event) ?? [];
    for (const cb of arr) cb(...args);
  }

  messages(): ServerMessage[] {
    return this.sent.map((b) => decode(b) as ServerMessage);
  }
}

function sendMsg(socket: MockSocket, room: ServerRoom, msg: ClientMessage): void {
  room.handleMessage(socket as never, encode(msg));
}

function join(socket: MockSocket, room: ServerRoom, name: string, roomId = 'default'): void {
  sendMsg(socket, room, { t: 'JOIN', roomId, name, platform: 'PC' });
}

test('two simulated clients join, receive WELCOME and SNAPSHOT', () => {
  const room = new ServerRoom({ roomId: 'default', seed: 1 });
  const a = new MockSocket();
  const b = new MockSocket();

  room.handleOpen(a as never);
  room.handleOpen(b as never);
  join(a, room, 'Alice');
  join(b, room, 'Bob');

  const aMsgs = a.messages();
  const bMsgs = b.messages();

  const aWelcome = aMsgs.find((m) => m.t === 'WELCOME');
  const bWelcome = bMsgs.find((m) => m.t === 'WELCOME');
  assert.ok(aWelcome && aWelcome.t === 'WELCOME');
  assert.ok(bWelcome && bWelcome.t === 'WELCOME');
  assert.equal(aWelcome.roomId, 'default');
  assert.equal(bWelcome.roomId, 'default');
  assert.ok(aWelcome.playerId.length > 0);
  assert.ok(bWelcome.playerId.length > 0);
  assert.notEqual(aWelcome.playerId, bWelcome.playerId);

  // Both should get a snapshot (on join or after tick). Tick until broadcast due.
  for (let i = 0; i < 3; i++) room.tick();
  const aSnaps = a.messages().filter((m): m is Extract<ServerMessage, { t: 'SNAPSHOT' }> => m.t === 'SNAPSHOT');
  const bSnaps = b.messages().filter((m): m is Extract<ServerMessage, { t: 'SNAPSHOT' }> => m.t === 'SNAPSHOT');
  const aSnap = aSnaps[aSnaps.length - 1];
  const bSnap = bSnaps[bSnaps.length - 1];
  assert.ok(aSnap);
  assert.ok(bSnap);
  const aIds = aSnap.ships.map((s) => s.id);
  assert.ok(aIds.includes(aWelcome.playerId));
  assert.ok(aIds.includes(bWelcome.playerId));
});

test('room full rejects 9th join with clear error', () => {
  const manager = new RoomManager({ seed: 1 });
  const sockets: MockSocket[] = [];
  for (let i = 0; i < WORLD_CONFIG.MAX_PLAYERS_PER_ROOM; i++) {
    const s = new MockSocket();
    sockets.push(s);
    manager.handleOpen(s as never);
    manager.handleMessage(s as never, encode({ t: 'JOIN', roomId: 'default', name: `P${i}`, platform: 'PC' }));
  }
  for (const s of sockets) {
    const welcome = s.messages().find((m) => m.t === 'WELCOME');
    assert.ok(welcome, 'expected WELCOME for player within capacity');
  }

  const extra = new MockSocket();
  manager.handleOpen(extra as never);
  manager.handleMessage(extra as never, encode({ t: 'JOIN', roomId: 'default', name: 'Late', platform: 'PC' }));

  const extraMsgs = extra.messages();
  const welcome = extraMsgs.find((m) => m.t === 'WELCOME');
  assert.equal(welcome, undefined);
  // Clear error: either an EVENT/ERROR-like message or close with reason containing full/cheia
  const errMsg = extraMsgs.find((m) => (m as { t?: string }).t === 'ERROR');
  const closedWithReason = extra.readyState === 3 && typeof extra.closedReason === 'string' && /full|cheia/i.test(extra.closedReason);
  assert.ok(errMsg || closedWithReason, `expected room-full error, got msgs=${JSON.stringify(extraMsgs)} closed=${extra.closedReason}`);
});

test('QUIT removes player and records eligible score', () => {
  const scores: ScoreRecord[] = [];
  const room = new ServerRoom({
    roomId: 'default',
    seed: 1,
    scoreRecorder: (r) => scores.push(r),
  });
  const a = new MockSocket();
  room.handleOpen(a as never);
  join(a, room, 'Alice');
  const welcome = a.messages().find((m) => m.t === 'WELCOME');
  assert.ok(welcome && welcome.t === 'WELCOME');
  const playerId = welcome.playerId;

  // Give player score by directly accessing game room state through tick/drain; easier: use room internals for test.
  // We'll score by stepping with a spawned asteroid in front and firing.
  // Access internal game room via (room as any).gameRoom - stable enough for server tests.
  const gr = (room as unknown as { gameRoom: { receiveForPlayer: (id: string, cmds: unknown[]) => void; stepFixed: () => void; drainEvents: () => unknown[]; snapshot: () => any } }).gameRoom;
  // inject asteroid
  (gr as any).asteroids.push({ id: 9999, pos: [0, 0, -20], vel: [0, 0, 0], rot: [0, 0, 0, 1], angVel: [0, 0, 0], size: 'LARGE', hp: 10 });
  for (let i = 1; i <= 60; i++) {
    gr.receiveForPlayer(playerId, [{ tick: i, thrust: 0, strafeX: 0, strafeY: 0, yaw: 0, pitch: 0, roll: 0, firePrimary: true, fireSecondary: false, boost: false }]);
    gr.stepFixed();
    gr.drainEvents();
  }
  const snap = gr.snapshot();
  const ship = snap.ships.find((s: any) => s.id === playerId);
  assert.ok(ship && ship.score > 0, 'expected player to have score before quit');

  sendMsg(a, room, { t: 'QUIT' });
  room.tick(); // allow processing/drain

  assert.ok(scores.some((r) => r.playerId === playerId && r.score > 0), `expected score recorded, got ${JSON.stringify(scores)}`);
  // player removed
  const snapAfter = gr.snapshot();
  assert.ok(!snapAfter.ships.some((s: any) => s.id === playerId));
});

test('disconnect removes player and records eligible score', () => {
  const scores: ScoreRecord[] = [];
  const room = new ServerRoom({
    roomId: 'default',
    seed: 1,
    scoreRecorder: (r) => scores.push(r),
  });
  const a = new MockSocket();
  room.handleOpen(a as never);
  join(a, room, 'Alice');
  const welcome = a.messages().find((m) => m.t === 'WELCOME');
  assert.ok(welcome && welcome.t === 'WELCOME');
  const playerId = welcome.playerId;

  const gr = (room as any).gameRoom;
  gr.asteroids.push({ id: 9998, pos: [0, 0, -20], vel: [0, 0, 0], rot: [0, 0, 0, 1], angVel: [0, 0, 0], size: 'LARGE', hp: 10 });
  for (let i = 1; i <= 60; i++) {
    gr.receiveForPlayer(playerId, [{ tick: i, thrust: 0, strafeX: 0, strafeY: 0, yaw: 0, pitch: 0, roll: 0, firePrimary: true, fireSecondary: false, boost: false }]);
    gr.stepFixed();
    gr.drainEvents();
  }
  const ship = gr.snapshot().ships.find((s: any) => s.id === playerId);
  assert.ok(ship && ship.score > 0);

  room.handleClose(a as never);
  room.tick();

  assert.ok(scores.some((r) => r.playerId === playerId && r.score > 0));
  assert.ok(!gr.snapshot().ships.some((s: any) => s.id === playerId));
});

test('INPUT_BATCH redundant commands are accepted and do not regress state', () => {
  const room = new ServerRoom({ roomId: 'default', seed: 1 });
  const a = new MockSocket();
  room.handleOpen(a as never);
  join(a, room, 'Alice');
  const welcome = a.messages().find((m) => m.t === 'WELCOME');
  assert.ok(welcome && welcome.t === 'WELCOME');
  const playerId = welcome.playerId;
  const gr = (room as any).gameRoom;

  // Send batch with ticks 1,2,3
  sendMsg(a, room, {
    t: 'INPUT_BATCH',
    cmds: [
      { tick: 1, thrust: 1, strafeX: 0, strafeY: 0, yaw: 0, pitch: 0, roll: 0, firePrimary: false, fireSecondary: false, boost: false },
      { tick: 2, thrust: 1, strafeX: 0, strafeY: 0, yaw: 0, pitch: 0, roll: 0, firePrimary: false, fireSecondary: false, boost: false },
      { tick: 3, thrust: 1, strafeX: 0, strafeY: 0, yaw: 0, pitch: 0, roll: 0, firePrimary: false, fireSecondary: false, boost: false },
    ],
  });
  room.tick();
  room.tick();
  room.tick();
  const snap1 = gr.snapshot();
  const ship1 = snap1.ships.find((s: any) => s.id === playerId);
  assert.ok(ship1);

  // Resend redundant batch (same ticks) plus a new one - should not crash or regress
  sendMsg(a, room, {
    t: 'INPUT_BATCH',
    cmds: [
      { tick: 2, thrust: 1, strafeX: 0, strafeY: 0, yaw: 0, pitch: 0, roll: 0, firePrimary: false, fireSecondary: false, boost: false },
      { tick: 3, thrust: 1, strafeX: 0, strafeY: 0, yaw: 0, pitch: 0, roll: 0, firePrimary: false, fireSecondary: false, boost: false },
      { tick: 4, thrust: 1, strafeX: 0, strafeY: 0, yaw: 0, pitch: 0, roll: 0, firePrimary: false, fireSecondary: false, boost: false },
    ],
  });
  room.tick();
  room.tick();
  const snap2 = gr.snapshot();
  const ship2 = snap2.ships.find((s: any) => s.id === playerId);
  assert.ok(ship2);
  assert.ok(ship2.lastProcessedTick >= ship1.lastProcessedTick);
  // Position should have progressed (thrusting forward)
  assert.ok(ship2.pos[2] < 0);
});
