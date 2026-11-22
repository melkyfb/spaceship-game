import { describe, expect, it } from 'vitest'
import { WAVE_SPAWN_COSTS, WAVE_SPAWN_CONFIG } from '../../src/constants'
import {
  computeWaveBudget,
  WaveManager,
  type SpawnPlan,
  type SpawnPlanEntry,
} from '../../src/sim/WaveManager'
import type { ShipState } from '../../src/types'

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

function makeRng(seed: number): () => number {
  // Simple deterministic LCG for tests; returns [0,1).
  let s = seed >>> 0
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    return s / 0x1_0000_0000
  }
}

function dist(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.hypot(dx, dy, dz)
}

function entryCost(entry: SpawnPlanEntry): number {
  if (entry.kind === 'ASTEROID_LARGE') return WAVE_SPAWN_COSTS.LARGE
  if (entry.kind === 'SCOUT') return WAVE_SPAWN_COSTS.SCOUT
  if (entry.kind === 'SCAVENGER') return WAVE_SPAWN_COSTS.SCAVENGER
  return WAVE_SPAWN_COSTS.BRUISER
}

describe('computeWaveBudget', () => {
  it('matches the spec formula 10 + 4*wave + 2*playerCount', () => {
    expect(computeWaveBudget(1, 1)).toBe(16)
    expect(computeWaveBudget(2, 1)).toBe(20)
    expect(computeWaveBudget(1, 4)).toBe(22)
    expect(computeWaveBudget(5, 2)).toBe(34)
  })
})

describe('WAVE_SPAWN_COSTS', () => {
  it('defines the spec costs', () => {
    expect(WAVE_SPAWN_COSTS.LARGE).toBe(3)
    expect(WAVE_SPAWN_COSTS.SCOUT).toBe(3)
    expect(WAVE_SPAWN_COSTS.SCAVENGER).toBe(2)
    expect(WAVE_SPAWN_COSTS.BRUISER).toBe(6)
  })
})

describe('WaveManager.planWave', () => {
  it('returns a plan within budget with valid spawn positions', () => {
    const wm = new WaveManager()
    const players = [makeShip({ pos: [0, 0, 0], alive: true })]
    const plan: SpawnPlan = wm.planWave(1, 1, players, makeRng(123))

    expect(plan.wave).toBe(1)
    expect(plan.budget).toBe(16)
    expect(plan.spent).toBeGreaterThan(0)
    expect(plan.spent).toBeLessThanOrEqual(plan.budget)
    expect(plan.entries.length).toBeGreaterThan(0)

    const totalCost = plan.entries.reduce((sum, e) => sum + entryCost(e), 0)
    expect(totalCost).toBe(plan.spent)

    for (const entry of plan.entries) {
      const r = Math.hypot(entry.pos[0], entry.pos[1], entry.pos[2])
      expect(r).toBeGreaterThanOrEqual(WAVE_SPAWN_CONFIG.MIN_R - 1e-6)
      expect(r).toBeLessThanOrEqual(WAVE_SPAWN_CONFIG.MAX_R + 1e-6)
      for (const p of players) {
        if (!p.alive) continue
        expect(dist(entry.pos, p.pos)).toBeGreaterThanOrEqual(WAVE_SPAWN_CONFIG.MIN_PLAYER_DIST - 1e-6)
      }
      for (const v of entry.pos) expect(Number.isFinite(v)).toBe(true)
    }
  })

  it('is deterministic for the same inputs and rng seed', () => {
    const players = [makeShip({ pos: [10, -20, 30], alive: true })]
    const a = new WaveManager().planWave(3, 2, players, makeRng(999))
    const b = new WaveManager().planWave(3, 2, players, makeRng(999))
    expect(a).toEqual(b)
  })

  it('keeps spawns >= 120u from any alive player', () => {
    const players = [
      makeShip({ id: 'p1', pos: [300, 0, 0], alive: true }),
      makeShip({ id: 'p2', pos: [-300, 0, 0], alive: true }),
    ]
    const plan = new WaveManager().planWave(4, 2, players, makeRng(7))
    for (const entry of plan.entries) {
      for (const p of players) {
        expect(dist(entry.pos, p.pos)).toBeGreaterThanOrEqual(120 - 1e-6)
      }
    }
  })
})

describe('WaveManager wave lifecycle', () => {
  it('tracks enemy kills and wave clear state', () => {
    const wm = new WaveManager()
    const players = [makeShip({ pos: [0, 0, 0], alive: true })]
    const plan = wm.planWave(1, 1, players, makeRng(42))

    const enemyCount = plan.entries.filter((e) => e.kind !== 'ASTEROID_LARGE').length
    // Wave clear depends on enemies; if plan has no enemies this still must be coherent.
    if (enemyCount === 0) {
      expect(wm.isWaveClear()).toBe(true)
      return
    }

    expect(wm.isWaveClear()).toBe(false)
    for (let i = 0; i < enemyCount; i++) {
      wm.onEnemyKilled()
    }
    expect(wm.isWaveClear()).toBe(true)
  })

  it('advance moves to next wave number', () => {
    const wm = new WaveManager()
    const players = [makeShip()]
    wm.planWave(1, 1, players, makeRng(1))
    const next = wm.advance()
    expect(next).toBe(2)
    expect(wm.currentWave).toBe(2)
  })
})
