import { ASTEROID_TIERS, ENEMY_ARCHETYPES, SHIP_CONFIG, WAVE_SPAWN_CONFIG, WORLD_CONFIG } from '../constants'
import { CollisionEventBuffer, PROJECTILE_RADIUS, resolveProjectileAsteroidCollisions, resolveShipAsteroidCollisions } from '../collision'
import { clamp, isFiniteNumber, sweptSegmentSphere, type HitResult } from '../math'
import { FIXED_DT, stepShip } from '../physics'
import type {
  AsteroidSize,
  AsteroidState,
  ClientMessage,
  EnemyState,
  PickupState,
  PlatformMode,
  ProjectileState,
  ServerMessage,
  ShipCommand,
  ShipState,
} from '../types'
import { createEnemyIntent, createScavengerDeathDrops, stepEnemyAI, type EnemyIntent } from './EnemyAI'
import { IdSeq } from './ids'
import { fragmentAsteroid, type Rng } from './spawn'
import { WaveManager } from './WaveManager'

export interface GameRoomOptions {
  seed?: number
  playerId?: string
  playerName?: string
  platform?: PlatformMode
  initialAsteroids?: AsteroidState[]
  initialWave?: number
  spawnInitialWave?: boolean
}

interface ShipRuntime {
  primaryCooldown: number
  secondaryCooldown: number
  pendingCmd: ShipCommand | null
}

interface ProjectileRuntime {
  // no extra fields yet; kept for future pooling/runtime data
  alive: boolean
}

const LASER_SPEED = 240
const LASER_TTL = 2.0
const ENEMY_PLASMA_TTL = 2.0
const MISSILE_TTL = 6.0
const PICKUP_TTL = 30
const PICKUP_RADIUS = 4.5
const PLAYER_PROJECTILE_DAMAGE_LASER = 10
const PLAYER_PROJECTILE_DAMAGE_MISSILE = 45

function makeRng(seed: number): Rng {
  let s = (seed >>> 0) || 1
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    return s / 0x1_0000_0000
  }
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && isFiniteNumber(value) ? value : fallback
}

function clampAxis(value: unknown): number {
  return clamp(finiteOr(value, 0), -1, 1)
}

function boolOr(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function sanitizeCommand(cmd: ShipCommand): ShipCommand {
  return {
    tick: Math.max(0, Math.trunc(finiteOr(cmd.tick, 0))),
    thrust: clampAxis(cmd.thrust),
    strafeX: clampAxis(cmd.strafeX),
    strafeY: clampAxis(cmd.strafeY),
    yaw: clampAxis(cmd.yaw),
    pitch: clampAxis(cmd.pitch),
    roll: clampAxis(cmd.roll),
    firePrimary: boolOr(cmd.firePrimary),
    fireSecondary: boolOr(cmd.fireSecondary),
    boost: boolOr(cmd.boost),
  }
}

function copyShip(ship: ShipState): ShipState {
  return {
    id: ship.id,
    name: ship.name,
    platform: ship.platform,
    pos: [ship.pos[0], ship.pos[1], ship.pos[2]],
    vel: [ship.vel[0], ship.vel[1], ship.vel[2]],
    rot: [ship.rot[0], ship.rot[1], ship.rot[2], ship.rot[3]],
    angVel: [ship.angVel[0], ship.angVel[1], ship.angVel[2]],
    shield: ship.shield,
    energy: ship.energy,
    score: ship.score,
    alive: ship.alive,
    invulnTimer: ship.invulnTimer,
    lastProcessedTick: ship.lastProcessedTick,
  }
}

function copyAsteroid(a: AsteroidState): AsteroidState {
  return {
    id: a.id,
    pos: [a.pos[0], a.pos[1], a.pos[2]],
    vel: [a.vel[0], a.vel[1], a.vel[2]],
    rot: [a.rot[0], a.rot[1], a.rot[2], a.rot[3]],
    angVel: [a.angVel[0], a.angVel[1], a.angVel[2]],
    size: a.size,
    hp: a.hp,
  }
}

function copyEnemy(e: EnemyState): EnemyState {
  return {
    id: e.id,
    archetype: e.archetype,
    pos: [e.pos[0], e.pos[1], e.pos[2]],
    vel: [e.vel[0], e.vel[1], e.vel[2]],
    rot: [e.rot[0], e.rot[1], e.rot[2], e.rot[3]],
    hp: e.hp,
  }
}

function copyProjectile(p: ProjectileState): ProjectileState {
  return {
    id: p.id,
    ownerId: p.ownerId,
    kind: p.kind,
    pos: [p.pos[0], p.pos[1], p.pos[2]],
    prevPos: [p.prevPos[0], p.prevPos[1], p.prevPos[2]],
    vel: [p.vel[0], p.vel[1], p.vel[2]],
    ttl: p.ttl,
  }
}

function copyPickup(p: PickupState): PickupState {
  return {
    id: p.id,
    kind: p.kind,
    pos: [p.pos[0], p.pos[1], p.pos[2]],
    ttl: p.ttl,
  }
}

function distSq(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = ax - bx
  const dy = ay - by
  const dz = az - bz
  return dx * dx + dy * dy + dz * dz
}

function forwardFromRot(rot: readonly [number, number, number, number], out: [number, number, number]): [number, number, number] {
  let qx = finiteOr(rot[0], 0)
  let qy = finiteOr(rot[1], 0)
  let qz = finiteOr(rot[2], 0)
  let qw = finiteOr(rot[3], 1)
  const ql = Math.hypot(qx, qy, qz, qw)
  if (ql <= 1e-9) { out[0] = 0; out[1] = 0; out[2] = -1; return out }
  qx /= ql; qy /= ql; qz /= ql; qw /= ql
  const fx = -2 * qx * qz - 2 * qw * qy
  const fy = -2 * qy * qz + 2 * qw * qx
  const fz = -1 + 2 * qx * qx + 2 * qy * qy
  const fl = Math.hypot(fx, fy, fz)
  if (fl <= 1e-9) { out[0] = 0; out[1] = 0; out[2] = -1; return out }
  out[0] = fx / fl; out[1] = fy / fl; out[2] = fz / fl
  return out
}

function makeEmptyCmd(tick: number): ShipCommand {
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
  }
}

