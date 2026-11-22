import { describe, expect, it } from 'vitest'
import { ENEMY_ARCHETYPES } from '../../src/constants'
import {
  createEnemyIntent,
  createScavengerDeathDrops,
  stepEnemyAI,
  type EnemyIntent,
} from '../../src/sim/EnemyAI'
import type { AsteroidState, EnemyState, PickupState, ShipState } from '../../src/types'

function makeShip(overrides: Partial<ShipState> = {}): ShipState {
  return {
    id: 'p1',
    name: 'P1',
    platform: 'PC',
    pos: [0, 0, 0],
    vel: [0, 0, 0],
    rot: [0, 0, 0, 1],
    angVel: [0, 0, 0],
    shield: 100,
    energy: 100,
    score: 0,
    alive: true,
    invulnTimer: 0,
    lastProcessedTick: 0,
    ...overrides,
  }
}

function makeEnemy(overrides: Partial<EnemyState> = {}): EnemyState {
  return {
    id: 1,
    archetype: 'SCOUT',
    pos: [0, 0, 0],
    vel: [0, 0, 0],
    rot: [0, 0, 0, 1],
    hp: 35,
    ...overrides,
  }
}

function makeAsteroid(overrides: Partial<AsteroidState> = {}): AsteroidState {
  return {
    id: 100,
    pos: [0, 0, 0],
    vel: [0, 0, 0],
    rot: [0, 0, 0, 1],
    angVel: [0, 0, 0],
    size: 'LARGE',
    hp: 60,
    ...overrides,
  }
}

function makePickup(overrides: Partial<PickupState> = {}): PickupState {
  return {
    id: 200,
    kind: 'SHIELD_CRYSTAL',
    pos: [0, 0, 0],
    ttl: 30,
    ...overrides,
  }
}

function len(x: number, y: number, z: number): number {
  return Math.hypot(x, y, z)
}

function norm(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z)
  if (l <= 1e-9) return [0, 0, 0]
  return [x / l, y / l, z / l]
}

function dot(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  return ax * bx + ay * by + az * bz
}

function runAI(
  enemy: EnemyState,
  players: readonly ShipState[],
  asteroids: readonly AsteroidState[],
  pickups: readonly PickupState[],
  timeSec: number,
): EnemyIntent {
  const out = createEnemyIntent()
  stepEnemyAI(enemy, players, asteroids, pickups, timeSec, out)
  return out
}

describe('ENEMY_ARCHETYPES constants', () => {
  it('defines spec HP and speed values', () => {
    expect(ENEMY_ARCHETYPES.SCOUT.hp).toBe(35)
    expect(ENEMY_ARCHETYPES.SCOUT.speed).toBe(52)
    expect(ENEMY_ARCHETYPES.BRUISER.hp).toBe(180)
    expect(ENEMY_ARCHETYPES.BRUISER.speed).toBe(24)
    expect(ENEMY_ARCHETYPES.SCAVENGER.hp).toBe(60)
    expect(ENEMY_ARCHETYPES.SCAVENGER.speed).toBe(48)
  })
})

describe('EnemyAI - SCOUT', () => {
  it('seeks the nearest player', () => {
    const enemy = makeEnemy({ archetype: 'SCOUT', pos: [0, 0, 0] })
    const far = makeShip({ id: 'far', pos: [300, 0, 0], alive: true })
    const near = makeShip({ id: 'near', pos: [0, 100, 0], alive: true })
    const intent = runAI(enemy, [far, near], [], [], 0)

    // Should move primarily toward near player (+Y)
    expect(intent.moveY).toBeGreaterThan(0)
    expect(Math.abs(intent.moveY)).toBeGreaterThan(Math.abs(intent.moveX))
  })

  it('applies sinusoidal strafe when within 120u of target', () => {
    const enemy = makeEnemy({ archetype: 'SCOUT', pos: [0, 0, 0] })
    const player = makeShip({ id: 'p1', pos: [100, 0, 0], alive: true }) // 100u < 120u

    const a = runAI(enemy, [player], [], [], 0.0)
    const b = runAI(enemy, [player], [], [], 0.5)
    const c = runAI(enemy, [player], [], [], 1.0)

    // Strafe should change over time (sinusoidal component), so lateral movement isn't constant
    const lateralA = Math.hypot(a.moveY, a.moveZ)
    const lateralB = Math.hypot(b.moveY, b.moveZ)
    const lateralC = Math.hypot(c.moveY, c.moveZ)
    const allSame = Math.abs(lateralA - lateralB) < 1e-6 && Math.abs(lateralB - lateralC) < 1e-6
    expect(allSame).toBe(false)
  })

  it('does not require strafe oscillation when target is >= 120u', () => {
    const enemy = makeEnemy({ archetype: 'SCOUT', pos: [0, 0, 0] })
    const player = makeShip({ id: 'p1', pos: [200, 0, 0], alive: true }) // 200u >= 120u

    const a = runAI(enemy, [player], [], [], 0.0)
    const b = runAI(enemy, [player], [], [], 1.25)

    // Direction toward player should remain dominant/stable when far away
    expect(a.moveX).toBeGreaterThan(0)
    expect(b.moveX).toBeGreaterThan(0)
  })
})

