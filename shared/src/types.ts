// Contratos de dados e protocolo do spec (seção 4.3). Apenas tipos; sem lógica.

export type PlatformMode = 'PC' | 'ANDROID_FLAT' | 'VR_BOX' | 'QUEST_3';
export type AsteroidSize = 'LARGE' | 'MEDIUM' | 'SMALL';
export type EnemyArchetype = 'SCOUT' | 'BRUISER' | 'SCAVENGER';
export type KillerKind = 'ENEMY' | 'PLAYER' | 'ASTEROID' | 'UNKNOWN';

export interface ShipCommand {
  tick: number;
  thrust: number;
  strafeX: number;
  strafeY: number;
  yaw: number;
  pitch: number;
  roll: number;
  firePrimary: boolean;
  fireSecondary: boolean;
  boost: boolean;
}

export interface ShipState {
  id: string;
  name: string;
  platform: PlatformMode;
  pos: [number, number, number];
  vel: [number, number, number];
  rot: [number, number, number, number];
  angVel: [number, number, number];
  shield: number;
  energy: number;
  score: number;
  alive: boolean;
  invulnTimer: number;
  lastProcessedTick: number;
}

export interface AsteroidState {
  id: number;
  pos: [number, number, number];
  vel: [number, number, number];
  rot: [number, number, number, number];
  angVel: [number, number, number];
  size: AsteroidSize;
  hp: number;
}

export interface EnemyState {
  id: number;
  archetype: EnemyArchetype;
  pos: [number, number, number];
  vel: [number, number, number];
  rot: [number, number, number, number];
  hp: number;
}

export interface ProjectileState {
  id: number;
  ownerId: string;
  kind: 'LASER' | 'MISSILE' | 'ENEMY_PLASMA';
  pos: [number, number, number];
  prevPos: [number, number, number];
  vel: [number, number, number];
  ttl: number;
  /** Runtime HP for destructible projectiles (e.g. BRUISER homing missile). */
  hp?: number;
  /** Ship/entity id to home toward. Used by homing missiles. */
  homingTargetId?: string;
}

export interface PickupState {
  id: number;
  kind: 'SHIELD_CRYSTAL' | 'ENERGY_CRYSTAL';
  pos: [number, number, number];
  ttl: number;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  score: number;
}

export const CLIENT_MESSAGE_TYPES = [
  'JOIN',
  'INPUT_BATCH',
  'PING',
  'RESPAWN_REQUEST',
  'QUIT',
] as const;

export type ClientMessageType = (typeof CLIENT_MESSAGE_TYPES)[number];

export function isClientMessageType(value: unknown): value is ClientMessageType {
  return typeof value === 'string' && (CLIENT_MESSAGE_TYPES as readonly string[]).includes(value);
}

export type ClientMessage =
  | { t: 'JOIN'; roomId: string; name: string; platform: PlatformMode }
  | { t: 'INPUT_BATCH'; cmds: ShipCommand[] }
  | { t: 'PING'; clientTime: number }
  | { t: 'RESPAWN_REQUEST' }
  | { t: 'QUIT' };

type EventBase = {
  t: 'EVENT';
  pos: [number, number, number];
  scale: number;
};

export type PlayerDeathEvent = EventBase & {
  kind: 'PLAYER_DEATH';
  playerId?: string;
  killerId?: string | number;
  killerKind?: KillerKind;
  respawnDelaySec?: number;
};

export type ScoreRecordedEvent = EventBase & {
  kind: 'SCORE_RECORDED';
  playerId: string;
  name: string;
  score: number;
  wave: number;
  rank?: number;
};

export type GenericEvent = EventBase & {
  kind: 'EXPLOSION' | 'HIT' | 'PICKUP' | 'WAVE_CLEAR';
};

export type GameEvent = GenericEvent | PlayerDeathEvent | ScoreRecordedEvent;

export type ServerMessage =
  | {
      t: 'WELCOME';
      playerId: string;
      roomId: string;
      serverTick: number;
      serverTime: number;
      playerToken?: string;
      protocol?: number;
    }
  | { t: 'PONG'; clientTime: number; serverTime: number }
  | {
      t: 'SNAPSHOT';
      tick: number;
      serverTime: number;
      ships: ShipState[];
      asteroids: AsteroidState[];
      enemies: EnemyState[];
      projectiles: ProjectileState[];
      pickups: PickupState[];
      wave: number;
      /** @deprecated M5: sem game over; mantido para compatibilidade temporária. */
      gameOver?: boolean;
    }
  | GameEvent
  | {
      t: 'LEADERBOARD';
      scope: 'GLOBAL' | 'LOCAL';
      entries: LeaderboardEntry[];
      current?: LeaderboardEntry;
    };

export const SERVER_MESSAGE_TYPES = [
  'WELCOME',
  'PONG',
  'SNAPSHOT',
  'EVENT',
  'LEADERBOARD',
] as const;

export type ServerMessageType = (typeof SERVER_MESSAGE_TYPES)[number];

export function isServerMessageType(value: unknown): value is ServerMessageType {
  return typeof value === 'string' && (SERVER_MESSAGE_TYPES as readonly string[]).includes(value);
}