export class GameRoom {
  private readonly rng: Rng
  private idSeq = new IdSeq(1)
  private readonly waveManager = new WaveManager()
  private readonly collisionBuffer = new CollisionEventBuffer(512)
  private readonly enemyIntents: EnemyIntent[] = []
  private readonly shipRuntimes: ShipRuntime[] = []
  private readonly shipPrevPos: [number, number, number][] = []
  private readonly shipPrevVel: [number, number, number][] = []
  private readonly shipSweep: ShipState[] = []
  private readonly autoWaves: boolean
  private readonly forwardScratch: [number, number, number] = [0, 0, -1]
  private readonly hitScratch: HitResult = { hit: false, t: 0, nx: 0, ny: 0, nz: 0 }

  readonly snapshotIntervalTicks = WORLD_CONFIG.FIXED_TICK_RATE / WORLD_CONFIG.NETWORK_BROADCAST_RATE
  private snapshotAccum = 0
  private snapshotDue = false

  private tick = 0
  private readonly ships: ShipState[] = []
  private readonly asteroids: AsteroidState[] = []
  private readonly enemies: EnemyState[] = []
  private readonly projectiles: ProjectileState[] = []
  private readonly pickups: PickupState[] = []
  private readonly pendingEvents: ServerMessage[] = []

  constructor(opts: GameRoomOptions = {}) {
    const seed = Number.isFinite(opts.seed) ? Math.trunc(opts.seed as number) : 1
    this.rng = makeRng(seed)
    this.autoWaves = opts.spawnInitialWave !== false

    const playerId = opts.playerId ?? 'p1'
    const playerName = opts.playerName ?? 'Player'
    const platform = opts.platform ?? 'PC'

    const ship: ShipState = {
      id: playerId,
      name: playerName,
      platform,
      pos: [0, 0, 0],
      vel: [0, 0, 0],
      rot: [0, 0, 0, 1],
      angVel: [0, 0, 0],
      shield: SHIP_CONFIG.MAX_SHIELD,
      energy: SHIP_CONFIG.MAX_ENERGY,
      score: 0,
      alive: true,
      invulnTimer: WORLD_CONFIG.SPAWN_INVULN_SEC,
      lastProcessedTick: 0,
    }
    this.ships.push(ship)
    this.shipRuntimes.push({ primaryCooldown: 0, secondaryCooldown: 0, pendingCmd: null })
    this.shipPrevPos.push([0, 0, 0])
    this.shipPrevVel.push([0, 0, 0])
    this.shipSweep.push(copyShip(ship))

    if (Array.isArray(opts.initialAsteroids)) {
      let maxId = 0
      for (let i = 0; i < opts.initialAsteroids.length; i++) {
        const a = opts.initialAsteroids[i]
        if (a !== undefined) {
          this.asteroids.push(copyAsteroid(a))
          if (Number.isFinite(a.id) && a.id > maxId) maxId = Math.trunc(a.id)
        }
      }
      if (maxId >= 1) this.idSeq = new IdSeq(maxId + 1)
    }

    const initialWave = Number.isFinite(opts.initialWave) ? Math.max(0, Math.trunc(opts.initialWave as number)) : 1
    const spawnInitial = opts.spawnInitialWave !== false
    if (spawnInitial) {
      this.spawnWave(initialWave)
    } else if (initialWave > 0) {
      // Keep wave number coherent for tests/scenarios that manage spawns manually.
      this.waveManager.planWave(initialWave, this.countAlivePlayers(), this.ships, this.rng)
      // planWave populated enemiesRemaining based on entries; but we didn't add them. Reset to 0.
      while (!this.waveManager.isWaveClear()) this.waveManager.onEnemyKilled()
    }
  }

