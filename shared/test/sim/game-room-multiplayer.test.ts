import { describe, expect, it } from 'vitest'
import { ASTEROID_TIERS, WORLD_CONFIG } from '../../src/constants'
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

function step(room: GameRoom, ticks: number, cmdFor?: (tick: number) => ShipCommand[] | undefined): ServerMessage[] {
  const events: ServerMessage[] = []
  for (let i = 0; i < ticks; i++) {
    const tick = room.currentTick + 1
    const cmds = cmdFor?.(tick)
    if (cmds) room.enqueue(cmds)
    room.stepFixed()
    events.push(...room.drainEvents())
  }
  return events
}

describe('GameRoom multiplayer (Task 2)', () => {
  it('two players enter; commands of one do not affect the other', () => {
    const room = new GameRoom({ seed: 1, playerId: 'p1', playerName: 'Alice', platform: 'PC', spawnInitialWave: false, initialWave: 0 })
    room.addPlayer({ id: 'p2', name: 'Bob', platform: 'PC' })

    expect(room.hasPlayer('p1')).toBe(true)
    expect(room.hasPlayer('p2')).toBe(true)
    expect(room.playerCount()).toBe(2)

    // p1 thrusts, p2 stays idle
    for (let i = 1; i <= 30; i++) {
      room.receiveForPlayer('p1', [makeCmd(i, { thrust: 1 })])
      room.receiveForPlayer('p2', [makeCmd(i, {})])
      room.stepFixed()
    }

    const snap = room.snapshot()
    expect(isSnapshot(snap)).toBe(true)
    if (!isSnapshot(snap)) return
    const p1 = snap.ships.find((s) => s.id === 'p1')
    const p2 = snap.ships.find((s) => s.id === 'p2')
    expect(p1).toBeDefined()
    expect(p2).toBeDefined()
    // p1 should have moved forward (-Z at identity)
    expect(p1!.pos[2]).toBeLessThan(-1)
    // p2 should remain near origin
    expect(Math.abs(p2!.pos[0])).toBeLessThan(0.01)
    expect(Math.abs(p2!.pos[1])).toBeLessThan(0.01)
    expect(Math.abs(p2!.pos[2])).toBeLessThan(0.01)
    expect(p2!.lastProcessedTick).toBe(30)
    expect(p1!.lastProcessedTick).toBe(30)
  })

  it('death records score and zeros on respawn; respawn requires request after delay', () => {
    const room = new GameRoom({
      seed: 7,
      playerId: 'p1',
      playerName: 'Pilot',
      platform: 'PC',
      spawnInitialWave: false,
      initialWave: 0,
      initialAsteroids: [
        { id: 100, pos: [0, 0, -20], vel: [0, 0, 0], rot: [0, 0, 0, 1], angVel: [0, 0, 0], size: 'LARGE', hp: 10 },
        // lethal asteroid right on top to kill after scoring
      ],
    })

    // Destroy asteroid to gain score
    let scored = false
    for (let i = 1; i <= 60; i++) {
      room.receiveForPlayer('p1', [makeCmd(i, { firePrimary: true })])
      room.stepFixed()
      room.drainEvents()
      const snap = room.snapshot()
      if (!isSnapshot(snap)) continue
      const ship = snap.ships.find((s) => s.id === 'p1')
      if (ship && ship.score >= ASTEROID_TIERS.LARGE.score) { scored = true; break }
    }
    expect(scored).toBe(true)

    // Now force death by placing lethal collision scenario: add a big asteroid at ship pos via direct setup is hard;
    // easier to spawn enemy/plasma or just collide. We'll step with a lethal asteroid spawned in front and thrust into it.
    // Instead, create a fresh room with score seeded by destroying, then kill.
    // Simpler: create room, manually give damage by ramming asteroid.
    const room2 = new GameRoom({
      seed: 7,
      playerId: 'p1',
      playerName: 'Pilot',
      platform: 'PC',
      spawnInitialWave: false,
      initialWave: 0,
      initialAsteroids: [
        { id: 100, pos: [0, 0, -20], vel: [0, 0, 0], rot: [0, 0, 0, 1], angVel: [0, 0, 0], size: 'LARGE', hp: 10 },
      ],
    })

    for (let i = 1; i <= 60; i++) {
      room2.receiveForPlayer('p1', [makeCmd(i, { firePrimary: true })])
      room2.stepFixed()
      room2.drainEvents()
    }
    let snap2 = room2.snapshot()
    if (!isSnapshot(snap2)) throw new Error('snapshot')
    let ship2 = snap2.ships.find((s) => s.id === 'p1')!
    expect(ship2.score).toBeGreaterThanOrEqual(ASTEROID_TIERS.LARGE.score)
    const scoreBeforeDeath = ship2.score

    // Kill player by ramming into a big asteroid placed close
    const room3 = new GameRoom({
      seed: 5,
      playerId: 'p1',
      playerName: 'Pilot',
      platform: 'PC',
      spawnInitialWave: false,
      initialWave: 0,
      gameOverOnDeath: false,
      autoRespawn: false,
      initialAsteroids: [
        { id: 100, pos: [0, 0, -20], vel: [0, 0, 0], rot: [0, 0, 0, 1], angVel: [0, 0, 0], size: 'LARGE', hp: 10 },
        { id: 200, pos: [0, 0, -3], vel: [0, 0, 0], rot: [0, 0, 0, 1], angVel: [0, 0, 0], size: 'LARGE', hp: 10000 },
      ],
    })
    // gain score
    for (let i = 1; i <= 60; i++) {
      room3.receiveForPlayer('p1', [makeCmd(i, { firePrimary: true })])
      room3.stepFixed()
      room3.drainEvents()
    }
    const snap3a = room3.snapshot()
    if (!isSnapshot(snap3a)) throw new Error('snapshot')
    const scoreEarned = snap3a.ships.find((s) => s.id === 'p1')!.score
    expect(scoreEarned).toBeGreaterThan(0)

    let deathEvents: Extract<ServerMessage, { t: 'EVENT' }>[] = []
    let scoreEvents: Extract<ServerMessage, { t: 'EVENT' }>[] = []
    let died = false
    for (let i = 61; i <= 400; i++) {
      room3.receiveForPlayer('p1', [makeCmd(i, { thrust: 1 })])
      room3.stepFixed()
      const ev = room3.drainEvents().filter(isEvent)
      deathEvents.push(...ev.filter((e) => e.kind === 'PLAYER_DEATH'))
      scoreEvents.push(...ev.filter((e) => e.kind === 'SCORE_RECORDED'))
      const s = room3.snapshot()
      if (isSnapshot(s) && s.ships.find((sh) => sh.id === 'p1')?.alive === false) { died = true; break }
    }
    expect(died).toBe(true)
    expect(scoreEvents.length).toBeGreaterThanOrEqual(1)
    const recorded = scoreEvents.find((e) => e.kind === 'SCORE_RECORDED' && (e as any).playerId === 'p1') as any
    expect(recorded).toBeDefined()
    expect(recorded.score).toBe(scoreEarned)

    // After death, score should be zeroed (before/at respawn as per spec)
    const snapDead = room3.snapshot()
    if (!isSnapshot(snapDead)) throw new Error('snapshot')
    const deadShip = snapDead.ships.find((s) => s.id === 'p1')!
    expect(deadShip.alive).toBe(false)
    expect(deadShip.score).toBe(0)

    // Should not respawn without request
    for (let i = 401; i <= 401 + 30 * 5; i++) {
      room3.receiveForPlayer('p1', [makeCmd(i, {})])
      room3.stepFixed()
      room3.drainEvents()
    }
    const snapStillDead = room3.snapshot()
    if (!isSnapshot(snapStillDead)) throw new Error('snapshot')
    expect(snapStillDead.ships.find((s) => s.id === 'p1')!.alive).toBe(false)

    // Request respawn after delay
    room3.requestRespawn('p1')
    for (let i = 560; i <= 570; i++) {
      room3.receiveForPlayer('p1', [makeCmd(i, {})])
      room3.stepFixed()
      room3.drainEvents()
    }
    const snapRespawned = room3.snapshot()
    if (!isSnapshot(snapRespawned)) throw new Error('snapshot')
    const respawned = snapRespawned.ships.find((s) => s.id === 'p1')!
    expect(respawned.alive).toBe(true)
    expect(respawned.score).toBe(0)
    expect(respawned.shield).toBeGreaterThan(0)
  })

  it('quit records score if > 0', () => {
    const room = new GameRoom({
      seed: 7,
      playerId: 'p1',
      playerName: 'Pilot',
      platform: 'PC',
      spawnInitialWave: false,
      initialWave: 0,
      initialAsteroids: [
        { id: 100, pos: [0, 0, -20], vel: [0, 0, 0], rot: [0, 0, 0, 1], angVel: [0, 0, 0], size: 'LARGE', hp: 10 },
      ],
    })

    for (let i = 1; i <= 60; i++) {
      room.receiveForPlayer('p1', [makeCmd(i, { firePrimary: true })])
      room.stepFixed()
      room.drainEvents()
    }
    const snap = room.snapshot()
    if (!isSnapshot(snap)) throw new Error('snapshot')
    const score = snap.ships.find((s) => s.id === 'p1')!.score
    expect(score).toBeGreaterThan(0)

    room.quit('p1')
    const events = room.drainEvents().filter(isEvent)
    const rec = events.find((e) => e.kind === 'SCORE_RECORDED' && (e as any).playerId === 'p1') as any
    expect(rec).toBeDefined()
    expect(rec.score).toBe(score)
    expect(room.hasPlayer('p1')).toBe(false)
  })

  it('killer attribution for enemy and asteroid deaths', () => {
    // Asteroid kill
    const roomA = new GameRoom({
      seed: 5,
      playerId: 'p1',
      playerName: 'Pilot',
      platform: 'PC',
      spawnInitialWave: false,
      initialWave: 0,
      gameOverOnDeath: false,
      autoRespawn: false,
      initialAsteroids: [
        { id: 200, pos: [0, 0, -3], vel: [0, 0, 0], rot: [0, 0, 0, 1], angVel: [0, 0, 0], size: 'LARGE', hp: 10000 },
      ],
    })
    // wait out spawn invuln
    for (let i = 1; i <= 100; i++) {
      roomA.receiveForPlayer('p1', [makeCmd(i, {})])
      roomA.stepFixed()
      roomA.drainEvents()
    }
    let asteroidDeath: any = null
    for (let i = 101; i <= 400; i++) {
      roomA.receiveForPlayer('p1', [makeCmd(i, { thrust: 1 })])
      roomA.stepFixed()
      const ev = roomA.drainEvents().filter(isEvent)
      const d = ev.find((e) => e.kind === 'PLAYER_DEATH') as any
      if (d) { asteroidDeath = d; break }
    }
    expect(asteroidDeath).toBeTruthy()
    expect(asteroidDeath.playerId).toBe('p1')
    expect(asteroidDeath.killerKind).toBe('ASTEROID')
    expect(asteroidDeath.killerId).toBe(200)
    expect(asteroidDeath.respawnDelaySec).toBe(WORLD_CONFIG.RESPAWN_DELAY_SEC)
    expect(Array.isArray(asteroidDeath.pos)).toBe(true)

    // Enemy kill - use enemy projectile. Spawn a scout close and let it shoot.
    const roomE = new GameRoom({
      seed: 11,
      playerId: 'p1',
      playerName: 'Pilot',
      platform: 'PC',
      spawnInitialWave: false,
      initialWave: 0,
    })
    ;(roomE as any).spawnEnemy('SCOUT', [0, 0, -30])
    // Place player in front of enemy; enemy faces toward player by AI. Step until death.
    let enemyDeath: any = null
    for (let i = 1; i <= 2000; i++) {
      roomE.receiveForPlayer('p1', [makeCmd(i, {})])
      roomE.stepFixed()
      const ev = roomE.drainEvents().filter(isEvent)
      const d = ev.find((e) => e.kind === 'PLAYER_DEATH') as any
      if (d) { enemyDeath = d; break }
    }
    // Enemy may or may not kill depending on AI; if not, this is a weak test - but it's a real scenario.
    // As fallback, inject enemy plasma projectile directly to ensure deterministic test.
    if (!enemyDeath) {
      const roomE2 = new GameRoom({
        seed: 11,
        playerId: 'p1',
        playerName: 'Pilot',
        platform: 'PC',
        spawnInitialWave: false,
        initialWave: 0,
        gameOverOnDeath: false,
      autoRespawn: false,
      })
      for (let i = 1; i <= 100; i++) {
        roomE2.receiveForPlayer('p1', [makeCmd(i, {})])
        roomE2.stepFixed()
        roomE2.drainEvents()
      }
      for (let i = 101; i <= 140; i++) {
        ;(roomE2 as any).projectiles.push({
          id: 9000 + i,
          ownerId: 'enemy:42',
          kind: 'ENEMY_PLASMA',
          pos: [0, 0, -3],
          prevPos: [0, 0, -3],
          vel: [0, 0, 60],
          ttl: 5,
        })
        roomE2.receiveForPlayer('p1', [makeCmd(i, {})])
        roomE2.stepFixed()
        const ev = roomE2.drainEvents().filter(isEvent)
        const d = ev.find((e) => e.kind === 'PLAYER_DEATH') as any
        if (d) { enemyDeath = d; break }
      }
    }
    expect(enemyDeath).toBeTruthy()
    expect(enemyDeath.playerId).toBe('p1')
    expect(enemyDeath.killerKind).toBe('ENEMY')
    expect(enemyDeath.killerId).toBe(42)
    expect(enemyDeath.respawnDelaySec).toBe(WORLD_CONFIG.RESPAWN_DELAY_SEC)
  })
})
