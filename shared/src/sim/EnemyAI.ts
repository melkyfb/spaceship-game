import { ENEMY_ARCHETYPES } from '../constants'
import { isFiniteNumber } from '../math'
import type { AsteroidState, EnemyArchetype, EnemyState, PickupState, ShipState } from '../types'
import { ASTEROID_TIERS } from '../constants'

export interface EnemyIntent {
  /** Desired velocity in world units/sec. */
  moveX: number
  moveY: number
  moveZ: number
  /** Facing direction (unit vector). Zero when no facing preference. */
  faceX: number
  faceY: number
  faceZ: number
  firePrimary: boolean
  fireSecondary: boolean
}

export function createEnemyIntent(): EnemyIntent {
  return {
    moveX: 0,
    moveY: 0,
    moveZ: 0,
    faceX: 0,
    faceY: 0,
    faceZ: 1,
    firePrimary: false,
    fireSecondary: false,
  }
}

function resetIntent(out: EnemyIntent): void {
  out.moveX = 0
  out.moveY = 0
  out.moveZ = 0
  out.faceX = 0
  out.faceY = 0
  out.faceZ = 1
  out.firePrimary = false
  out.fireSecondary = false
}

function finite(v: number, fallback = 0): number {
  return isFiniteNumber(v) ? v : fallback
}

function vLen(x: number, y: number, z: number): number {
  return Math.hypot(x, y, z)
}

function clamp01(v: number): number {
  if (v <= 0) return 0
  if (v >= 1) return 1
  return v
}

// Scratch vectors to avoid per-tick allocations.
const S = {
  // desired direction
  dx: 0, dy: 0, dz: 0,
  // avoidance
  ax: 0, ay: 0, az: 0,
  // right/up basis
  rx: 0, ry: 0, rz: 0,
  ux: 0, uy: 0, uz: 0,
  // temp
  tx: 0, ty: 0, tz: 0,
  // scavenger target scratch
  tgx: 0, tgy: 0, tgz: 0,
}

function setBasisFromForward(fx: number, fy: number, fz: number): void {
  // Build a stable orthonormal basis (right, up) around forward.
  // Pick a helper axis not parallel to forward.
  let hx = 0
  let hy = 1
  let hz = 0
  if (Math.abs(fy) > 0.9) {
    hx = 1
    hy = 0
    hz = 0
  }
  // right = normalize(cross(forward, helper))
  let rx = fy * hz - fz * hy
  let ry = fz * hx - fx * hz
  let rz = fx * hy - fy * hx
  const rl = Math.hypot(rx, ry, rz)
  if (rl <= 1e-9) {
    rx = 1; ry = 0; rz = 0
  } else {
    rx /= rl; ry /= rl; rz /= rl
  }
  // up = cross(right, forward)
  const ux = ry * fz - rz * fy
  const uy = rz * fx - rx * fz
  const uz = rx * fy - ry * fx
  S.rx = rx; S.ry = ry; S.rz = rz
  S.ux = ux; S.uy = uy; S.uz = uz
}

// 5-ray cone: center + 4 around at ~25 degrees.
const RAY_ANGLES: readonly [number, number][] = [
  [0, 0],
  [0.45, 0],
  [-0.45, 0],
  [0, 0.45],
  [0, -0.45],
]

const AVOID_LOOKAHEAD = 60
const AVOID_STRENGTH = 1.35

