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

  it('advances at fixed 30Hz and exposes 20Hz snapshot cadence', () => {
    const room = new GameRoom({ seed: 3, playerId: 'p1', playerName: 'Pilot', platform: 'PC' })
    expect(room.snapshotIntervalTicks).toBeCloseTo(1.5, 6)

    const dueTicks: number[] = []
    for (let i = 0; i < 30; i++) {
      room.stepFixed()
      if (room.shouldEmitSnapshot()) {
        const snap = room.createSnapshot()
        if (isSnapshot(snap)) dueTicks.push(snap.tick)
      }
    }

    // 20Hz over 30 fixed steps => 20 snapshots
    expect(dueTicks.length).toBe(20)
    expect(dueTicks[0]).toBe(2) // 1.5 ticks => due on tick 2
    expect(dueTicks[dueTicks.length - 1]).toBe(30)
    const snap = room.createSnapshot()
    if (!isSnapshot(snap)) throw new Error('expected snapshot')
    expect(snap.tick).toBe(30)
    expect(snap.serverTime).toBeCloseTo(1, 5)
  })

  it('keeps ship-asteroid collision tick deterministic and preserves stepShip rotation', () => {
    const run = () => {
      const room = new GameRoom({
        seed: 99,
        playerId: 'p1',
        playerName: 'Pilot',
        platform: 'PC',
        spawnInitialWave: false,
        initialWave: 1,
        initialAsteroids: [
          { id: 500, pos: [0, 0, -10], vel: [0, 0, 0], rot: [0, 0, 0, 1], angVel: [0, 0, 0], size: 'LARGE', hp: 1000 },
        ],
      })
      const before = room.createSnapshot()
      if (!isSnapshot(before)) throw new Error('expected snapshot')
      room.enqueue([makeCmd(1, { thrust: 1, yaw: 0.5 })])
      room.stepFixed()
      const after = room.createSnapshot()
      if (!isSnapshot(after)) throw new Error('expected snapshot')
      return { before, after, events: room.drainEvents().filter(isEvent) }
    }

    const a = run()
    const b = run()
    expect(a.after).toEqual(b.after)
    expect(a.events).toEqual(b.events)

    const shipBefore = a.before.ships[0]!
    const shipAfter = a.after.ships[0]!
    // Rotation/angular integration from stepShip should still advance on collision tick.
    expect(shipAfter.rot).not.toEqual(shipBefore.rot)
    expect(shipAfter.lastProcessedTick).toBe(1)
    expect(a.events.some((e) => e.kind === 'HIT')).toBe(true)
  })

  it('emits PLAYER_DEATH and WAVE_CLEAR events in focused scenarios', () => {
    const deathRoom = new GameRoom({
      seed: 77,
      playerId: 'p1',
      playerName: 'Pilot',
      platform: 'PC',
      spawnInitialWave: false,
      initialWave: 1,
      initialAsteroids: [
        { id: 700, pos: [0, 0, -3], vel: [0, 0, 0], rot: [0, 0, 0, 1], angVel: [0, 0, 0], size: 'LARGE', hp: 10000 },
      ],
    })

    let sawDeath = false
    for (let i = 1; i <= 120; i++) {
      deathRoom.enqueue([makeCmd(i, { thrust: 1 })])
      deathRoom.stepFixed()
      const events = deathRoom.drainEvents().filter(isEvent)
      if (events.some((e) => e.kind === 'PLAYER_DEATH')) {
        sawDeath = true
        break
      }
    }
    expect(sawDeath).toBe(true)

    // WAVE_CLEAR: aim at nearest enemy and fire.
    let sawWaveClear = false
    {
      const room = new GameRoom({ seed: 7, playerId: 'p1', playerName: 'Pilot', platform: 'PC' })
      for (let i = 1; i <= 6000; i++) {
        const snap = room.createSnapshot()
        let yaw = 0
        let pitch = 0
        let thrust = 0
        let firePrimary = true
        if (isSnapshot(snap)) {
          const ship = snap.ships[0]
          const enemy = snap.enemies[0]
          if (ship && enemy) {
            const dx = enemy.pos[0] - ship.pos[0]
            const dy = enemy.pos[1] - ship.pos[1]
            const dz = enemy.pos[2] - ship.pos[2]
            // Ship forward at identity is -Z; compute desired yaw/pitch roughly in world terms.
            // Simple aim: rotate yaw toward target in XZ, pitch toward Y.
            const hx = Math.hypot(dx, dz)
            const desiredYaw = Math.atan2(-dx, -dz) // yaw so forward(-Z rotated) points to target
            // Approximate current yaw from quaternion (yaw around Y)
            const q = ship.rot
            const siny = 2 * (q[3] * q[1] + q[0] * q[2])
            const cosy = 1 - 2 * (q[1] * q[1] + q[0] * q[0])
            const currentYaw = Math.atan2(siny, cosy)
            let dyaw = desiredYaw - currentYaw
            while (dyaw > Math.PI) dyaw -= Math.PI * 2
            while (dyaw < -Math.PI) dyaw += Math.PI * 2
            yaw = Math.max(-1, Math.min(1, dyaw * 2))
            const desiredPitch = Math.atan2(dy, hx)
            // approximate pitch from quat
            const sinp = 2 * (q[3] * q[0] - q[2] * q[1])
            const currentPitch = Math.asin(Math.max(-1, Math.min(1, sinp)))
            let dpitch = desiredPitch - currentPitch
            pitch = Math.max(-1, Math.min(1, dpitch * 2))
            thrust = 0.3
          }
        }
        room.enqueue([makeCmd(i, { yaw, pitch, firePrimary, thrust })])
        room.stepFixed()
        const ev = room.drainEvents().filter(isEvent)
        if (ev.some((e) => e.kind === 'WAVE_CLEAR')) { sawWaveClear = true; break }
      }
    }
    expect(sawWaveClear).toBe(true)
  })
})
