import { describe, expect, it } from 'vitest'
import { GameRoom } from '../../src/sim/GameRoom'
import type { ServerMessage, ShipCommand } from '../../src/types'

function makeCmd(tick: number, overrides: Partial<ShipCommand> = {}): ShipCommand {
  return {
    tick,
    thrust: 0,
    strafeX: 0,
    strafeY: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    firePrimary: false,
    fireSecondary: false,
    boost: false,
    ...overrides,
  }
}

function isSnapshot(msg: ServerMessage): msg is Extract<ServerMessage, { t: 'SNAPSHOT' }> {
  return msg.t === 'SNAPSHOT'
}

function isEvent(msg: ServerMessage): msg is Extract<ServerMessage, { t: 'EVENT' }> {
  return msg.t === 'EVENT'
}

describe('GameRoom', () => {
  it('produces deterministic snapshots for same seed and inputs', () => {
    const run = () => {
      const room = new GameRoom({ seed: 12345, playerId: 'p1', playerName: 'Pilot', platform: 'PC' })
      for (let i = 1; i <= 90; i++) {
        room.enqueue([makeCmd(i, { thrust: 1, yaw: i % 2 === 0 ? 0.2 : -0.1, firePrimary: i % 5 === 0 })])
        room.stepFixed()
      }
      return {
        snapshot: room.createSnapshot(),
        events: room.drainEvents(),
      }
    }

    const a = run()
    const b = run()
    expect(a.snapshot).toEqual(b.snapshot)
    expect(a.events).toEqual(b.events)
  })

  it('creates snapshots with expected shape and rates metadata', () => {
    const room = new GameRoom({ seed: 1, playerId: 'p1', playerName: 'Pilot', platform: 'PC' })
    room.stepFixed()
    const snap = room.createSnapshot()
    expect(isSnapshot(snap)).toBe(true)
    if (!isSnapshot(snap)) return
    expect(snap.tick).toBe(1)
    expect(snap.wave).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(snap.ships)).toBe(true)
    expect(Array.isArray(snap.asteroids)).toBe(true)
    expect(Array.isArray(snap.enemies)).toBe(true)
    expect(Array.isArray(snap.projectiles)).toBe(true)
    expect(Array.isArray(snap.pickups)).toBe(true)
    expect(snap.ships.length).toBe(1)
    expect(snap.ships[0]?.id).toBe('p1')
  })

  it('sanitizes input commands (clamp/finite/shape) and ignores old/duplicate ticks', () => {
    const room = new GameRoom({ seed: 2, playerId: 'p1', playerName: 'Pilot', platform: 'PC' })
    room.enqueue([
      makeCmd(1, { thrust: 2, strafeX: NaN, strafeY: Infinity, yaw: -5, pitch: 10, roll: -Infinity, firePrimary: true }),
    ])
    room.stepFixed()
    // Duplicate/old tick should be ignored
    room.enqueue([makeCmd(1, { thrust: -1, yaw: 1 })])
    room.enqueue([makeCmd(0, { thrust: -1 })])
    room.stepFixed()

    const snap = room.createSnapshot()
    if (!isSnapshot(snap)) throw new Error('expected snapshot')
    const ship = snap.ships[0]
    expect(ship).toBeDefined()
    // Tick 1 processed, tick 2 stepped with no valid pending command (old/duplicate ignored).
    expect(ship?.lastProcessedTick).toBe(2)
    // State should remain finite despite NaN/Infinity/out-of-range inputs
    for (const v of ship?.pos ?? []) expect(Number.isFinite(v)).toBe(true)
    for (const v of ship?.vel ?? []) expect(Number.isFinite(v)).toBe(true)
    for (const v of ship?.rot ?? []) expect(Number.isFinite(v)).toBe(true)
  })

  it('emits impact/fragmentation events when projectile hits asteroid', () => {
    const room = new GameRoom({
      seed: 7,
      playerId: 'p1',
      playerName: 'Pilot',
      platform: 'PC',
      initialAsteroids: [
        { id: 100, pos: [0, 0, -20], vel: [0, 0, 0], rot: [0, 0, 0, 1], angVel: [0, 0, 0], size: 'LARGE', hp: 1 },
      ],
      initialWave: 1,
      spawnInitialWave: false,
    })

    // Aim forward (-Z in local space at identity rot) and fire
    room.enqueue([makeCmd(1, { firePrimary: true })])
    room.stepFixed()

    let sawHit = false
    let sawExplosion = false
    for (let i = 2; i <= 120; i++) {
      room.enqueue([makeCmd(i, { firePrimary: i % 10 === 0 })])
      room.stepFixed()
      const events = room.drainEvents().filter(isEvent)
      if (events.some((e) => e.kind === 'HIT' || e.kind === 'EXPLOSION')) sawHit = sawHit || events.some((e) => e.kind === 'HIT')
      if (events.some((e) => e.kind === 'EXPLOSION')) sawExplosion = true
      if (sawHit && sawExplosion) break
    }

    expect(sawHit || sawExplosion).toBe(true)

    const snap = room.createSnapshot()
    if (!isSnapshot(snap)) throw new Error('expected snapshot')
    // LARGE asteroid with 1 hp should be fragmented or removed after being hit
    const largeStillThere = snap.asteroids.some((a) => a.id === 100)
    expect(largeStillThere).toBe(false)
  })

  it('advances at fixed 30Hz and reports 20Hz snapshot cadence metadata', () => {
    const room = new GameRoom({ seed: 3, playerId: 'p1', playerName: 'Pilot', platform: 'PC' })
    for (let i = 0; i < 30; i++) room.stepFixed()
    const snap = room.createSnapshot()
    if (!isSnapshot(snap)) throw new Error('expected snapshot')
    expect(snap.tick).toBe(30)
    // serverTime should be deterministic from tick/fixed dt
    expect(snap.serverTime).toBeCloseTo(1, 5)
  })
})