function applyAvoidance(
  px: number, py: number, pz: number,
  dirX: number, dirY: number, dirZ: number,
  asteroids: readonly AsteroidState[],
): void {
  S.ax = 0; S.ay = 0; S.az = 0
  const dl = Math.hypot(dirX, dirY, dirZ)
  if (dl <= 1e-9) return
  const fx = dirX / dl
  const fy = dirY / dl
  const fz = dirZ / dl
  setBasisFromForward(fx, fy, fz)

  for (let r = 0; r < RAY_ANGLES.length; r++) {
    const ang = RAY_ANGLES[r]!
    const yawOff = ang[0]
    const pitchOff = ang[1]
    // ray direction = normalize(forward + right*yawOff + up*pitchOff)
    let rdx = fx + S.rx * yawOff + S.ux * pitchOff
    let rdy = fy + S.ry * yawOff + S.uy * pitchOff
    let rdz = fz + S.rz * yawOff + S.uz * pitchOff
    const rdl = Math.hypot(rdx, rdy, rdz)
    if (rdl <= 1e-9) continue
    rdx /= rdl; rdy /= rdl; rdz /= rdl

    let nearestT = AVOID_LOOKAHEAD + 1
    let hitNx = 0
    let hitNy = 0
    let hitNz = 0
    let hit = false

    for (let i = 0; i < asteroids.length; i++) {
      const a = asteroids[i]
      if (a === undefined) continue
      const ax = finite(a.pos[0])
      const ay = finite(a.pos[1])
      const az = finite(a.pos[2])
      const radius = ASTEROID_TIERS[a.size].radius + 2.5 // padding for enemy body
      // Ray-sphere intersection: ray origin P, dir D, sphere center C, radius R
      const ocx = px - ax
      const ocy = py - ay
      const ocz = pz - az
      const b = ocx * rdx + ocy * rdy + ocz * rdz
      const c = ocx * ocx + ocy * ocy + ocz * ocz - radius * radius
      // t^2 + 2b*t + c = 0; we want smallest positive t
      const disc = b * b - c
      if (disc < 0) continue
      const sqrtDisc = Math.sqrt(disc)
      let t = -b - sqrtDisc
      if (t < 0) t = -b + sqrtDisc
      if (t < 0 || t > AVOID_LOOKAHEAD) continue
      if (t < nearestT) {
        nearestT = t
        // Push away from asteroid center at hit region
        let hx = px + rdx * t - ax
        let hy = py + rdy * t - ay
        let hz = pz + rdz * t - az
        const hl = Math.hypot(hx, hy, hz)
        if (hl > 1e-9) {
          hx /= hl; hy /= hl; hz /= hl
        } else {
          hx = -rdx; hy = -rdy; hz = -rdz
        }
        // If the push is nearly anti-parallel to ray (dead-center hit), deflect sideways
        const along = hx * rdx + hy * rdy + hz * rdz
        let pxAway = hx - along * rdx
        let pyAway = hy - along * rdy
        let pzAway = hz - along * rdz
        const pLen = Math.hypot(pxAway, pyAway, pzAway)
        if (pLen > 1e-6) {
          hitNx = pxAway / pLen
          hitNy = pyAway / pLen
          hitNz = pzAway / pLen
        } else {
          // Dead-center: deterministic lateral escape using basis right
          hitNx = S.rx
          hitNy = S.ry
          hitNz = S.rz
        }
        hit = true
      }
    }

    if (hit) {
      const weight = (1 - clamp01(nearestT / AVOID_LOOKAHEAD)) * AVOID_STRENGTH
      // Center ray gets stronger weight
      const centerBoost = r === 0 ? 1.5 : 1.0
      S.ax += hitNx * weight * centerBoost
      S.ay += hitNy * weight * centerBoost
      S.az += hitNz * weight * centerBoost
    }
  }
}

function nearestAlivePlayer(
  px: number, py: number, pz: number,
  players: readonly ShipState[],
): ShipState | null {
  let best: ShipState | null = null
  let bestDistSq = Infinity
  for (let i = 0; i < players.length; i++) {
    const p = players[i]
    if (p === undefined || p.alive !== true) continue
    const dx = finite(p.pos[0]) - px
    const dy = finite(p.pos[1]) - py
    const dz = finite(p.pos[2]) - pz
    const d2 = dx * dx + dy * dy + dz * dz
    if (d2 < bestDistSq) {
      bestDistSq = d2
      best = p
    }
  }
  return best
}

function nearestAlivePlayerWithin(
  px: number, py: number, pz: number,
  players: readonly ShipState[],
  range: number,
): ShipState | null {
  const r2 = range * range
  let best: ShipState | null = null
  let bestDistSq = r2
  for (let i = 0; i < players.length; i++) {
    const p = players[i]
    if (p === undefined || p.alive !== true) continue
    const dx = finite(p.pos[0]) - px
    const dy = finite(p.pos[1]) - py
    const dz = finite(p.pos[2]) - pz
    const d2 = dx * dx + dy * dy + dz * dz
    if (d2 < bestDistSq) {
      bestDistSq = d2
      best = p
    }
  }
  return best
}

function stepScout(
  enemy: EnemyState,
  players: readonly ShipState[],
  asteroids: readonly AsteroidState[],
  timeSec: number,
  out: EnemyIntent,
): void {
  const px = finite(enemy.pos[0])
  const py = finite(enemy.pos[1])
  const pz = finite(enemy.pos[2])
  const target = nearestAlivePlayer(px, py, pz, players)
  if (target === null) return

  const tx = finite(target.pos[0]) - px
  const ty = finite(target.pos[1]) - py
  const tz = finite(target.pos[2]) - pz
  const dist = Math.hypot(tx, ty, tz)
  if (dist <= 1e-9) return

  const fx = tx / dist
  const fy = ty / dist
  const fz = tz / dist

  let dx = fx
  let dy = fy
  let dz = fz

  // Sinusoidal strafe when within 120u
  if (dist < ENEMY_ARCHETYPES.SCOUT.strafeRange) {
    setBasisFromForward(fx, fy, fz)
    const phase = enemy.id * 1.37
    const strafe = Math.sin(timeSec * 2.6 + phase)
    const strafeMag = 0.55
    dx += S.rx * strafe * strafeMag
    dy += S.ry * strafe * strafeMag
    dz += S.rz * strafe * strafeMag
  }

  // 5-ray avoidance
  applyAvoidance(px, py, pz, dx, dy, dz, asteroids)
  dx += S.ax
  dy += S.ay
  dz += S.az

  const dl = Math.hypot(dx, dy, dz)
  if (dl > 1e-9) {
    out.moveX = (dx / dl) * ENEMY_ARCHETYPES.SCOUT.speed
    out.moveY = (dy / dl) * ENEMY_ARCHETYPES.SCOUT.speed
    out.moveZ = (dz / dl) * ENEMY_ARCHETYPES.SCOUT.speed
  }

  // Face toward target
  out.faceX = fx
  out.faceY = fy
  out.faceZ = fz

  // Fire primary when target within <15° cone of facing
  const faceDot = out.faceX * fx + out.faceY * fy + out.faceZ * fz
  const cos15 = Math.cos((15 * Math.PI) / 180)
  out.firePrimary = faceDot > cos15
}

