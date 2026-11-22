// Contratos de dados e protocolo do spec (seção 4.3). Apenas tipos; sem lógica.

export type PlatformMode = 'PC' | 'ANDROID_FLAT' | 'VR_BOX' | 'QUEST_3';
export type AsteroidSize = 'LARGE' | 'MEDIUM' | 'SMALL';
export type EnemyArchetype = 'SCOUT' | 'BRUISER' | 'SCAVENGER';

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
}

export interface PickupState {
  id: number;
  kind: 'SHIELD_CRYSTAL' | 'ENERGY_CRYSTAL';
  pos: [number, number, number];
  ttl: number;
}

export type ClientMessage =
  | { t: 'JOIN'; roomId: string; name: string; platform: PlatformMode }
  | { t: 'INPUT_BATCH'; cmds: ShipCommand[] }
  | { t: 'PING'; clientTime: number };

export type ServerMessage =
  | { t: 'WELCOME'; playerId: string; roomId: string; serverTick: number; serverTime: number }
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
    }
  | {
      t: 'EVENT';
      kind: 'EXPLOSION' | 'HIT' | 'PLAYER_DEATH' | 'PICKUP' | 'WAVE_CLEAR';
      pos: [number, number, number];
      scale: number;
    };
