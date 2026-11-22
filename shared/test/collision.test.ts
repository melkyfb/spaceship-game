import { describe, expect, it } from 'vitest'
import {
  CollisionEventBuffer,
  resolveProjectileAsteroidCollisions,
  resolveShipAsteroidCollisions,
} from '../src/collision'
import { ASTEROID_TIERS, SHIP_CONFIG } from '../src/constants'
import { FIXED_DT } from '../src/physics'
import type { AsteroidState, AsteroidSize, ProjectileState, ShipState } from '../src/types'

function makeAsteroid(id: number, size: AsteroidSize, pos: [number, number, number]): AsteroidState {
  return {
    id,
    pos: [...pos],
    vel: [0, 0, 0],
    rot: [0, 0, 0, 1],
    angVel: [0, 0, 0],
    size,
    hp: ASTEROID_TIERS[size].hp,
  }
}

function makeShip(id: string, pos: [number, number, number], vel: [number, number, number]): ShipState {
  return {
    id,
    name: id,
    platform: 'PC',
    pos: [...pos],
    vel: [...vel],
    rot: [0, 0, 0, 1],
    angVel: [0, 0, 0],
    shield: 100,
    energy: 100,
    score: 0,
    alive: true,
    invulnTimer: 0,
    lastProcessedTick: 0,
  }
}

function makeLaser(id: number, prevPos: [number, number, number], pos: [number, number, number]): ProjectileState {
  return {
    id,
    ownerId: 'p1',
    kind: 'LASER',
    prevPos: [...prevPos],
    pos: [...pos],
    vel: [240, 0, 0],
    ttl: 1,
  }
}

describe('resolveProjectileAsteroidCollisions (swept segment-to-sphere)', () => {
  it('projectile at 240u/s hits SMALL asteroid (r=3) — both endpoints outside', () => {
    // dt = 1/30 => 8u displacement; a discrete point test at either end misses.
    const projectile = makeLaser(42, [-4, 0, 0], [4, 0, 0])
    const asteroid = makeAsteroid(7, 'SMALL', [0, 0, 0])
    const events = new CollisionEventBuffer()

    resolveProjectileAsteroidCollisions([projectile], [asteroid], events)

    expect(events.count).toBe(1)
    const e = events.get(0)
    if (!e) throw new Error('missing event')
    expect(e.kind).toBe('PROJECTILE_ASTEROID')
    expect(e.aId).toBe(projectile.id)
    expect(e.bId).toBe(asteroid.id)
    expect(e.t).toBeGreaterThanOrEqual(0)
    expect(e.t).toBeLessThanOrEqual(1)
    expect(Math.hypot(e.x, e.y, e.z)).toBeLessThan(ASTEROID_TIERS.SMALL.radius + 1)
  })

  it('does not emit when the swept segment misses the asteroid', () => {
    const projectile = makeLaser(1, [-4, 10, 0], [4, 10, 0])
    const asteroid = makeAsteroid(2, 'SMALL', [0, 0, 0])
    const events = new CollisionEventBuffer()

    resolveProjectileAsteroidCollisions([projectile], [asteroid], events)
    expect(events.count).toBe(0)
  })

  it('spatial hash culls asteroids far from the swept segment', () => {
    const projectile = makeLaser(1, [-4, 0, 0], [4, 0, 0])
    const near = makeAsteroid(2, 'SMALL', [0, 0, 0])
    const far = makeAsteroid(3, 'LARGE', [200, 0, 0])
    const events = new CollisionEventBuffer()

    resolveProjectileAsteroidCollisions([projectile], [far, near], events)

    expect(events.count).toBe(1)
    expect(events.get(0)?.bId).toBe(near.id)
  })

  it('ignores consumed projectiles (ttl <= 0)', () => {
    const projectile = makeLaser(1, [-4, 0, 0], [4, 0, 0])
    projectile.ttl = 0
    const asteroid = makeAsteroid(2, 'SMALL', [0, 0, 0])
    const events = new CollisionEventBuffer()

    resolveProjectileAsteroidCollisions([projectile], [asteroid], events)
    expect(events.count).toBe(0)
  })
})