function stepBruiser(
  enemy: EnemyState,
  players: readonly ShipState[],
  asteroids: readonly AsteroidState[],
  _timeSec: number,
  out: EnemyIntent,
): void {
  const px = finite(enemy.pos[0])
  const py = finite(enemy.pos[1])
  const pz = finite(enemy.pos[2])
  const target = nearestAlivePlayer(px, py, pz, players)
  if (target === null) return

  const tx = finite(target.pos[0]) - px
  const ty = finite(target.pos[1]) - py
  const tz = finite(target.pos[2]) - pz
  const dist = Math.hypot(tx, ty, tz)
  if (dist <= 1e-9) return

  const fx = tx / dist
  const fy = ty / dist
  const fz = tz / dist

  const orbitRange = ENEMY_ARCHETYPES.BRUISER.orbitRange
  let dx = 0
  let dy = 0
  let dz = 0

  if (dist > orbitRange) {
    // Arrive: move toward target, slow as approaching orbit range
    const approach = clamp01((dist - orbitRange) / orbitRange)
    dx = fx * approach
    dy = fy * approach
    dz = fz * approach
  } else {
    // Inside orbit: move outward slightly and orbit tangentially
    const outward = clamp01((orbitRange - dist) / orbitRange)
    setBasisFromForward(fx, fy, fz)
    // Tangential orbit direction (use right vector)
    const orbitSign = enemy.id % 2 === 0 ? 1 : -1
    dx = -fx * outward * 0.8 + S.rx * orbitSign * 1.0
    dy = -fy * outward * 0.8 + S.ry * orbitSign * 1.0
    dz = -fz * outward * 0.8 + S.rz * orbitSign * 1.0
  }

  // 5-ray avoidance
  const moveDirLen = Math.hypot(dx, dy, dz)
  const avoidDirX = moveDirLen > 1e-9 ? dx : fx
  const avoidDirY = moveDirLen > 1e-9 ? dy : fy
  const avoidDirZ = moveDirLen > 1e-9 ? dz : fz
  applyAvoidance(px, py, pz, avoidDirX, avoidDirY, avoidDirZ, asteroids)
  dx += S.ax
  dy += S.ay
  dz += S.az

  const dl = Math.hypot(dx, dy, dz)
  if (dl > 1e-9) {
    out.moveX = (dx / dl) * ENEMY_ARCHETYPES.BRUISER.speed
    out.moveY = (dy / dl) * ENEMY_ARCHETYPES.BRUISER.speed
    out.moveZ = (dz / dl) * ENEMY_ARCHETYPES.BRUISER.speed
  }

  // Prow aligned to target
  out.faceX = fx
  out.faceY = fy
  out.faceZ = fz

  // Slow homing missile
  out.fireSecondary = true
}

function findNearestScavengerTarget(
  px: number, py: number, pz: number,
  asteroids: readonly AsteroidState[],
  pickups: readonly PickupState[],
): boolean {
  let bestDistSq = Infinity
  let found = false

  for (let i = 0; i < asteroids.length; i++) {
    const a = asteroids[i]
    if (a === undefined || a.size !== 'SMALL') continue
    const ax = finite(a.pos[0])
    const ay = finite(a.pos[1])
    const az = finite(a.pos[2])
    const dx = ax - px
    const dy = ay - py
    const dz = az - pz
    const d2 = dx * dx + dy * dy + dz * dz
    if (d2 < bestDistSq) {
      bestDistSq = d2
      S.tgx = ax; S.tgy = ay; S.tgz = az
      found = true
    }
  }

  for (let i = 0; i < pickups.length; i++) {
    const p = pickups[i]
    if (p === undefined) continue
    const cx = finite(p.pos[0])
    const cy = finite(p.pos[1])
    const cz = finite(p.pos[2])
    const dx = cx - px
    const dy = cy - py
    const dz = cz - pz
    const d2 = dx * dx + dy * dy + dz * dz
    if (d2 < bestDistSq) {
      bestDistSq = d2
      S.tgx = cx; S.tgy = cy; S.tgz = cz
      found = true
    }
  }

  return found
}

