// Constantes físicas calibradas do spec (seção 4.1). Fonte única de valores.
// Sem lógica: apenas dados imutáveis (`as const`).

export const WORLD_CONFIG = {
  ARENA_RADIUS: 500,
  SOFT_BOUNDARY_START: 450,
  HARD_BOUNDARY_LIMIT: 515,
  BOUNDARY_SPRING_K: 140,
  BOUNDARY_RADIAL_DAMPING: 3.0,
  FIXED_TICK_RATE: 30,
  NETWORK_BROADCAST_RATE: 20,
  INTERPOLATION_DELAY_MS: 100,
  MAX_PLAYERS_PER_ROOM: 8,
  RESPAWN_DELAY_SEC: 3.0,
  SPAWN_INVULN_SEC: 3.0,
} as const;

export const SHIP_CONFIG = {
  RADIUS: 2.2,
  MAX_SPEED: 65,
  BOOST_MULTIPLIER: 1.75,
  LINEAR_DRAG: 1.8,
  THRUST_ACCEL: 117,
  STRAFE_ACCEL: 75,
  ANGULAR_DRAG: 8.5,
  TURN_ACCEL_YAW: 15.3,
  TURN_ACCEL_PITCH: 12.75,
  TURN_ACCEL_ROLL: 18.7,
  PRIMARY_COOLDOWN: 0.15,
  SECONDARY_COOLDOWN: 2.5,
  MAX_SHIELD: 100,
  MAX_ENERGY: 100,
  ENERGY_REGEN_RATE: 20,
  BOOST_DRAIN_RATE: 35,
  MISSILE_ENERGY_COST: 30,
} as const;

export const ASTEROID_TIERS = {
  LARGE: { radius: 14, hp: 60, speed: 12, score: 100, children: 3, nextTier: 'MEDIUM' },
  MEDIUM: { radius: 7, hp: 30, speed: 20, score: 250, children: 2, nextTier: 'SMALL' },
  SMALL: { radius: 3, hp: 10, speed: 30, score: 500, children: 0, nextTier: null },
} as const;