  enqueue(cmds: ShipCommand[]): void {
    if (!Array.isArray(cmds)) return
    for (let i = 0; i < cmds.length; i++) {
      const raw = cmds[i]
      if (raw === undefined || raw === null || typeof raw !== 'object') continue
      const cmd = sanitizeCommand(raw)
      // Solo room: apply to primary ship. If multi-player later, match by owner.
      const ship = this.ships[0]
      const rt = this.shipRuntimes[0]
      if (ship === undefined || rt === undefined) continue
      if (cmd.tick <= ship.lastProcessedTick) continue
      const pending = rt.pendingCmd
      if (pending === null || cmd.tick >= pending.tick) {
        rt.pendingCmd = cmd
      }
    }
  }

  stepFixed(): void {
    const tSec = this.tick * FIXED_DT

    // 1) Apply commands to ships (or idle)
    for (let i = 0; i < this.ships.length; i++) {
      const ship = this.ships[i]
      const rt = this.shipRuntimes[i]
      if (ship === undefined || rt === undefined) continue

      let cmd = rt.pendingCmd
      if (cmd === null || cmd.tick <= ship.lastProcessedTick) {
        cmd = makeEmptyCmd(ship.lastProcessedTick + 1)
      } else {
        rt.pendingCmd = null
      }

      // Save prev state for post-step ship-asteroid sweep
      const prevPos = this.shipPrevPos[i]
      const prevVel = this.shipPrevVel[i]
      if (prevPos !== undefined) {
        prevPos[0] = ship.pos[0]; prevPos[1] = ship.pos[1]; prevPos[2] = ship.pos[2]
      }
      if (prevVel !== undefined) {
        prevVel[0] = ship.vel[0]; prevVel[1] = ship.vel[1]; prevVel[2] = ship.vel[2]
      }

      if (ship.alive) {
        this.updateShipTimersAndFire(ship, rt, cmd)
        stepShip(ship, cmd, FIXED_DT)
        ship.lastProcessedTick = cmd.tick
      } else {
        ship.lastProcessedTick = Math.max(ship.lastProcessedTick, cmd.tick)
        // Respawn timer handling
        ship.invulnTimer = Math.max(0, ship.invulnTimer - FIXED_DT)
        if (ship.invulnTimer <= 0) {
          this.respawnShip(ship)
        }
      }
    }

    // 2) Projectiles: move, ttl
    this.stepProjectiles()

    // 3) Enemies: AI + movement
    this.stepEnemies(tSec)

    // 4) Asteroids: integrate linear motion
    this.stepAsteroids()

    // 5) Collisions
    this.resolveCollisions()

    // 6) Pickups: ttl and collection
    this.stepPickups()

    // 7) Wave progression
    this.stepWave()

    this.tick += 1
    this.snapshotAccum += 1
    if (this.snapshotAccum + 1e-9 >= this.snapshotIntervalTicks) {
      this.snapshotDue = true
      this.snapshotAccum -= this.snapshotIntervalTicks
    }
  }

  shouldEmitSnapshot(): boolean {
    return this.snapshotDue
  }

  createSnapshot(): ServerMessage {
    this.snapshotDue = false
    const ships: ShipState[] = new Array(this.ships.length)
    for (let i = 0; i < this.ships.length; i++) ships[i] = copyShip(this.ships[i]!)

    const asteroids: AsteroidState[] = new Array(this.asteroids.length)
    for (let i = 0; i < this.asteroids.length; i++) asteroids[i] = copyAsteroid(this.asteroids[i]!)

    const enemies: EnemyState[] = new Array(this.enemies.length)
    for (let i = 0; i < this.enemies.length; i++) enemies[i] = copyEnemy(this.enemies[i]!)

    const projectiles: ProjectileState[] = new Array(this.projectiles.length)
    for (let i = 0; i < this.projectiles.length; i++) projectiles[i] = copyProjectile(this.projectiles[i]!)

    const pickups: PickupState[] = new Array(this.pickups.length)
    for (let i = 0; i < this.pickups.length; i++) pickups[i] = copyPickup(this.pickups[i]!)

    return {
      t: 'SNAPSHOT',
      tick: this.tick,
      serverTime: this.tick * FIXED_DT,
      ships,
      asteroids,
      enemies,
      projectiles,
      pickups,
      wave: this.waveManager.currentWave,
    }
  }

  drainEvents(): ServerMessage[] {
    if (this.pendingEvents.length === 0) return []
    const out = this.pendingEvents.slice()
    this.pendingEvents.length = 0
    return out
  }

  private countAlivePlayers(): number {
    let n = 0
    for (let i = 0; i < this.ships.length; i++) {
      if (this.ships[i]?.alive === true) n++
    }
    return n
  }

  private emitEvent(kind: 'EXPLOSION' | 'HIT' | 'PLAYER_DEATH' | 'PICKUP' | 'WAVE_CLEAR', pos: [number, number, number], scale: number): void {
    this.pendingEvents.push({ t: 'EVENT', kind, pos: [pos[0], pos[1], pos[2]], scale })
  }