function stepScavenger(
  enemy: EnemyState,
  players: readonly ShipState[],
  asteroids: readonly AsteroidState[],
  pickups: readonly PickupState[],
  _timeSec: number,
  out: EnemyIntent,
): void {
  const px = finite(enemy.pos[0])
  const py = finite(enemy.pos[1])
  const pz = finite(enemy.pos[2])

  // Flee if any player within 55u
  const threat = nearestAlivePlayerWithin(px, py, pz, players, ENEMY_ARCHETYPES.SCAVENGER.fleeRange)
  if (threat !== null) {
    let dx = px - finite(threat.pos[0])
    let dy = py - finite(threat.pos[1])
    let dz = pz - finite(threat.pos[2])
    const dl = Math.hypot(dx, dy, dz)
    if (dl > 1e-9) { dx /= dl; dy /= dl; dz /= dl } else { dx = 0; dy = 0; dz = 0 }
    // Avoidance still helps while fleeing
    applyAvoidance(px, py, pz, dx, dy, dz, asteroids)
    let mx = dx + S.ax
    let my = dy + S.ay
    let mz = dz + S.az
    const ml = Math.hypot(mx, my, mz)
    if (ml > 1e-9) {
      out.moveX = (mx / ml) * ENEMY_ARCHETYPES.SCAVENGER.speed
      out.moveY = (my / ml) * ENEMY_ARCHETYPES.SCAVENGER.speed
      out.moveZ = (mz / ml) * ENEMY_ARCHETYPES.SCAVENGER.speed
      out.faceX = mx / ml
      out.faceY = my / ml
      out.faceZ = mz / ml
    }
    out.firePrimary = false
    out.fireSecondary = false
    return
  }

  if (findNearestScavengerTarget(px, py, pz, asteroids, pickups)) {
    let dx = S.tgx - px
    let dy = S.tgy - py
    let dz = S.tgz - pz
    const dl = Math.hypot(dx, dy, dz)
    if (dl > 1e-9) { dx /= dl; dy /= dl; dz /= dl } else { dx = 0; dy = 0; dz = 0 }
    applyAvoidance(px, py, pz, dx, dy, dz, asteroids)
    let mx = dx + S.ax
    let my = dy + S.ay
    let mz = dz + S.az
    const ml = Math.hypot(mx, my, mz)
    if (ml > 1e-9) {
      out.moveX = (mx / ml) * ENEMY_ARCHETYPES.SCAVENGER.speed
      out.moveY = (my / ml) * ENEMY_ARCHETYPES.SCAVENGER.speed
      out.moveZ = (mz / ml) * ENEMY_ARCHETYPES.SCAVENGER.speed
      out.faceX = mx / ml
      out.faceY = my / ml
      out.faceZ = mz / ml
    }
  }

  out.firePrimary = false
  out.fireSecondary = false
}

export function stepEnemyAI(
  enemy: EnemyState,
  players: readonly ShipState[],
  asteroids: readonly AsteroidState[],
  pickups: readonly PickupState[],
  timeSec: number,
  out: EnemyIntent,
): void {
  resetIntent(out)
  const time = finite(timeSec, 0)

  switch (enemy.archetype) {
    case 'SCOUT':
      stepScout(enemy, players, asteroids, time, out)
      return
    case 'BRUISER':
      stepBruiser(enemy, players, asteroids, time, out)
      return
    case 'SCAVENGER':
      stepScavenger(enemy, players, asteroids, pickups, time, out)
      return
    default: {
      // Exhaustive guard - no-op for unknown archetypes
      const _exhaustive: never = enemy.archetype
      void _exhaustive
      return
    }
  }
}

export interface ScavengerDrop {
  id: number
  kind: 'SHIELD_CRYSTAL' | 'ENERGY_CRYSTAL'
  pos: [number, number, number]
  ttl: number
}

/** Creates the 2 crystals dropped by a dead SCAVENGER (Shield + Energy). Deterministic given nextId. */
export function createScavengerDeathDrops(
  enemy: EnemyState,
  nextId: () => number,
): ScavengerDrop[] {
  const x = finite(enemy.pos[0])
  const y = finite(enemy.pos[1])
  const z = finite(enemy.pos[2])
  return [
    { id: nextId(), kind: 'SHIELD_CRYSTAL', pos: [x, y, z], ttl: 30 },
    { id: nextId(), kind: 'ENERGY_CRYSTAL', pos: [x, y, z], ttl: 30 },
  ]
}