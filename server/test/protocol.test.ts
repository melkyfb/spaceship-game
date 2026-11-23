import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encode, decode } from '@msgpack/msgpack';
import {
  decodeClientMessage,
  encodeServerMessage,
  MAX_CLIENT_MESSAGE_BYTES,
  MAX_INPUT_BATCH_CMDS,
  type DecodeResult,
} from '../src/protocol';
import type { ClientMessage, ServerMessage, ShipCommand } from '../../shared/src/types';

function validCmd(overrides: Partial<ShipCommand> = {}): ShipCommand {
  return {
    tick: 1,
    thrust: 0.5,
    strafeX: -0.25,
    strafeY: 0,
    yaw: 1,
    pitch: -1,
    roll: 0,
    firePrimary: true,
    fireSecondary: false,
    boost: false,
    ...overrides,
  };
}

function expectOk(result: DecodeResult<ClientMessage>): ClientMessage {
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

function expectErr(result: DecodeResult<ClientMessage>): string {
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected error');
  return result.error;
}

test('decodeClientMessage accepts valid JOIN', () => {
  const msg: ClientMessage = { t: 'JOIN', roomId: 'default', name: 'Pilot', platform: 'PC' };
  const value = expectOk(decodeClientMessage(encode(msg)));
  assert.deepEqual(value, msg);
});

test('decodeClientMessage accepts valid PING, RESPAWN_REQUEST, QUIT', () => {
  assert.deepEqual(expectOk(decodeClientMessage(encode({ t: 'PING', clientTime: 1234.5 }))), {
    t: 'PING',
    clientTime: 1234.5,
  });
  assert.deepEqual(expectOk(decodeClientMessage(encode({ t: 'RESPAWN_REQUEST' }))), {
    t: 'RESPAWN_REQUEST',
  });
  assert.deepEqual(expectOk(decodeClientMessage(encode({ t: 'QUIT' }))), { t: 'QUIT' });
});

test('decodeClientMessage accepts valid INPUT_BATCH and clamps axes to [-1,1]', () => {
  const msg: ClientMessage = {
    t: 'INPUT_BATCH',
    cmds: [validCmd({ thrust: 2, strafeX: -5, yaw: 1.5, pitch: -1.2, roll: 0.3 })],
  };
  const value = expectOk(decodeClientMessage(encode(msg)));
  assert.equal(value.t, 'INPUT_BATCH');
  if (value.t !== 'INPUT_BATCH') return;
  assert.equal(value.cmds.length, 1);
  const cmd = value.cmds[0];
  assert.ok(cmd);
  assert.equal(cmd.thrust, 1);
  assert.equal(cmd.strafeX, -1);
  assert.equal(cmd.yaw, 1);
  assert.equal(cmd.pitch, -1);
  assert.equal(cmd.roll, 0.3);
});

test('decodeClientMessage rejects malformed payload', () => {
  expectErr(decodeClientMessage(new Uint8Array([0xff, 0x00, 0x13, 0xa2])));
  expectErr(decodeClientMessage(new Uint8Array()));
});

test('decodeClientMessage rejects oversize payload > 512 bytes', () => {
  const bigName = 'A'.repeat(600);
  const bytes = encode({ t: 'JOIN', roomId: 'default', name: bigName, platform: 'PC' });
  assert.ok(bytes.byteLength > MAX_CLIENT_MESSAGE_BYTES);
  expectErr(decodeClientMessage(bytes));
});

test('decodeClientMessage rejects NaN/Infinity in command axes', () => {
  const nanMsg = { t: 'INPUT_BATCH', cmds: [validCmd({ thrust: Number.NaN })] };
  expectErr(decodeClientMessage(encode(nanMsg)));

  const infMsg = { t: 'INPUT_BATCH', cmds: [validCmd({ yaw: Number.POSITIVE_INFINITY })] };
  expectErr(decodeClientMessage(encode(infMsg)));

  const negInfMsg = { t: 'INPUT_BATCH', cmds: [validCmd({ pitch: Number.NEGATIVE_INFINITY })] };
  expectErr(decodeClientMessage(encode(negInfMsg)));
});

test('decodeClientMessage rejects NaN/Infinity in PING clientTime', () => {
  expectErr(decodeClientMessage(encode({ t: 'PING', clientTime: Number.NaN })));
  expectErr(decodeClientMessage(encode({ t: 'PING', clientTime: Number.POSITIVE_INFINITY })));
});

test('decodeClientMessage rejects unknown message type', () => {
  expectErr(decodeClientMessage(encode({ t: 'HACK' })));
  expectErr(decodeClientMessage(encode({ t: 42 })));
  expectErr(decodeClientMessage(encode({ nope: true })));
});

test('decodeClientMessage ignores extra fields per rule', () => {
  const bytes = encode({
    t: 'JOIN',
    roomId: 'default',
    name: 'Pilot',
    platform: 'PC',
    extra: 'ignored',
    admin: true,
  });
  const value = expectOk(decodeClientMessage(bytes));
  assert.deepEqual(value, { t: 'JOIN', roomId: 'default', name: 'Pilot', platform: 'PC' });
});

test('decodeClientMessage rejects invalid shape and types', () => {
  expectErr(decodeClientMessage(encode({ t: 'JOIN', roomId: 1, name: 'Pilot', platform: 'PC' })));
  expectErr(decodeClientMessage(encode({ t: 'JOIN', roomId: 'r', name: 'Pilot', platform: 'TOASTER' })));
  expectErr(decodeClientMessage(encode({ t: 'INPUT_BATCH', cmds: 'nope' })));
  expectErr(
    decodeClientMessage(encode({ t: 'INPUT_BATCH', cmds: [validCmd({ firePrimary: 'yes' as never })] })),
  );
  expectErr(
    decodeClientMessage(encode({ t: 'INPUT_BATCH', cmds: [validCmd({ tick: 1.5 })] })),
  );
});

test('decodeClientMessage bounds INPUT_BATCH command count', () => {
  const cmds = Array.from({ length: MAX_INPUT_BATCH_CMDS + 1 }, (_, i) => validCmd({ tick: i }));
  expectErr(decodeClientMessage(encode({ t: 'INPUT_BATCH', cmds })));
});

test('encodeServerMessage round-trips through msgpack decode', () => {
  const msg: ServerMessage = {
    t: 'WELCOME',
    playerId: 'p1',
    roomId: 'default',
    serverTick: 10,
    serverTime: 1234,
  };
  const bytes = encodeServerMessage(msg);
  assert.ok(bytes instanceof Uint8Array);
  const decoded = decode(bytes) as ServerMessage;
  assert.deepEqual(decoded, msg);
});

test('decodeClientMessage never throws on hostile input', () => {
  const hostile: unknown[] = [
    new Uint8Array([0xc1]),
    encode(null),
    encode(1),
    encode('JOIN'),
    encode([1, 2, 3]),
    encode({ t: 'INPUT_BATCH', cmds: [null] }),
    encode({ t: 'INPUT_BATCH', cmds: [{ tick: 0 }] }),
  ];
  for (const input of hostile) {
    assert.doesNotThrow(() => {
      const result = decodeClientMessage(input as Uint8Array);
      assert.equal(typeof result.ok, 'boolean');
    });
  }
});