  private spawnWave(wave: number): void {
    const plan = this.waveManager.planWave(wave, Math.max(1, this.countAlivePlayers()), this.ships, this.rng)
    for (let i = 0; i < plan.entries.length; i++) {
      const e = plan.entries[i]
      if (e === undefined) continue
      if (e.kind === 'ASTEROID_LARGE') {
        this.spawnAsteroid('LARGE', e.pos)
      } else if (e.kind === 'SCOUT' || e.kind === 'BRUISER' || e.kind === 'SCAVENGER') {
        this.spawnEnemy(e.kind, e.pos)
      }
    }
  }

  private spawnAsteroid(size: AsteroidSize, pos: [number, number, number]): void {
    const tier = ASTEROID_TIERS[size]
    const a: AsteroidState = {
      id: this.idSeq.next(),
      pos: [pos[0], pos[1], pos[2]],
      vel: [0, 0, 0],
      rot: [0, 0, 0, 1],
      angVel: [0, 0, 0],
      size,
      hp: tier.hp,
    }
    // Small random drift so asteroids aren't static
    const speed = tier.speed * 0.25
    a.vel[0] = (this.rng() * 2 - 1) * speed
    a.vel[1] = (this.rng() * 2 - 1) * speed
    a.vel[2] = (this.rng() * 2 - 1) * speed
    this.asteroids.push(a)
  }

  private spawnEnemy(archetype: 'SCOUT' | 'BRUISER' | 'SCAVENGER', pos: [number, number, number]): void {
    const cfg = ENEMY_ARCHETYPES[archetype]
    const e: EnemyState = {
      id: this.idSeq.next(),
      archetype,
      pos: [pos[0], pos[1], pos[2]],
      vel: [0, 0, 0],
      rot: [0, 0, 0, 1],
      hp: cfg.hp,
    }
    this.enemies.push(e)
  }

  private updateShipTimersAndFire(ship: ShipState, rt: ShipRuntime, cmd: ShipCommand): void {
    ship.invulnTimer = Math.max(0, ship.invulnTimer - FIXED_DT)
    rt.primaryCooldown = Math.max(0, rt.primaryCooldown - FIXED_DT)
    rt.secondaryCooldown = Math.max(0, rt.secondaryCooldown - FIXED_DT)

    ship.energy = clamp(ship.energy + SHIP_CONFIG.ENERGY_REGEN_RATE * FIXED_DT, 0, SHIP_CONFIG.MAX_ENERGY)
    if (cmd.boost) {
      ship.energy = clamp(ship.energy - SHIP_CONFIG.BOOST_DRAIN_RATE * FIXED_DT, 0, SHIP_CONFIG.MAX_ENERGY)
    }

    forwardFromRot(ship.rot, this.forwardScratch)
    const fx = this.forwardScratch[0]
    const fy = this.forwardScratch[1]
    const fz = this.forwardScratch[2]
    const muzzleOffset = SHIP_CONFIG.RADIUS + 0.5

    if (cmd.firePrimary && rt.primaryCooldown <= 0) {
      rt.primaryCooldown = SHIP_CONFIG.PRIMARY_COOLDOWN
      this.spawnProjectile(ship.id, 'LASER', ship.pos, fx, fy, fz, LASER_SPEED, LASER_TTL, muzzleOffset)
    }

    if (cmd.fireSecondary && rt.secondaryCooldown <= 0 && ship.energy >= SHIP_CONFIG.MISSILE_ENERGY_COST) {
      rt.secondaryCooldown = SHIP_CONFIG.SECONDARY_COOLDOWN
      ship.energy = clamp(ship.energy - SHIP_CONFIG.MISSILE_ENERGY_COST, 0, SHIP_CONFIG.MAX_ENERGY)
      this.spawnProjectile(ship.id, 'MISSILE', ship.pos, fx, fy, fz, ENEMY_ARCHETYPES.BRUISER.missileSpeed, MISSILE_TTL, muzzleOffset)
    }
  }

  private spawnProjectile(
    ownerId: string,
    kind: 'LASER' | 'MISSILE' | 'ENEMY_PLASMA',
    origin: readonly [number, number, number],
    dx: number,
    dy: number,
    dz: number,
    speed: number,
    ttl: number,
    muzzleOffset: number,
  ): void {
    const len = Math.hypot(dx, dy, dz)
    let nx = 0, ny = 0, nz = -1
    if (len > 1e-9) { nx = dx / len; ny = dy / len; nz = dz / len }
    const px = origin[0] + nx * muzzleOffset
    const py = origin[1] + ny * muzzleOffset
    const pz = origin[2] + nz * muzzleOffset
    this.projectiles.push({
      id: this.idSeq.next(),
      ownerId,
      kind,
      pos: [px, py, pz],
      prevPos: [px, py, pz],
      vel: [nx * speed, ny * speed, nz * speed],
      ttl,
    })
  }

