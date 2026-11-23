import { decode, encode } from '@msgpack/msgpack';
import {
  CLIENT_MESSAGE_TYPES,
  type ClientMessage,
  type ClientMessageType,
  type PlatformMode,
  type ServerMessage,
  type ShipCommand,
} from '../../shared/src/types';

export const MAX_CLIENT_MESSAGE_BYTES = 512;
export const MAX_INPUT_BATCH_CMDS = 16;

export type DecodeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const PLATFORM_MODES: readonly PlatformMode[] = ['PC', 'ANDROID_FLAT', 'VR_BOX', 'QUEST_3'];
const CLIENT_MESSAGE_TYPE_SET = new Set<ClientMessageType>(CLIENT_MESSAGE_TYPES);

function err(error: string): DecodeResult<never> {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function clampAxis(value: unknown): DecodeResult<number> {
  if (!isFiniteNumber(value)) return err('axis must be a finite number');
  if (value <= -1) return { ok: true, value: -1 };
  if (value >= 1) return { ok: true, value: 1 };
  return { ok: true, value };
}

function validateShipCommand(value: unknown): DecodeResult<ShipCommand> {
  if (!isRecord(value)) return err('command must be an object');

  const tick = value.tick;
  if (!isFiniteNumber(tick) || !Number.isInteger(tick) || tick < 0) {
    return err('command.tick must be a finite non-negative integer');
  }

  const thrust = clampAxis(value.thrust);
  if (!thrust.ok) return thrust;
  const strafeX = clampAxis(value.strafeX);
  if (!strafeX.ok) return strafeX;
  const strafeY = clampAxis(value.strafeY);
  if (!strafeY.ok) return strafeY;
  const yaw = clampAxis(value.yaw);
  if (!yaw.ok) return yaw;
  const pitch = clampAxis(value.pitch);
  if (!pitch.ok) return pitch;
  const roll = clampAxis(value.roll);
  if (!roll.ok) return roll;

  const firePrimary = value.firePrimary;
  const fireSecondary = value.fireSecondary;
  const boost = value.boost;
  if (typeof firePrimary !== 'boolean') return err('command.firePrimary must be boolean');
  if (typeof fireSecondary !== 'boolean') return err('command.fireSecondary must be boolean');
  if (typeof boost !== 'boolean') return err('command.boost must be boolean');

  return {
    ok: true,
    value: {
      tick,
      thrust: thrust.value,
      strafeX: strafeX.value,
      strafeY: strafeY.value,
      yaw: yaw.value,
      pitch: pitch.value,
      roll: roll.value,
      firePrimary,
      fireSecondary,
      boost,
    },
  };
}

function validateJoin(msg: Record<string, unknown>): DecodeResult<ClientMessage> {
  const roomId = msg.roomId;
  const name = msg.name;
  const platform = msg.platform;
  if (!isNonEmptyString(roomId)) return err('JOIN.roomId must be a non-empty string');
  if (!isNonEmptyString(name)) return err('JOIN.name must be a non-empty string');
  if (typeof platform !== 'string' || !PLATFORM_MODES.includes(platform as PlatformMode)) {
    return err('JOIN.platform is invalid');
  }
  return { ok: true, value: { t: 'JOIN', roomId, name, platform: platform as PlatformMode } };
}

function validateInputBatch(msg: Record<string, unknown>): DecodeResult<ClientMessage> {
  const cmds = msg.cmds;
  if (!Array.isArray(cmds)) return err('INPUT_BATCH.cmds must be an array');
  if (cmds.length > MAX_INPUT_BATCH_CMDS) return err('INPUT_BATCH.cmds exceeds maximum');

  const validated: ShipCommand[] = [];
  for (const cmd of cmds) {
    const result = validateShipCommand(cmd);
    if (!result.ok) return result;
    validated.push(result.value);
  }
  return { ok: true, value: { t: 'INPUT_BATCH', cmds: validated } };
}

function validatePing(msg: Record<string, unknown>): DecodeResult<ClientMessage> {
  const clientTime = msg.clientTime;
  if (!isFiniteNumber(clientTime)) return err('PING.clientTime must be a finite number');
  return { ok: true, value: { t: 'PING', clientTime } };
}

function validateClientMessage(decoded: unknown): DecodeResult<ClientMessage> {
  if (!isRecord(decoded)) return err('message must be an object');
  const t = decoded.t;
  if (typeof t !== 'string' || !CLIENT_MESSAGE_TYPE_SET.has(t as ClientMessageType)) {
    return err('unknown message type');
  }

  switch (t as ClientMessageType) {
    case 'JOIN':
      return validateJoin(decoded);
    case 'INPUT_BATCH':
      return validateInputBatch(decoded);
    case 'PING':
      return validatePing(decoded);
    case 'RESPAWN_REQUEST':
      return { ok: true, value: { t: 'RESPAWN_REQUEST' } };
    case 'QUIT':
      return { ok: true, value: { t: 'QUIT' } };
  }
}

export function decodeClientMessage(bytes: Uint8Array): DecodeResult<ClientMessage> {
  try {
    if (!(bytes instanceof Uint8Array)) return err('payload must be bytes');
    if (bytes.byteLength > MAX_CLIENT_MESSAGE_BYTES) return err('payload exceeds maximum size');

    const decoded = decode(bytes);
    return validateClientMessage(decoded);
  } catch {
    return err('malformed payload');
  }
}

export function encodeServerMessage(msg: ServerMessage): Uint8Array {
  return encode(msg);
}
