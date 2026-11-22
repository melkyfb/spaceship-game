import { describe, expect, it } from 'vitest'
import { ASTEROID_TIERS } from '../../src/constants'
import { IdSeq } from '../../src/sim/ids'
import { fragmentAsteroid, isSafeSpawn, spawnAsteroidInShell } from '../../src/sim/spawn'
import type { AsteroidState, ShipState } from '../../src/types'

function makeAsteroid(overrides: Partial<AsteroidState> = {}): AsteroidState {
  return {
    id: 1,
    pos: [10, 20, 30],
    vel: [1, -2, 3],
    rot: [0, 0, 0, 1],
    angVel: [0.1, 0.2, 0.3],
    size: 'LARGE',
    hp: ASTEROID_TIERS.LARGE.hp,
    ...overrides,
  }
}

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

describe('IdSeq', () => {
  it('returns monotonically increasing deterministic ids per instance', () => {
    const ids = new IdSeq(100)
    expect(ids.next()).toBe(100)
    expect(ids.next()).toBe(101)
    expect(ids.next()).toBe(102)

    const other = new IdSeq(7)
    expect(other.next()).toBe(7)
    expect(ids.next()).toBe(103)
  })
})

describe('isSafeSpawn', () => {
  it('returns false when within minDist of any alive player', () => {
    const players = [makeShip({ pos: [100, 0, 0], alive: true })]
    expect(isSafeSpawn([200, 0, 0], players, 120)).toBe(false)
    expect(isSafeSpawn([220, 0, 0], players, 120)).toBe(true)
  })

  it('ignores dead players', () => {
    const players = [makeShip({ pos: [100, 0, 0], alive: false })]
    expect(isSafeSpawn([101, 0, 0], players, 120)).toBe(true)
  })

  it('checks distance >= 120u boundary as safe', () => {
    const players = [makeShip({ pos: [0, 0, 0], alive: true })]
    expect(isSafeSpawn([120, 0, 0], players, 120)).toBe(true)
    expect(isSafeSpawn([119.999, 0, 0], players, 120)).toBe(false)
  })
})

describe('fragmentAsteroid', () => {
  it('fragments LARGE into 3 MEDIUM and MEDIUM into 2 SMALL', () => {
    const ids = new IdSeq(100)
    const rng = () => 0.5

    const large = makeAsteroid({ id: 1, size: 'LARGE', hp: ASTEROID_TIERS.LARGE.hp })
    const mediumChildren = fragmentAsteroid(large, ids, rng)
    expect(mediumChildren).toHaveLength(3)
    for (const child of mediumChildren) {
      expect(child.size).toBe('MEDIUM')
      expect(child.hp).toBe(ASTEROID_TIERS.MEDIUM.hp)
    }

    const medium = makeAsteroid({ id: 2, size: 'MEDIUM', hp: ASTEROID_TIERS.MEDIUM.hp })
    const smallChildren = fragmentAsteroid(medium, ids, rng)
    expect(smallChildren).toHaveLength(2)
    for (const child of smallChildren) {
      expect(child.size).toBe('SMALL')
      expect(child.hp).toBe(ASTEROID_TIERS.SMALL.hp)
    }
  })

  it('returns empty array for SMALL asteroids', () => {
    const ids = new IdSeq(1)
    const rng = () => 0.5
    const small = makeAsteroid({ size: 'SMALL', hp: ASTEROID_TIERS.SMALL.hp })
    expect(fragmentAsteroid(small, ids, rng)).toEqual([])
  })

  it('assigns deterministic ids from IdSeq and uses injected rng', () => {
    const idsA = new IdSeq(500)
    const idsB = new IdSeq(500)
    const seqA = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65]
    let iA = 0
    let iB = 0
    const rngA = () => seqA[iA++ % seqA.length]!
    const rngB = () => seqA[iB++ % seqA.length]!
    const parent = makeAsteroid({ id: 10, size: 'LARGE', hp: ASTEROID_TIERS.LARGE.hp, pos: [5, -3, 8], vel: [2, 0, -1] })

    const a = fragmentAsteroid(parent, idsA, rngA)
    const b = fragmentAsteroid(parent, idsB, rngB)
    expect(a).toEqual(b)
    expect(a.map((c) => c.id)).toEqual([500, 501, 502])
  })

  it('produces children near parent with finite pos/vel/rot/angVel', () => {
    const ids = new IdSeq(1)
    const values = [0.0, 0.25, 0.5, 0.75, 1.0]
    let i = 0
    const rng = () => values[i++ % values.length]!
    const parent = makeAsteroid({ pos: [100, 0, -50], vel: [3, 1, -2], size: 'LARGE', hp: ASTEROID_TIERS.LARGE.hp })
    const children = fragmentAsteroid(parent, ids, rng)

    for (const child of children) {
      expect(child.pos).toHaveLength(3)
      expect(child.vel).toHaveLength(3)
      expect(child.rot).toEqual([0, 0, 0, 1])
      expect(child.angVel).toHaveLength(3)
      for (const v of [...child.pos, ...child.vel, ...child.rot, ...child.angVel]) {
        expect(Number.isFinite(v)).toBe(true)
      }
      // Children should stay reasonably close to parent origin.
      const dx = child.pos[0] - parent.pos[0]
      const dy = child.pos[1] - parent.pos[1]
      const dz = child.pos[2] - parent.pos[2]
      expect(Math.hypot(dx, dy, dz)).toBeLessThan(50)
    }
  })
})

describe('spawnAsteroidInShell', () => {
  it('returns a point inside shell radius and safe from alive players', () => {
    const players = [makeShip({ pos: [0, 0, 0], alive: true })]
    const seq = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
    let i = 0
    const rng = () => seq[i++ % seq.length]!

    const pos = spawnAsteroidInShell(rng, 280, 420, players, 120)
    expect(pos).not.toBeNull()
    const [x, y, z] = pos!
    const r = Math.hypot(x, y, z)
    expect(r).toBeGreaterThanOrEqual(280 - 1e-6)
    expect(r).toBeLessThanOrEqual(420 + 1e-6)
    expect(isSafeSpawn(pos!, players, 120)).toBe(true)
  })

  it('returns null when no safe point can be found', () => {
    const players = [makeShip({ pos: [0, 0, 0], alive: true })]
    // minDist larger than entire shell possible distance from origin is impossible to satisfy?
    // Easier: put players everywhere by making minDist absurdly large.
    const pos = spawnAsteroidInShell(() => 0.5, 280, 420, players, 10_000, 8)
    expect(pos).toBeNull()
  })
})