describe('resolveShipAsteroidCollisions (swept sphere-to-sphere)', () => {
  it('boosting ship does not tunnel through asteroid at 113.75 u/s', () => {
    // ship R 2.2 + SMALL R 3 = 5.2; endpoints at x = +/-1.895, y = -5
    // => endpoint distance 5.349 > 5.2, but the path crosses the sphere.
    const speed = SHIP_CONFIG.MAX_SPEED * SHIP_CONFIG.BOOST_MULTIPLIER
    const half = (speed * FIXED_DT) / 2
    const ship = makeShip('boost', [-half, -5, 0], [speed, 0, 0])
    const asteroid = makeAsteroid(9, 'SMALL', [0, 0, 0])
    const events = new CollisionEventBuffer()

    resolveShipAsteroidCollisions([ship], [asteroid], events)

    expect(Math.hypot(ship.pos[0], ship.pos[1], ship.pos[2])).toBeGreaterThan(
      SHIP_CONFIG.RADIUS + ASTEROID_TIERS.SMALL.radius,
    )
    expect(events.count).toBe(1)
    const e = events.get(0)
    if (!e) throw new Error('missing event')
    expect(e.kind).toBe('SHIP_ASTEROID')
    expect(e.aId).toBe(ship.id)
    expect(e.bId).toBe(asteroid.id)
    expect(e.t).toBeGreaterThanOrEqual(0)
    expect(e.t).toBeLessThanOrEqual(1)
    // damage = max(5, 0.45 * vrel) = 0.45 * 113.75
    expect(e.damage).toBeCloseTo(0.45 * speed, 6)
    expect(ship.shield).toBeCloseTo(100 - 0.45 * speed, 6)
  })

  it('applies partial elastic bounce e=0.6 with mass proportional to R^3', () => {
    const mShip = SHIP_CONFIG.RADIUS ** 3
    const mAst = ASTEROID_TIERS.SMALL.radius ** 3
    const ship = makeShip('ram', [-6, 0, 0], [100, 0, 0])
    const asteroid = makeAsteroid(3, 'SMALL', [0, 0, 0])
    const events = new CollisionEventBuffer()

    resolveShipAsteroidCollisions([ship], [asteroid], events)

    expect(events.count).toBe(1)
    // Impulse conserves momentum; relative speed after = e * relative speed before.
    const pBefore = mShip * 100
    const pAfter = mShip * ship.vel[0] + mAst * asteroid.vel[0]
    expect(pAfter).toBeCloseTo(pBefore, 5)
    const relAfter = ship.vel[0] - asteroid.vel[0]
    expect(relAfter).toBeCloseTo(-0.6 * 100, 5)
    expect(ship.vel[0]).toBeLessThan(0)
    expect(asteroid.vel[0]).toBeGreaterThan(0)
  })

  it('damage has a floor of 5 even at low relative speed', () => {
    const ship = makeShip('slow', [-5, 0, 0], [2, 0, 0]) // already overlapping => hit at t = 0
    const asteroid = makeAsteroid(4, 'SMALL', [0, 0, 0])
    const events = new CollisionEventBuffer()

    resolveShipAsteroidCollisions([ship], [asteroid], events)

    expect(events.count).toBe(1)
    expect(events.get(0)?.damage).toBe(5)
    expect(ship.shield).toBe(95)
  })

  it('resolves multi-asteroid overlap deterministically by earliest impact', () => {
    const speed = 240 // 8u per FIXED_DT
    const ship = makeShip('s', [-10, 0, 0], [speed, 0, 0])
    const near = makeAsteroid(1, 'SMALL', [-6, 0, 0]) // deepest penetration at t=0.5
    const far = makeAsteroid(2, 'SMALL', [0, 0, 0])   // on same path
    const events = new CollisionEventBuffer()

    resolveShipAsteroidCollisions([ship], [near, far], events)

    expect(events.count).toBeGreaterThanOrEqual(1)
    for (let i = 0; i < events.count; i++) {
      const e = events.get(i)
      if (!e) throw new Error('missing event')
      expect(e.kind).toBe('SHIP_ASTEROID')
      expect(e.t).toBeGreaterThanOrEqual(0)
      expect(e.t).toBeLessThanOrEqual(1)
      expect(Number.isFinite(e.damage)).toBe(true)
      expect(Number.isFinite(e.x)).toBe(true)
    }
    // Earliest hit in the path should be the nearer asteroid.
    expect(events.get(0)?.bId).toBe(near.id)
    if (events.count > 1) {
      expect((events.get(0)?.t ?? 1)).toBeLessThanOrEqual(events.get(1)?.t ?? 0)
    }
    expect(ship.shield).toBeLessThan(100)
    expect(ship.shield).toBeGreaterThanOrEqual(0)
    expect(ship.vel.every(Number.isFinite)).toBe(true)

    // Deterministic: same setup produces same result.
    const ship2 = makeShip('s', [-10, 0, 0], [speed, 0, 0])
    const near2 = makeAsteroid(1, 'SMALL', [-6, 0, 0])
    const far2 = makeAsteroid(2, 'SMALL', [0, 0, 0])
    const events2 = new CollisionEventBuffer()
    resolveShipAsteroidCollisions([ship2], [near2, far2], events2)
    expect(events2.count).toBe(events.count)
    expect(ship2.shield).toBe(ship.shield)
    expect(ship2.vel).toEqual(ship.vel)
  })
})