describe('EnemyAI - BRUISER', () => {
  it('orbits at ~140u from target (arrive/orbit behavior)', () => {
    // Far away: should move toward player
    const enemyFar = makeEnemy({ archetype: 'BRUISER', hp: 180, pos: [0, 0, 0] })
    const player = makeShip({ id: 'p1', pos: [300, 0, 0], alive: true })
    const farIntent = runAI(enemyFar, [player], [], [], 0)
    expect(farIntent.moveX).toBeGreaterThan(0)

    // Inside orbit radius: should not keep closing aggressively toward player center
    const enemyClose = makeEnemy({ archetype: 'BRUISER', hp: 180, pos: [200, 0, 0] }) // 100u from player
    const closeIntent = runAI(enemyClose, [player], [], [], 0)
    // Should not have strong inward (+X) movement when already inside 140u
    expect(closeIntent.moveX).toBeLessThan(farIntent.moveX)
  })

  it('keeps prow aligned to target', () => {
    const enemy = makeEnemy({ archetype: 'BRUISER', hp: 180, pos: [0, 0, 0] })
    const player = makeShip({ id: 'p1', pos: [0, 200, 0], alive: true })
    const intent = runAI(enemy, [player], [], [], 0)

    const [fx, fy, fz] = norm(intent.faceX, intent.faceY, intent.faceZ)
    const [tx, ty, tz] = norm(0, 200, 0)
    expect(dot(fx, fy, fz, tx, ty, tz)).toBeGreaterThan(0.9)
  })
})

describe('EnemyAI - SCAVENGER', () => {
  it('seeks SMALL asteroids or crystals', () => {
    const enemy = makeEnemy({ archetype: 'SCAVENGER', hp: 60, pos: [0, 0, 0] })
    const large = makeAsteroid({ id: 1, size: 'LARGE', pos: [50, 0, 0] })
    const small = makeAsteroid({ id: 2, size: 'SMALL', pos: [0, 80, 0] })
    const intent = runAI(enemy, [makeShip({ pos: [500, 500, 500], alive: true })], [large, small], [], 0)

    // Should prefer SMALL asteroid at +Y over LARGE at +X
    expect(intent.moveY).toBeGreaterThan(0)
    expect(Math.abs(intent.moveY)).toBeGreaterThan(Math.abs(intent.moveX))
  })

  it('seeks crystals (pickups)', () => {
    const enemy = makeEnemy({ archetype: 'SCAVENGER', hp: 60, pos: [0, 0, 0] })
    const pickup = makePickup({ id: 7, pos: [0, 0, 90], kind: 'ENERGY_CRYSTAL' })
    const intent = runAI(enemy, [makeShip({ pos: [500, 500, 500], alive: true })], [], [pickup], 0)
    expect(intent.moveZ).toBeGreaterThan(0)
  })

  it('flees when player approaches within 55u', () => {
    const enemy = makeEnemy({ archetype: 'SCAVENGER', hp: 60, pos: [0, 0, 0] })
    const player = makeShip({ id: 'p1', pos: [40, 0, 0], alive: true }) // 40u < 55u
    const intent = runAI(enemy, [player], [], [], 0)

    // Player is at +X, so flee should move away (-X)
    expect(intent.moveX).toBeLessThan(0)
  })

  it('does not flee when player is >= 55u away', () => {
    const enemy = makeEnemy({ archetype: 'SCAVENGER', hp: 60, pos: [0, 0, 0] })
    const player = makeShip({ id: 'p1', pos: [60, 0, 0], alive: true }) // 60u >= 55u, boundary safe
    const small = makeAsteroid({ id: 2, size: 'SMALL', pos: [-80, 0, 0] })
    const intent = runAI(enemy, [player], [small], [], 0)

    // Should seek the small asteroid, not flee from player
    expect(intent.moveX).toBeLessThan(0) // toward asteroid at -X
  })

  it('does not attack', () => {
    const enemy = makeEnemy({ archetype: 'SCAVENGER', hp: 60, pos: [0, 0, 0] })
    const player = makeShip({ id: 'p1', pos: [10, 0, 0], alive: true })
    const intent = runAI(enemy, [player], [], [], 0)
    expect(intent.firePrimary).toBe(false)
    expect(intent.fireSecondary).toBe(false)
  })
})