  private stepProjectiles(): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]
      if (p === undefined) continue
      p.prevPos[0] = p.pos[0]; p.prevPos[1] = p.pos[1]; p.prevPos[2] = p.pos[2]
      p.pos[0] += p.vel[0] * FIXED_DT
      p.pos[1] += p.vel[1] * FIXED_DT
      p.pos[2] += p.vel[2] * FIXED_DT
      p.ttl -= FIXED_DT
      if (p.ttl <= 0) {
        this.projectiles[i] = this.projectiles[this.projectiles.length - 1]!
        this.projectiles.length -= 1
      }
    }
  }

  private stepEnemies(timeSec: number): void {
    // Ensure intent scratch pool
    while (this.enemyIntents.length < this.enemies.length) this.enemyIntents.push(createEnemyIntent())

    // Tick down enemy weapon cooldowns once per sim step.
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i]
      if (e === undefined) continue
      const cd = this.enemyCooldowns.get(e.id)
      if (cd !== undefined && cd > 0) this.enemyCooldowns.set(e.id, Math.max(0, cd - FIXED_DT))
    }

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i]
      const intent = this.enemyIntents[i]
      if (enemy === undefined || intent === undefined) continue
      if (!(enemy.hp > 0)) {
        this.killEnemyAtIndex(i)
        continue
      }

      stepEnemyAI(enemy, this.ships, this.asteroids, this.pickups, timeSec, intent)

      // Apply movement intent as velocity (simple kinematic steering for M4)
      enemy.vel[0] = intent.moveX
      enemy.vel[1] = intent.moveY
      enemy.vel[2] = intent.moveZ
      enemy.pos[0] += enemy.vel[0] * FIXED_DT
      enemy.pos[1] += enemy.vel[1] * FIXED_DT
      enemy.pos[2] += enemy.vel[2] * FIXED_DT

      // Face direction: update rot from face vector (yaw/pitch approximation via look-at quat)
      this.applyFacing(enemy, intent.faceX, intent.faceY, intent.faceZ)

      // Fire weapons
      if (intent.firePrimary && enemy.archetype === 'SCOUT') {
        this.enemyTryFireScout(enemy, intent, timeSec)
      }
      if (intent.fireSecondary && enemy.archetype === 'BRUISER') {
        this.enemyTryFireBruiser(enemy, timeSec)
      }
    }
  }

  private applyFacing(enemy: EnemyState, fx: number, fy: number, fz: number): void {
    const len = Math.hypot(fx, fy, fz)
    if (len <= 1e-9) return
    const nx = fx / len, ny = fy / len, nz = fz / len
    // Build quaternion that rotates local -Z to (nx,ny,nz)
    // forward = -Z, target = n. quat from -Z to n:
    const dotF = -nz // dot((0,0,-1), n)
    let qx: number, qy: number, qz: number, qw: number
    if (dotF < -0.999999) {
      // 180 degrees around Y
      qx = 0; qy = 1; qz = 0; qw = 0
    } else if (dotF > 0.999999) {
      qx = 0; qy = 0; qz = 0; qw = 1
    } else {
      // cross(-Z, n) = (ny, -nx, 0)
      const cx = ny
      const cy = -nx
      const cz = 0
      qw = 1 + dotF
      qx = cx; qy = cy; qz = cz
      const ql = Math.hypot(qx, qy, qz, qw)
      qx /= ql; qy /= ql; qz /= ql; qw /= ql
    }
    enemy.rot[0] = qx; enemy.rot[1] = qy; enemy.rot[2] = qz; enemy.rot[3] = qw
  }

  // Simple per-enemy cooldown tracking stored on enemy id via map-like scan avoidance: use a small array parallel to enemies not worth it.
  // Instead, keep a Map - firing is infrequent, but Map allocates? No, Map is stable. Alternatively, store on a side record.
  private readonly enemyCooldowns = new Map<number, number>()
  private readonly deadProjectileIds = new Set<number>()
  private readonly asteroidDamageById = new Map<number, number>()

  private enemyTryFireScout(enemy: EnemyState, intent: EnemyIntent, _timeSec: number): void {
    const cd = this.enemyCooldowns.get(enemy.id) ?? 0
    if (cd > 0) return
    // Fire burst of 2
    const burst = intent.primaryBurstCount > 0 ? intent.primaryBurstCount : ENEMY_ARCHETYPES.SCOUT.primaryBurstCount
    forwardFromRot(enemy.rot, this.forwardScratch)
    const fx = this.forwardScratch[0]
    const fy = this.forwardScratch[1]
    const fz = this.forwardScratch[2]
    for (let b = 0; b < burst; b++) {
      // slight spread in time? At same tick spawn same direction; acceptable for M4.
      this.spawnProjectile(`enemy:${enemy.id}`, 'ENEMY_PLASMA', enemy.pos, fx, fy, fz, ENEMY_ARCHETYPES.SCOUT.projectileSpeed, ENEMY_PLASMA_TTL, 3.0)
    }
    this.enemyCooldowns.set(enemy.id, SHIP_CONFIG.PRIMARY_COOLDOWN * 4) // slower than player
  }

  private enemyTryFireBruiser(enemy: EnemyState, _timeSec: number): void {
    const cd = this.enemyCooldowns.get(enemy.id) ?? 0
    if (cd > 0) return
    forwardFromRot(enemy.rot, this.forwardScratch)
    this.spawnProjectile(`enemy:${enemy.id}`, 'MISSILE', enemy.pos, this.forwardScratch[0], this.forwardScratch[1], this.forwardScratch[2], ENEMY_ARCHETYPES.BRUISER.missileSpeed, MISSILE_TTL, 4.0)
    this.enemyCooldowns.set(enemy.id, SHIP_CONFIG.SECONDARY_COOLDOWN)
  }

  private stepAsteroids(): void {
    for (let i = 0; i < this.asteroids.length; i++) {
      const a = this.asteroids[i]
      if (a === undefined) continue
      a.pos[0] += a.vel[0] * FIXED_DT
      a.pos[1] += a.vel[1] * FIXED_DT
      a.pos[2] += a.vel[2] * FIXED_DT
    }
  }

  private resolveCollisions(): void {
    // Ship-asteroid: post-step swept approximation using prevPos->pos
    this.resolveShipAsteroidPostStep()

    // Projectile-asteroid
    this.collisionBuffer.reset()
    resolveProjectileAsteroidCollisions(this.projectiles, this.asteroids, this.collisionBuffer)
    this.applyProjectileAsteroidEvents()

    // Projectile-enemy (player projectiles hit enemies)
    this.resolveProjectileEnemyCollisions()

    // Projectile-ship (enemy projectiles hit player)
    this.resolveProjectileShipCollisions()
  }

  private resolveShipAsteroidPostStep(): void {
    if (this.ships.length === 0 || this.asteroids.length === 0) return
    // Build sweep ship proxies with prevPos and sweep vel
    for (let i = 0; i < this.ships.length; i++) {
      const s = this.ships[i]
      const prev = this.shipPrevPos[i]
      const sweep = this.shipSweep[i]
      if (s === undefined || prev === undefined || sweep === undefined) continue
      // copy ship into sweep proxy
      sweep.id = s.id; sweep.name = s.name; sweep.platform = s.platform
      sweep.pos[0] = prev[0]; sweep.pos[1] = prev[1]; sweep.pos[2] = prev[2]
      sweep.vel[0] = (s.pos[0] - prev[0]) / FIXED_DT
      sweep.vel[1] = (s.pos[1] - prev[1]) / FIXED_DT
      sweep.vel[2] = (s.pos[2] - prev[2]) / FIXED_DT
      sweep.rot[0] = s.rot[0]; sweep.rot[1] = s.rot[1]; sweep.rot[2] = s.rot[2]; sweep.rot[3] = s.rot[3]
      sweep.angVel[0] = s.angVel[0]; sweep.angVel[1] = s.angVel[1]; sweep.angVel[2] = s.angVel[2]
      sweep.shield = s.shield; sweep.energy = s.energy; sweep.score = s.score
      sweep.alive = s.alive; sweep.invulnTimer = s.invulnTimer; sweep.lastProcessedTick = s.lastProcessedTick
    }

    this.collisionBuffer.reset()
    // Use sweep proxies array length == ships.length
    this.shipSweep.length = this.ships.length
    resolveShipAsteroidCollisions(this.shipSweep, this.asteroids, this.collisionBuffer)

    for (let i = 0; i < this.ships.length; i++) {
      const s = this.ships[i]
      const prev = this.shipPrevPos[i]
      const sweep = this.shipSweep[i]
      if (s === undefined || prev === undefined || sweep === undefined) continue
      // Preserve stepShip integration; apply only collision bounce delta + minimal separation.
      if (s.invulnTimer > 0) {
        sweep.shield = s.shield
      }
      s.shield = sweep.shield

      const dispVx = (s.pos[0] - prev[0]) / FIXED_DT
      const dispVy = (s.pos[1] - prev[1]) / FIXED_DT
      const dispVz = (s.pos[2] - prev[2]) / FIXED_DT
      const dvx = sweep.vel[0] - dispVx
      const dvy = sweep.vel[1] - dispVy
      const dvz = sweep.vel[2] - dispVz

      // Apply bounce delta on top of stepShip result (preserves accel/drag integration).
      s.vel[0] += dvx
      s.vel[1] += dvy
      s.vel[2] += dvz
      s.pos[0] += dvx * FIXED_DT
      s.pos[1] += dvy * FIXED_DT
      s.pos[2] += dvz * FIXED_DT

      if (s.shield <= 0 && s.alive) {
        this.killShip(s)
      }
    }

    for (let i = 0; i < this.collisionBuffer.count; i++) {
      const ev = this.collisionBuffer.get(i)
      if (ev === undefined) continue
      this.emitEvent('HIT', [ev.x, ev.y, ev.z], 1)
    }
  }

  private applyProjectileAsteroidEvents(): void {
    if (this.collisionBuffer.count === 0) return

    this.deadProjectileIds.clear()
    this.asteroidDamageById.clear()

    for (let i = 0; i < this.collisionBuffer.count; i++) {
      const ev = this.collisionBuffer.get(i)
      if (ev === undefined) continue
      if (ev.kind !== 'PROJECTILE_ASTEROID') continue
      const projId = ev.aId as number
      this.deadProjectileIds.add(projId)
      const prev = this.asteroidDamageById.get(ev.bId) ?? 0
      const proj = this.findProjectileById(projId)
      const dmg = proj?.kind === 'MISSILE' ? PLAYER_PROJECTILE_DAMAGE_MISSILE : PLAYER_PROJECTILE_DAMAGE_LASER
      this.asteroidDamageById.set(ev.bId, prev + dmg)
      this.emitEvent('HIT', [ev.x, ev.y, ev.z], 0.6)
    }

    if (this.deadProjectileIds.size > 0) {
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const p = this.projectiles[i]
        if (p !== undefined && this.deadProjectileIds.has(p.id)) {
          this.projectiles[i] = this.projectiles[this.projectiles.length - 1]!
          this.projectiles.length -= 1
        }
      }
    }

    if (this.asteroidDamageById.size > 0) {
      for (let i = this.asteroids.length - 1; i >= 0; i--) {
        const a = this.asteroids[i]
        if (a === undefined) continue
        const dmg = this.asteroidDamageById.get(a.id)
        if (dmg === undefined) continue
        a.hp -= dmg
        if (a.hp <= 0) {
          this.destroyAsteroidAtIndex(i)
        }
      }
    }
  }

  private findProjectileById(id: number): ProjectileState | undefined {
    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i]
      if (p !== undefined && p.id === id) return p
    }
    return undefined
  }

  private destroyAsteroidAtIndex(index: number): void {
    const a = this.asteroids[index]
    if (a === undefined) return
    this.emitEvent('EXPLOSION', [a.pos[0], a.pos[1], a.pos[2]], ASTEROID_TIERS[a.size].radius / 3)
    const children = fragmentAsteroid(a, this.idSeq, this.rng)
    // swap-remove asteroid
    this.asteroids[index] = this.asteroids[this.asteroids.length - 1]!
    this.asteroids.length -= 1
    for (let i = 0; i < children.length; i++) {
      const c = children[i]
      if (c !== undefined) this.asteroids.push(c)
    }
  }

  private enemyRadius(archetype: 'SCOUT' | 'BRUISER' | 'SCAVENGER'): number {
    if (archetype === 'BRUISER') return 5
    if (archetype === 'SCAVENGER') return 3.5
    return 3
  }

  private resolveProjectileEnemyCollisions(): void {
    for (let pi = this.projectiles.length - 1; pi >= 0; pi--) {
      const p = this.projectiles[pi]
      if (p === undefined) continue
      const isPlayerProjectile = p.kind === 'LASER' || (p.kind === 'MISSILE' && !p.ownerId.startsWith('enemy:'))
      if (!isPlayerProjectile) continue

      const ax = p.prevPos[0], ay = p.prevPos[1], az = p.prevPos[2]
      const bx = p.pos[0], by = p.pos[1], bz = p.pos[2]

      let hit = false
      for (let ei = this.enemies.length - 1; ei >= 0; ei--) {
        const e = this.enemies[ei]
        if (e === undefined) continue
        const r = this.enemyRadius(e.archetype) + PROJECTILE_RADIUS
        sweptSegmentSphere(ax, ay, az, bx, by, bz, e.pos[0], e.pos[1], e.pos[2], r, this.hitScratch)
        if (!this.hitScratch.hit) continue
        const dmg = p.kind === 'MISSILE' ? PLAYER_PROJECTILE_DAMAGE_MISSILE : PLAYER_PROJECTILE_DAMAGE_LASER
        e.hp -= dmg
        const t = this.hitScratch.t
        this.emitEvent('HIT', [ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t], 0.7)
        if (e.hp <= 0) {
          this.killEnemyAtIndex(ei)
        }
        hit = true
        break
      }
      if (hit) {
        this.projectiles[pi] = this.projectiles[this.projectiles.length - 1]!
        this.projectiles.length -= 1
      }
    }
  }

  private resolveProjectileShipCollisions(): void {
    // Enemy projectiles hitting alive players (swept to avoid tunneling)
    for (let pi = this.projectiles.length - 1; pi >= 0; pi--) {
      const p = this.projectiles[pi]
      if (p === undefined) continue
      const isEnemyProjectile = p.kind === 'ENEMY_PLASMA' || (p.kind === 'MISSILE' && p.ownerId.startsWith('enemy:'))
      if (!isEnemyProjectile) continue

      const ax = p.prevPos[0], ay = p.prevPos[1], az = p.prevPos[2]
      const bx = p.pos[0], by = p.pos[1], bz = p.pos[2]

      let hit = false
      for (let si = 0; si < this.ships.length; si++) {
        const s = this.ships[si]
        if (s === undefined || !s.alive) continue
        if (s.invulnTimer > 0) continue
        const r = SHIP_CONFIG.RADIUS + PROJECTILE_RADIUS
        sweptSegmentSphere(ax, ay, az, bx, by, bz, s.pos[0], s.pos[1], s.pos[2], r, this.hitScratch)
        if (!this.hitScratch.hit) continue
        const t = this.hitScratch.t
        const dmg = p.kind === 'MISSILE' ? 35 : 12
        s.shield = Math.max(0, s.shield - dmg)
        this.emitEvent('HIT', [ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t], 0.8)
        if (s.shield <= 0) this.killShip(s)
        hit = true
        break
      }
      if (hit) {
        this.projectiles[pi] = this.projectiles[this.projectiles.length - 1]!
        this.projectiles.length -= 1
      }
    }
  }

  private killShip(ship: ShipState): void {
    if (!ship.alive) return
    ship.alive = false
    ship.shield = 0
    ship.vel[0] = 0; ship.vel[1] = 0; ship.vel[2] = 0
    ship.angVel[0] = 0; ship.angVel[1] = 0; ship.angVel[2] = 0
    ship.invulnTimer = WORLD_CONFIG.RESPAWN_DELAY_SEC
    this.emitEvent('PLAYER_DEATH', [ship.pos[0], ship.pos[1], ship.pos[2]], 2)
  }

  private respawnShip(ship: ShipState): void {
    ship.alive = true
    ship.shield = SHIP_CONFIG.MAX_SHIELD
    ship.energy = SHIP_CONFIG.MAX_ENERGY
    ship.pos[0] = 0; ship.pos[1] = 0; ship.pos[2] = 0
    ship.vel[0] = 0; ship.vel[1] = 0; ship.vel[2] = 0
    ship.rot[0] = 0; ship.rot[1] = 0; ship.rot[2] = 0; ship.rot[3] = 1
    ship.angVel[0] = 0; ship.angVel[1] = 0; ship.angVel[2] = 0
    ship.invulnTimer = WORLD_CONFIG.SPAWN_INVULN_SEC
  }

  private killEnemyAtIndex(index: number): void {
    const enemy = this.enemies[index]
    if (enemy === undefined) return

    this.emitEvent('EXPLOSION', [enemy.pos[0], enemy.pos[1], enemy.pos[2]], 1.2)
    if (enemy.archetype === 'SCAVENGER') {
      const drops = createScavengerDeathDrops(enemy, () => this.idSeq.next())
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i]
        if (d !== undefined) {
          this.pickups.push({ id: d.id, kind: d.kind, pos: [d.pos[0], d.pos[1], d.pos[2]], ttl: d.ttl })
        }
      }
    }

    this.enemyCooldowns.delete(enemy.id)
    // swap-remove enemy and keep enemyIntents aligned
    const lastIdx = this.enemies.length - 1
    this.enemies[index] = this.enemies[lastIdx]!
    this.enemies.length -= 1
    if (this.enemyIntents.length > lastIdx) {
      this.enemyIntents[index] = this.enemyIntents[lastIdx]!
      this.enemyIntents.length = this.enemies.length
    }
    this.waveManager.onEnemyKilled()
  }

  private stepPickups(): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i]
      if (p === undefined) continue
      p.ttl -= FIXED_DT
      if (p.ttl <= 0) {
        this.pickups[i] = this.pickups[this.pickups.length - 1]!
        this.pickups.length -= 1
        continue
      }

      // collection by any alive ship
      let collected = false
      for (let si = 0; si < this.ships.length; si++) {
        const s = this.ships[si]
        if (s === undefined || !s.alive) continue
        if (distSq(p.pos[0], p.pos[1], p.pos[2], s.pos[0], s.pos[1], s.pos[2]) <= PICKUP_RADIUS * PICKUP_RADIUS) {
          if (p.kind === 'SHIELD_CRYSTAL') s.shield = clamp(s.shield + 30, 0, SHIP_CONFIG.MAX_SHIELD)
          if (p.kind === 'ENERGY_CRYSTAL') s.energy = clamp(s.energy + 40, 0, SHIP_CONFIG.MAX_ENERGY)
          this.emitEvent('PICKUP', [p.pos[0], p.pos[1], p.pos[2]], 0.5)
          collected = true
          break
        }
      }
      if (collected) {
        this.pickups[i] = this.pickups[this.pickups.length - 1]!
        this.pickups.length -= 1
      }
    }
  }

  private stepWave(): void {
    if (!this.autoWaves) return
    if (this.waveManager.currentWave <= 0) return
    if (this.waveManager.isWaveClear()) {
      this.emitEvent('WAVE_CLEAR', [0, 0, 0], 1)
      const next = this.waveManager.advance()
      this.spawnWave(next)
    }
  }
}