describe('CollisionEventBuffer (zero-alloc event storage)', () => {
  it('reuses the same preallocated event objects across calls', () => {
    const projectile = makeLaser(1, [-4, 0, 0], [4, 0, 0])
    const asteroid = makeAsteroid(2, 'SMALL', [0, 0, 0])
    const events = new CollisionEventBuffer()

    resolveProjectileAsteroidCollisions([projectile], [asteroid], events)
    const first = events.get(0)
    events.reset()
    resolveProjectileAsteroidCollisions([projectile], [asteroid], events)

    expect(events.get(0)).toBe(first)
    expect(events.count).toBe(1)
  })

  it('reset clears the counter and overflow is dropped without allocating', () => {
    const events = new CollisionEventBuffer(1)
    const a = makeLaser(1, [-4, 0, 0], [4, 0, 0])
    const b = makeLaser(2, [-4, 0, 0], [4, 0, 0])
    const asteroid = makeAsteroid(3, 'SMALL', [0, 0, 0])

    resolveProjectileAsteroidCollisions([a, b], [asteroid], events)
    expect(events.count).toBe(1)

    events.reset()
    expect(events.count).toBe(0)
    expect(events.get(0)).toBeUndefined()
  })

  it('appends events from both resolvers when the caller does not reset', () => {
    const ship = makeShip('s', [-5, 0, 0], [2, 0, 0])
    const projectile = makeLaser(1, [-4, 0, 0], [4, 0, 0])
    const asteroid = makeAsteroid(3, 'SMALL', [0, 0, 0])
    const events = new CollisionEventBuffer()

    resolveProjectileAsteroidCollisions([projectile], [asteroid], events)
    resolveShipAsteroidCollisions([ship], [asteroid], events)

    expect(events.count).toBe(2)
    expect(events.get(0)?.kind).toBe('PROJECTILE_ASTEROID')
    expect(events.get(1)?.kind).toBe('SHIP_ASTEROID')
  })
})

describe('non-finite state safety', () => {
  it('ignores projectiles with NaN/Infinity coordinates', () => {
    const asteroid = makeAsteroid(1, 'SMALL', [0, 0, 0])
    const events = new CollisionEventBuffer()
    const bad = makeLaser(1, [NaN, 0, 0], [4, 0, 0])
    bad.prevPos = [NaN, 0, 0]
    const bad2 = makeLaser(2, [-4, 0, 0], [Infinity, 0, 0])

    resolveProjectileAsteroidCollisions([bad, bad2], [asteroid], events)
    expect(events.count).toBe(0)
  })

  it('ignores asteroids with NaN/Infinity coordinates in collision resolvers', () => {
    const projectile = makeLaser(1, [-4, 0, 0], [4, 0, 0])
    const badAsteroid = makeAsteroid(2, 'SMALL', [0, 0, 0])
    badAsteroid.pos = [NaN, 0, 0]
    const events = new CollisionEventBuffer()

    resolveProjectileAsteroidCollisions([projectile], [badAsteroid], events)
    expect(events.count).toBe(0)

    const ship = makeShip('s', [-5, 0, 0], [2, 0, 0])
    const shipEvents = new CollisionEventBuffer()
    resolveShipAsteroidCollisions([ship], [badAsteroid], shipEvents)
    expect(shipEvents.count).toBe(0)
    expect(ship.shield).toBe(100)
  })

  it('ignores ships with NaN/Infinity state without poisoning events', () => {
    const asteroid = makeAsteroid(1, 'SMALL', [0, 0, 0])
    const ship = makeShip('s', [NaN, 0, 0], [100, 0, 0])
    ship.pos = [NaN, 0, 0]
    const ship2 = makeShip('s2', [-5, 0, 0], [Infinity, 0, 0])
    ship2.vel = [Infinity, 0, 0]
    const events = new CollisionEventBuffer()

    resolveShipAsteroidCollisions([ship, ship2], [asteroid], events)
    expect(events.count).toBe(0)
    expect(ship.shield).toBe(100)
    expect(ship2.shield).toBe(100)
  })
})