describe('EnemyAI - 5-ray avoidance', () => {
  it('produces deviation when obstacle is directly ahead', () => {
    const enemy = makeEnemy({ archetype: 'SCOUT', pos: [0, 0, 0] })
    const player = makeShip({ id: 'p1', pos: [200, 0, 0], alive: true })
    // Large asteroid directly on the path to player
    const blocker = makeAsteroid({ id: 99, pos: [60, 0, 0], size: 'LARGE' })

    const noBlocker = runAI(enemy, [player], [], [], 0)
    const blocked = runAI(enemy, [player], [blocker], [], 0)

    // Without blocker, movement should be mostly straight +X
    expect(noBlocker.moveX).toBeGreaterThan(0)
    const noBlockerLateral = Math.hypot(noBlocker.moveY, noBlocker.moveZ)
    const blockedLateral = Math.hypot(blocked.moveY, blocked.moveZ)

    // With blocker ahead, should have more lateral deviation
    expect(blockedLateral).toBeGreaterThan(noBlockerLateral + 0.1)
  })
})

describe('EnemyAI - firing', () => {
  it('SCOUT fires primary when target is in front within <15° cone', () => {
    const enemy = makeEnemy({ archetype: 'SCOUT', pos: [0, 0, 0] })
    const player = makeShip({ id: 'p1', pos: [80, 0, 0], alive: true }) // directly ahead
    const intent = runAI(enemy, [player], [], [], 0)
    expect(intent.firePrimary).toBe(true)
  })

  it('BRUISER fires secondary (missile) when it has a target', () => {
    const enemy = makeEnemy({ archetype: 'BRUISER', hp: 180, pos: [0, 0, 0] })
    const player = makeShip({ id: 'p1', pos: [200, 0, 0], alive: true })
    const intent = runAI(enemy, [player], [], [], 0)
    expect(intent.fireSecondary).toBe(true)
  })
})

describe('EnemyAI - SCAVENGER death drops', () => {
  it('drops 2 crystals (Shield + Energy) on death helper', () => {
    const enemy = makeEnemy({ archetype: 'SCAVENGER', hp: 60, pos: [10, 20, 30] })
    let nextId = 500
    const drops = createScavengerDeathDrops(enemy, () => nextId++)
    expect(drops).toHaveLength(2)
    const kinds = drops.map((d) => d.kind).sort()
    expect(kinds).toEqual(['ENERGY_CRYSTAL', 'SHIELD_CRYSTAL'])
    for (const d of drops) {
      expect(d.pos[0]).toBe(10)
      expect(d.pos[1]).toBe(20)
      expect(d.pos[2]).toBe(30)
      expect(d.id).toBeGreaterThanOrEqual(500)
    }
  })
})

describe('EnemyAI - determinism', () => {
  it('produces identical output for identical inputs', () => {
    const enemy = makeEnemy({ archetype: 'SCOUT', pos: [10, 20, 30] })
    const players = [makeShip({ id: 'p1', pos: [100, 0, 0], alive: true })]
    const asteroids = [makeAsteroid({ id: 1, pos: [40, 0, 0], size: 'LARGE' })]
    const pickups = [makePickup({ id: 7, pos: [0, 50, 0] })]

    const a = runAI(enemy, players, asteroids, pickups, 1.234)
    const b = runAI(enemy, players, asteroids, pickups, 1.234)
    expect(a).toEqual(b)
  })
})
